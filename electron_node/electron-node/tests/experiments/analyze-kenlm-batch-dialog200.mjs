#!/usr/bin/env node
/** Analyze dialog200 batch for KenLM batch subprocess perf + quality */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchArg = process.argv[2];
const BATCH = batchArg
  ? path.resolve(batchArg)
  : path.join(__dirname, 'kenlm-batch-subprocess-dialog200-batch-result.json');
const MANIFEST = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');
const OUT = path.join(__dirname, 'kenlm-batch-subprocess-dialog200-quality-perf.json');

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

const evaluated = report.cases.filter((c) => !c.skip && !c.error);
const pipelineMs = evaluated.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = evaluated.map((c) => c.extra?.fw_detector_step_ms).filter((n) => typeof n === 'number');
const kenlmVetoMs = evaluated
  .map((c) => c.extra?.fw_detector?.kenlmVetoMs ?? c.extra?.fw_detector?.sentenceRerank?.kenlmSubprocessMs)
  .filter((n) => typeof n === 'number');
const kenlmQueryCount = evaluated
  .map((c) => c.extra?.fw_detector?.kenlmVetoQueryCount ?? c.extra?.fw_detector?.sentenceRerank?.kenlmQueryCount)
  .filter((n) => typeof n === 'number');

const errorReasons = {};
let batchSubprocessSuccessCount = 0;
const rawCers = [];
const finalCers = [];
let exactRaw = 0;
let exactFinal = 0;
let improved = 0;
let degraded = 0;
let appliedCases = 0;

for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
  if ((c.fw_applied_count || 0) > 0) appliedCases += 1;

  const sr = c.extra?.fw_detector?.sentenceRerank || {};
  const reason = sr.kenlmSubprocessErrorReason;
  if (reason) errorReasons[reason] = (errorReasons[reason] || 0) + 1;
  if ((sr.kenlmSubprocessCount ?? 0) >= 1) batchSubprocessSuccessCount += 1;
}

function pickSample(id) {
  const c = evaluated.find((x) => x.id === id);
  if (!c) return null;
  const ref = refById[id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || '').trim();
  const fw = c.extra?.fw_detector || {};
  const sr = fw.sentenceRerank || {};
  return {
    id,
    scenario: c.scenario,
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    pipeline_ms: c.pipeline_ms,
    fw_detector_step_ms: c.extra?.fw_detector_step_ms,
    kenlmVetoMs: fw.kenlmVetoMs,
    kenlmQueryCount: fw.kenlmVetoQueryCount ?? sr.kenlmQueryCount,
    kenlmSubprocessMs: sr.kenlmSubprocessMs,
    kenlmSubprocessCount: sr.kenlmSubprocessCount,
    kenlmSubprocessErrorReason: sr.kenlmSubprocessErrorReason,
    combinationCount: sr.combinationCount,
    pickedIsRaw: sr.pickedIsRaw,
    maxDelta: sr.maxDelta,
    fw_applied_count: fw.summary?.appliedCount ?? 0,
    ref: ref.slice(0, 80),
    raw: raw.slice(0, 80),
    final: fin.slice(0, 80),
  };
}

const sampleIds = ['d001', 'd002', 'd005', 'd021', 'd048', 'd065', 'd079'];
const highQ = [...evaluated]
  .sort((a, b) => (b.extra?.fw_detector?.kenlmVetoQueryCount ?? 0) - (a.extra?.fw_detector?.kenlmVetoQueryCount ?? 0))
  .slice(0, 3)
  .map((c) => c.id);

const output = {
  batchFile: BATCH,
  timestamp: new Date().toISOString(),
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  contractPass: evaluated.filter((c) => c.pass).length,
  contractFail: evaluated.filter((c) => !c.pass).length,
  wallClockSec: report.summary?.wall_clock_sec,
  kenlmRuntime: 'batch-only',
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
    applied_case_count: appliedCases,
  },
  performance: {
    pipeline_ms_avg: Math.round(avg(pipelineMs)),
    pipeline_ms_p50: Math.round(pct(pipelineMs, 50)),
    pipeline_ms_p95: Math.round(pct(pipelineMs, 95)),
    fw_detector_step_ms_avg: Math.round(avg(fwStepMs)),
    fw_detector_step_ms_p50: Math.round(pct(fwStepMs, 50)),
    fw_detector_step_ms_p95: Math.round(pct(fwStepMs, 95)),
    kenlmVetoMs_avg: Math.round(avg(kenlmVetoMs)),
    kenlmVetoMs_p50: Math.round(pct(kenlmVetoMs, 50)),
    kenlmVetoMs_p95: Math.round(pct(kenlmVetoMs, 95)),
    kenlmQueryCount_avg: Number(avg(kenlmQueryCount).toFixed(2)),
    kenlmQueryCount_p95: pct(kenlmQueryCount, 95),
  },
  kenlmRuntime: {
    error_reason_distribution: errorReasons,
    batch_subprocess_success_count: batchSubprocessSuccessCount,
    batch_subprocess_success_rate: evaluated.length ? batchSubprocessSuccessCount / evaluated.length : 0,
  },
  samples: {
    golden: sampleIds.map(pickSample).filter(Boolean),
    high_query_count: highQ.map(pickSample).filter(Boolean),
  },
  baseline_compare_note:
    'Stage A baseline kenlmVetoMs P95 ~11748ms serial; target <2000ms batch',
};

fs.writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify(output, null, 2));
console.log('[analyze-kenlm-batch] wrote', OUT);
