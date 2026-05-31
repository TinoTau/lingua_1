#!/usr/bin/env node
/**
 * P4 Sentence Rerank — quality + perf analysis.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(__dirname, 'lexicon-v2-p4-batch-result.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function loadJson(name) {
  const p = path.join(__dirname, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const p33 = loadJson('lexicon-v2-phase3-p33-quality-perf.json');
const phase2 = loadJson('lexicon-v2-phase2-dialog200-quality-perf.json');

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
let unchangedApply = 0;

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_text || '').trim();
  const fin = (c.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (fc < rc - 1e-9) improved += 1;
  else if (fc > rc + 1e-9) degraded += 1;
  else if (c.fw_applied_count > 0) unchangedApply += 1;
}

const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = evaluated.map((c) => c.fw_detector_step_ms).filter((n) => typeof n === 'number');
const kenlmMs = evaluated.map((c) => c.kenlm_veto_ms).filter((n) => typeof n === 'number');
const metaGateMs = evaluated.map((c) => c.fw_metadata_gate_ms).filter((n) => typeof n === 'number');
const spanCounts = evaluated.map((c) => c.span_count).filter((n) => typeof n === 'number');

const combinationCounts = [];
const kenlmQueryCounts = [];
const maxDeltas = [];
const perSpanLimits = [];
let jobsWithRerank = 0;
let pickedRaw = 0;
let pickedCandidate = 0;

for (const c of evaluated) {
  const sr = c.sentence_rerank;
  if (!sr) continue;
  jobsWithRerank += 1;
  if (sr.pickedIsRaw) pickedRaw += 1;
  else pickedCandidate += 1;
  combinationCounts.push(sr.combinationCount ?? 0);
  kenlmQueryCounts.push(sr.kenlmQueryCount ?? 0);
  maxDeltas.push(sr.maxDelta ?? 0);
  perSpanLimits.push(sr.perSpanLimit ?? 0);
}

const out = {
  config: report.config,
  contract: report.summary,
  recall_chain: {
    path: 'Metadata Gate → V2 Recall (combined limit) → Sentence combinator → KenLM sentence rerank → Apply',
  },
  span_gate: {
    span_count_per_job: stats(spanCounts),
    fw_metadata_gate_ms: stats(metaGateMs),
  },
  sentence_rerank: {
    jobs_with_diagnostics: jobsWithRerank,
    picked_raw: pickedRaw,
    picked_candidate: pickedCandidate,
    combination_count: stats(combinationCounts),
    kenlm_query_count: stats(kenlmQueryCounts),
    max_delta: stats(maxDeltas.map((d) => Math.round(d * 10000))),
    per_span_limit: stats(perSpanLimits),
  },
  quality: {
    evaluated_count: evaluated.length,
    avg_cer_raw: Number((avg(rawCers) * 100).toFixed(2)),
    avg_cer_final: Number((avg(finalCers) * 100).toFixed(2)),
    median_cer_raw: Number((pct(rawCers, 50) * 100).toFixed(2)),
    median_cer_final: Number((pct(finalCers, 50) * 100).toFixed(2)),
    p95_cer_raw: Number((pct(rawCers, 95) * 100).toFixed(2)),
    p95_cer_final: Number((pct(finalCers, 95) * 100).toFixed(2)),
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
    fw_unchanged_apply_cases: unchangedApply,
  },
  perf: {
    pipeline_total_ms: stats(pipelineMs),
    fw_detector_total_ms: stats(fwStepMs),
    kenlm_sentence_rerank_ms: stats(kenlmMs),
    fw_metadata_gate_ms: stats(metaGateMs),
    batch_elapsed_sec: report.batch_elapsed_sec,
    avg_wall_sec_per_case: report.summary.avg_wall_sec_per_case,
  },
  comparison: {
    p33: p33
      ? {
          fw_applied_total: p33.contract?.fw_applied_total,
          avg_cer_final: p33.quality?.avg_cer_final,
          pipeline_ms_p95: p33.perf?.pipeline_total_ms?.p95,
          fw_degraded: p33.quality?.fw_degraded_cases,
        }
      : null,
    phase2: phase2
      ? {
          fw_applied_total: phase2.contract?.fw_applied_total,
          avg_cer_final: phase2.quality?.avg_cer_final,
          pipeline_ms_p95: phase2.perf?.pipeline_ms?.p95,
        }
      : null,
  },
};

const outPath = path.join(__dirname, 'lexicon-v2-p4-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
