#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.resolve(__dirname, '../raw-log-delta-dialog200-batch-result.json');
const MANIFEST = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');
const OUT = path.join(__dirname, 'raw-log-delta-dialog200-quality-perf.json');

const report = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '').toLowerCase();
}

function cer(ref, hyp) {
  const r = norm(ref);
  const h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  const m = r.length;
  const n = h.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        r[i - 1] === h[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n] / r.length;
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
let pickedNotRaw = 0;
let appliedCases = 0;
let scoreModeCount = 0;
const appliedIds = [];
const gateDist = {};
const kenlmVetoMs = [];
const pipelineMs = [];
const fwStepMs = [];

for (const c of evaluated) {
  const sr = c.extra?.fw_detector?.sentenceRerank || {};
  if (sr.scoreMode === 'raw_log_delta') scoreModeCount += 1;
  if (sr.pickedIsRaw === false) pickedNotRaw += 1;
  if ((c.fw_applied_count || 0) > 0) {
    appliedCases += 1;
    appliedIds.push(c.id);
  }
  const gate = sr.minDeltaToReplace;
  gateDist[String(gate)] = (gateDist[String(gate)] || 0) + 1;
  const fw = c.extra?.fw_detector || {};
  const v = fw.kenlmVetoMs ?? sr.kenlmSubprocessMs;
  if (typeof v === 'number') kenlmVetoMs.push(v);
  if (typeof c.pipeline_ms === 'number') pipelineMs.push(c.pipeline_ms);
  if (typeof c.extra?.fw_detector_step_ms === 'number') fwStepMs.push(c.extra.fw_detector_step_ms);
}

let improved = 0;
let degraded = 0;
for (const c of evaluated) {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

const riskIds = ['d048', 'd093', 'd138', 'd003', 'd001', 'd079'];
const riskReview = riskIds.map((id) => {
  const c = evaluated.find((x) => x.id === id);
  if (!c) return { id, missing: true };
  const sr = c.extra?.fw_detector?.sentenceRerank || {};
  const ref = refById[id] || '';
  const raw = (c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  return {
    id,
    scenario: c.scenario,
    pickedIsRaw: sr.pickedIsRaw,
    maxDelta: sr.maxDelta,
    minDeltaToReplace: sr.minDeltaToReplace,
    scoreMode: sr.scoreMode,
    fw_applied_count: c.fw_applied_count || 0,
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    ref: ref.slice(0, 80),
    raw: raw.slice(0, 80),
    final: fin.slice(0, 80),
  };
});

const out = {
  batchFile: BATCH,
  timestamp: new Date().toISOString(),
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  contractPass: evaluated.filter((c) => c.pass).length,
  wallClockSec: report.summary?.wall_clock_sec,
  scoreModeCount,
  gateDist,
  configSnapshot: evaluated[0]?.extra?.fw_detector?.configSnapshot,
  pick: {
    pickedNotRaw,
    pickedIsRaw: evaluated.length - pickedNotRaw,
    pickedNotRawRate: Number((pickedNotRaw / evaluated.length).toFixed(4)),
  },
  apply: {
    appliedCases,
    appliedIds,
    applyRate: Number((appliedCases / evaluated.length).toFixed(4)),
  },
  cer: { improved, degraded, net: improved - degraded },
  performance: {
    pipeline_ms_p95: Math.round(pct(pipelineMs, 95)),
    fw_detector_step_ms_p95: Math.round(pct(fwStepMs, 95)),
    kenlmVetoMs_avg: Math.round(avg(kenlmVetoMs)),
    kenlmVetoMs_p95: Math.round(pct(kenlmVetoMs, 95)),
  },
  riskReview,
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
