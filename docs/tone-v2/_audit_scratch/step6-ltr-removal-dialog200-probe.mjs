/**
 * Step 6 — Post-LTR-deletion dialog_200 Trace / Contract regression.
 *
 * Hard gates:
 *   orchestratorSuccess = 200
 *   orchestratorFailure = 0
 *   legacyTraceFieldCount = 0
 *   kenlmInputOver16 = 0
 *   duplicateKenlmText = 0
 *   undefinedPrefilledCombinations = 0
 *
 * Legacy Fine Span module must be absent (static require fails).
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\step6-ltr-removal-dialog200-probe.mjs
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
const outDir = path.resolve(__dirname, 'step6_ltr_removal');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logLines.push(line);
  console.error(line);
}

const LEGACY_TRACE_KEYS = [
  'formalSpans',
  'formalFineSpans',
  'formalCommit',
  'toneCommitTraces',
  'toneCommitTrace',
  'temporaryPreStep4Collection',
  'STEP3_TEMPORARY',
  'productionCutover',
  'phase2HarnessOnly',
  'fallbackToLtr',
  'shadowLtr',
  'FormalFineSpan',
  'toneRecomputedAfterCommit',
  'recomputedAfterCommit',
  'formalRawStart',
  'coverageComplete',
];

function collectLegacyKeys(obj, prefix = '', out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectLegacyKeys(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (LEGACY_TRACE_KEYS.includes(k)) out.push(p);
    if (v && typeof v === 'object') collectLegacyKeys(v, p, out);
  }
  return out;
}

// Static module resolution: legacy Fine Span generator must be gone.
const legacyGenPath = path.join(dist, 'fw-detector/span-assembly-v4', 'ltr' + '-fine-span-generator.js');
let legacyModuleAbsent = !fs.existsSync(legacyGenPath);
log(`legacyModuleAbsent=${legacyModuleAbsent} path=${legacyGenPath}`);

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

const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
log(`load.status=${loadState.status}`);
if (loadState.status !== 'ok') process.exit(1);

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

let orchestratorSuccess = 0;
let orchestratorFailure = 0;
let latticeTracePresent = 0;
let pathAssemblyTracePresent = 0;
let crossPathTracePresent = 0;
let kenlmInputOver16 = 0;
let duplicateKenlmText = 0;
let undefinedPrefilledCombinations = 0;
let legacyTraceFieldCount = 0;
const failCases = [];
const results = [];
const latencies = [];

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
    latencies.push(performance.now() - t0);
    orchestratorSuccess += 1;

    if (out.latticeTrace) latticeTracePresent += 1;
    if (out.pathAssemblyTraces?.length) pathAssemblyTracePresent += 1;
    if (out.crossPathMergeTrace) crossPathTracePresent += 1;

    const prefilled = out.kenlmSentenceCandidates?.combinations;
    if (prefilled === undefined) undefinedPrefilledCombinations += 1;
    const texts = (prefilled || []).map((x) => x.text);
    if (texts.length > 16) kenlmInputOver16 += 1;
    if (new Set(texts).size !== texts.length) duplicateKenlmText += 1;

    const legacyHits = collectLegacyKeys({
      latticeTrace: out.latticeTrace,
      pathAssemblyTraces: out.pathAssemblyTraces,
      crossPathMergeTrace: out.crossPathMergeTrace,
      architectureCompliance: out.metrics?.architectureCompliance,
    });
    if (legacyHits.length) {
      legacyTraceFieldCount += 1;
      failCases.push({ caseId, issues: ['LEGACY_TRACE'], legacyHits });
    }

    const issues = [];
    if (prefilled === undefined) issues.push('undefined_prefilled');
    if (texts.length > 16) issues.push('kenlm_over_16');
    if (new Set(texts).size !== texts.length) issues.push('dup_kenlm_text');
    if (legacyHits.length) issues.push('legacy_trace');
    if (out.metrics?.architectureCompliance?.ltrRuntimeEnabled !== false) {
      issues.push('ltrRuntimeEnabled');
    }
    if (issues.length && !failCases.some((f) => f.caseId === caseId)) {
      failCases.push({ caseId, issues });
    }
    results.push({ caseId, ok: issues.length === 0, kenlmN: texts.length, issues });
  } catch (err) {
    orchestratorFailure += 1;
    failCases.push({
      caseId,
      issues: ['THROW'],
      message: err && err.message ? err.message : String(err),
    });
    results.push({ caseId, ok: false });
  }
}

const hardGatePass =
  legacyModuleAbsent &&
  orchestratorSuccess === 200 &&
  orchestratorFailure === 0 &&
  legacyTraceFieldCount === 0 &&
  kenlmInputOver16 === 0 &&
  duplicateKenlmText === 0 &&
  undefinedPrefilledCombinations === 0 &&
  failCases.length === 0;

const summary = {
  entry: 'runSpanAssemblyV4Orchestrator (Step 6 post-deletion)',
  casesTotal: cases.length,
  orchestratorSuccess,
  orchestratorFailure,
  latticeTracePresent,
  pathAssemblyTracePresent,
  crossPathTracePresent,
  kenlmInputOver16,
  duplicateKenlmText,
  undefinedPrefilledCombinations,
  legacyTraceFieldCount,
  legacyModuleAbsent,
  hardGatePass,
  latencyMs: {
    p50: Math.round(latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.5)] || 0),
    total: Math.round(performance.now() - tAll),
  },
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

if (!hardGatePass) process.exit(2);
process.exit(0);
