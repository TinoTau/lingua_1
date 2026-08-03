/**
 * Step 2 — Lattice Production Entry offline validation on dialog_200 (real SQLite).
 *
 * Does NOT wire into production orchestrator.
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\step2-lattice-production-entry-dialog200-probe.mjs
 *
 * Outputs:
 *   docs/tone-v2/_audit_scratch/step2_lattice_production_entry/
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
const outDir = path.resolve(__dirname, 'step2_lattice_production_entry');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logLines.push(line);
  console.error(line);
}

log(`cwd=${process.cwd()}`);
log(`ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE || ''}`);

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
const { runLatticeFineSpanGeneration } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-fine-span-runtime.js')
);

const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(bundleDir);
log(`loadFromBundleDir.status=${loadState.status}`);
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
const recallScope = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains });
const domainIds = recallScope.domainIds;
log(`domainIds=${domainIds.join('|')}`);

const casesManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const cases = (casesManifest.cases || []).filter((c) => typeof c.text === 'string' && c.text.length > 0);

const results = [];
let completed = 0;
let withPath = 0;
let zeroPath = 0;
let requiringFallback = 0;
let materializationFailures = 0;
let coverageFailures = 0;
let maxPathCount = 0;
const pathCountHist = {};
const failCases = [];

const t0 = performance.now();
for (const c of cases) {
  const caseId = c.id || c.caseId || `unknown`;
  const rawText = c.text;
  let row;
  try {
    const out = runLatticeFineSpanGeneration({
      rawText,
      runtime,
      profile,
      domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
    });
    if (!out.ok) {
      zeroPath += 1;
      coverageFailures += 1;
      failCases.push({ caseId, code: out.code, message: out.message, rawText });
      row = { caseId, ok: false, code: out.code, message: out.message };
    } else {
      completed += 1;
      withPath += 1;
      const n = out.segmentationPaths.length;
      maxPathCount = Math.max(maxPathCount, n);
      pathCountHist[n] = (pathCountHist[n] || 0) + 1;
      if (out.trace.fallbackInjectionCount > 0) requiringFallback += 1;
      if (out.pathFineSpanViews.length !== out.segmentationPaths.length) {
        materializationFailures += 1;
        failCases.push({
          caseId,
          code: 'MATERIALIZATION_COUNT_MISMATCH',
          message: `views=${out.pathFineSpanViews.length} paths=${out.segmentationPaths.length}`,
          rawText,
        });
      }
      row = {
        caseId,
        ok: true,
        syllableCount: out.syllableCount,
        lexicalEdgeCount: out.trace.lexicalEdgeCount,
        fallbackEdgeCount: out.trace.fallbackEdgeCount,
        fallbackInjectionCount: out.trace.fallbackInjectionCount,
        retainedCompletePathCount: out.trace.retainedCompletePathCount,
        prunedPathCount: out.trace.prunedPathCount,
        materializedPathCount: out.trace.materializedPathCount,
        windowCount: out.trace.windowCount,
        logicalWindowRecallCount: out.trace.logicalWindowRecallCount,
      };
    }
  } catch (err) {
    coverageFailures += 1;
    failCases.push({
      caseId,
      code: 'THROW',
      message: err && err.message ? err.message : String(err),
      rawText,
    });
    row = { caseId, ok: false, code: 'THROW', message: String(err && err.message ? err.message : err) };
  }
  results.push(row);
}
const elapsedMs = Math.round(performance.now() - t0);

const summary = {
  entry: 'runLatticeFineSpanGeneration',
  casesTotal: cases.length,
  completed,
  casesWithAtLeastOneCompletePath: withPath,
  casesWithZeroCompletePath: zeroPath,
  casesRequiringFallback: requiringFallback,
  pathCountDistribution: pathCountHist,
  maxPathCount,
  materializationFailures,
  coverageFailures,
  failCases,
  elapsedMs,
  productionOrchestratorUnchanged: true,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dialog_200_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'dialog_200_results.jsonl'),
  results.map((r) => JSON.stringify(r)).join('\n') + '\n'
);
fs.writeFileSync(path.join(outDir, 'probe.log'), logLines.join('\n') + '\n');

log(`summary=${JSON.stringify(summary)}`);
if (zeroPath > 0 || coverageFailures > 0 || materializationFailures > 0) {
  process.exit(2);
}
process.exit(0);
