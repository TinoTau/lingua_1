#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.join(__dirname, '../lexicon-tone-dialog200-spanselector-batch-result.json');
const MANIFEST = path.join(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');

const r = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c]));

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
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function cer(ref, hyp) {
  const R = norm(ref);
  const H = norm(hyp);
  if (!R.length) return H.length ? 1 : 0;
  return levenshtein(R, H) / R.length;
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

const cases = r.cases.filter((c) => !c.skip);
const pipelineMs = cases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const asrLat = cases
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms)
  .filter((n) => typeof n === 'number');
const toneMs = cases
  .map((c) => c.extra?.asr_diagnostics?.toneModule?.tone_inference_ms)
  .filter((n) => typeof n === 'number');
const audioMs = cases
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.audio_ms)
  .filter((n) => typeof n === 'number');

const perCase = [];
let exact = 0;
for (const c of cases) {
  const ref = refById[c.id]?.utterance || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  if (norm(fin) === norm(ref)) exact += 1;
  const ime = c.extra?.fw_detector?.pinyinImeV2 || {};
  perCase.push({
    id: c.id,
    scenario: c.scenario,
    ref,
    raw,
    fin,
    rc,
    fc,
    fw: c.fw_triggered,
    reason: c.fw_reason,
    applied: c.fw_applied_count || 0,
    selectedSpanCount: ime.selectedSpanCount || 0,
    selectionMode: ime.selectionMode,
    neighborMissCount: ime.neighborMissCount || 0,
  });
}

const rawCers = perCase.map((p) => p.rc);
const finalCers = perCase.map((p) => p.fc);
const cafe = perCase.filter((p) => p.scenario === 'cafe');

const out = {
  cer: {
    raw_avg: avg(rawCers),
    raw_p50: pct(rawCers, 50),
    raw_p95: pct(rawCers, 95),
    final_avg: avg(finalCers),
    exact,
  },
  perf: {
    pipeline_avg: avg(pipelineMs),
    pipeline_p50: pct(pipelineMs, 50),
    pipeline_p95: pct(pipelineMs, 95),
    pipeline_min: Math.min(...pipelineMs),
    pipeline_max: Math.max(...pipelineMs),
    asr_avg: avg(asrLat),
    asr_p95: pct(asrLat, 95),
    tone_avg: avg(toneMs),
    audio_avg: avg(audioMs),
    rtf: avg(pipelineMs) / avg(audioMs),
  },
  cafe_cer_avg: avg(cafe.map((p) => p.rc)),
  worst: [...perCase].sort((a, b) => b.fc - a.fc).slice(0, 5),
  best: perCase.filter((p) => p.fc === 0).slice(0, 5),
  cafeSamples: cafe.slice(0, 6),
  d002: perCase.find((p) => p.id === 'd002'),
  d001: perCase.find((p) => p.id === 'd001'),
  d003: perCase.find((p) => p.id === 'd003'),
};

const outPath = path.join(__dirname, 'lexicon-tone-dialog200-spanselector-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
