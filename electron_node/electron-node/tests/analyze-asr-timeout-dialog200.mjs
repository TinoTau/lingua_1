#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'asr-timeout-dialog200-batch-result.json'), 'utf8')
);
const manifest = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json'),
    'utf8'
  )
);
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function norm(s) {
  return (s || '')
    .replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '')
    .toLowerCase();
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

const evaluated = report.cases.filter((c) => !c.skip);
const rawCers = [];
const finalCers = [];
const pipelineMs = [];
const asrLatency = [];
let improved = 0;
let degraded = 0;
const byScenario = {};
const worstFinal = [];

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (fc < rc - 0.0001) improved += 1;
  if (fc > rc + 0.0001) degraded += 1;
  if (typeof c.pipeline_ms === 'number') pipelineMs.push(c.pipeline_ms);
  const al = c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms;
  if (typeof al === 'number') asrLatency.push(al);
  const sc = c.scenario || 'unknown';
  if (!byScenario[sc]) byScenario[sc] = { n: 0, raw: [], fin: [] };
  byScenario[sc].n += 1;
  byScenario[sc].raw.push(rc);
  byScenario[sc].fin.push(fc);
  worstFinal.push({ id: c.id, scenario: c.scenario, final_cer: fc, ref: ref.slice(0, 40), final: fin.slice(0, 60) });
}

worstFinal.sort((a, b) => b.final_cer - a.final_cer);

const focusIds = ['d049', 'd050', 'd051', 'd052', 'd053', 'd054', 'd055'];
const focusCases = focusIds.map((id) => {
  const c = evaluated.find((x) => x.id === id);
  if (!c) return null;
  const ref = refById[id];
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  return {
    id,
    scenario: c.scenario,
    pipeline_ms: c.pipeline_ms,
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    fw_applied_count: c.fw_applied_count,
    ref,
    raw,
    final: fin,
  };
}).filter(Boolean);

const out = {
  summary: {
    evaluated: evaluated.length,
    pass: evaluated.filter((c) => c.pass).length,
    fail: evaluated.filter((c) => !c.pass).length,
    wall_clock_sec: report.summary.wall_clock_sec,
    asr_503_504: evaluated.filter(
      (c) => c.error && (c.error.includes('503') || c.error.includes('504'))
    ).length,
  },
  cer: {
    raw_mean: Number(avg(rawCers).toFixed(4)),
    final_mean: Number(avg(finalCers).toFixed(4)),
    raw_p50: Number(pct(rawCers, 50).toFixed(4)),
    final_p50: Number(pct(finalCers, 50).toFixed(4)),
    raw_p95: Number(pct(rawCers, 95).toFixed(4)),
    final_p95: Number(pct(finalCers, 95).toFixed(4)),
    improved,
    degraded,
    unchanged: evaluated.length - improved - degraded,
  },
  perf: {
    pipeline_mean: Math.round(avg(pipelineMs)),
    pipeline_p50: Math.round(pct(pipelineMs, 50)),
    pipeline_p95: Math.round(pct(pipelineMs, 95)),
    pipeline_max: Math.max(...pipelineMs),
    asr_latency_mean: Math.round(avg(asrLatency)),
    asr_latency_p50: Math.round(pct(asrLatency, 50)),
    warmup_ms: report.asrWarmup?.elapsedMs,
  },
  fw: {
    triggered: report.summary.fw_triggered_count,
    applied_cases: report.summary.fw_applied_case_count,
    text_changed: report.summary.text_changed_count,
  },
  byScenario: Object.fromEntries(
    Object.entries(byScenario).map(([k, v]) => [
      k,
      {
        n: v.n,
        raw_mean: Number(avg(v.raw).toFixed(4)),
        final_mean: Number(avg(v.fin).toFixed(4)),
      },
    ])
  ),
  focusCases,
  worstFinal: worstFinal.slice(0, 8),
};

const outPath = path.join(__dirname, 'asr-timeout-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
