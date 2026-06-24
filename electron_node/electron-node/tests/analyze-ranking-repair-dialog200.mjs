#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.join(__dirname, 'ranking-repair-v1_2-dialog200-batch-result.json');
const manifestPath = path.resolve(__dirname, '../../../test wav/dialog_200/cases.manifest.json');
const outPath = path.join(__dirname, 'ranking-repair-v1_2-dialog200-quality-perf.json');
const preBaselinePath = path.join(__dirname, 'lexicon-post-alias-cleanup-dialog200-quality-perf.json');

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));
const preBaseline = fs.existsSync(preBaselinePath)
  ? JSON.parse(fs.readFileSync(preBaselinePath, 'utf8'))
  : null;

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

const per = [];
let exact = 0;
let improved = 0;
let degraded = 0;
let applyTotal = 0;
const pipelineMs = [];

for (const row of batch.cases) {
  if (row.skip) continue;
  const ref = refById[row.id] || '';
  const raw = row.extra?.raw_asr_text || row.raw_asr_preview || '';
  const fin = row.extra?.text_asr || row.text_asr_preview || '';
  const cRaw = cer(ref, raw);
  const cFin = cer(ref, fin);
  const delta = cRaw - cFin;
  const applied = row.fw_applied_count || 0;
  applyTotal += applied;
  pipelineMs.push(row.pipeline_ms || 0);
  if (cFin === 0) exact++;
  if (delta > 0.001) improved++;
  if (delta < -0.001) degraded++;
  per.push({
    id: row.id,
    scenario: row.scenario,
    cer_raw: Math.round(cRaw * 10000) / 10000,
    cer_final: Math.round(cFin * 10000) / 10000,
    cer_delta: Math.round(delta * 10000) / 10000,
    applied,
    fw_triggered: row.fw_triggered,
    text_changed: row.text_changed,
    pipeline_ms: row.pipeline_ms,
    text_preview: (fin || '').slice(0, 80),
    raw_preview: (raw || '').slice(0, 80),
  });
}

pipelineMs.sort((a, b) => a - b);
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

function caseDetail(id) {
  const p = per.find((x) => x.id === id);
  const row = batch.cases.find((x) => x.id === id);
  const fin = row?.extra?.text_asr || row?.text_asr_preview || '';
  const raw = row?.extra?.raw_asr_text || row?.raw_asr_preview || '';
  const fw = row?.extra?.fw_detector || {};
  const shaobingSpan = (fw.spans || []).find(
    (s) =>
      (s.candidates || []).some((c) => c.word === '少冰' || c.word === '烧饼') ||
      s.text?.includes('病')
  );
  return {
    id,
    reference: refById[id],
    raw_preview: raw.slice(0, 100),
    text_preview: fin.slice(0, 100),
    semantic: {
      has_shaobing: fin.includes('少冰'),
      has_shaobing_wrong: fin.includes('烧饼'),
      has_xiaobei: fin.includes('小杯'),
      has_xiaobei_wrong: fin.includes('小背'),
    },
    fw_applied: fw.summary?.appliedCount ?? row?.fw_applied_count,
    tone_guard_blocked: fw.spanAssemblyV4?.metrics?.toneGuardBlockedCount ?? null,
    shaobing_span_selected: shaobingSpan?.candidates?.[shaobingSpan.selectedCandidateIndex ?? 0]?.word,
    ...p,
  };
}

const regressions = [];
if (preBaseline?.perCase) {
  const preById = Object.fromEntries(preBaseline.perCase.map((p) => [p.id, p]));
  for (const p of per) {
    const pre = preById[p.id];
    if (pre && p.cer_final > pre.cer_final + 0.001) {
      regressions.push({
        id: p.id,
        cer_pre: pre.cer_final,
        cer_post: p.cer_final,
        delta: Math.round((p.cer_final - pre.cer_final) * 10000) / 10000,
      });
    }
  }
}

const out = {
  timestamp: new Date().toISOString(),
  testScope: 'Ranking Repair V1.2 dialog_200',
  batchSummary: batch.summary,
  quality: {
    evaluated: per.length,
    avg_cer_raw: Math.round(avg(per.map((p) => p.cer_raw)) * 10000) / 10000,
    avg_cer_final: Math.round(avg(per.map((p) => p.cer_final)) * 10000) / 10000,
    avg_cer_improvement: Math.round(avg(per.map((p) => p.cer_delta)) * 10000) / 10000,
    exact_match: exact,
    improved,
    degraded,
    unchanged: per.length - improved - degraded,
    total_fw_applied: applyTotal,
  },
  perf: {
    wall_clock_sec: batch.summary.wall_clock_sec,
    avg_pipeline_ms: Math.round(avg(pipelineMs)),
    p50_pipeline_ms: pipelineMs[Math.floor(pipelineMs.length / 2)],
    p95_pipeline_ms: pipelineMs[Math.floor(pipelineMs.length * 0.95)],
    max_pipeline_ms: pipelineMs[pipelineMs.length - 1],
  },
  keyCases: ['d003', 'd048', 'd138', 'd001', 'd082', 'd187'].map(caseDetail),
  regressions_vs_post_cleanup_baseline: regressions.sort((a, b) => b.delta - a.delta).slice(0, 15),
  regression_count: regressions.length,
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[analyze-ranking-repair-dialog200] wrote', outPath);
console.log(JSON.stringify({ quality: out.quality, perf: out.perf, keyCases: out.keyCases, regression_count: out.regression_count }, null, 2));
