#!/usr/bin/env node
/** Analyze dialog_200 batch for Boundary Window Interval Assembly V1.1. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchArg = process.argv[2];
const BATCH = batchArg
  ? path.resolve(batchArg)
  : path.join(__dirname, '../interval-assembly-v11-dialog200-batch-result.json');
const MANIFEST = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');

const report = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
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

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  return levenshtein(r, h) / r.length;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function pickSamples(ids, validCases) {
  return ids
    .map((id) => validCases.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => caseRow(c));
}

function caseRow(c) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
  const fw = c.extra?.fw_detector || {};
  const v4 = fw.spanAssemblyV4 || {};
  const rerank = fw.sentenceRerank || {};
  const combos = rerank.allCombinations || [];
  const hasZhongbeiCombo = combos.some(
    (combo) =>
      (combo.sentence || combo.text || '').includes('中杯') ||
      JSON.stringify(combo).includes('中杯')
  ) || (c.extra?.fw_detector?.sentenceRerank?.picked?.text || '').includes('中杯');
  return {
    id: c.id,
    scenario: c.scenario,
    pass: c.pass,
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    text_changed: raw !== fin,
    fw_triggered: fw.triggered,
    fw_applied_count: fw.summary?.appliedCount ?? 0,
    pipeline_ms: c.pipeline_ms,
    fw_detector_step_ms: c.extra?.fw_detector_step_ms,
    assemblyMs: v4.assemblyMs,
    boundaryWindowCount: v4.boundaryWindowCount,
    intervalAssemblyCandidateCount: v4.intervalAssemblyCandidateCount ?? 0,
    intervalRejectedOverlapCount: v4.intervalRejectedOverlapCount ?? 0,
    conflictRelationCount: v4.conflictRelationCount ?? 0,
    combinationCount: rerank.combinationCount ?? combos.length,
    kenlmQueryCount: rerank.kenlmQueryCount ?? fw.summary?.kenlmQueryCount,
    has_zhongbei_final: fin.includes('中杯'),
    has_zhongbei_combo: hasZhongbeiCombo,
    ref: ref.slice(0, 80),
    raw: raw.slice(0, 80),
    final: fin.slice(0, 80),
  };
}

const evaluated = report.cases.filter((c) => !c.skip);
const validCases = evaluated.filter((c) => c.pass && !c.error);
const pipelineMs = validCases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = validCases.map((c) => c.extra?.fw_detector_step_ms).filter((n) => typeof n === 'number');
const assemblyMs = validCases
  .map((c) => c.extra?.fw_detector?.spanAssemblyV4?.assemblyMs)
  .filter((n) => typeof n === 'number');
const intervalCounts = validCases
  .map((c) => c.extra?.fw_detector?.spanAssemblyV4?.intervalAssemblyCandidateCount)
  .filter((n) => typeof n === 'number');
const intervalRejects = validCases
  .map((c) => c.extra?.fw_detector?.spanAssemblyV4?.intervalRejectedOverlapCount)
  .filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
let exactRaw = 0;
let exactFinal = 0;
let improved = 0;
let degraded = 0;

for (const c of validCases) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

const d001 = validCases.find((c) => c.id === 'd001');
const d001Row = d001 ? caseRow(d001) : null;

const out = {
  batchFile: BATCH,
  testScope: 'Boundary Window Interval Assembly V1.1 dialog_200',
  timestamp: report.timestamp,
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  contractPass: report.summary?.pass ?? validCases.length,
  contractFail: report.summary?.fail ?? 0,
  wallClockSec: report.summary?.wall_clock_sec,
  quality: {
    raw_cer_avg: Number(avg(rawCers).toFixed(4)),
    final_cer_avg: Number(avg(finalCers).toFixed(4)),
    raw_cer_p50: Number(pct(rawCers, 50).toFixed(4)),
    final_cer_p50: Number(pct(finalCers, 50).toFixed(4)),
    raw_cer_p95: Number(pct(rawCers, 95).toFixed(4)),
    final_cer_p95: Number(pct(finalCers, 95).toFixed(4)),
    exact_raw_count: exactRaw,
    exact_final_count: exactFinal,
    improved_count: improved,
    degraded_count: degraded,
  },
  performance: {
    pipeline_ms_avg: Math.round(avg(pipelineMs)),
    pipeline_ms_p50: Math.round(pct(pipelineMs, 50)),
    pipeline_ms_p95: Math.round(pct(pipelineMs, 95)),
    fw_detector_step_ms_avg: Math.round(avg(fwStepMs)),
    fw_detector_step_ms_p50: Math.round(pct(fwStepMs, 50)),
    fw_detector_step_ms_p95: Math.round(pct(fwStepMs, 95)),
    assembly_ms_avg: Math.round(avg(assemblyMs)),
    assembly_ms_p50: Math.round(pct(assemblyMs, 50)),
    assembly_ms_p95: Math.round(pct(assemblyMs, 95)),
  },
  intervalAssembly: {
    avg_candidate_count: Number(avg(intervalCounts).toFixed(2)),
    max_candidate_count: intervalCounts.length ? Math.max(...intervalCounts) : 0,
    avg_rejected_overlap: Number(avg(intervalRejects).toFixed(2)),
    total_rejected_overlap: intervalRejects.reduce((s, v) => s + v, 0),
    cases_with_rejections: intervalRejects.filter((n) => n > 0).length,
    hard_drop_total: validCases.reduce(
      (s, c) => s + (c.extra?.fw_detector?.spanAssemblyV4?.conflictRelationCount ?? 0),
      0
    ),
  },
  fw: {
    triggered_count: evaluated.filter((c) => c.fw_triggered).length,
    applied_case_count: evaluated.filter((c) => (c.fw_applied_count || 0) > 0).length,
    text_changed_count: evaluated.filter((c) => c.text_changed).length,
  },
  d001Acceptance: d001Row
    ? {
        l1_has_zhongbei_combo: d001Row.has_zhongbei_combo,
        l2_has_zhongbei_final: d001Row.has_zhongbei_final,
        intervalAssemblyCandidateCount: d001Row.intervalAssemblyCandidateCount,
        intervalRejectedOverlapCount: d001Row.intervalRejectedOverlapCount,
        fw_applied_count: d001Row.fw_applied_count,
        combinationCount: d001Row.combinationCount,
        raw: d001Row.raw,
        final: d001Row.final,
      }
    : null,
  samples: {
    cafe: pickSamples(['d001', 'd002', 'd003'], validCases),
    meeting: pickSamples(['d004', 'd005'], validCases),
    applied: validCases
      .filter((c) => (c.extra?.fw_detector?.summary?.appliedCount || 0) > 0)
      .slice(0, 5)
      .map((c) => caseRow(c)),
    worst_cer: [...validCases]
      .map((c) => ({
        id: c.id,
        cer: Number(cer(refById[c.id] || '', c.text_asr_preview || c.extra?.text_asr || '').toFixed(4)),
        final: (c.text_asr_preview || c.extra?.text_asr || '').slice(0, 50),
      }))
      .sort((a, b) => b.cer - a.cer)
      .slice(0, 5),
  },
};

const outPath = path.join(__dirname, 'interval-assembly-v11-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[analyze-interval-v11] wrote', outPath);
console.log(JSON.stringify(out, null, 2));
