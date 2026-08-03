/**
 * Step 5 — Lattice Trace / Diagnostics / Acceptance contract validation on dialog_200.
 *
 * Hard gates (Trace/Contract only — not quality):
 *   casesWithLegacyTraceField = 0
 *   casesWithUndefinedPrefilledCombinations = 0
 *   casesWithKenlmInputOver16 = 0
 *   casesWithDuplicateKenlmText = 0
 *   ltrRuntimeCallCount = 0
 *
 * Quality observation only (NOT a Step 5 blocker):
 *   unique candidate count distribution / pathsPerCase / distinctTextsBeforeCrossPathDedup
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\step5-lattice-trace-dialog200-probe.mjs
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
const outDir = path.resolve(__dirname, 'step5_lattice_trace');

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
  'ltr_soft_boundary',
  'ltr_fine_span',
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

const ltrMod = require(path.join(dist, 'fw-detector/span-assembly-v4/ltr-fine-span-generator.js'));
let ltrCallCount = 0;
const originalLtr = ltrMod.runLtrFineSpanGeneration;
ltrMod.runLtrFineSpanGeneration = function patched(...args) {
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
let architectureCompliancePresent = 0;
let casesWithLegacyTraceField = 0;
let casesWithUndefinedPrefilledCombinations = 0;
let casesWithKenlmInputOver16 = 0;
let casesWithDuplicateKenlmText = 0;
let casesAllUniqueEq1 = 0;
const uniqueDist = {};
const pathsDist = {};
const pathCandDist = {};
const distinctBeforeDedupDist = {};
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
    const elapsed = performance.now() - t0;
    latencies.push(elapsed);
    orchestratorSuccess += 1;

    if (out.latticeTrace) latticeTracePresent += 1;
    if (out.pathAssemblyTraces && out.pathAssemblyTraces.length) pathAssemblyTracePresent += 1;
    if (out.crossPathMergeTrace) crossPathTracePresent += 1;
    const ac = out.metrics?.architectureCompliance;
    if (ac) architectureCompliancePresent += 1;

    const prefilled = out.kenlmSentenceCandidates?.combinations;
    if (prefilled === undefined) casesWithUndefinedPrefilledCombinations += 1;

    const texts = (prefilled || []).map((x) => x.text);
    if (texts.length > 16) casesWithKenlmInputOver16 += 1;
    if (new Set(texts).size !== texts.length) casesWithDuplicateKenlmText += 1;

    const pathResults = out.pathAssemblyResults || [];
    const pathsPerCase = pathResults.length;
    pathsDist[pathsPerCase] = (pathsDist[pathsPerCase] || 0) + 1;
    const pathCandidateCounts = pathResults.map((p) => p.sentenceCandidateCount ?? 0);
    for (const n of pathCandidateCounts) {
      pathCandDist[n] = (pathCandDist[n] || 0) + 1;
    }
    const textsBefore = [];
    for (const p of pathResults) {
      for (const bucket of p.perBucketGenerated || []) {
        for (const combo of bucket) textsBefore.push(combo.text);
      }
    }
    const distinctBefore = new Set(textsBefore).size;
    distinctBeforeDedupDist[distinctBefore] = (distinctBeforeDedupDist[distinctBefore] || 0) + 1;

    const m = out.crossPathMergeTrace || {};
    const uniqueN = m.crossPathUniqueCandidateCount ?? new Set(texts).size;
    uniqueDist[uniqueN] = (uniqueDist[uniqueN] || 0) + 1;
    if (uniqueN === 1) casesAllUniqueEq1 += 1;

    const legacyHits = collectLegacyKeys({
      latticeTrace: out.latticeTrace,
      pathAssemblyTraces: out.pathAssemblyTraces,
      crossPathMergeTrace: out.crossPathMergeTrace,
      architectureCompliance: ac,
      kenlmSentenceCandidates: out.kenlmSentenceCandidates
        ? {
            crossPathMerge: out.kenlmSentenceCandidates.crossPathMerge,
            combinationCount: out.kenlmSentenceCandidates.combinations?.length,
          }
        : undefined,
    });
    if (legacyHits.length) {
      casesWithLegacyTraceField += 1;
      failCases.push({ caseId, issues: ['LEGACY_TRACE'], legacyHits });
    }

    const issues = [];
    if (!out.latticeTrace) issues.push('missing_latticeTrace');
    if (!out.pathAssemblyTraces?.length) issues.push('missing_pathAssemblyTraces');
    if (!out.crossPathMergeTrace) issues.push('missing_crossPathMergeTrace');
    if (!ac) issues.push('missing_architectureCompliance');
    if (ac && ac.generatorMode !== 'multi_path_lattice') issues.push('generatorMode');
    if (ac && ac.voteScope !== 'per_path') issues.push('voteScope');
    if (ac && ac.assemblyScope !== 'per_path') issues.push('assemblyScope');
    if (ac && ac.crossPathMergeOwner !== 'mergeCrossPathSentenceCandidates') {
      issues.push('crossPathMergeOwner');
    }
    if (ac && ac.ltrRuntimeEnabled !== false) issues.push('ltrRuntimeEnabled');
    if (ac && ac.toneEvidenceOwner !== 'acoustic_tone_slices') issues.push('toneEvidenceOwner');
    if (prefilled === undefined) issues.push('undefined_prefilled');
    if (texts.length > 16) issues.push('kenlm_over_16');
    if (new Set(texts).size !== texts.length) issues.push('dup_kenlm_text');
    if (legacyHits.length) issues.push('legacy_trace');

    if (issues.length && !failCases.some((f) => f.caseId === caseId && f.issues.includes('LEGACY_TRACE'))) {
      failCases.push({ caseId, issues });
    } else if (issues.length && failCases.some((f) => f.caseId === caseId)) {
      const prev = failCases.find((f) => f.caseId === caseId);
      prev.issues = [...new Set([...(prev.issues || []), ...issues])];
    }

    results.push({
      caseId,
      ok: issues.length === 0,
      pathsPerCase,
      pathCandidateCounts,
      distinctTextsBeforeCrossPathDedup: distinctBefore,
      uniqueN,
      kenlmN: texts.length,
      elapsedMs: Math.round(elapsed),
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
const pct = (p) =>
  latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] : 0;

const hardGatePass =
  casesWithLegacyTraceField === 0 &&
  casesWithUndefinedPrefilledCombinations === 0 &&
  casesWithKenlmInputOver16 === 0 &&
  casesWithDuplicateKenlmText === 0 &&
  ltrCallCount === 0 &&
  orchestratorFailure === 0 &&
  failCases.length === 0;

const summary = {
  entry: 'runSpanAssemblyV4Orchestrator (Step 5 Trace / Contract)',
  casesTotal: cases.length,
  orchestratorSuccess,
  orchestratorFailure,
  latticeTracePresent,
  pathAssemblyTracePresent,
  crossPathTracePresent,
  architectureCompliancePresent,
  casesWithLegacyTraceField,
  casesWithUndefinedPrefilledCombinations,
  casesWithKenlmInputOver16,
  casesWithDuplicateKenlmText,
  ltrRuntimeCallCount: ltrCallCount,
  hardGatePass,
  qualityObservation_NOT_STEP5_BLOCKER: {
    note: 'unique candidate always-1 is a quality observation, not a Step 5 blocker',
    uniqueCandidateCountDistribution: uniqueDist,
    casesAllUniqueEq1,
    pathsPerCaseDistribution: pathsDist,
    pathCandidateCountsDistribution: pathCandDist,
    distinctTextsBeforeCrossPathDedupDistribution: distinctBeforeDedupDist,
  },
  latencyMs: {
    p50: Math.round(pct(50)),
    p95: Math.round(pct(95)),
    max: Math.round(latencies[latencies.length - 1] || 0),
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
