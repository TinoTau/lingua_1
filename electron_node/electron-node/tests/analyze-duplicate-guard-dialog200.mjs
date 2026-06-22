#!/usr/bin/env node
/**
 * dialog_200 quality/perf + duplicate_sanitize analysis.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'duplicate-guard-dialog200-batch-result.json');
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

function maxConsecutiveUnit(text, unit) {
  let max = 0;
  for (let i = 0; i < text.length; i += 1) {
    let count = 0;
    let pos = i;
    while (text.slice(pos, pos + unit.length) === unit) {
      count += 1;
      pos += unit.length;
    }
    if (count > max) max = count;
  }
  return max;
}

const evaluated = report.cases.filter((c) => !c.skip && !c.error);
const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;
const worstFinal = [];
const duplicateApplied = [];
const ruleCounts = {};
const samples = [];

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const ds = c.extra?.duplicate_sanitize;
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
  if (fc > 0.15) {
    worstFinal.push({ id: c.id, scenario: c.scenario, cer: fc, ref: ref.slice(0, 48), hyp: fin.slice(0, 48) });
  }
  if (ds?.applied) {
    duplicateApplied.push({
      id: c.id,
      rule: ds.rule,
      repeatCount: ds.repeatCount,
      beforeLength: ds.beforeLength,
      afterLength: ds.afterLength,
      raw_preview: raw.slice(0, 80),
      final_preview: fin.slice(0, 80),
    });
    ruleCounts[ds.rule] = (ruleCounts[ds.rule] || 0) + 1;
  }
  if (['d067', 'd001', 'd045', 'd051'].includes(c.id) || ds?.applied) {
    samples.push({
      id: c.id,
      pass: c.pass,
      scenario: c.scenario,
      ref: ref.slice(0, 60),
      raw: raw.slice(0, 80),
      final: fin.slice(0, 80),
      raw_cer: Number(rc.toFixed(4)),
      final_cer: Number(fc.toFixed(4)),
      duplicate_sanitize: ds || null,
      pipeline_ms: c.pipeline_ms,
    });
  }
}
worstFinal.sort((a, b) => b.cer - a.cer);

const d067 = evaluated.find((c) => c.id === 'd067');
const d067Raw = (d067?.extra?.raw_asr_text || '').trim();
const d067Fin = (d067?.extra?.text_asr || '').trim();
const d067Unit = '您好,我定,';

const out = {
  batch_file: path.basename(batchPath),
  timestamp: report.timestamp,
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  contract: report.summary,
  duplicate_guard: {
    trace_present_count: evaluated.filter((c) => c.extra?.duplicate_sanitize).length,
    applied_count: duplicateApplied.length,
    rule_distribution: ruleCounts,
    d067: d067
      ? {
          pass: d067.pass,
          raw_cer: Number(cer(refById.d067 || '', d067Raw).toFixed(4)),
          final_cer: Number(cer(refById.d067 || '', d067Fin).toFixed(4)),
          max_consecutive_unit: maxConsecutiveUnit(d067Fin, d067Unit),
          duplicate_sanitize: d067.extra?.duplicate_sanitize,
          raw_len: d067Raw.length,
          final_len: d067Fin.length,
          final_preview: d067Fin.slice(0, 80),
        }
      : null,
    applied_cases: duplicateApplied.slice(0, 20),
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
    worst_final_cer_top5: worstFinal.slice(0, 5),
  },
  perf: {
    pipeline_ms: {
      count: pipelineMs.length,
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      max: pipelineMs.length ? Math.max(...pipelineMs) : 0,
    },
    wall_clock_sec: report.summary?.wall_clock_sec,
  },
  samples,
};

const outPath = path.join(__dirname, 'duplicate-guard-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
