/**
 * Lattice Phase 1 offline probe on dialog_200 GT texts.
 * Harness-only measurement — no production cutover / no WAV ASR E2E.
 *
 * Run (Electron ABI):
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe docs/tone-v2/_audit_scratch/phase1-window-edge-dialog200-probe.mjs
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

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

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
const { runPhase1WindowEdgeHarness } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/phase1-window-edge-harness.js')
);

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);

const runtime = new LexiconRuntimeV2();
const bundleDir = path.resolve(repoRoot, 'node_runtime/lexicon/v3');
const loadState = runtime.loadFromBundleDir(bundleDir);
if (loadState.status !== 'ok') {
  console.error('lexicon load failed', loadState);
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

const cases = (manifest.cases || []).filter((c) => typeof c.text === 'string' && c.text.length > 0);
const latencies = [];
const rows = [];
let completed = 0;
let failed = 0;
let incompleteRecallCases = [];
const knownFive = new Set(['d019', 'd064', 'd109', 'd154', 'd199']);
const knownFiveResults = [];

const heapStart = process.memoryUsage().heapUsed;
const tAll = performance.now();

for (const c of cases) {
  const caseId = c.id || c.caseId || `case_${completed + failed}`;
  try {
    const t0 = performance.now();
    const result = runPhase1WindowEdgeHarness({
      rawText: c.text,
      runtime,
      profile,
      domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      measureHeap: false,
    });
    const ms = performance.now() - t0;
    latencies.push(ms);
    const d = result.diagnostics;
    if (d.logicalWindowRecallCount !== d.recallableWindowCount) {
      incompleteRecallCases.push({
        caseId,
        logicalWindowRecallCount: d.logicalWindowRecallCount,
        recallableWindowCount: d.recallableWindowCount,
      });
    }
    if (knownFive.has(caseId)) {
      const e3234 = result.edges.find((e) => e.edgeId === '32:34');
      const e3436 = result.edges.find((e) => e.edgeId === '34:36');
      knownFiveResults.push({
        caseId,
        edge_32_34: e3234
          ? { candidateCount: e3234.candidates.length, replacements: e3234.candidates.map((x) => x.replacement) }
          : null,
        edge_34_36: e3436
          ? { candidateCount: e3436.candidates.length, replacements: e3436.candidates.map((x) => x.replacement) }
          : null,
      });
    }
    rows.push({
      caseId,
      syllableCount: result.syllableCount,
      windowCount: d.windowCount,
      blockedWindowCount: d.blockedWindowCount,
      recallableWindowCount: d.recallableWindowCount,
      logicalWindowRecallCount: d.logicalWindowRecallCount,
      uniqueRecallKeyCount: d.uniqueRecallKeyCount,
      cacheHitCount: d.cacheHitCount,
      cacheMissCount: d.cacheMissCount,
      physicalSqlStatementCount: d.physicalSqlStatementCount,
      edgeCount: d.edgeCount,
      candidateCount: d.candidateCount,
      singleCharWindowCount: d.singleCharWindowCount ?? 0,
      singleCharRecallCount: d.singleCharRecallCount ?? 0,
      singleCharHitCount: d.singleCharHitCount ?? 0,
      singleCharCandidateCount: d.singleCharCandidateCount ?? 0,
      singleCharCandidateCapHitCount: d.singleCharCandidateCapHitCount ?? 0,
      singleCharLexicalEdgeCount: d.singleCharLexicalEdgeCount ?? 0,
      latencyMs: Math.round(ms * 100) / 100,
    });
    completed += 1;
  } catch (err) {
    failed += 1;
    rows.push({
      caseId,
      error: err && err.message ? err.message : String(err),
    });
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

latencies.sort((a, b) => a - b);
const heapEnd = process.memoryUsage().heapUsed;

const summary = {
  harnessOnly: true,
  productionCutover: false,
  note: 'Phase 1 Window/Edge harness on dialog_200 GT text — not full production E2E',
  completed,
  failed,
  caseCount: cases.length,
  windowCount: {
    sum: rows.reduce((n, r) => n + (r.windowCount || 0), 0),
    avg: completed ? rows.reduce((n, r) => n + (r.windowCount || 0), 0) / completed : 0,
    min: completed ? Math.min(...rows.map((r) => r.windowCount || 0)) : 0,
    max: completed ? Math.max(...rows.map((r) => r.windowCount || 0)) : 0,
  },
  blockedCount: {
    sum: rows.reduce((n, r) => n + (r.blockedWindowCount || 0), 0),
    avg: completed ? rows.reduce((n, r) => n + (r.blockedWindowCount || 0), 0) / completed : 0,
  },
  uniqueRecallKeys: {
    sum: rows.reduce((n, r) => n + (r.uniqueRecallKeyCount || 0), 0),
    avg: completed ? rows.reduce((n, r) => n + (r.uniqueRecallKeyCount || 0), 0) / completed : 0,
  },
  cacheHit: {
    sum: rows.reduce((n, r) => n + (r.cacheHitCount || 0), 0),
  },
  cacheMiss: {
    sum: rows.reduce((n, r) => n + (r.cacheMissCount || 0), 0),
  },
  physicalSql: {
    sum: rows.reduce((n, r) => n + (r.physicalSqlStatementCount || 0), 0),
    avg: completed
      ? rows.reduce((n, r) => n + (r.physicalSqlStatementCount || 0), 0) / completed
      : 0,
  },
  edgeCount: {
    sum: rows.reduce((n, r) => n + (r.edgeCount || 0), 0),
    avg: completed ? rows.reduce((n, r) => n + (r.edgeCount || 0), 0) / completed : 0,
  },
  singleChar: {
    windowCount: rows.reduce((n, r) => n + (r.singleCharWindowCount || 0), 0),
    recallCount: rows.reduce((n, r) => n + (r.singleCharRecallCount || 0), 0),
    hitCount: rows.reduce((n, r) => n + (r.singleCharHitCount || 0), 0),
    candidateCount: rows.reduce((n, r) => n + (r.singleCharCandidateCount || 0), 0),
    candidateCapHitCount: rows.reduce((n, r) => n + (r.singleCharCandidateCapHitCount || 0), 0),
    lexicalEdgeCount: rows.reduce((n, r) => n + (r.singleCharLexicalEdgeCount || 0), 0),
  },
  latencyMs: {
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    totalMs: performance.now() - tAll,
  },
  memory: {
    heapStartBytes: heapStart,
    heapEndBytes: heapEnd,
    heapDeltaBytes: heapEnd - heapStart,
  },
  recallCompleteness: {
    incompleteRecallCaseCount: incompleteRecallCases.length,
    incompleteRecallCases,
    partialRecallCases: incompleteRecallCases.length,
  },
  knownFiveResults,
  logicalWindowRecall: {
    sum: rows.reduce((n, r) => n + (r.logicalWindowRecallCount || 0), 0),
    avg: completed ? rows.reduce((n, r) => n + (r.logicalWindowRecallCount || 0), 0) / completed : 0,
  },
};

const outDir = path.resolve(__dirname, 'lattice_v1_phase1');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dialog_200_phase1_summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'dialog_200_phase1_results.jsonl'),
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
);

console.log(JSON.stringify(summary, null, 2));
