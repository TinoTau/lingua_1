#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.resolve(
  process.argv[2] || path.join(__dirname, '../schema-v2-seed-import-dialog200-batch-result.json')
);
const manifestPath = path.resolve(
  __dirname,
  '../../../../test wav/dialog_200/cases.manifest.json'
);

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

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

const cases = report.cases.filter((c) => !c.skip && c.pass);
const utterance = {};
const winning = {};
let insufficient = 0;
let hasRecall = 0;
let hasScores = 0;
let hasWinning = 0;
let hardDrop = 0;
const byScenario = {};

for (const c of cases) {
  const d = c.extra?.fw_detector?.spanAssemblyV4 || {};
  const u = d.utteranceDomain || 'missing';
  utterance[u] = (utterance[u] || 0) + 1;
  const w = d.winningFineDomain || 'missing';
  winning[w] = (winning[w] || 0) + 1;
  if (d.insufficientEvidence) insufficient += 1;
  if (Array.isArray(d.recallEnabledFineDomains) && d.recallEnabledFineDomains.length) hasRecall += 1;
  if (d.domainScores && Object.keys(d.domainScores).length) hasScores += 1;
  if (d.winningFineDomain) hasWinning += 1;
  hardDrop += d.hardDropCount || 0;

  const sc = c.scenario || 'unknown';
  byScenario[sc] = byScenario[sc] || { count: 0, general: 0, fine: 0, insufficient: 0 };
  byScenario[sc].count += 1;
  if (d.utteranceDomain === 'general') byScenario[sc].general += 1;
  else byScenario[sc].fine += 1;
  if (d.insufficientEvidence) byScenario[sc].insufficient += 1;
}

const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;
let exactRaw = 0;
let exactFinal = 0;

function pick(ids) {
  return ids
    .map((id) => cases.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => {
      const d = c.extra?.fw_detector?.spanAssemblyV4 || {};
      const ref = refById[c.id] || '';
      const raw = (c.extra?.raw_asr_text || '').trim();
      const fin = (c.text_asr_preview || '').trim();
      return {
        id: c.id,
        scenario: c.scenario,
        ref: ref.slice(0, 80),
        raw: raw.slice(0, 80),
        final: fin.slice(0, 80),
        raw_cer: Number(cer(ref, raw).toFixed(4)),
        final_cer: Number(cer(ref, fin).toFixed(4)),
        utteranceDomain: d.utteranceDomain,
        winningFineDomain: d.winningFineDomain,
        insufficientEvidence: d.insufficientEvidence,
        domainScores: d.domainScores,
        recallEnabledFineDomains: d.recallEnabledFineDomains,
        fw_applied: c.fw_applied_count || 0,
        pipeline_ms: c.pipeline_ms,
        assemblyMs: d.assemblyMs,
        hardDropCount: d.hardDropCount || 0,
      };
    });
}

for (const c of cases) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

const cafeCases = cases.filter((c) => c.scenario === 'cafe');
const cafeFine = cafeCases.filter(
  (c) => (c.extra?.fw_detector?.spanAssemblyV4?.utteranceDomain || 'general') !== 'general'
).length;

const out = {
  batchFile: batchPath,
  timestamp: report.timestamp,
  stoppedReason: report.stoppedReason,
  evaluated: cases.length,
  wallClockSec: report.summary?.wall_clock_sec,
  manifestV2Count: cases.filter(
    (c) => c.extra?.fw_detector?.runtime?.manifestVersion === 'lexicon-v3-five-table-v2'
  ).length,
  domainVote: {
    utteranceDomainDist: utterance,
    winningFineDomainDist: winning,
    insufficientEvidenceCount: insufficient,
    nonGeneralCount: cases.length - (utterance.general || 0),
    nonGeneralRate: cases.length
      ? Number(((cases.length - (utterance.general || 0)) / cases.length).toFixed(4))
      : 0,
    recallEnabledFineDomainsPresent: hasRecall,
    domainScoresPresent: hasScores,
    winningFineDomainPresent: hasWinning,
    totalHardDropCount: hardDrop,
    avgNgramQueries: Number(
      avg(cases.map((c) => c.extra?.fw_detector?.spanAssemblyV4?.ngramQueryCount || 0)).toFixed(2)
    ),
  },
  byScenario,
  cafeFineDomainRate: cafeCases.length ? Number((cafeFine / cafeCases.length).toFixed(4)) : 0,
  quality: {
    raw_cer_avg: Number(avg(rawCers).toFixed(4)),
    final_cer_avg: Number(avg(finalCers).toFixed(4)),
    raw_cer_p50: Number(pct(rawCers, 50).toFixed(4)),
    final_cer_p50: Number(pct(finalCers, 50).toFixed(4)),
    raw_cer_p95: Number(pct(rawCers, 95).toFixed(4)),
    final_cer_p95: Number(pct(finalCers, 95).toFixed(4)),
    exact_raw: exactRaw,
    exact_final: exactFinal,
    improved,
    degraded,
  },
  performance: {
    pipeline_ms_avg: Math.round(avg(cases.map((c) => c.pipeline_ms))),
    pipeline_ms_p50: Math.round(pct(cases.map((c) => c.pipeline_ms), 50)),
    pipeline_ms_p95: Math.round(pct(cases.map((c) => c.pipeline_ms), 95)),
    fw_step_ms_avg: Math.round(avg(cases.map((c) => c.extra?.fw_detector_step_ms || 0))),
    assembly_ms_avg: Math.round(
      avg(cases.map((c) => c.extra?.fw_detector?.spanAssemblyV4?.assemblyMs || 0))
    ),
  },
  fw: {
    triggered: cases.filter((c) => c.fw_triggered).length,
    applied_cases: cases.filter((c) => (c.fw_applied_count || 0) > 0).length,
    text_changed: cases.filter((c) => c.text_changed).length,
  },
  samples: {
    cafe: pick(['d001', 'd002', 'd046', 'd047']),
    tourism: pick(['d007', 'd031', 'd032']),
    meeting: pick(['d004', 'd005']),
    applied: pick(['d010']),
  },
};

const outPath = path.join(__dirname, 'schema-v2-seed-import-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log('[analyze-schema-v2] wrote', outPath);
