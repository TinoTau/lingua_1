#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, '../../../..');
const BATCH = path.join(__dirname, '../lexicon-tone-dialog200-batch-result.json');
const MANIFEST = path.join(PROJECT_ROOT, 'test wav/dialog_200/cases.manifest.json');
const DB_AUDIT = path.join(__dirname, 'lexicon-tone-db-audit.json');
const OUT = path.join(__dirname, 'lexicon-tone-dialog200-quality-perf.json');

const report = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const dbAudit = fs.existsSync(DB_AUDIT) ? JSON.parse(fs.readFileSync(DB_AUDIT, 'utf8')) : null;
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
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
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
const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const asrLatency = evaluated
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms)
  .filter((n) => typeof n === 'number');
const audioMs = evaluated
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.audio_ms)
  .filter((n) => typeof n === 'number');
const toneInferMs = evaluated
  .map((c) => c.extra?.asr_diagnostics?.toneModule?.tone_inference_ms)
  .filter((n) => typeof n === 'number');
const toneEnabled = evaluated.filter((c) => c.extra?.asr_diagnostics?.toneModule?.toneEnabled === true);

const rawCers = [];
const finalCers = [];
const perCase = [];
let exactFinal = 0;
const worstFinal = [];
const cafeCases = [];

for (const c of evaluated) {
  const ref = refById[c.id]?.utterance || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(fin) === norm(ref)) exactFinal += 1;
  const fw = c.extra?.fw_detector || {};
  const toneDiag = fw.toneModule || fw.toneDiagnostics || {};
  const row = {
    id: c.id,
    scenario: c.scenario,
    cer: Number(fc.toFixed(4)),
    pipeline_ms: c.pipeline_ms,
    fw_triggered: c.fw_triggered,
    fw_applied_count: c.fw_applied_count,
    recallToneCompatibleCount: toneDiag.recallToneCompatibleCount ?? null,
    recallToneFallbackCount: toneDiag.recallToneFallbackCount ?? null,
    toneEnabled: c.extra?.asr_diagnostics?.toneModule?.toneEnabled === true,
    ref: ref.slice(0, 60),
    hyp: fin.slice(0, 60),
  };
  perCase.push(row);
  if (fc > 0.2) worstFinal.push(row);
  if (c.scenario === 'cafe') cafeCases.push(row);
}
worstFinal.sort((a, b) => b.cer - a.cer);

const fwTriggered = evaluated.filter((c) => c.fw_triggered);
let recallToneCompatibleTotal = 0;
let recallToneFallbackTotal = 0;
let spansWithAcousticTone = 0;
for (const c of fwTriggered) {
  const td = c.extra?.fw_detector?.toneModule || c.extra?.fw_detector?.toneDiagnostics || {};
  recallToneCompatibleTotal += td.recallToneCompatibleCount || 0;
  recallToneFallbackTotal += td.recallToneFallbackCount || 0;
  if (Array.isArray(td.acousticTonePattern) && td.acousticTonePattern.length) spansWithAcousticTone += 1;
}

const samples = {
  cafe_d001: perCase.find((r) => r.id === 'd001'),
  cafe_d002: perCase.find((r) => r.id === 'd002'),
  cafe_d003: perCase.find((r) => r.id === 'd003'),
  best_cer: [...perCase].sort((a, b) => a.cer - b.cer).slice(0, 3),
  worst_cer: worstFinal.slice(0, 8),
  fw_triggered_sample: perCase.filter((r) => r.fw_triggered).slice(0, 5),
};

const out = {
  timestamp: new Date().toISOString(),
  dbAudit: dbAudit
    ? { all_tables_pass: dbAudit.all_tables_pass, tables: dbAudit.tables, manifest: dbAudit.manifest }
    : null,
  contract: report.summary,
  quality: {
    evaluated: evaluated.length,
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    exact_match_final: exactFinal,
    exact_match_rate: Number((exactFinal / evaluated.length).toFixed(4)),
    cafe_avg_cer: Number(avg(cafeCases.map((c) => c.cer)).toFixed(4)),
    cafe_count: cafeCases.length,
  },
  perf: {
    wall_clock_sec: report.summary?.wall_clock_sec,
    pipeline_ms: {
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      min: Math.min(...pipelineMs),
      max: Math.max(...pipelineMs),
    },
    asr_latency_ms: {
      avg: Math.round(avg(asrLatency)),
      p50: pct(asrLatency, 50),
      p95: pct(asrLatency, 95),
    },
    tone_inference_ms: {
      avg: Math.round(avg(toneInferMs)),
      p50: pct(toneInferMs, 50),
      p95: pct(toneInferMs, 95),
    },
    audio_ms_avg: Math.round(avg(audioMs)),
    rtf_pipeline: Number((avg(pipelineMs) / avg(audioMs)).toFixed(3)),
  },
  toneRuntime: {
    toneEnabledCases: toneEnabled.length,
    toneEnabledRate: Number((toneEnabled.length / evaluated.length).toFixed(4)),
    fw_triggered_cases: fwTriggered.length,
    recallToneCompatibleTotal,
    recallToneFallbackTotal,
    cases_with_recall_tone_compatible: perCase.filter((r) => (r.recallToneCompatibleCount || 0) > 0).length,
    spans_with_acoustic_tone_pattern: spansWithAcousticTone,
  },
  samples,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
