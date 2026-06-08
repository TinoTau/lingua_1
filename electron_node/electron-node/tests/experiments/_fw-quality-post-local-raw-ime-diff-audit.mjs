#!/usr/bin/env node
/** READONLY audit — FW quality post Local Raw-IME Diff (no product code changes) */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
process.env.PROJECT_ROOT = PROJECT_ROOT;

try {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      app: {
        getPath: (n) =>
          n === 'userData'
            ? path.join(PROJECT_ROOT, 'electron_node/electron-node/tmp-experiment')
            : PROJECT_ROOT,
      },
    },
  };
} catch (_) {}

const DIST = path.join(PROJECT_ROOT, 'electron_node/electron-node/dist/main/electron-node/main/src');
const BATCH_PATH = path.join(__dirname, '../lexicon-tone-dialog200-local-raw-ime-batch-result.json');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json');
const OUT_JSON = path.join(__dirname, '_fw-quality-post-local-raw-ime-diff-audit-data.json');

const { textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js'));
const { syllablesKey } = require(path.join(DIST, 'lexicon/pinyin-index.js'));
const { execFileSync } = require('child_process');

const DOMAINS = ['tech_ai', 'travel', 'transport', 'restaurant'];
const MIN_PRIOR = 0.5;
const PER_SPAN_LIMIT = 8;
const SAMPLE_SEED = 20260607;

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function buildAlignmentMap(raw, ref) {
  const a = [...norm(raw)];
  const b = [...norm(ref)];
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) dp[i][0] = i;
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  const rawToRef = Array(m).fill(-1);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      rawToRef[i - 1] = j - 1;
      i -= 1;
      j -= 1;
    } else {
      const del = dp[i - 1][j];
      const ins = dp[i][j - 1];
      const sub = dp[i - 1][j - 1];
      if (sub <= del && sub <= ins) {
        rawToRef[i - 1] = j - 1;
        i -= 1;
        j -= 1;
      } else if (del <= ins) i -= 1;
      else j -= 1;
    }
  }
  return { rawToRef, refNorm: b };
}

function rawIndexToNormIndex(raw, idx) {
  return norm(raw.slice(0, idx)).length;
}

function extractCorrectCandidate(raw, ref, spanStart, spanEnd) {
  const rawSeg = raw.slice(spanStart, spanEnd);
  const nStart = rawIndexToNormIndex(raw, spanStart);
  const nEnd = rawIndexToNormIndex(raw, spanEnd);
  const spanLen = nEnd - nStart;
  if (spanLen <= 0) return { word: null, reason: 'empty_span', rawSeg };

  const { rawToRef, refNorm } = buildAlignmentMap(raw, ref);
  const mapped = [];
  for (let k = nStart; k < nEnd; k++) {
    const r = rawToRef[k];
    if (r >= 0) mapped.push(r);
  }
  if (!mapped.length) return { word: null, reason: 'alignment_failed', rawSeg };

  const rMin = Math.min(...mapped);
  const rMax = Math.max(...mapped);
  let word = refNorm.slice(rMin, rMax + 1).join('');
  if (word.length !== spanLen) word = refNorm.slice(rMin, rMin + spanLen).join('');
  if (!word || norm(word) === norm(rawSeg)) return { word: null, reason: 'same_as_raw', rawSeg };
  return { word, reason: 'aligned', rawSeg };
}

function isRefCorrectReplacement(spanText, word, ref) {
  const w = norm(word);
  const s = norm(spanText);
  if (!w || w === s || w.length !== s.length) return false;
  return norm(ref).includes(w);
}

function refReplacementTargets(spanText, ref) {
  const s = norm(spanText);
  const r = norm(ref);
  const L = s.length;
  const out = [];
  for (let i = 0; i <= r.length - L; i++) {
    const sub = r.slice(i, i + L);
    if (sub && sub !== s) out.push(sub);
  }
  return [...new Set(out)];
}

function pickPrimaryRefTarget(spanText, ref, alignedWord) {
  if (alignedWord) return alignedWord;
  const targets = refReplacementTargets(spanText, ref);
  return targets[0] || null;
}

function recallRank(candidates, spanText, ref, correctWord) {
  const words = candidates.map((c) => c.word);
  const valid = new Set(refReplacementTargets(spanText, ref));
  if (correctWord) valid.add(norm(correctWord));
  for (let i = 0; i < words.length; i++) {
    if (isRefCorrectReplacement(spanText, words[i], ref) || (correctWord && norm(words[i]) === norm(correctWord))) {
      return i + 1;
    }
  }
  return null;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}
function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadCafeSqliteProbe() {
  const jsonPath = path.join(__dirname, '_cafe_sqlite_probe.json');
  const py = path.join(__dirname, '_tmp_sqlite_probe.py');
  if (!fs.existsSync(jsonPath) && fs.existsSync(py)) {
    try {
      execFileSync('python', [py], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    } catch (_) {}
  }
  if (!fs.existsSync(jsonPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return [];
  }
}

function analyzeSpan(span, raw, ref) {
  const aligned = extractCorrectCandidate(raw, ref, span.start, span.end);
  const correctWord = pickPrimaryRefTarget(span.text, ref, aligned.word);
  const spanCorrect =
    Boolean(correctWord) &&
    aligned.reason === 'aligned' &&
    correctWord.length === span.text.length &&
    norm(correctWord) !== norm(span.text);
  const spanWrongBoundary = Boolean(correctWord || aligned.rawSeg) && !spanCorrect;
  const candidates = span.candidates || [];
  const recallWords = candidates.map((c) => c.word);
  const rank = recallRank(candidates, span.text, ref, correctWord);
  const recallHitTop1 = rank === 1;
  const recallHitTop3 = rank != null && rank <= 3;
  const recallHitTop5 = rank != null && rank <= 5;
  const recallMiss = spanCorrect && candidates.length > 0 && rank == null;
  const recallEmpty = candidates.length === 0;

  return {
    text: span.text,
    start: span.start,
    end: span.end,
    spanCorrect,
    correctWord,
    alignedReason: aligned.reason,
    spanWrongBoundary,
    recallTopK: recallWords.slice(0, 8),
    recallHitTop1,
    recallHitTop3,
    recallHitTop5,
    recallMiss,
    recallEmpty,
    correctRank: rank,
    candidateCount: candidates.length,
  };
}

function classifyCase(caseAudit) {
  const spans = caseAudit.spans.filter((s) => s.spanCorrect);
  if (!spans.length) return 'P0_no_correctable_span';
  const withRecall = spans.filter((s) => s.candidateCount > 0);
  if (!withRecall.length) return 'P1_recall_miss';
  const recallHit = withRecall.filter((s) => s.correctRank != null);
  if (!recallHit.length) return 'P1_recall_miss';
  const toneTop1 = recallHit.filter((s) => s.recallHitTop1);
  if (!toneTop1.length) return 'P2_recall_hit_tone_miss';
  const sr = caseAudit.sentenceRerank;
  if (sr?.combinationCount > 0 && sr?.pickedIsRaw) return 'P3_recall_hit_tone_hit_kenlm_reject';
  if (caseAudit.fw_reason === 'no_candidates' || (caseAudit.candidateSentenceCount || 0) === 0) {
    return 'P1_recall_miss';
  }
  if (sr?.pickedIsRaw) return 'P3_recall_hit_tone_hit_kenlm_reject';
  return 'P4_apply_guard_or_other';
}

function auditCase(c, refById) {
  const ref = refById[c.id]?.utterance || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fw = c.extra?.fw_detector || {};
  const spans = (fw.spans || []).map((s) => analyzeSpan(s, raw, ref));
  const sentenceRerank = fw.sentenceRerank || {};
  const toneModule = fw.toneModule || {};
  const ime = fw.pinyinImeV2 || {};
  const recallDiag = fw.recallV2Diagnostics || {};

  const recallMs = (recallDiag.spans || []).map((s) => s.v2_recall_ms).filter((n) => typeof n === 'number');
  const kenlmTiming = sentenceRerank.kenlmTiming || fw.kenlmTiming || {};

  return {
    id: c.id,
    scenario: c.scenario,
    ref,
    raw,
    fin: (c.text_asr_preview || '').trim(),
    fw_triggered: c.fw_triggered,
    fw_reason: c.fw_reason || fw.reason,
    applied: c.fw_applied_count || 0,
    selectedSpanCount: ime.selectedSpanCount || 0,
    spanCount: fw.summary?.spanCount || spans.length,
    candidateSentenceCount: fw.summary?.candidateSentenceCount || 0,
    candidateCount: fw.summary?.candidateCount || 0,
    spans,
    correctSpanCount: spans.filter((s) => s.spanCorrect).length,
    recallHitSpanCount: spans.filter((s) => s.correctRank != null).length,
    sentenceRerank,
    toneModule,
    pipeline_ms: c.pipeline_ms,
    fw_detector_step_ms: c.extra?.fw_detector_step_ms,
    decodeMs: ime.decodeMs,
    recall_ms_total: recallMs.reduce((a, b) => a + b, 0),
    recall_ms_max: recallMs.length ? Math.max(...recallMs) : 0,
    kenlm_ms: kenlmTiming.batchMs || fw.kenlmVetoMs || 0,
    tone_inference_ms: c.extra?.asr_diagnostics?.toneModule?.tone_inference_ms,
  };
}

function sampleClass(row) {
  const correctSpans = row.spans.filter((s) => s.spanCorrect);
  const wrongBoundaryOnly = correctSpans.length === 0 && row.spans.some((s) => s.spanWrongBoundary);
  if (wrongBoundaryOnly || correctSpans.length === 0) return 'A4';
  const recallHit = correctSpans.some((s) => s.correctRank != null);
  const kenlmReject = row.sentenceRerank?.pickedIsRaw && (row.candidateSentenceCount || 0) > 0;
  if (recallHit && kenlmReject) return 'A3';
  if (!recallHit) return 'A2';
  return 'A1';
}

// --- main ---
const batch = JSON.parse(fs.readFileSync(BATCH_PATH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const refById = Object.fromEntries(manifest.map((m) => [m.id, m]));

const allCases = batch.cases.filter((c) => !c.skip).map((c) => auditCase(c, refById));
const fwCases = allCases.filter((c) => c.fw_triggered);
const fwSelected = fwCases.filter((c) => c.selectedSpanCount > 0);

for (const row of fwCases) {
  row.rootCause = classifyCase(row);
  row.sampleClass = sampleClass(row);
}

// Section 1 aggregates (158 fw)
const fwSpanTotal = fwCases.reduce((s, c) => s + c.spans.length, 0);
const fwCorrectSpans = fwCases.reduce((s, c) => s + c.correctSpanCount, 0);
const fwWrongBoundarySpans = fwCases.reduce((s, c) => s + c.spans.filter((x) => x.spanWrongBoundary).length, 0);
const fwRecallHitSpans = fwCases.reduce((s, c) => s + c.recallHitSpanCount, 0);

const spanLevel = [];
for (const c of fwCases) {
  for (const s of c.spans) {
    if (!s.spanCorrect) continue;
    spanLevel.push({ ...s, id: c.id, scenario: c.scenario });
  }
}
const spanLevelAll = [];
for (const c of fwCases) {
  for (const s of c.spans) {
    spanLevelAll.push({ ...s, id: c.id, scenario: c.scenario });
  }
}

const recallStats = {
  recallHitTop1: spanLevel.filter((s) => s.recallHitTop1).length,
  recallHitTop3: spanLevel.filter((s) => s.recallHitTop3).length,
  recallHitTop5: spanLevel.filter((s) => s.recallHitTop5).length,
  recallMiss: spanLevel.filter((s) => s.recallMiss).length,
  recallEmpty: spanLevel.filter((s) => s.recallEmpty).length,
  totalCorrectableSpans: spanLevel.length,
  wrongBoundarySpans: spanLevelAll.filter((s) => s.spanWrongBoundary).length,
  totalSpans: spanLevelAll.length,
};

function scenarioBucket(scenario) {
  if (scenario === 'cafe') return 'cafe';
  if (scenario === 'hospital') return 'hospital';
  if (scenario === 'bank') return 'bank';
  if (['tech_deploy', 'meeting', 'lexicon_homophone'].includes(scenario)) return 'tech';
  return 'other';
}

const scenarioRecall = {};
for (const bucket of ['cafe', 'hospital', 'bank', 'tech']) {
  const items = spanLevel.filter((s) => scenarioBucket(s.scenario) === bucket);
  scenarioRecall[bucket] = {
    totalCorrectableSpans: items.length,
    recallHitTop1: items.filter((s) => s.recallHitTop1).length,
    recallHitTop3: items.filter((s) => s.recallHitTop3).length,
    recallHitTop5: items.filter((s) => s.recallHitTop5).length,
    recallMiss: items.filter((s) => s.recallMiss).length,
    recallEmpty: items.filter((s) => s.recallEmpty).length,
  };
}

// Tone stats (on recall hit spans — rank is post-tone finalScore order in batch)
const recallHitSpans = spanLevel.filter((s) => s.correctRank != null);
const toneStats = {
  toneCorrectTop1: recallHitSpans.filter((s) => s.correctRank === 1).length,
  toneCorrectTop3: recallHitSpans.filter((s) => s.correctRank != null && s.correctRank <= 3).length,
  toneCorrectTop5: recallHitSpans.filter((s) => s.correctRank != null && s.correctRank <= 5).length,
  totalRecallHitSpans: recallHitSpans.length,
};

// KenLM
const kenlmCases = fwCases.filter((c) => (c.sentenceRerank?.kenlmQueryCount || 0) > 0);
const kenlmRecallHit = fwCases.filter(
  (c) => c.recallHitSpanCount > 0 && (c.sentenceRerank?.kenlmQueryCount || 0) > 0
);
const kenlmRows = kenlmRecallHit.map((c) => ({
  id: c.id,
  raw: c.raw,
  pickedIsRaw: c.sentenceRerank.pickedIsRaw,
  maxDelta: c.sentenceRerank.maxDelta,
  minDeltaToReplace: c.sentenceRerank.minDeltaToReplace,
  topCandidate: c.sentenceRerank.topCandidates?.[0]?.text || null,
  topDelta: c.sentenceRerank.topCandidates?.[0]?.kenlmDelta ?? null,
  combinationCount: c.sentenceRerank.combinationCount,
}));

const deltaBuckets = { '0~0.01': 0, '0.01~0.03': 0, '0.03~0.05': 0, '>0.05': 0, negative: 0 };
for (const c of kenlmCases) {
  const d = c.sentenceRerank?.maxDelta ?? 0;
  if (d < 0) deltaBuckets.negative += 1;
  else if (d < 0.01) deltaBuckets['0~0.01'] += 1;
  else if (d < 0.03) deltaBuckets['0.01~0.03'] += 1;
  else if (d < 0.05) deltaBuckets['0.03~0.05'] += 1;
  else deltaBuckets['>0.05'] += 1;
}

// P1-P4
const rootCauseCounts = {};
for (const c of fwCases) {
  rootCauseCounts[c.rootCause] = (rootCauseCounts[c.rootCause] || 0) + 1;
}

// 30 sample
const samplePool = fwSelected;
const sample30 = seededShuffle(samplePool, SAMPLE_SEED).slice(0, 30).map((c) => ({
  id: c.id,
  scenario: c.scenario,
  sampleClass: c.sampleClass,
  raw: c.raw,
  ref: c.ref,
  spans: c.spans.map((s) => ({
    text: s.text,
    correctWord: s.correctWord,
    spanCorrect: s.spanCorrect,
    recallTopK: s.recallTopK,
    correctRank: s.correctRank,
  })),
  kenlm: {
    pickedIsRaw: c.sentenceRerank?.pickedIsRaw,
    maxDelta: c.sentenceRerank?.maxDelta,
    topCandidates: (c.sentenceRerank?.topCandidates || []).slice(0, 3),
  },
  toneModule: c.toneModule,
}));

const sampleClassCounts = { A1: 0, A2: 0, A3: 0, A4: 0 };
for (const s of sample30) sampleClassCounts[s.sampleClass] = (sampleClassCounts[s.sampleClass] || 0) + 1;

// Cafe / restaurant simulation (SQLite bucket, read-only)
const cafeCases = allCases.filter((c) => c.scenario === 'cafe' || c.scenario === 'restaurant');
const restaurantTargets = ['中杯', '大杯', '小杯', '蓝莓马芬', '美式', '少冰'];
const cafeDetail = ['d001', 'd002', 'd003'].map((id) => {
  const c = allCases.find((x) => x.id === id);
  if (!c) return null;
  const spanSim = c.spans.map((s) => ({
    span: s.text,
    correctWord: s.correctWord,
    spanCorrect: s.spanCorrect,
    spanWrongBoundary: s.spanWrongBoundary,
    batchRecallTopK: s.recallTopK,
    correctRank: s.correctRank,
  }));
  return {
    id: c.id,
    raw: c.raw,
    ref: c.ref,
    fw_triggered: c.fw_triggered,
    spans: spanSim,
    batchKenlm: c.sentenceRerank,
    batchTone: c.toneModule,
  };
}).filter(Boolean);

// Manual cafe target spans
const CAFE_SPANS = [
  { id: 'd001', span: '钟贝', target: '中杯' },
  { id: 'd001', span: '蓝美马分', target: '蓝莓马芬' },
  { id: 'd002', span: '美食', target: '美式' },
  { id: 'd002', span: '大悲', target: '大杯' },
  { id: 'd003', span: '少病', target: '少冰' },
  { id: 'd003', span: '小背', target: '小杯' },
];
const cafeSqliteProbe = loadCafeSqliteProbe();
const cafeTargetSim = CAFE_SPANS.map(({ id, span, target }) => {
  const probe = cafeSqliteProbe.find((p) => p.span === span) || {};
  const domainWords = (probe.domainTop || []).filter((r) => r.repair_target === 1 && r.prior_score >= MIN_PRIOR).map((r) => r.word);
  const baseWords = (probe.baseTop || []).filter((r) => r.repair_target === 1 && r.prior_score >= MIN_PRIOR).map((r) => r.word);
  const generalRank = [...new Set([...baseWords, ...domainWords])].indexOf(target);
  const restRank = [
    ...domainWords.map((w) => ({ w, boost: 0.15 })),
    ...baseWords.filter((w) => !domainWords.includes(w)).map((w) => ({ w, boost: 0 })),
  ]
    .sort((a, b) => b.boost - a.boost)
    .map((x) => x.w)
    .indexOf(target);
  return {
    id,
    span,
    target,
    generalTop8: [...new Set([...baseWords, ...domainWords])].slice(0, 8),
    restaurantTop8: [
      ...domainWords,
      ...baseWords.filter((w) => !domainWords.includes(w)),
    ].slice(0, 8),
    targetInDomainLexicon: probe.targetInDomain || false,
    targetInBaseLexicon: probe.targetInBase || false,
    targetInGeneralRank: generalRank >= 0 ? generalRank + 1 : null,
    targetInRestaurantRank: restRank >= 0 ? restRank + 1 : null,
  };
});

const restaurantSimSummary = Object.fromEntries(
  cafeTargetSim.map((r) => [
    r.target,
    {
      span: r.span,
      inDomainLexicon: r.targetInDomainLexicon,
      inBaseLexicon: r.targetInBaseLexicon,
      generalRank: r.targetInGeneralRank,
      restaurantRank: r.targetInRestaurantRank,
    },
  ])
);

// Performance
const decodeMs = allCases.map((c) => c.decodeMs).filter((n) => typeof n === 'number' && n >= 0);
const recallMs = allCases.map((c) => c.recall_ms_total).filter((n) => typeof n === 'number');
const kenlmMs = allCases.map((c) => c.kenlm_ms).filter((n) => typeof n === 'number' && n > 0);
const toneMs = allCases.map((c) => c.tone_inference_ms).filter((n) => typeof n === 'number');
const fwStepMs = allCases.map((c) => c.fw_detector_step_ms).filter((n) => typeof n === 'number');

const perf = {
  proposal_decode: { avg: avg(decodeMs), p95: pct(decodeMs, 95), n: decodeMs.length },
  recall_v2: { avg: avg(recallMs), p95: pct(recallMs, 95), n: recallMs.length },
  tone_inference: { avg: avg(toneMs), p95: pct(toneMs, 95), n: toneMs.length },
  kenlm_batch: { avg: avg(kenlmMs), p95: pct(kenlmMs, 95), n: kenlmMs.length },
  fw_detector_step: { avg: avg(fwStepMs), p95: pct(fwStepMs, 95), n: fwStepMs.length },
};

const output = {
  meta: {
    batch: BATCH_PATH,
    timestamp: batch.timestamp,
    auditDate: '2026-06-07',
  },
  summary: {
    total: allCases.length,
    fw_triggered: fwCases.length,
    fw_selected_gt0: fwSelected.length,
    apply_gt0: allCases.filter((c) => c.applied > 0).length,
    fwSpanTotal,
    fwCorrectSpans,
    fwWrongBoundarySpans,
    fwCorrectSpanRate: fwSpanTotal ? fwCorrectSpans / fwSpanTotal : 0,
    fwWrongBoundaryRate: fwSpanTotal ? fwWrongBoundarySpans / fwSpanTotal : 0,
    fwRecallHitSpans,
    fwRecallHitSpanRate: fwCorrectSpans ? fwRecallHitSpans / fwCorrectSpans : 0,
    casesWithCorrectSpan: fwCases.filter((c) => c.correctSpanCount > 0).length,
    casesWithRecallHit: fwCases.filter((c) => c.recallHitSpanCount > 0).length,
    kenlmQueriedCases: kenlmCases.length,
    pickedIsRawCases: fwCases.filter((c) => c.sentenceRerank?.pickedIsRaw).length,
    pickedIsRawWithKenlm: kenlmCases.filter((c) => c.sentenceRerank?.pickedIsRaw).length,
  },
  recallStats,
  scenarioRecall,
  toneStats,
  kenlm: {
    queriedCases: kenlmCases.length,
    recallHitQueriedCases: kenlmRecallHit.length,
    pickedIsRaw: kenlmRecallHit.filter((c) => c.sentenceRerank.pickedIsRaw).length,
    pickedCandidate: kenlmRecallHit.filter((c) => !c.sentenceRerank.pickedIsRaw).length,
    deltaBuckets,
    samples: kenlmRows.slice(0, 15),
  },
  rootCauseCounts,
  sample30,
  sampleClassCounts,
  cafeDetail,
  cafeTargetSim,
  restaurantSimSummary,
  perf,
};

fs.writeFileSync(OUT_JSON, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ out: OUT_JSON, summary: output.summary, rootCauseCounts, recallStats, toneStats, sampleClassCounts, cafeTargetSim }, null, 2));
