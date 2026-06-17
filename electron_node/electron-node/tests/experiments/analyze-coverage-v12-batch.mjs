#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.resolve(
  process.argv[2] || path.join(__dirname, '../coverage-merge-v12-dialog200-batch-result.json')
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
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
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

function pickSample(id) {
  const c = validCases.find((x) => x.id === id);
  if (!c) return null;
  const ref = refById[id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  const v4 = c.extra?.fw_detector?.spanAssemblyV4 || {};
  return {
    id,
    scenario: c.scenario,
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    text_changed: c.text_changed,
    fw_applied_count: c.fw_applied_count,
    pipeline_ms: c.pipeline_ms,
    fw_detector_step_ms: c.extra?.fw_detector_step_ms,
    assemblyMs: v4.assemblyMs,
    coverageCount: v4.coverageCount,
    conflictCount: v4.conflictCount,
    conflictRelationCount: v4.conflictRelationCount,
    hardDropCount: v4.hardDropCount,
    activeCandidateCount: v4.activeCandidateCount,
    compatibleCount: v4.compatibleCount,
    droppedCandidateCount: v4.droppedCandidateCount,
    windowCandidatePoolCount: v4.windowCandidatePoolCount,
    ref: ref.slice(0, 80),
    raw: raw.slice(0, 80),
    final: fin.slice(0, 80),
  };
}

const d001 = validCases.find((c) => c.id === 'd001');
const d001V4 = d001?.extra?.fw_detector?.spanAssemblyV4;
const d001Pool = d001V4?.poolAfterDrop || [];
const d001MafenPool = d001Pool.filter((x) => x.replacement.includes('马芬'));
const d001MafenGraph = (d001V4?.graphEdgesAfterMerge || []).filter((x) =>
  x.replacement.includes('马芬')
);

const out = {
  batchFile: batchPath,
  timestamp: report.timestamp,
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  totalManifestCases: report.totalManifestCases,
  contractPass: report.summary?.pass ?? validCases.length,
  contractFail: report.summary?.fail ?? 0,
  contractPassRate: evaluated.length ? (report.summary?.pass ?? 0) / evaluated.length : 0,
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
    text_changed_count: evaluated.filter((c) => c.text_changed).length,
    fw_applied_case_count: evaluated.filter((c) => (c.fw_applied_count || 0) > 0).length,
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
  },
  coverageMetrics: {
    total_coverage_pairs: v4List.reduce((s, d) => s + (d.coverageCount || 0), 0),
    avg_coverage_pairs: Number(avg(v4List.map((d) => d.coverageCount || 0)).toFixed(2)),
    max_coverage_pairs: Math.max(...v4List.map((d) => d.coverageCount || 0), 0),
    cases_with_coverage: v4List.filter((d) => (d.coverageCount || 0) > 0).length,
    total_conflict_relations: v4List.reduce((s, d) => s + (d.conflictRelationCount || 0), 0),
    avg_conflict_relations: Number(avg(v4List.map((d) => d.conflictRelationCount || 0)).toFixed(2)),
    total_hard_drops: v4List.reduce((s, d) => s + (d.hardDropCount || 0), 0),
    avg_active_candidates: Number(avg(v4List.map((d) => d.activeCandidateCount || d.windowCandidatePoolCount || 0)).toFixed(2)),
  },
  d001Acceptance: {
    coverageCount: d001V4?.coverageCount,
    conflictRelationCount: d001V4?.conflictRelationCount,
    hardDropCount: d001V4?.hardDropCount,
    activeCandidateCount: d001V4?.activeCandidateCount,
    poolAfterDropCount: d001Pool.length,
    mafenInPoolCount: d001MafenPool.length,
    mafenInPool: d001MafenPool.map((x) => ({
      replacement: x.replacement,
      isCovered: x.isCovered,
      coveredBy: x.coveredBy,
    })),
    mafenGraphEdgeCount: d001MafenGraph.length,
    mafenGraphEdges: d001MafenGraph.map((e) => e.replacement),
    zhongBeiConflictEdges: (d001V4?.compatibilityEdges || []).filter(
      (e) =>
        e.overlapRelationType === 'CONFLICT' &&
        (e.sourceReplacement.includes('中杯') || e.targetReplacement.includes('中杯'))
    ).length,
    zhongBeiDropped: (d001V4?.candidateLifecycle || []).some(
      (x) => x.candidateText === '中杯' && x.firstDroppedLayer === 'compatibility'
    ),
    contractPass: d001?.pass,
  },
  samples: {
    cafe: ['d001', 'd002', 'd003'].map(pickSample).filter(Boolean),
    meeting: ['d004', 'd005'].map(pickSample).filter(Boolean),
    topCoverage: [...validCases]
      .map((c) => ({
        id: c.id,
        coverageCount: c.extra?.fw_detector?.spanAssemblyV4?.coverageCount || 0,
      }))
      .sort((a, b) => b.coverageCount - a.coverageCount)
      .slice(0, 5),
    worstCer: [...validCases]
      .map((c) => ({
        id: c.id,
        raw_cer: Number(cer(refById[c.id] || '', c.extra?.raw_asr_text || '').toFixed(4)),
        final_cer: Number(cer(refById[c.id] || '', c.text_asr_preview || '').toFixed(4)),
        raw: (c.extra?.raw_asr_text || '').slice(0, 50),
        final: (c.text_asr_preview || '').slice(0, 50),
      }))
      .sort((a, b) => b.raw_cer - a.raw_cer)
      .slice(0, 5),
  },
};

const outPath = path.join(__dirname, 'coverage-merge-v12-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[analyze-coverage-v12] wrote', outPath);
console.log(JSON.stringify(out, null, 2));
