#!/usr/bin/env node
/** Aggregate freeze acceptance metrics from batch JSON + manifest CER. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function load(name) {
  const p = path.join(__dirname, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

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

function analyzeBatch(report) {
  const evaluated = report.cases.filter((c) => !c.skip && !c.error);
  let improved = 0;
  let degraded = 0;
  const rawCers = [];
  const finalCers = [];
  let domainHitsTotal = 0;
  let domainHitsJobs = 0;

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

    const spans = c.recall_v2_diagnostics?.spans || [];
    const dh = spans.reduce((s, x) => s + (x.domain_hits || 0), 0);
    if (dh > 0) domainHitsJobs += 1;
    domainHitsTotal += dh;
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  return {
    pass: evaluated.filter((c) => c.pass).length,
    fail: evaluated.filter((c) => !c.pass).length,
    fail_ids: evaluated.filter((c) => !c.pass).map((c) => ({ id: c.id, failures: c.contract_failures, error: c.error })),
    avg_cer_raw: Number((avg(rawCers) * 100).toFixed(2)),
    avg_cer_final: Number((avg(finalCers) * 100).toFixed(2)),
    fw_improved: improved,
    fw_degraded: degraded,
    domain_hits_total: domainHitsTotal,
    domain_hits_gt0_jobs: domainHitsJobs,
    summary: report.summary,
  };
}

const generalPerf = load('lexicon-v2-p4-quality-perf.json');
const restaurantReport = load('p4-freeze-batch-restaurant-result.json');
const p33 = load('lexicon-v2-phase3-p33-quality-perf.json');

const out = {
  timestamp: new Date().toISOString(),
  general_dialog200: generalPerf
    ? {
        source: 'lexicon-v2-p4-quality-perf.json (2026-05-31 prior run, general profile)',
        pass: generalPerf.contract.pass,
        total: generalPerf.contract.total,
        avg_cer_raw: generalPerf.quality.avg_cer_raw,
        avg_cer_final: generalPerf.quality.avg_cer_final,
        fw_degraded: generalPerf.quality.fw_degraded_cases,
        domain_hits: 0,
        pipeline_p95: generalPerf.perf.pipeline_total_ms.p95,
        metadata_gate_p95: generalPerf.span_gate.fw_metadata_gate_ms.p95,
        span_job_p95: generalPerf.span_gate.span_count_per_job.p95,
        span_job_max: generalPerf.span_gate.span_count_per_job.max,
      }
    : null,
  restaurant_dialog200: restaurantReport ? analyzeBatch(restaurantReport) : null,
  p33_baseline: p33
    ? {
        avg_cer_final: Number((p33.quality.avg_cer_final * 100).toFixed(2)),
        pipeline_p95: p33.perf.pipeline_total_ms.p95,
        fw_degraded: p33.quality.fw_degraded_cases,
      }
    : null,
};

const outPath = path.join(__dirname, 'p1-p4-freeze-acceptance-metrics.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
