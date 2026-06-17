#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.resolve(
  process.argv[2] || path.join(__dirname, '../compat-auth-reduction-dialog200-batch-result.json')
);
const manifestPath = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');

const report = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

const evaluated = report.cases.filter((c) => !c.skip);
const validCases = evaluated.filter((c) => c.pass);
const v4List = validCases
  .map((c) => c.extra?.fw_detector?.spanAssemblyV4)
  .filter(Boolean);

const rawCers = [];
const finalCers = [];
let exactRaw = 0;
let exactFinal = 0;

for (const c of validCases) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || c.extra?.raw_asr_text || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
}

const pipelineMs = validCases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = validCases.map((c) => c.extra?.fw_detector_step_ms).filter((n) => typeof n === 'number');
const assemblyMs = v4List.map((d) => d.assemblyMs).filter((n) => typeof n === 'number');

const d001 = validCases.find((c) => c.id === 'd001');
const d001V4 = d001?.extra?.fw_detector?.spanAssemblyV4 || {};
const activeCandidates = d001V4.activeCandidates || d001V4.poolAfterDrop || [];

const out = {
  batchFile: batchPath,
  timestamp: report.timestamp,
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  contractPass: report.summary?.pass ?? validCases.length,
  wallClockSec: report.summary?.wall_clock_sec,
  quality: {
    raw_cer_avg: Number(avg(rawCers).toFixed(4)),
    final_cer_avg: Number(avg(finalCers).toFixed(4)),
    raw_cer_p50: Number(pct(rawCers, 50).toFixed(4)),
    final_cer_p50: Number(pct(finalCers, 50).toFixed(4)),
    raw_cer_p95: Number(pct(rawCers, 95).toFixed(4)),
    final_cer_p95: Number(pct(finalCers, 95).toFixed(4)),
    exact_raw_count: exactRaw,
    exact_final_count: exactFinal,
    text_changed_count: validCases.filter(
      (c) => (c.extra?.raw_asr_text || '').trim() !== (c.extra?.text_asr || '').trim()
    ).length,
    fw_applied_case_count: validCases.filter((c) => (c.fw_applied_count || 0) > 0).length,
  },
  performance: {
    pipeline_ms_avg: Math.round(avg(pipelineMs)),
    pipeline_ms_p50: Math.round(pct(pipelineMs, 50)),
    pipeline_ms_p95: Math.round(pct(pipelineMs, 95)),
    fw_detector_step_ms_avg: Math.round(avg(fwStepMs)),
    fw_detector_step_ms_p50: Math.round(pct(fwStepMs, 50)),
    fw_detector_step_ms_p95: Math.round(pct(fwStepMs, 95)),
    assembly_ms_avg: Math.round(avg(assemblyMs)),
    assembly_ms_p50: Math.round(pct(assemblyMs, 50)),
    assembly_ms_p95: Math.round(pct(assemblyMs, 95)),
    asr_warmup_ms: report.asrWarmup?.elapsedMs,
    throughput_cases_per_sec: Number((validCases.length / (report.summary?.wall_clock_sec || 1)).toFixed(3)),
  },
  compatibilityAuthorityReduction: {
    total_conflict_relations: v4List.reduce((s, d) => s + (d.conflictRelationCount || 0), 0),
    avg_conflict_relations: Number(avg(v4List.map((d) => d.conflictRelationCount || 0)).toFixed(2)),
    total_hard_drops: v4List.reduce((s, d) => s + (d.hardDropCount || 0), 0),
    avg_hard_drops: Number(avg(v4List.map((d) => d.hardDropCount || 0)).toFixed(2)),
    avg_active_candidates: Number(avg(v4List.map((d) => d.activeCandidateCount || 0)).toFixed(2)),
    avg_dropped_candidates: Number(avg(v4List.map((d) => d.droppedCandidateCount || 0)).toFixed(2)),
    cases_with_conflict_relations: v4List.filter((d) => (d.conflictRelationCount || 0) > 0).length,
    max_active_candidates: Math.max(...v4List.map((d) => d.activeCandidateCount || 0), 0),
    min_active_candidates: Math.min(...v4List.map((d) => d.activeCandidateCount || 0), 0),
  },
  coverageMetrics: {
    total_coverage_pairs: v4List.reduce((s, d) => s + (d.coverageCount || 0), 0),
    avg_coverage_pairs: Number(avg(v4List.map((d) => d.coverageCount || 0)).toFixed(2)),
    cases_with_coverage: v4List.filter((d) => (d.coverageCount || 0) > 0).length,
  },
  d001Acceptance: {
    activeCandidateCount: d001V4.activeCandidateCount,
    conflictRelationCount: d001V4.conflictRelationCount,
    hardDropCount: d001V4.hardDropCount,
    coverageCount: d001V4.coverageCount,
    zhongbeiCandidates: activeCandidates
      .filter((x) => /中杯|钟贝/.test(x.replacement || ''))
      .map((x) => x.replacement),
    mafenCandidates: activeCandidates
      .filter((x) => /马芬|马分|蓝莓/.test(x.replacement || ''))
      .map((x) => x.replacement),
    graphEdgeCount: (d001V4.graphEdgesAfterMerge || []).length,
    mafenGraphEdges: (d001V4.graphEdgesAfterMerge || [])
      .filter((e) => /马芬|马分|蓝莓/.test(e.replacement || ''))
      .map((e) => e.replacement),
    zhongBeiDropped: (d001V4.candidateLifecycle || []).some(
      (x) => /中杯|钟贝/.test(x.candidateText || '') && x.firstDroppedLayer === 'compatibility'
    ),
    contractPass: d001?.pass,
    contractChecks: {
      hardDropCountZero: d001V4.hardDropCount === 0,
      activeCandidateCountGt24: (d001V4.activeCandidateCount || 0) > 24,
      conflictRelationCountGt0: (d001V4.conflictRelationCount || 0) > 0,
    },
  },
};

const outPath = path.join(__dirname, 'compat-auth-reduction-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
