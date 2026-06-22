#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchPath = path.resolve(process.argv[2] || path.join(__dirname, '../fine-domain-weighted-recall-dialog200-batch-result.json'));
const manifestPath = path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
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

const cases = batch.cases.filter((c) => !c.skip);
const domainCounts = {};
const recallDomainUnion = new Set();
let insufficientEvidenceCases = 0;

for (const c of cases) {
  const v4 = c.extra?.fw_detector?.spanAssemblyV4 || {};
  const dom = v4.utteranceDomain || v4.domainVote?.utteranceDomain || 'unknown';
  domainCounts[dom] = (domainCounts[dom] || 0) + 1;
  if (v4.insufficientEvidence || v4.domainVote?.insufficientEvidence) {
    insufficientEvidenceCases += 1;
  }
  for (const d of v4.recallEnabledFineDomains || []) {
    recallDomainUnion.add(d);
  }
}

const rawCers = [];
const finalCers = [];
let improved = 0;
let degraded = 0;
let exactRaw = 0;
let exactFinal = 0;
const pipelineMs = [];
const assemblyMs = [];
const domainAssemblyMs = [];

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
  else if (fc > rc + 1e-9) degraded += 1;
  if (typeof c.pipeline_ms === 'number') pipelineMs.push(c.pipeline_ms);
  const v4 = c.extra?.fw_detector?.spanAssemblyV4 || {};
  if (typeof v4.assemblyMs === 'number') assemblyMs.push(v4.assemblyMs);
  if (typeof v4.domainAssemblyMs === 'number') domainAssemblyMs.push(v4.domainAssemblyMs);
}

function pickSample(id) {
  const c = cases.find((x) => x.id === id);
  if (!c) return null;
  const ref = refById[id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  const v4 = c.extra?.fw_detector?.spanAssemblyV4 || {};
  return {
    id,
    scenario: c.scenario,
    utteranceDomain: v4.utteranceDomain,
    insufficientEvidence: v4.insufficientEvidence,
    recallEnabledFineDomains: v4.recallEnabledFineDomains,
    domainScores: v4.domainScores,
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    text_changed: raw !== fin,
    fw_applied_count: c.fw_applied_count,
    pipeline_ms: c.pipeline_ms,
    assemblyMs: v4.assemblyMs,
    domainAssemblyMs: v4.domainAssemblyMs,
    domainCandidateCount: v4.domainCandidateCount,
    ref: ref.slice(0, 60),
    raw: raw.slice(0, 60),
    final: fin.slice(0, 60),
  };
}

const out = {
  batchFile: batchPath,
  timestamp: batch.timestamp,
  stoppedReason: batch.stoppedReason,
  evaluated: cases.length,
  contractPass: cases.filter((c) => c.pass).length,
  wallClockSec: batch.summary?.wall_clock_sec,
  domainVote: {
    utteranceDomainCounts: domainCounts,
    fineDomainWinCount: Object.entries(domainCounts)
      .filter(([k]) => k !== 'general' && k !== 'unknown')
      .reduce((s, [, v]) => s + v, 0),
    generalWinCount: domainCounts.general || 0,
    insufficientEvidenceCases,
    recallEnabledFineDomainUnion: [...recallDomainUnion].sort(),
  },
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
    assembly_ms_avg: Math.round(avg(assemblyMs)),
    domain_assembly_ms_avg: Math.round(avg(domainAssemblyMs)),
  },
  fw: batch.summary,
  samples: {
    cafe: ['d001', 'd002', 'd046'].map(pickSample).filter(Boolean),
    applied: cases
      .filter((c) => (c.fw_applied_count || 0) > 0)
      .slice(0, 4)
      .map((c) => pickSample(c.id))
      .filter(Boolean),
    improved: cases
      .filter((c) => {
        const ref = refById[c.id] || '';
        const raw = (c.extra?.raw_asr_text || '').trim();
        const fin = (c.text_asr_preview || '').trim();
        return cer(ref, fin) < cer(ref, raw) - 1e-9;
      })
      .slice(0, 4)
      .map((c) => pickSample(c.id))
      .filter(Boolean),
  },
};

const outPath = path.join(__dirname, 'fine-domain-weighted-recall-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[analyze-fine-domain] wrote', outPath);
console.log(JSON.stringify(out, null, 2));
