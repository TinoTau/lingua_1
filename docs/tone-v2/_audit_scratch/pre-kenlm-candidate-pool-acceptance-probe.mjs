/**
 * Pre-KenLM 16-Candidate Sentence Pool Targeted Acceptance
 * Audit-only. Does not modify dialog_200 / production / lexicon.
 *
 * Run:
 *   cd electron_node/electron-node
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   .\node_modules\electron\dist\electron.exe ..\..\docs\tone-v2\_audit_scratch\pre-kenlm-candidate-pool-acceptance-probe.mjs
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
const outDir = path.resolve(__dirname, 'pre_kenlm_candidate_pool_acceptance');
const casesDir = path.join(outDir, 'cases');

process.chdir(root);
process.env.PROJECT_ROOT = repoRoot;

function log(m) {
  console.error(`[${new Date().toISOString()}] ${m}`);
}
function pct(n, d) {
  return d ? Math.round((10000 * n) / d) / 100 : 0;
}
function stats(arr) {
  if (!arr.length) return { min: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, n: 0 };
  const a = [...arr].sort((x, y) => x - y);
  const n = a.length;
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const at = (p) => a[Math.min(n - 1, Math.floor(n * p))];
  return {
    min: +a[0].toFixed(3),
    mean: +mean.toFixed(3),
    p50: +at(0.5).toFixed(3),
    p90: +at(0.9).toFixed(3),
    p95: +at(0.95).toFixed(3),
    p99: +at(0.99).toFixed(3),
    max: +a[n - 1].toFixed(3),
    n,
  };
}
function applyReplacements(rawText, reps) {
  let text = rawText;
  for (const r of [...reps].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, r.start) + r.word + text.slice(r.end);
  }
  return text;
}

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
const { buildUtteranceSyllableCoordinate } = require(
  path.join(dist, 'fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.js')
);
const { partitionCoarseSpans } = require(
  path.join(dist, 'fw-detector/span-assembly-shared/coarse-span-partition.js')
);
const { buildLexicalWindowQueries } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/build-lexical-window-queries.js')
);
const { latticeHardBlockFilter } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/lattice-hard-block-filter.js')
);
const { buildWordTimeSpans } = require(path.join(dist, 'fw-detector/tone-time-align.js'));
const { isFuzzyPinyinRecallEnabled } = require(
  path.join(dist, 'lexicon-v2/lexicon-fw-recall-config.js')
);
const { recallTopKForWindows } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/recall-topk-for-windows.js')
);
const { runSpanAssemblyV4Orchestrator } = require(
  path.join(dist, 'fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.js')
);
const { runFwSentenceRerankFromPrefilled } = require(
  path.join(dist, 'fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.js')
);
const { createKenlmBatchScorer } = require(
  path.join(dist, 'asr-repair/sentence-rerank/kenlm-scorer.js')
);
const {
  resolveCharLmModelPath,
  resolveKenlmQueryPath,
  isKenlmSubprocessRunnable,
  getSentenceKenlmRuntimeStatus,
} = require(path.join(dist, 'phonetic-correction/lm-scorer.js'));

const runtime = new LexiconRuntimeV2();
const loadState = runtime.loadFromBundleDir(path.resolve(repoRoot, 'node_runtime/lexicon/v3'));
log(`lexicon=${loadState.status}`);
if (loadState.status !== 'ok') process.exit(1);

const fwConfig = loadFwDetectorRuntimeConfig();
const imeConfig = loadPinyinImeV2RuntimeConfig();
const dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
  enabledDomains: imeConfig.enabledDomains,
});
const profile = defaultGeneralProfile();
const domainIds = resolveRecallScope({ configEnabledDomains: fwConfig.enabledDomains }).domainIds;
const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
const toneTimestampOnlyEnabled = fwConfig.toneTimestampOnlyEnabled === true;

fs.mkdirSync(casesDir, { recursive: true });

function recallPrescan(rawText) {
  const coordinate = buildUtteranceSyllableCoordinate(rawText);
  const partition = partitionCoarseSpans({ rawText, imeConfig, dict });
  const coarseSpans = partition.coarseSpans;
  const wordTimeSpans = buildWordTimeSpans(rawText, [], [], [], []);
  const windows = buildLexicalWindowQueries({
    rawText,
    globalSyllables: coordinate.syllables,
    coarseSpans,
    charSyllableRanges: coordinate.ranges,
  });
  const filtered = latticeHardBlockFilter({ windows, rawText, coarseSpans, wordTimeSpans });
  const recallable = filtered.filter((w) => !w.blocked);
  const recall = recallTopKForWindows({
    rawText,
    windows: recallable,
    globalSyllables: [...coordinate.syllables],
    runtime,
    profile,
    domainIds,
    minPrior: fwConfig.minPrior,
    wordTimeSpans,
    fuzzyRecallEnabled: fuzzyEnabled,
    toneTimestampOnlyEnabled,
  });
  const byWindow = new Map();
  for (const c of recall.candidates) {
    const list = byWindow.get(c.windowId) || [];
    list.push(c);
    byWindow.set(c.windowId, list);
  }
  const surfaceDistinctRecallByWindow = [];
  for (const w of recallable) {
    const cands = byWindow.get(w.windowId) || [];
    const surfaces = [...new Set(cands.map((c) => c.replacement))];
    if (surfaces.length >= 2) {
      surfaceDistinctRecallByWindow.push({
        windowId: w.windowId,
        syllableStart: w.syllableStart,
        syllableEnd: w.syllableEnd,
        text: w.windowText,
        surfaces,
        identityCount: cands.length,
      });
    }
  }
  // greedy non-overlapping multi-candidate windows (by syllable)
  const sorted = [...surfaceDistinctRecallByWindow].sort(
    (a, b) => a.syllableStart - b.syllableStart || b.syllableEnd - a.syllableEnd
  );
  const eligible = [];
  let lastEnd = -1;
  for (const w of sorted) {
    if (w.syllableStart >= lastEnd) {
      eligible.push(w);
      lastEnd = w.syllableEnd;
    }
  }
  let expectedCombinationPotential = 1;
  for (const w of eligible) expectedCombinationPotential *= w.surfaces.length;
  if (!eligible.length) expectedCombinationPotential = 0;

  return {
    syllableCount: coordinate.syllables.length,
    windowCount: filtered.length,
    surfaceDistinctRecallByWindow,
    eligibleMultiCandidateSpans: eligible,
    expectedCombinationPotential,
    targetTriggered: eligible.length >= 1,
    dualTriggered: eligible.length >= 2,
    tripleTriggered: eligible.length >= 3,
  };
}

function analyzeAssembly(caseId, rawText, orch, prescan) {
  const pathResults = orch.pathAssemblyResults || [];
  const prefilled = orch.kenlmSentenceCandidates?.combinations || [];
  const uniqueBefore = orch.kenlmSentenceCandidates?.uniqueBeforeCap || prefilled;

  let theoreticalCombinationCount = 0;
  let assemblyGeneratedCount = 0;
  const allAsmTexts = new Set();
  const bucketDetails = [];
  const candidatesOut = [];

  for (const pr of pathResults) {
    const retained = pr.assemblyResult?.vote?.retainedDomains?.length
      ? [...pr.assemblyResult.vote.retainedDomains]
      : [null];
    const grids = pr.assemblyResult?.bucketSpanSets || [];
    for (let bi = 0; bi < grids.length; bi++) {
      const grid = grids[bi] || [];
      const perSpanSurfaces = grid.map((slot) => [
        ...new Set(slot.map((p) => p.word)),
      ]);
      let theo = 1;
      for (const s of perSpanSurfaces) theo *= Math.max(1, s.length);
      theoreticalCombinationCount = Math.max(theoreticalCombinationCount, theo);

      const generated = (pr.perBucketGenerated || [])[bi] || [];
      assemblyGeneratedCount += generated.length;
      for (const combo of generated) {
        allAsmTexts.add(combo.text);
        const reps = (combo.replacements || []).map((r) => ({
          start: r.span.start,
          end: r.span.end,
          word: r.word,
          sourceText: rawText.slice(r.span.start, r.span.end),
          candidateId: r.candidateId,
        }));
        const rebuilt = applyReplacements(rawText, reps);
        const overlap = (() => {
          const s = [...reps].sort((a, b) => a.start - b.start);
          for (let i = 1; i < s.length; i++) if (s[i].start < s[i - 1].end) return true;
          return false;
        })();
        let cls = 'VALID_PLAUSIBLE';
        if (!rebuilt || rebuilt !== combo.text || overlap) cls = 'INVALID_RANGE';
        else if (combo.text === rawText) cls = 'VALID_RAW';
        candidatesOut.push({
          text: combo.text,
          sourcePathId: pr.pathId,
          sourceDomain: retained[bi] ?? null,
          sourceBucket: bi,
          replacementOperations: reps,
          dedupKey: combo.text,
          rebuildOk: rebuilt === combo.text,
          classification: cls,
        });
      }
      bucketDetails.push({
        pathId: pr.pathId,
        domainId: retained[bi] ?? null,
        perSpanSurfaceCounts: perSpanSurfaces.map((s) => s.length),
        perSpanSurfaces: perSpanSurfaces.map((s) => s.slice(0, 8)),
        theoretical: theo,
        generated: generated.length,
        distinct: new Set(generated.map((g) => g.text)).size,
      });
    }
  }

  const inputCandidates = [];
  for (const pr of pathResults) {
    for (const list of pr.perBucketGenerated || []) {
      for (const c of list || []) inputCandidates.push(c.text);
    }
  }
  const crossPathDistinct = new Set(inputCandidates).size;

  // collapse layer
  let collapse = null;
  const surfRecall = (prescan.surfaceDistinctRecallByWindow || []).length;
  const edgeMultiSurface = surfRecall; // approximate from recall; edge usually preserves
  if (surfRecall === 0) collapse = 'RECALL';
  else if (theoreticalCombinationCount <= 1 && (prescan.expectedCombinationPotential || 0) >= 2)
    collapse = 'BUCKET';
  else if (allAsmTexts.size <= 1 && theoreticalCombinationCount >= 2) collapse = 'ASSEMBLY';
  else if (allAsmTexts.size <= 1 && (prescan.expectedCombinationPotential || 0) >= 2)
    collapse = 'BUCKET';
  else if (crossPathDistinct <= 1 && allAsmTexts.size > 1) collapse = 'CROSS_PATH';
  else if (prefilled.length <= 1 && crossPathDistinct > 1) collapse = 'CROSS_PATH';
  else if (prefilled.length <= 1 && (prescan.expectedCombinationPotential || 0) >= 2)
    collapse = allAsmTexts.size <= 1 ? 'ASSEMBLY' : 'CROSS_PATH';

  const invalid = candidatesOut.filter((c) => String(c.classification).startsWith('INVALID'));

  return {
    caseId,
    rawText,
    windowCount: prescan.windowCount,
    surfaceDistinctRecallCount: surfRecall,
    eligibleMultiCandidateSpans: prescan.eligibleMultiCandidateSpans,
    expectedCombinationPotential: prescan.expectedCombinationPotential,
    pathCount: pathResults.length,
    retainedDomainCount: Math.max(
      0,
      ...pathResults.map((p) => p.assemblyResult?.vote?.retainedDomains?.length || 0)
    ),
    bucketCount: bucketDetails.length,
    theoreticalCombinationCount,
    validNonOverlappingCombinationCount: theoreticalCombinationCount,
    assemblyGeneratedCount,
    assemblyDistinctTextCount: allAsmTexts.size,
    crossPathInputCount: inputCandidates.length,
    crossPathDistinctCount: crossPathDistinct,
    prefilledCount: prefilled.length,
    prefilledTexts: prefilled.map((c) => c.text),
    kenlmInputCount: prefilled.length,
    firstCollapseLayer: collapse,
    bucketDetails,
    candidates: candidatesOut,
    invalidCandidateCount: invalid.length,
    latticeTrace: orch.latticeTrace || null,
    architectureCompliance: orch.metrics?.architectureCompliance || null,
  };
}

async function maybeKenlm(rawText, orch) {
  const prefilled = orch.kenlmSentenceCandidates?.combinations || [];
  if (prefilled.length <= 1) {
    return { skipped: true, reason: 'prefilledCount<=1', prefilledCount: prefilled.length };
  }
  let scorer = null;
  try {
    scorer = createKenlmBatchScorer();
  } catch (e) {
    return { skipped: true, reason: 'createKenlmBatchScorer_threw', error: String(e && e.message ? e.message : e) };
  }
  if (!scorer) return { skipped: true, reason: 'kenlm_scorer_null' };
  const t0 = performance.now();
  try {
    const result = await runFwSentenceRerankFromPrefilled({
      rawText,
      spans: orch.fwSpans || [],
      spanSets: orch.spanSets || [],
      config: {
        minPrior: fwConfig.minPrior,
        maxSentenceCandidates: fwConfig.maxSentenceCandidates,
        minDeltaToReplace: fwConfig.minDeltaToReplace,
        candidateRequireRepairTarget: fwConfig.candidateRequireRepairTarget,
      },
      kenlmScorer: scorer,
      prefilledCombinations: prefilled,
    });
    const totalMs = performance.now() - t0;
    const sr = result.sentenceRerank || {};
    let top5 = [];
    if (Array.isArray(sr.candidateScores)) {
      top5 = sr.candidateScores.slice(0, 5);
    } else if (Array.isArray(prefilled)) {
      top5 = prefilled.slice(0, 5).map((c, i) => ({
        text: c.text,
        rank: i + 1,
        note: 'prefilled_order_fallback_see_sentenceRerank',
      }));
    }
    return {
      skipped: false,
      prefilledCount: prefilled.length,
      kenlmTotalMs: totalMs,
      kenlmTiming: result.kenlmTiming || sr.kenlmTiming || null,
      kenlmQueryCount: result.kenlmQueryCount,
      pickedTopKWinCount: result.pickedTopKWinCount,
      approvedCount: (result.approved || []).length,
      sentenceRerankKeys: Object.keys(sr),
      top5,
      rawLogDelta: sr.rawLogDelta ?? sr.bestRawDelta ?? null,
      selectedText: sr.selectedText ?? sr.pickedText ?? null,
    };
  } catch (e) {
    return {
      skipped: true,
      reason: 'kenlm_rerank_threw',
      error: String(e && e.message ? e.message : e),
      kenlmTotalMs: performance.now() - t0,
      prefilledCount: prefilled.length,
    };
  }
}

function runTimedOrch(rawText) {
  const t0 = performance.now();
  const out = runSpanAssemblyV4Orchestrator({
    rawText,
    runtime,
    profile,
    recallDomainScope: domainIds,
    minPrior: fwConfig.minPrior,
    imeConfig,
    dict,
    domainPriors: [],
  });
  return { out, ms: performance.now() - t0, prefilledN: out.kenlmSentenceCandidates?.combinations?.length ?? 0 };
}

// ---------- load cases ----------
const targeted = JSON.parse(fs.readFileSync(path.join(outDir, 'targeted_cases.json'), 'utf8'));
const dialogManifest = JSON.parse(
  fs.readFileSync(path.resolve(repoRoot, 'test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const dialogCases = dialogManifest.cases.filter((c) => typeof c.text === 'string' && c.text.length);

// ---------- PRESCAN targeted ----------
log('PRESCAN_START');
const prescans = [];
for (const tc of targeted) {
  const ps = recallPrescan(tc.text);
  prescans.push({
    caseId: tc.caseId,
    text: tc.text,
    groups: tc.group,
    expectedTerms: tc.expectedTerms,
    why: tc.why,
    ...ps,
    targetTriggered: ps.targetTriggered,
    status: ps.targetTriggered ? 'TRIGGERED' : 'TARGET_NOT_TRIGGERED',
  });
}
fs.writeFileSync(path.join(outDir, 'targeted_prescan.json'), JSON.stringify(prescans, null, 2));
log(
  `prescan triggered=${prescans.filter((p) => p.targetTriggered).length}/${prescans.length} dual=${prescans.filter((p) => p.dualTriggered).length} triple=${prescans.filter((p) => p.tripleTriggered).length}`
);

// ---------- TARGETED full ----------
async function main() {
log('TARGETED_FULL_START');
let kenlmStatus = null;
let kenlmRunnable = false;
try {
  kenlmStatus = getSentenceKenlmRuntimeStatus();
  kenlmRunnable = isKenlmSubprocessRunnable();
} catch (e) {
  kenlmRunnable = false;
  kenlmStatus = { error: String(e && e.message ? e.message : e) };
}
let modelPath = null;
let queryPath = null;
try {
  modelPath = resolveCharLmModelPath();
  queryPath = resolveKenlmQueryPath();
} catch (_) {}
log(`kenlmRunnable=${kenlmRunnable} model=${modelPath} query=${queryPath} status=${JSON.stringify(kenlmStatus)}`);

const targetedRows = [];
for (const tc of targeted) {
  const ps = prescans.find((p) => p.caseId === tc.caseId);
  const t0 = performance.now();
  let orch;
  let err = null;
  try {
    orch = runSpanAssemblyV4Orchestrator({
      rawText: tc.text,
      runtime,
      profile,
      recallDomainScope: domainIds,
      minPrior: fwConfig.minPrior,
      imeConfig,
      dict,
      domainPriors: [],
      traceCaseId: tc.caseId,
    });
  } catch (e) {
    err = String(e && e.stack ? e.stack : e);
  }
  const orchMs = performance.now() - t0;
  if (err) {
    const row = { caseId: tc.caseId, text: tc.text, error: err, orchMs };
    targetedRows.push(row);
    fs.writeFileSync(path.join(casesDir, `${tc.caseId}.json`), JSON.stringify(row, null, 2));
    continue;
  }
  const analyzed = analyzeAssembly(tc.caseId, tc.text, orch, ps || recallPrescan(tc.text));
  analyzed.groups = tc.group;
  analyzed.why = tc.why;
  analyzed.prescanStatus = ps?.status;
  analyzed.orchMs = orchMs;
  analyzed.kenlm = await maybeKenlm(tc.text, orch);
  targetedRows.push(analyzed);
  fs.writeFileSync(path.join(casesDir, `${tc.caseId}.json`), JSON.stringify(analyzed, null, 2));
}
log('TARGETED_FULL_DONE');

// ---------- dialog_200 regression counts + perf ----------
log('DIALOG200_START');
const d200Counts = [];
for (const c of dialogCases) {
  const r = runTimedOrch(c.text);
  d200Counts.push({
    caseId: c.id,
    prefilledCount: r.prefilledN,
    orchMs: r.ms,
    distinctBefore:
      new Set(
        (r.out.pathAssemblyResults || []).flatMap((p) =>
          (p.perBucketGenerated || []).flatMap((l) => (l || []).map((x) => x.text))
        )
      ).size,
  });
}
function perfBatch(label, texts, rounds) {
  const runs = [];
  for (let i = 0; i < rounds; i++) {
    const totals = [];
    const byN = { 1: [], '2-4': [], '5-8': [], '9-16': [] };
    for (const text of texts) {
      const r = runTimedOrch(text);
      totals.push(r.ms);
      const n = r.prefilledN || 1;
      if (n <= 1) byN['1'].push(r.ms);
      else if (n <= 4) byN['2-4'].push(r.ms);
      else if (n <= 8) byN['5-8'].push(r.ms);
      else byN['9-16'].push(r.ms);
    }
    runs.push({ label: `${label}_${i === 0 ? 'cold' : 'warm' + i}`, stats: stats(totals), byN: Object.fromEntries(Object.entries(byN).map(([k, v]) => [k, stats(v)])) });
  }
  return runs;
}
const d200Perf = perfBatch('dialog200', dialogCases.map((c) => c.text), 4);
const targetedTexts = targeted.map((t) => t.text);
const targetedPerf = perfBatch('targeted', targetedTexts, 6);

// KenLM perf only on multi-prefilled targeted
const multiPrefill = targetedRows.filter((r) => (r.prefilledCount || 0) > 1 && !r.error);
const kenlmPerfByBucket = { 1: [], '2-4': [], '5-8': [], '9-16': [] };
const kenlmQualitySamples = [];
for (const row of multiPrefill) {
  const k = row.kenlm;
  if (!k || k.skipped) continue;
  const n = row.prefilledCount;
  const ms = k.kenlmTotalMs;
  if (n <= 1) kenlmPerfByBucket['1'].push(ms);
  else if (n <= 4) kenlmPerfByBucket['2-4'].push(ms);
  else if (n <= 8) kenlmPerfByBucket['5-8'].push(ms);
  else kenlmPerfByBucket['9-16'].push(ms);
  kenlmQualitySamples.push({
    caseId: row.caseId,
    prefilledCount: n,
    texts: row.prefilledTexts,
    kenlm: k,
  });
}

// ---------- summaries ----------
const triggered = prescans.filter((p) => p.targetTriggered);
const dual = prescans.filter((p) => p.dualTriggered);
const triple = prescans.filter((p) => p.tripleTriggered);
const geo16 = targetedRows.filter((r) => (r.expectedCombinationPotential || 0) >= 16 || (r.theoreticalCombinationCount || 0) >= 16);
const blockers = targetedRows.filter((r) => {
  const theo = Math.max(r.expectedCombinationPotential || 0, r.theoreticalCombinationCount || 0);
  return theo >= 4 && (r.assemblyDistinctTextCount || 0) <= 1 && !r.error;
});
const nearTheo = targetedRows.filter((r) => {
  const theo = r.theoreticalCombinationCount || 0;
  const got = r.assemblyDistinctTextCount || 0;
  return theo >= 2 && got >= Math.min(theo, 2);
});

const combo2x2 = targetedRows.filter(
  (r) => (r.eligibleMultiCandidateSpans || []).length >= 2 && (r.assemblyDistinctTextCount || 0) >= 4
);
const combo222 = targetedRows.filter(
  (r) => (r.eligibleMultiCandidateSpans || []).length >= 3 && (r.assemblyDistinctTextCount || 0) >= 8
);
const pool16 = targetedRows.filter((r) => (r.prefilledCount || 0) === 16);

const d200PrefillDist = {};
for (const r of d200Counts) d200PrefillDist[r.prefilledCount] = (d200PrefillDist[r.prefilledCount] || 0) + 1;

const targetedSummary = {
  casesTotal: targeted.length,
  triggered: triggered.length,
  dualTriggered: dual.length,
  tripleTriggered: triple.length,
  TARGET_NOT_TRIGGERED: prescans.filter((p) => !p.targetTriggered).map((p) => p.caseId),
  assemblyDistinctGt1: targetedRows.filter((r) => (r.assemblyDistinctTextCount || 0) > 1).length,
  prefilledGt1: targetedRows.filter((r) => (r.prefilledCount || 0) > 1).length,
  prefilledEq16: pool16.map((r) => r.caseId),
  theoreticalGe16: geo16.map((r) => ({
    caseId: r.caseId,
    expected: r.expectedCombinationPotential,
    theoretical: r.theoreticalCombinationCount,
    distinct: r.assemblyDistinctTextCount,
    prefilled: r.prefilledCount,
  })),
  blockersTheoGe4ButDistinct1: blockers.map((r) => ({
    caseId: r.caseId,
    expected: r.expectedCombinationPotential,
    theoretical: r.theoreticalCombinationCount,
    collapse: r.firstCollapseLayer,
    distinct: r.assemblyDistinctTextCount,
  })),
  combo2x2Achieved: combo2x2.map((r) => r.caseId),
  combo222Achieved: combo222.map((r) => r.caseId),
  nearTheoOk: nearTheo.map((r) => r.caseId),
  kenlmRan: kenlmQualitySamples.length,
  collapseLayers: targetedRows.reduce((m, r) => {
    const k = r.firstCollapseLayer || 'NONE';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {}),
  invalidTotal: targetedRows.reduce((s, r) => s + (r.invalidCandidateCount || 0), 0),
};

const dialog200Summary = {
  casesTotal: d200Counts.length,
  prefilledDist: d200PrefillDist,
  prefilledGt1: d200Counts.filter((r) => r.prefilledCount > 1).length,
  orchMs: stats(d200Counts.map((r) => r.orchMs)),
};

fs.writeFileSync(path.join(outDir, 'targeted_summary.json'), JSON.stringify(targetedSummary, null, 2));
fs.writeFileSync(path.join(outDir, 'dialog200_summary.json'), JSON.stringify(dialog200Summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'performance.json'),
  JSON.stringify(
    {
      dialog200: d200Perf,
      targeted: targetedPerf,
      kenlmByCandidateCount: Object.fromEntries(
        Object.entries(kenlmPerfByBucket).map(([k, v]) => [k, stats(v)])
      ),
      kenlmRunnable,
      kenlmStatus,
    },
    null,
    2
  )
);

// reviews
let poolMd = `# Candidate Pool Review\n\n`;
poolMd += `Triggered ${triggered.length}/${targeted.length}; dual=${dual.length}; triple=${triple.length}; prefilled>1=${targetedSummary.prefilledGt1}\n\n`;
for (const r of targetedRows.filter((x) => !x.error).slice(0, 40)) {
  poolMd += `## ${r.caseId}\n`;
  poolMd += `- text: ${r.rawText}\n`;
  poolMd += `- expectedCombos(prescan)=${r.expectedCombinationPotential} theoretical(bucket)=${r.theoreticalCombinationCount} distinctAsm=${r.assemblyDistinctTextCount} prefilled=${r.prefilledCount} collapse=${r.firstCollapseLayer}\n`;
  poolMd += `- eligible spans: ${JSON.stringify(r.eligibleMultiCandidateSpans)}\n`;
  poolMd += `- prefilled texts:\n`;
  for (const t of (r.prefilledTexts || []).slice(0, 16)) poolMd += `  - ${t}\n`;
  poolMd += `\n`;
}
fs.writeFileSync(path.join(outDir, 'candidate_pool_review.md'), poolMd);

let kenlmMd = `# KenLM Quality Review\n\n`;
kenlmMd += `kenlmRunnable=${kenlmRunnable}; samples=${kenlmQualitySamples.length}\n\n`;
if (!kenlmQualitySamples.length) {
  kenlmMd += `No case with prefilledCount>1 reached KenLM. Ranking quality is INCONCLUSIVE for this run.\n`;
} else {
  for (const s of kenlmQualitySamples) {
    kenlmMd += `## ${s.caseId} (n=${s.prefilledCount})\n`;
    kenlmMd += `\`\`\`json\n${JSON.stringify(s.kenlm, null, 2)}\n\`\`\`\n\n`;
  }
}
fs.writeFileSync(path.join(outDir, 'kenlm_quality_review.md'), kenlmMd);

log(`SUMMARY ${JSON.stringify(targetedSummary)}`);
log(`DIALOG200 prefilledDist=${JSON.stringify(d200PrefillDist)}`);
process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
