#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchArg = process.argv[2];
const BATCH = batchArg
  ? path.resolve(batchArg)
  : path.join(__dirname, '../span-assembly-v4-dialog200-batch-result.json');
const MANIFEST = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');

const report = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
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
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

const evaluated = report.cases.filter((c) => !c.skip);
const validCases = evaluated.filter((c) => c.pass);
const pipelineMs = validCases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = validCases.map((c) => c.extra?.fw_detector_step_ms).filter((n) => typeof n === 'number');
const assemblyMs = validCases
  .map((c) => c.extra?.fw_detector?.spanAssemblyV4?.assemblyMs)
  .filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
let exactRaw = 0;
let exactFinal = 0;
let improved = 0;
let degraded = 0;
const samples = [];

for (const c of validCases) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

const v4Cases = validCases.filter((c) => c.extra?.fw_detector?.pipelinePath === 'v4');
const v4DiagList = v4Cases.map((c) => c.extra?.fw_detector?.spanAssemblyV4).filter(Boolean);

const d001 = validCases.find((c) => c.id === 'd001');
const d001Fw = d001?.extra?.fw_detector;
const d001V4 = d001Fw?.spanAssemblyV4;

function pickSamples(ids) {
  return ids
    .map((id) => validCases.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => {
      const ref = refById[c.id] || '';
      const raw = (c.extra?.raw_asr_text || '').trim();
      const fin = (c.extra?.text_asr || '').trim();
      const fw = c.extra?.fw_detector || {};
      const v4 = fw.spanAssemblyV4 || {};
      return {
        id: c.id,
        scenario: c.scenario,
        pipelinePath: fw.pipelinePath,
        raw_cer: Number(cer(ref, raw).toFixed(4)),
        final_cer: Number(cer(ref, fin).toFixed(4)),
        text_changed: raw !== fin,
        fw_applied_count: fw.summary?.appliedCount ?? 0,
        fw_triggered: fw.triggered,
        pipeline_ms: c.pipeline_ms,
        fw_detector_step_ms: c.extra?.fw_detector_step_ms,
        assemblyMs: v4.assemblyMs,
        boundaryWindowCount: v4.boundaryWindowCount,
        windowCandidatePoolCount: v4.windowCandidatePoolCount,
        ngramQueryCount: v4.ngramQueryCount,
        droppedCandidateCount: v4.droppedCandidateCount,
        ref: ref.slice(0, 60),
        raw: raw.slice(0, 60),
        final: fin.slice(0, 60),
      };
    });
}

const out = {
  batchFile: BATCH,
  timestamp: report.timestamp,
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  contractPass: report.summary?.pass ?? validCases.length,
  contractFail: report.summary?.fail ?? 0,
  wallClockSec: report.summary?.wall_clock_sec,
  pipelinePathV4Count: v4Cases.length,
  pipelinePathV4Rate: validCases.length ? v4Cases.length / validCases.length : 0,
  quality: {
    raw_cer_avg: Number(avg(rawCers).toFixed(4)),
    final_cer_avg: Number(avg(finalCers).toFixed(4)),
    raw_cer_p50: Number(pct(rawCers, 50).toFixed(4)),
    final_cer_p50: Number(pct(finalCers, 50).toFixed(4)),
    raw_cer_p95: Number(pct(rawCers, 95).toFixed(4)),
    final_cer_p95: Number(pct(finalCers, 95).toFixed(4)),
    exact_raw_count: exactRaw,
    exact_final_count: exactFinal,
    improved_count: improved,
    degraded_count: degraded,
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
  },
  fw: {
    triggered_count: evaluated.filter((c) => c.fw_triggered).length,
    applied_case_count: evaluated.filter((c) => (c.fw_applied_count || 0) > 0).length,
    text_changed_count: evaluated.filter((c) => c.text_changed).length,
    diagnostics_trace_cases: v4DiagList.filter((d) => d.traceTargetMatched === true).length,
    avg_global_windows: Math.round(avg(v4DiagList.map((d) => d.globalWindowGeneratedCount || 0))),
    avg_boundary_windows: Number(avg(v4DiagList.map((d) => d.boundaryWindowCount || 0)).toFixed(2)),
    avg_blocked_windows: Number(avg(v4DiagList.map((d) => d.blockedWindowCount || 0)).toFixed(2)),
    avg_ngram_queries: Number(avg(v4DiagList.map((d) => d.ngramQueryCount || 0)).toFixed(2)),
    avg_pool_size: Number(avg(v4DiagList.map((d) => d.windowCandidatePoolCount || 0)).toFixed(2)),
    avg_dropped: Number(avg(v4DiagList.map((d) => d.droppedCandidateCount || 0)).toFixed(2)),
    total_dropped: v4DiagList.reduce((s, d) => s + (d.droppedCandidateCount || 0), 0),
  },
  d001: d001
    ? {
        pipelinePath: d001Fw?.pipelinePath,
        asrRepairApplied: d001.extra?.asr_repair_applied,
        fw_applied_count: d001Fw?.summary?.appliedCount,
        boundaryWindowCount: d001V4?.boundaryWindowCount,
        windowCandidatePoolCount: d001V4?.windowCandidatePoolCount,
        ngramQueryCount: d001V4?.ngramQueryCount,
        raw: (d001.extra?.raw_asr_text || '').slice(0, 80),
        final: (d001.extra?.text_asr || '').slice(0, 80),
        has_zhong_bei_window: JSON.stringify(d001.extra).includes('zhong|bei'),
        has_zhongbei_text: (d001.extra?.text_asr || '').includes('中杯'),
        traceTargetMatched: d001V4?.traceTargetMatched,
        traceLevel: d001V4?.traceLevel,
        recallHitsPreFilterCount: d001V4?.recallHitsPreFilter?.length ?? 0,
        recallHitsCount: d001V4?.recallHits?.length ?? 0,
        candidateLifecycleCount: d001V4?.candidateLifecycle?.length ?? 0,
        boundaryWindowsCount: d001V4?.boundaryWindows?.length ?? 0,
        allCombinationsCount: d001Fw?.sentenceRerank?.allCombinations?.length ?? 0,
        zhongBeiLifecycle: d001V4?.candidateLifecycle?.find((x) => x.candidateText === '中杯'),
      }
    : null,
  samples: {
    cafe: pickSamples(['d001', 'd002', 'd003']),
    meeting: pickSamples(['d004', 'd005']),
    applied: validCases
      .filter((c) => (c.extra?.fw_detector?.summary?.appliedCount || 0) > 0)
      .slice(0, 5)
      .map((c) => pickSamples([c.id])[0])
      .filter(Boolean),
    worst_cer: [...validCases]
      .map((c) => ({
        id: c.id,
        cer: cer(refById[c.id] || '', c.extra?.text_asr || ''),
        final: (c.extra?.text_asr || '').slice(0, 50),
      }))
      .sort((a, b) => b.cer - a.cer)
      .slice(0, 5),
  },
};

const outPath = path.join(__dirname, 'span-assembly-v4-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[analyze-v4] wrote', outPath);
console.log(JSON.stringify(out, null, 2));
