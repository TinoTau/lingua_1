#!/usr/bin/env node
/**
 * Quality + perf analysis for Phase 3/4 dialog_200 batch result.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'lexicon-v2-phase3-dialog200-batch-result.json'), 'utf8')
);
const manifest = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'),
    'utf8'
  )
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

const phase2Path = path.join(__dirname, 'lexicon-v2-phase2-dialog200-quality-perf.json');
let phase2Baseline = null;
if (fs.existsSync(phase2Path)) {
  phase2Baseline = JSON.parse(fs.readFileSync(phase2Path, 'utf8'));
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

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

const evaluated = report.cases.filter((c) => !c.skip && !c.error);
const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const asrLatency = evaluated
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms)
  .filter((n) => typeof n === 'number');
const audioMs = evaluated
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.audio_ms)
  .filter((n) => typeof n === 'number');
const fwStepMs = evaluated
  .map((c) => c.extra?.pipeline_step_ms?.fw_detector)
  .filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_text || c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr || c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

const out = {
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
    pipeline_ms: {
      count: pipelineMs.length,
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      min: pipelineMs.length ? Math.min(...pipelineMs) : 0,
      max: pipelineMs.length ? Math.max(...pipelineMs) : 0,
      total_sec: Math.round(pipelineMs.reduce((s, v) => s + v, 0) / 1000),
    },
    fw_detector_ms: {
      count: fwStepMs.length,
      avg: Math.round(avg(fwStepMs)),
      p50: pct(fwStepMs, 50),
      p95: pct(fwStepMs, 95),
    },
    asr_latency_ms: {
      count: asrLatency.length,
      avg: Math.round(avg(asrLatency)),
      p50: pct(asrLatency, 50),
      p95: pct(asrLatency, 95),
    },
    audio_ms: { avg: Math.round(avg(audioMs)), p50: pct(audioMs, 50) },
    rtf_pipeline: audioMs.length ? Number((avg(pipelineMs) / avg(audioMs)).toFixed(3)) : null,
    batch_elapsed_sec: report.batch_elapsed_sec,
  },
  contract: report.summary,
  intent: report.intent,
  phase2_baseline_comparison: phase2Baseline
    ? {
        avg_cer_final_delta: Number(
          (avg(finalCers) - (phase2Baseline.quality?.avg_cer_final ?? 0)).toFixed(4)
        ),
        pipeline_ms_p95_delta: pct(pipelineMs, 95) - (phase2Baseline.perf?.pipeline_ms?.p95 ?? 0),
        fw_detector_ms_p95: phase2Baseline.perf?.fw_detector_ms?.p95 ?? null,
        fw_detector_ms_p95_delta:
          fwStepMs.length && phase2Baseline.perf?.fw_detector_ms?.p95 != null
            ? pct(fwStepMs, 95) - phase2Baseline.perf.fw_detector_ms.p95
            : null,
      }
    : null,
};

const outPath = path.join(__dirname, 'lexicon-v2-phase3-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
