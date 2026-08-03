/**
 * Step 3 — Production orchestrator Lattice cutover on dialog_200.
 *
 * Proves runSpanAssemblyV4Orchestrator is Lattice-driven and LTR call count = 0.
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\step3-orchestrator-lattice-cutover-dialog200-probe.mjs
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '../../../electron_node/electron-node');
const dist = path.join(root, 'dist/main/electron-node/main/src');
const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.resolve(__dirname, 'step3_orchestrator_lattice_cutover');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logLines.push(line);
  console.error(line);
}

const ltrPath = path.join(dist, 'fw-detector/span-assembly-v4/ltr-fine-span-generator.js');
const ltrMod = require(ltrPath);
let ltrCallCount = 0;
const originalLtr = ltrMod.runLtrFineSpanGeneration;
ltrMod.runLtrFineSpanGeneration = function patchedLtr(...args) {
  ltrCallCount += 1;
  return originalLtr.apply(this, args);
};

const { LexiconRuntimeV2 } = require(path.join(dist, 'lexicon-v2/lexicon-runtime-v2.js'));
const { defaultGeneralProfile } = require(path.join(dist, 'lexicon-v2/profile-registry.js'));
const { resolveRecallScope } = require(
  path.join(dist, 'lexicon-v2/resolve-recall-enabled-fine-domains.js')
);
const { loadFwDetectorRuntimeConfig } = require(path.join(dist, 'fw-detector/fw-config.js'));
const { loadPinyinImeV2RuntimeConfig } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-config.js')
);
const { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-dict-load.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);

const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
log(`load.status=${loadState.status}`);
if (loadState.status !== 'ok') {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'startup.log'), logLines.join('\n') + '\n');
  process.exit(1);
}

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;

const cases = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
).cases.filter((c) => typeof c.text === 'string' && c.text.length > 0);

const latencies = [];
const pathCountHist = {};
const latticeFailureCodes = {};
let orchestratorSuccess = 0;
let orchestratorFailure = 0;
let fallbackCases = 0;
let pathsWithZeroAssemblyCandidates = 0;
let duplicateCandidateCount = 0;
let sqlQueryCount = 0;
const failCases = [];
const results = [];

const tAll = performance.now();
for (const c of cases) {
  const caseId = c.id || c.caseId || 'unknown';
  const t0 = performance.now();
  try {
    const out = runSpanAssemblyV4Orchestrator({
      rawText: c.text,
      runtime,
      profile,
      recallDomainScope: domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      domainPriors: [],
    });
    const elapsed = performance.now() - t0;
    latencies.push(elapsed);
    orchestratorSuccess += 1;
    const pathCount = out.pathAssemblyResults?.length ?? 0;
    pathCountHist[pathCount] = (pathCountHist[pathCount] || 0) + 1;
    if ((out.latticeTrace?.fallbackInjectionCount ?? 0) > 0) fallbackCases += 1;
    for (const p of out.pathAssemblyResults || []) {
      if (p.sentenceCandidateCount === 0) pathsWithZeroAssemblyCandidates += 1;
    }
    const texts = (out.kenlmSentenceCandidates?.combinations || []).map((x) => x.text);
    duplicateCandidateCount += texts.length - new Set(texts).size;
    sqlQueryCount += out.metrics?.physicalSqlStatementCount ?? 0;

    const mode = out.metrics?.architectureCompliance?.generatorMode;
    if (mode !== 'multi_path_lattice') {
      failCases.push({ caseId, code: 'BAD_GENERATOR_MODE', message: String(mode) });
    }
    results.push({
      caseId,
      ok: true,
      pathCount,
      fallbackInjectionCount: out.latticeTrace?.fallbackInjectionCount ?? 0,
      kenlmPool: out.kenlmSentenceCandidates?.combinations?.length ?? 0,
      elapsedMs: Math.round(elapsed),
      generatorMode: mode,
    });
  } catch (err) {
    orchestratorFailure += 1;
    const msg = err && err.message ? err.message : String(err);
    const codeMatch = /LATTICE_([A-Z_]+)/.exec(msg);
    const code = codeMatch ? codeMatch[1] : 'THROW';
    latticeFailureCodes[code] = (latticeFailureCodes[code] || 0) + 1;
    failCases.push({ caseId, code, message: msg, rawText: c.text });
    results.push({ caseId, ok: false, code, message: msg });
  }
}
const totalMs = performance.now() - tAll;
latencies.sort((a, b) => a - b);
const pct = (p) =>
  latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] : 0;

const summary = {
  entry: 'runSpanAssemblyV4Orchestrator',
  casesTotal: cases.length,
  orchestratorSuccess,
  orchestratorFailure,
  latticeFailureCodes,
  pathCountDistribution: pathCountHist,
  fallbackCases,
  pathsWithZeroAssemblyCandidates,
  finalPreKenlmCandidateNotes: 'STEP3_TEMPORARY_PRE_STEP4_COLLECTION',
  duplicateCandidateCount,
  latencyMs: {
    p50: Math.round(pct(50)),
    p95: Math.round(pct(95)),
    max: Math.round(latencies[latencies.length - 1] || 0),
    total: Math.round(totalMs),
  },
  sqlQueryCount,
  ltrRuntimeCallCount: ltrCallCount,
  failCases,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dialog_200_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'dialog_200_results.jsonl'),
  results.map((r) => JSON.stringify(r)).join('\n') + '\n'
);
fs.writeFileSync(path.join(outDir, 'probe.log'), logLines.join('\n') + '\n');
log(`summary=${JSON.stringify(summary)}`);

if (ltrCallCount !== 0 || orchestratorFailure > 0 || failCases.length > 0) {
  process.exit(2);
}
process.exit(0);
