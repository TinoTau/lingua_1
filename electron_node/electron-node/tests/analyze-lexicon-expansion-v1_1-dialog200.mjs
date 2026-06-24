#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.join(__dirname, 'lexicon-expansion-v1_1-dialog200-batch-result.json');
const report = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'),
    'utf8'
  )
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

const evaluated = report.cases.filter((c) => !c.skip);
const rawCers = [];
const finalCers = [];
const probeCers = [];
let exactRaw = 0;
let exactFinal = 0;
let exactProbe = 0;
let improved = 0;
let degraded = 0;
const samples = { exact: [], fwApplied: [], expansionHits: [], worst: [] };

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const probe = (c.extra?.asr_merge_probe_text || c.asr_merge_probe_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  const pc = cer(ref, probe);
  rawCers.push(rc);
  finalCers.push(fc);
  probeCers.push(pc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (norm(probe) === norm(ref)) exactProbe += 1;
  if (fc < rc - 1e-9) improved += 1;
  else if (fc > rc + 1e-9) degraded += 1;
  const row = {
    id: c.id,
    scenario: c.scenario,
    cer_raw: Number(rc.toFixed(4)),
    cer_final: Number(fc.toFixed(4)),
    ref,
    hyp: fin,
    raw,
    fw_applied: c.fw_applied_count || 0,
  };
  if (fc <= 0.001 && samples.exact.length < 5) samples.exact.push(row);
  if ((c.fw_applied_count || 0) > 0 && samples.fwApplied.length < 5) samples.fwApplied.push(row);
  if (fc > 0.15) samples.worst.push(row);
}
samples.worst.sort((a, b) => b.cer_final - a.cer_final);
samples.worst = samples.worst.slice(0, 8);

const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const asrLatency = evaluated
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms)
  .filter((n) => typeof n === 'number');
const audioMs = evaluated
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.audio_ms)
  .filter((n) => typeof n === 'number');

const appliedCases = evaluated.filter((c) => (c.fw_applied_count || 0) > 0);

const out = {
  timestamp: new Date().toISOString(),
  batch_timestamp: report.timestamp,
  evaluated: evaluated.length,
  quality: {
    avg_cer_raw: Number(avg(rawCers).toFixed(4)),
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    avg_cer_probe: Number(avg(probeCers).toFixed(4)),
    median_cer_raw: Number(pct(rawCers, 50).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    median_cer_probe: Number(pct(probeCers, 50).toFixed(4)),
    p95_cer_raw: Number(pct(rawCers, 95).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    p95_cer_probe: Number(pct(probeCers, 95).toFixed(4)),
    exact_match_raw: exactRaw,
    exact_match_final: exactFinal,
    exact_match_probe: exactProbe,
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
    fw_unchanged_cer_cases: evaluated.length - improved - degraded,
    applied_cases_cer_delta_avg:
      appliedCases.length > 0
        ? Number(
            (
              appliedCases.reduce((s, c) => {
                const ref = refById[c.id] || '';
                const raw = (c.extra?.raw_asr_text || '').trim();
                const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
                return s + (cer(ref, raw) - cer(ref, fin));
              }, 0) / appliedCases.length
            ).toFixed(4)
          )
        : 0,
  },
  perf: {
    pipeline_ms: {
      count: pipelineMs.length,
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      min: pipelineMs.length ? Math.min(...pipelineMs) : 0,
      max: pipelineMs.length ? Math.max(...pipelineMs) : 0,
      total_sec: Math.round(pipelineMs.reduce((s, v) => s + v, 0) / 1000),
    },
    asr_latency_ms: {
      count: asrLatency.length,
      avg: Math.round(avg(asrLatency)),
      p50: pct(asrLatency, 50),
      p95: pct(asrLatency, 95),
    },
    audio_ms: {
      count: audioMs.length,
      avg: Math.round(avg(audioMs)),
      p50: pct(audioMs, 50),
    },
    rtf_pipeline: audioMs.length ? Number((avg(pipelineMs) / avg(audioMs)).toFixed(3)) : 0,
    wall_clock_sec: report.summary.wall_clock_sec,
  },
  contract: report.summary,
  stoppedReason: report.stoppedReason,
  samples,
};

const outPath = path.join(__dirname, 'lexicon-expansion-v1_1-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
