#!/usr/bin/env node
/**
 * dialog_200 quality/perf + Residual Cleanup diagnostics analysis.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'residual-cleanup-dialog200-batch-result.json');
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

const evaluated = report.cases.filter((c) => !c.skip && !c.error && c.pass);
const allEvaluated = report.cases.filter((c) => !c.skip && !c.error);
const pipelineMs = allEvaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = allEvaluated
  .map((c) => c.extra?.fw_detector_step_ms)
  .filter((n) => typeof n === 'number');
const assemblyMs = allEvaluated
  .map((c) => c.extra?.fw_detector?.spanAssemblyV4?.assemblyMs)
  .filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;
const worstFinal = [];
const ruleCounts = {};
let toneModuleLeak = 0;
let hardDropLeak = 0;
let intervalPathsLeak = 0;
let conflictRelationTotal = 0;
let toneEnabledCount = 0;
const samples = [];

for (const c of allEvaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const fw = c.extra?.fw_detector || {};
  const v4 = fw.spanAssemblyV4 || {};
  const tone = v4.tone || {};
  const ds = c.extra?.duplicate_sanitize;

  if (fw.toneModule != null) toneModuleLeak += 1;
  if (v4.hardDropCount != null || v4.droppedCandidateCount != null) hardDropLeak += 1;
  if (v4.intervalPaths != null) intervalPathsLeak += 1;
  conflictRelationTotal += v4.conflictRelationCount || 0;
  if (tone.toneEnabled === true) toneEnabledCount += 1;

  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  if (c.pass) {
    rawCers.push(rc);
    finalCers.push(fc);
    if (fc < rc - 1e-9) improved += 1;
    if (fc > rc + 1e-9) degraded += 1;
    if (fc > 0.15) {
      worstFinal.push({
        id: c.id,
        scenario: c.scenario,
        cer: Number(fc.toFixed(4)),
        ref: ref.slice(0, 48),
        hyp: fin.slice(0, 48),
      });
    }
  }

  const rule = ds?.rule || 'none';
  ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;

  if (samples.length < 12) {
    samples.push({
      id: c.id,
      scenario: c.scenario,
      pass: c.pass,
      pipeline_ms: c.pipeline_ms,
      raw_cer: Number(rc.toFixed(4)),
      final_cer: Number(fc.toFixed(4)),
      fw_applied: c.fw_applied_count || 0,
      conflictRelationCount: v4.conflictRelationCount ?? null,
      toneEnabled: tone.toneEnabled ?? null,
      duplicate_sanitize: ds || null,
      has_toneModule: fw.toneModule != null,
      text_preview: fin.slice(0, 60),
    });
  }
}

worstFinal.sort((a, b) => b.cer - a.cer);

const out = {
  source_batch: batchPath,
  timestamp: new Date().toISOString(),
  testScope: 'Residual Chain Cleanup V1.2 dialog_200',
  batch_summary: report.summary,
  stoppedReason: report.stoppedReason,
  evaluated_pass: evaluated.length,
  evaluated_total: allEvaluated.length,
  quality: {
    raw_cer_mean: Number(avg(rawCers).toFixed(4)),
    raw_cer_p50: Number(pct(rawCers, 50).toFixed(4)),
    raw_cer_p95: Number(pct(rawCers, 95).toFixed(4)),
    final_cer_mean: Number(avg(finalCers).toFixed(4)),
    final_cer_p50: Number(pct(finalCers, 50).toFixed(4)),
    final_cer_p95: Number(pct(finalCers, 95).toFixed(4)),
    cer_improved_count: improved,
    cer_degraded_count: degraded,
    cer_unchanged_count: evaluated.length - improved - degraded,
    worst_final_cer_top5: worstFinal.slice(0, 5),
  },
  performance: {
    pipeline_ms_mean: Number(avg(pipelineMs).toFixed(1)),
    pipeline_ms_p50: Math.round(pct(pipelineMs, 50)),
    pipeline_ms_p95: Math.round(pct(pipelineMs, 95)),
    fw_detector_step_ms_mean: Number(avg(fwStepMs).toFixed(1)),
    assembly_ms_mean: Number(avg(assemblyMs).toFixed(1)),
    wall_clock_sec: report.summary?.wall_clock_sec,
    throughput_cases_per_sec: report.summary?.evaluated
      ? Number((report.summary.evaluated / (report.summary.wall_clock_sec || 1)).toFixed(3))
      : 0,
  },
  cleanup_diagnostics: {
    toneModule_leak_count: toneModuleLeak,
    hardDrop_field_leak_count: hardDropLeak,
    intervalPaths_leak_count: intervalPathsLeak,
    total_conflict_relations: conflictRelationTotal,
    avg_conflict_relations: Number(
      (conflictRelationTotal / Math.max(1, allEvaluated.length)).toFixed(2)
    ),
    tone_enabled_case_count: toneEnabledCount,
    duplicate_sanitize_rule_counts: ruleCounts,
  },
  samples,
};

const outPath = path.join(__dirname, 'residual-cleanup-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
