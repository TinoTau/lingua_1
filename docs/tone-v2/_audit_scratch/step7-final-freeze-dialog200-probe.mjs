/**
 * Step 7 — Final Lattice Freeze dialog_200 production probe.
 *
 * Uses real production orchestrator only (no LTR / mock Recall / mock KenLM pool).
 * Hard gates + diversity quality observation (not architecture failure).
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\step7-final-freeze-dialog200-probe.mjs
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
const outDir = path.resolve(__dirname, 'step7_final_freeze');

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
  'ltrRuntimeEnabled',
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

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Math.round(sorted[idx]);
}

function bump(map, key) {
  const k = String(key);
  map[k] = (map[k] || 0) + 1;
}

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
let latticeGenerationFailure = 0;
let coverageFailure = 0;
let materializationFailure = 0;
let pathAssemblyFailure = 0;
let fallbackCaseCount = 0;
let kenlmInputOver16 = 0;
let duplicateKenlmText = 0;
let undefinedPrefilledCombinations = 0;
let legacyTraceFieldCount = 0;
let distinctTextsBeforeDedupAllOne = 0;

const pathCountDistribution = {};
const crossPathInputCountDistribution = {};
const uniqueCandidateCountDistribution = {};
const kenlmInputCountDistribution = {};
const perPathCandidateCountSamples = [];
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

    const lt = out.latticeTrace || {};
    const ac = out.metrics?.architectureCompliance || {};
    const pathCount =
      ac.retainedCompletePathCount ??
      out.pathAssemblyTraces?.length ??
      lt.retainedCompletePathCount ??
      0;
    bump(pathCountDistribution, pathCount);

    if (lt.coverageStatus && lt.coverageStatus !== 'complete') {
      coverageFailure += 1;
    }
    if (lt.generationStatus === 'failed' || lt.errorCode) {
      latticeGenerationFailure += 1;
    }
    if (lt.materializationStatus === 'failed') {
      materializationFailure += 1;
    }
    if ((lt.fallbackEdgeCount || 0) > 0 || (lt.edgeCountAfterFallback || 0) > (lt.edgeCountBeforeFallback || 0)) {
      fallbackCaseCount += 1;
    }

    const pathTraces = out.pathAssemblyTraces || [];
    let pathAsmFail = false;
    const perPathCounts = [];
    for (const pt of pathTraces) {
      if (pt?.status === 'failed' || pt?.error) pathAsmFail = true;
      const n =
        (pt?.bucketSentenceCandidateCounts || []).reduce((a, b) => a + (b || 0), 0) ||
        pt?.sentenceCandidateCount ||
        0;
      perPathCounts.push(n);
    }
    if (pathAsmFail) pathAssemblyFailure += 1;
    perPathCandidateCountSamples.push({ caseId, pathCount, perPathCounts });

    const crossIn = out.metrics?.crossPathInputCandidateCount ?? out.crossPathMergeTrace?.inputCount ?? 0;
    const uniqueAfter =
      out.metrics?.crossPathUniqueCandidateCount ??
      out.crossPathMergeTrace?.uniqueAfterDedup ??
      out.kenlmSentenceCandidates?.uniqueBeforeCap?.length ??
      0;
    bump(crossPathInputCountDistribution, crossIn);
    bump(uniqueCandidateCountDistribution, uniqueAfter);

    const distinctBefore =
      out.crossPathMergeTrace?.distinctTextsBeforeDedup ??
      out.metrics?.crossPathInputCandidateCount ??
      crossIn;
    if (distinctBefore === 1) distinctTextsBeforeDedupAllOne += 1;

    const prefilled = out.kenlmSentenceCandidates?.combinations;
    if (prefilled === undefined) undefinedPrefilledCombinations += 1;
    const texts = (prefilled || []).map((x) => x.text);
    bump(kenlmInputCountDistribution, texts.length);
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
    if (Object.prototype.hasOwnProperty.call(ac, 'ltrRuntimeEnabled')) {
      issues.push('ltrRuntimeEnabled_present');
    }
    if (issues.length && !failCases.some((f) => f.caseId === caseId)) {
      failCases.push({ caseId, issues });
    }
    results.push({
      caseId,
      ok: issues.length === 0,
      pathsPerCase: pathCount,
      perPathCandidateCount: perPathCounts,
      distinctTextsBeforeDedup: distinctBefore,
      uniqueTextsAfterDedup: uniqueAfter,
      kenlmN: texts.length,
      issues,
    });
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

latencies.sort((a, b) => a - b);

const hardGatePass =
  legacyModuleAbsent &&
  cases.length === 200 &&
  orchestratorSuccess === 200 &&
  orchestratorFailure === 0 &&
  coverageFailure === 0 &&
  materializationFailure === 0 &&
  pathAssemblyFailure === 0 &&
  kenlmInputOver16 === 0 &&
  duplicateKenlmText === 0 &&
  undefinedPrefilledCombinations === 0 &&
  legacyTraceFieldCount === 0 &&
  failCases.length === 0;

const summary = {
  entry: 'runSpanAssemblyV4Orchestrator (Step 7 final freeze)',
  casesTotal: cases.length,
  orchestratorSuccess,
  orchestratorFailure,
  latticeGenerationFailure,
  coverageFailure,
  materializationFailure,
  pathCountDistribution,
  fallbackCaseCount,
  pathAssemblyFailure,
  crossPathInputCountDistribution,
  uniqueCandidateCountDistribution,
  kenlmInputCountDistribution,
  kenlmInputOver16,
  duplicateKenlmText,
  undefinedPrefilledCombinations,
  legacyTraceFieldCount,
  legacyModuleAbsent,
  distinctTextsBeforeDedupEquals1Count: distinctTextsBeforeDedupAllOne,
  qualityObservation:
    'distinctTextsBeforeCrossPathDedup / unique candidate diversity is Quality Observation, not Architecture Freeze Failure',
  hardGatePass,
  latencyMs: {
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length ? Math.round(latencies[latencies.length - 1]) : 0,
    total: Math.round(performance.now() - tAll),
  },
  sqlQueryCount: 'NOT_OWNED_HERE (orchestrator probe does not instrument SQLite counters)',
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
