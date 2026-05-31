#!/usr/bin/env node
/**
 * P3.2 KenLM Span Gate — quality + perf analysis.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(__dirname, 'lexicon-v2-phase3-p32-batch-result.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function loadJson(name) {
  const p = path.join(__dirname, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const phase2 = loadJson('lexicon-v2-phase2-dialog200-quality-perf.json');
const phase3Hotfix = loadJson('lexicon-v2-phase3-hotfix-audit-quality-perf.json');

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
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function stats(arr) {
  if (!arr.length) {
    return { count: 0, avg: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }
  return {
    count: arr.length,
    avg: Math.round(avg(arr)),
    p50: pct(arr, 50),
    p95: pct(arr, 95),
    p99: pct(arr, 99),
    min: Math.min(...arr),
    max: Math.max(...arr),
  };
}

const evaluated = report.cases.filter((c) => !c.skip && !c.error);
const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_text || '').trim();
  const fin = (c.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = evaluated.map((c) => c.fw_detector_step_ms).filter((n) => typeof n === 'number');
const vetoMs = evaluated.map((c) => c.kenlm_veto_ms).filter((n) => typeof n === 'number');
const gateMs = evaluated.map((c) => c.kenlm_span_gate_ms).filter((n) => typeof n === 'number');
const gateQueryCounts = evaluated
  .map((c) => c.kenlm_span_gate_query_count)
  .filter((n) => typeof n === 'number');
const vetoQueryCounts = evaluated
  .map((c) => c.kenlm_veto_query_count)
  .filter((n) => typeof n === 'number');
const spanCounts = evaluated.map((c) => c.span_count).filter((n) => typeof n === 'number');

const v2RecallMs = [];
const mergeAfterCounts = [];
const sentToKenlm = [];
let spanRecallCount = 0;
let mergeCapViolations = 0;

for (const c of evaluated) {
  const d = c.recall_v2_diagnostics;
  if (!d) continue;
  for (const s of d.spans || []) {
    spanRecallCount += 1;
    if ((s.candidate_count_after_merge ?? 0) > 5) mergeCapViolations += 1;
    mergeAfterCounts.push(s.candidate_count_after_merge ?? 0);
    sentToKenlm.push(s.sent_to_kenlm ?? 0);
    v2RecallMs.push(s.v2_recall_ms || 0);
  }
}

const out = {
  config: report.config,
  contract: report.summary,
  recall_chain: {
    path: 'KenLM Span Gate → V2 Recall (LIMIT 2/3/0) → KenLM weak_veto → pick',
  },
  span_gate: {
    span_count_per_job: stats(spanCounts),
    kenlm_span_gate_ms: stats(gateMs),
    kenlm_span_gate_query_count: stats(gateQueryCounts),
  },
  recall_tier: {
    span_recall_invocations: spanRecallCount,
    merge_after_merge: stats(mergeAfterCounts),
    sent_to_kenlm: stats(sentToKenlm),
    merge_cap_violations: mergeCapViolations,
    kenlm_veto_query_count: stats(vetoQueryCounts),
  },
  quality: {
    avg_cer_raw: Number(avg(rawCers).toFixed(4)),
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    median_cer_raw: Number(pct(rawCers, 50).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    p95_cer_raw: Number(pct(rawCers, 95).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
  },
  perf: {
    pipeline_total_ms: stats(pipelineMs),
    fw_detector_total_ms: stats(fwStepMs),
    kenlm_span_gate_ms: stats(gateMs),
    kenlm_veto_ms: stats(vetoMs),
    kenlm_total_ms_avg: Math.round(avg([...gateMs, ...vetoMs].filter(Boolean)) || 0),
    v2_recall_ms: stats(v2RecallMs),
    batch_elapsed_sec: report.batch_elapsed_sec,
    avg_wall_sec_per_case: report.summary.avg_wall_sec_per_case,
  },
  comparison: {
    phase2: phase2
      ? {
          fw_applied_total: phase2.contract?.fw_applied_total,
          avg_cer_final: phase2.quality?.avg_cer_final,
          pipeline_ms_p95: phase2.perf?.pipeline_ms?.p95,
          fw_degraded: phase2.quality?.fw_degraded_cases,
        }
      : null,
    phase3_hotfix: phase3Hotfix
      ? {
          fw_applied_total: phase3Hotfix.contract?.fw_applied_total,
          avg_cer_final: phase3Hotfix.quality?.avg_cer_final,
          pipeline_ms_p95: phase3Hotfix.perf?.pipeline_total_ms?.p95,
          span_count_p50: phase3Hotfix.recall_tier?.span_count_per_job?.p50,
          kenlm_veto_ms_avg: phase3Hotfix.perf?.kenlm_veto_ms?.avg ?? phase3Hotfix.perf?.kenlm_ms?.avg,
        }
      : null,
  },
};

const outPath = path.join(__dirname, 'lexicon-v2-phase3-p32-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
