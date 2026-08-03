/**
 * Step 4 — Cross-Path Merge production orchestrator validation on dialog_200.
 *
 * Hard gates: KenLM input ≤16, no duplicate texts, LTR call = 0.
 *
 * Run:
 *   cd electron_node/electron-node
 *   npm run build:main
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\step4-cross-path-merge-dialog200-probe.mjs
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
const outDir = path.resolve(__dirname, 'step4_cross_path_merge');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  logLines.push(line);
  console.error(line);
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

const latencies = [];
const inputDist = {};
const dupDist = {};
const uniqueDist = {};
const kenlmDist = {};
let orchestratorSuccess = 0;
let orchestratorFailure = 0;
let casesTruncatedTo16 = 0;
let maxInput = 0;
let maxUnique = 0;
let maxKenlm = 0;
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

    const m = out.crossPathMergeTrace || out.kenlmSentenceCandidates?.crossPathMerge || {};
    const inputN = m.crossPathInputCandidateCount ?? 0;
    const dupN = m.crossPathDuplicateCount ?? 0;
    const uniqueN = m.crossPathUniqueCandidateCount ?? 0;
    const kenlmN = m.crossPathOutputCandidateCount ?? out.kenlmSentenceCandidates?.combinations?.length ?? 0;
    const texts = (out.kenlmSentenceCandidates?.combinations || []).map((x) => x.text);
    const uniqueTexts = new Set(texts);

    inputDist[inputN] = (inputDist[inputN] || 0) + 1;
    dupDist[dupN] = (dupDist[dupN] || 0) + 1;
    uniqueDist[uniqueN] = (uniqueDist[uniqueN] || 0) + 1;
    kenlmDist[kenlmN] = (kenlmDist[kenlmN] || 0) + 1;
    maxInput = Math.max(maxInput, inputN);
    maxUnique = Math.max(maxUnique, uniqueN);
    maxKenlm = Math.max(maxKenlm, kenlmN);
    if ((m.crossPathTruncatedCount ?? 0) > 0) casesTruncatedTo16 += 1;

    const mode = out.metrics?.architectureCompliance?.kenlmInputOwner;
    const issues = [];
    if (kenlmN > 16) issues.push(`kenlmInput>${16}`);
    if (texts.length !== uniqueTexts.size) issues.push('duplicate_kenlm_text');
    if (mode !== 'cross_path_merge') issues.push(`kenlmInputOwner=${mode}`);
    if (out.metrics?.architectureCompliance?.temporaryPreStep4Collection) {
      issues.push('temporaryPreStep4Collection_present');
    }
    if (issues.length) {
      failCases.push({ caseId, issues, texts });
    }
    results.push({
      caseId,
      ok: issues.length === 0,
      inputN,
      dupN,
      uniqueN,
      kenlmN,
      truncated: m.crossPathTruncatedCount ?? 0,
      elapsedMs: Math.round(elapsed),
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

const summary = {
  entry: 'runSpanAssemblyV4Orchestrator + mergeCrossPathSentenceCandidates',
  casesTotal: cases.length,
  orchestratorSuccess,
  orchestratorFailure,
  crossPathInputCandidateCountDistribution: inputDist,
  duplicateCandidateCountDistribution: dupDist,
  uniqueCandidateCountDistribution: uniqueDist,
  kenlmInputCandidateCountDistribution: kenlmDist,
  casesTruncatedTo16,
  maxInputCandidateCount: maxInput,
  maxUniqueCandidateCount: maxUnique,
  maxKenlmInputCount: maxKenlm,
  kenlmCallsNote: 'KenLM invoked once per utterance in fw-detector-v4-path with prefilledCombinations',
  ltrRuntimeCallCount: ltrCallCount,
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

if (ltrCallCount !== 0 || orchestratorFailure > 0 || failCases.length > 0 || maxKenlm > 16) {
  process.exit(2);
}
process.exit(0);
