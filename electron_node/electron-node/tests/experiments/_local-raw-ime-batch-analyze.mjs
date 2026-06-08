#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.join(__dirname, '../lexicon-tone-dialog200-local-raw-ime-batch-result.json');
const BASELINE = path.join(__dirname, '../lexicon-tone-dialog200-spanselector-batch-result.json');
const MANIFEST = path.join(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');
const OUT = path.join(__dirname, 'lexicon-tone-dialog200-local-raw-ime-quality-perf.json');

const r = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c]));
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const baselineById = baseline
  ? Object.fromEntries(baseline.cases.filter((c) => !c.skip).map((c) => [c.id, c]))
  : {};

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
const decodeMs = cases
  .map((c) => c.extra?.fw_detector?.pinyinImeV2?.decodeMs)
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
  const b = baselineById[c.id];
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
    diffSpanCount: ime.diffSpanCount || 0,
    selectedSpanCount: ime.selectedSpanCount || 0,
    normalizedSpanCount: ime.normalizedSpanCount || 0,
    selectionMode: ime.selectionMode,
    pipeline_ms: c.pipeline_ms,
    baseline_fw: b?.fw_triggered ?? null,
    baseline_selected: b?.extra?.fw_detector?.pinyinImeV2?.selectedSpanCount ?? null,
    baseline_diff: b?.extra?.fw_detector?.pinyinImeV2?.diffSpanCount ?? null,
    fw_delta: b ? (c.fw_triggered ? 1 : 0) - (b.fw_triggered ? 1 : 0) : null,
  });
}

const rawCers = perCase.map((p) => p.rc);
const finalCers = perCase.map((p) => p.fc);
const cafe = perCase.filter((p) => p.scenario === 'cafe');

const fwTriggered = cases.filter((c) => c.fw_triggered).length;
const baselineFw = baseline ? baseline.cases.filter((c) => !c.skip && c.fw_triggered).length : null;
const diffPositive = perCase.filter((p) => p.diffSpanCount > 0).length;
const selectedPositive = perCase.filter((p) => p.selectedSpanCount > 0).length;
const fwGained = perCase.filter((p) => p.fw_delta === 1).length;
const fwLost = perCase.filter((p) => p.fw_delta === -1).length;

const out = {
  batch: {
    timestamp: r.timestamp,
    evaluated: cases.length,
    contract_pass: cases.filter((c) => c.pass).length,
    wall_clock_sec: r.summary?.wall_clock_sec,
  },
  fw: {
    triggered: fwTriggered,
    no_spans: cases.length - fwTriggered,
    baseline_triggered: baselineFw,
    delta_triggered: baselineFw != null ? fwTriggered - baselineFw : null,
    gained_from_baseline: fwGained,
    lost_from_baseline: fwLost,
    apply_gt0: cases.filter((c) => (c.fw_applied_count || 0) > 0).length,
  },
  proposal: {
    diffSpanCount_gt0: diffPositive,
    selectedSpanCount_gt0: selectedPositive,
    avg_diffSpanCount: avg(perCase.map((p) => p.diffSpanCount)),
    avg_selectedSpanCount: avg(perCase.map((p) => p.selectedSpanCount)),
  },
  cer: {
    raw_avg: avg(rawCers),
    raw_p50: pct(rawCers, 50),
    raw_p95: pct(rawCers, 95),
    final_avg: avg(finalCers),
    final_p50: pct(finalCers, 50),
    final_p95: pct(finalCers, 95),
    exact_final: exact,
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
    rtf: avg(audioMs) > 0 ? avg(pipelineMs) / avg(audioMs) : null,
    ime_decode_avg: avg(decodeMs),
    ime_decode_p95: pct(decodeMs, 95),
  },
  cafe_cer_avg: avg(cafe.map((p) => p.rc)),
  keyCases: {
    d001: perCase.find((p) => p.id === 'd001'),
    d002: perCase.find((p) => p.id === 'd002'),
    d003: perCase.find((p) => p.id === 'd003'),
  },
  samples: {
    fw_gained: perCase.filter((p) => p.fw_delta === 1).slice(0, 8),
    fw_lost: perCase.filter((p) => p.fw_delta === -1).slice(0, 5),
    worst_final_cer: [...perCase].sort((a, b) => b.fc - a.fc).slice(0, 5),
    best_final_cer: perCase.filter((p) => p.fc === 0).slice(0, 5),
    cafe: cafe.slice(0, 6),
  },
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ out: OUT, fw: out.fw, cer: out.cer, perf: out.perf, keyCases: out.keyCases }, null, 2));
