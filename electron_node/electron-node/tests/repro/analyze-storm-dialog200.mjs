#!/usr/bin/env node
/** Quality/perf analysis for dialog_200 batch JSON (storm repro round). */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath =
  process.argv[2] ||
  path.join(__dirname, '..', 'storm-repro-pipeline-batch-result.json');
const outPath =
  process.argv[3] ||
  path.join(__dirname, '..', 'storm-repro-pipeline-quality-perf.json');
const manifestPath = path.resolve(
  __dirname,
  '../../../../test wav/dialog_200/cases.manifest.json'
);

const report = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
let improved = 0;
let degraded = 0;
const samples = [];
const infraErrors = { '503': 0, '504': 0, other: 0 };

for (const c of evaluated) {
  const err = String(c.error || '');
  if (err.includes('503')) infraErrors['503'] += 1;
  else if (err.includes('504')) infraErrors['504'] += 1;
  else if (err && !c.pass) infraErrors.other += 1;

  if (!c.pass || c.error) continue;
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
  if (samples.length < 12) {
    samples.push({
      id: c.id,
      scenario: c.scenario,
      ref: ref.slice(0, 60),
      raw: raw.slice(0, 60),
      final: fin.slice(0, 60),
      raw_cer: +rc.toFixed(4),
      final_cer: +fc.toFixed(4),
      pipeline_ms: c.pipeline_ms,
    });
  }
}

const out = {
  timestamp: new Date().toISOString(),
  batchPath,
  evaluated: evaluated.length,
  pass: report.summary?.pass ?? evaluated.filter((c) => c.pass).length,
  fail: report.summary?.fail ?? evaluated.filter((c) => !c.pass).length,
  stoppedReason: report.stoppedReason,
  wall_clock_sec: report.summary?.wall_clock_sec,
  asr_warmup_ms: report.asrWarmup?.elapsedMs,
  infra_errors: infraErrors,
  quality: {
    pass_with_text: rawCers.length,
    raw_cer_mean: +avg(rawCers).toFixed(4),
    final_cer_mean: +avg(finalCers).toFixed(4),
    raw_cer_p50: +pct(rawCers, 50).toFixed(4),
    final_cer_p50: +pct(finalCers, 50).toFixed(4),
    fw_improved: improved,
    fw_degraded: degraded,
    fw_unchanged: rawCers.length - improved - degraded,
  },
  performance: {
    pipeline_ms_mean: Math.round(avg(pipelineMs)),
    pipeline_ms_p50: Math.round(pct(pipelineMs, 50)),
    pipeline_ms_p95: Math.round(pct(pipelineMs, 95)),
    pipeline_ms_max: pipelineMs.length ? Math.max(...pipelineMs) : 0,
  },
  samples,
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[analyze-storm-dialog200] wrote', outPath);
console.log(JSON.stringify(out, null, 2));
