#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(
  __dirname,
  process.argv[2] || 'greedy-longest-v21-dialog200-batch-result.json'
);
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function finalText(c) {
  return (c.extra?.text_asr || c.text_asr_preview || c.extra?.raw_asr_text || '').trim();
}

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  return levenshtein(r, h) / r.length;
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

if (!fs.existsSync(reportPath)) {
  console.error('batch result missing:', reportPath);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const evaluated = report.cases.filter((c) => !c.skip);
const valid = evaluated.filter((c) => c.pass);
const pipelineMs = valid.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwMs = valid.map((c) => c.extra?.fw_detector_step_ms).filter((n) => typeof n === 'number');
const asrMs = valid
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms)
  .filter((n) => typeof n === 'number');
const audioMs = valid
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.audio_ms)
  .filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;
let exactRaw = 0;
let exactFinal = 0;
const worstFinal = [];

for (const c of valid) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = finalText(c);
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
  if (fc > 0.15) {
    worstFinal.push({ id: c.id, cer: Number(fc.toFixed(4)), ref: ref.slice(0, 40), hyp: fin.slice(0, 40) });
  }
}
worstFinal.sort((a, b) => b.cer - a.cer);

const v3 = valid.filter((c) => c.extra?.fw_detector?.pipelinePath === 'v3');
const pfHits = v3.map((c) => c.extra?.fw_detector?.spanAssemblyV3?.parentFragmentHitCount || 0);
const spanCandSelected = v3.map(
  (c) =>
    c.extra?.fw_detector?.spanAssemblyV3?.parentSpanCandidateSelectedCount ??
    c.extra?.fw_detector?.spanAssemblyV3?.parentSpanCandidateCount ??
    0
);
const spanCandEmitted = v3.map(
  (c) => c.extra?.fw_detector?.spanAssemblyV3?.parentSpanCandidateEmittedCount ?? spanCandSelected
);
const dominatedPruned = v3.map((c) => c.extra?.fw_detector?.spanAssemblyV3?.dominatedPrunedCount ?? 0);
const ruleBRejectedByHole = v3.map(
  (c) => c.extra?.fw_detector?.spanAssemblyV3?.ruleBRejectedByHoleCount ?? 0
);
const spanCov = v3.map((c) => c.extra?.fw_detector?.spanAssemblyV3?.parentSpanCoverageAvg || 0);
const vote = v3.map((c) => c.extra?.fw_detector?.spanAssemblyV3?.parentTermVoteCount || 0);

const d001 = valid.find((c) => c.id === 'd001');
const sa = d001?.extra?.fw_detector?.spanAssemblyV3;

const out = {
  meta: {
    timestamp: report.timestamp,
    evaluated: evaluated.length,
    valid_cases: valid.length,
    fail_cases: evaluated.length - valid.length,
    stoppedReason: report.stoppedReason,
    wall_clock_sec: report.summary.wall_clock_sec,
    v3_cases: v3.length,
    lexicon_schema: 'lexicon-v3-five-table-v1',
    spanAssemblyV3Enabled: true,
    feature: 'greedy-longest-parent-term-assembly-v2.1',
  },
  quality: {
    avg_cer_raw: Number(avg(rawCers).toFixed(4)),
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    median_cer_raw: Number(pct(rawCers, 50).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    p95_cer_raw: Number(pct(rawCers, 95).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    exact_match_raw: exactRaw,
    exact_match_final: exactFinal,
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
    fw_unchanged_cases: valid.length - improved - degraded,
    fw_applied_cases: valid.filter((c) => (c.fw_applied_count || 0) > 0).length,
    worst_final_cer_top5: worstFinal.slice(0, 5),
  },
  perf: {
    pipeline_ms: {
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      min: pipelineMs.length ? Math.min(...pipelineMs) : 0,
      max: pipelineMs.length ? Math.max(...pipelineMs) : 0,
    },
    fw_detector_step_ms: {
      avg: Math.round(avg(fwMs)),
      p50: pct(fwMs, 50),
      p95: pct(fwMs, 95),
    },
    asr_latency_ms: {
      avg: Math.round(avg(asrMs)),
      p50: pct(asrMs, 50),
      p95: pct(asrMs, 95),
    },
    audio_ms: { avg: Math.round(avg(audioMs)), p50: pct(audioMs, 50) },
    rtf_pipeline: audioMs.length ? Number((avg(pipelineMs) / avg(audioMs)).toFixed(3)) : 0,
    rtf_asr: audioMs.length ? Number((avg(asrMs) / avg(audioMs)).toFixed(3)) : 0,
  },
  spanLevelParentTerm: {
    cases_with_fragment_hits: pfHits.filter((n) => n > 0).length,
    cases_with_span_candidates: spanCandSelected.filter((n) => n > 0).length,
    total_parentFragmentHitCount: pfHits.reduce((s, n) => s + n, 0),
    total_parentSpanCandidateEmittedCount: spanCandEmitted.reduce((s, n) => s + n, 0),
    total_parentSpanCandidateSelectedCount: spanCandSelected.reduce((s, n) => s + n, 0),
    total_dominatedPrunedCount: dominatedPruned.reduce((s, n) => s + n, 0),
    total_ruleBRejectedByHoleCount: ruleBRejectedByHole.reduce((s, n) => s + n, 0),
    total_parentTermVoteCount: vote.reduce((s, n) => s + n, 0),
    avg_parentFragmentHitCount: Number(avg(pfHits).toFixed(2)),
    avg_parentSpanCandidateEmittedCount: Number(avg(spanCandEmitted).toFixed(2)),
    avg_parentSpanCandidateSelectedCount: Number(avg(spanCandSelected).toFixed(2)),
    avg_dominatedPrunedCount: Number(avg(dominatedPruned).toFixed(2)),
    avg_ruleBRejectedByHoleCount: Number(avg(ruleBRejectedByHole).toFixed(2)),
    avg_parentSpanCoverageAvg: Number(avg(spanCov.filter((n) => n > 0)).toFixed(3)),
  },
  contract: report.summary,
  d001: {
    reference: refById.d001,
    raw_asr: d001?.extra?.raw_asr_text,
    final_asr: d001 ? finalText(d001) : '',
    cer_raw: Number(cer(refById.d001, d001?.extra?.raw_asr_text || '').toFixed(4)),
    cer_final: Number(cer(refById.d001, d001 ? finalText(d001) : '').toFixed(4)),
    spanAssemblyV3: sa,
    fw_applied: d001?.fw_applied_count,
    contains_lanmeimafen: (d001 ? finalText(d001) : '').includes('蓝美马分'),
    contains_lanmeimafin: (d001 ? finalText(d001) : '').includes('蓝莓马芬'),
  },
  samples: ['d001', 'd004', 'd010', 'd046', 'd050', 'd060'].map((id) => {
    const c = valid.find((x) => x.id === id);
    if (!c) return null;
    const ref = refById[id] || '';
    const raw = (c.extra?.raw_asr_text || '').trim();
    const fin = finalText(c);
    const sa3 = c.extra?.fw_detector?.spanAssemblyV3;
    return {
      id,
      scenario: c.scenario,
      reference: ref,
      raw_asr: raw,
      hyp: fin,
      cer_raw: Number(cer(ref, raw).toFixed(4)),
      cer_final: Number(cer(ref, fin).toFixed(4)),
      pipeline_ms: c.pipeline_ms,
      parentFragmentHitCount: sa3?.parentFragmentHitCount,
      parentSpanCandidateEmittedCount: sa3?.parentSpanCandidateEmittedCount,
      parentSpanCandidateSelectedCount:
        sa3?.parentSpanCandidateSelectedCount ?? sa3?.parentSpanCandidateCount,
      dominatedPrunedCount: sa3?.dominatedPrunedCount,
      ruleBRejectedByHoleCount: sa3?.ruleBRejectedByHoleCount,
      parentSpanCoverageAvg: sa3?.parentSpanCoverageAvg,
      utteranceDomain: sa3?.utteranceDomain,
      fw_applied: c.fw_applied_count,
    };
  }).filter(Boolean),
};

const outPath = path.join(__dirname, 'greedy-longest-v21-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
