#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const batchPath = path.join(__dirname, 'same-domain-per-span-dialog200-batch-result.json');
const manifestPath = path.join(__dirname, '../../../test wav/dialog_200/cases.manifest.json');

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const refById = Object.fromEntries(manifest.map((c) => [c.id, c.utterance]));

function norm(s) {
  return (s || '').replace(/[\s,，。！？、；：.!?;:()"'（）\[\]【】\-—…]/g, '').toLowerCase();
}

function lev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function cer(ref, hyp) {
  const r = norm(ref), h = norm(hyp);
  if (!r.length) return h.length ? 1 : 0;
  return lev(r, h) / r.length;
}

function avg(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)];
}

const valid = batch.cases.filter((c) => !c.skip);
const rawCers = [], finalCers = [];
let exact = 0, improved = 0, degraded = 0;

for (const c of valid) {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(fin) === norm(ref)) exact++;
  if (fc < rc - 1e-9) improved++;
  if (fc > rc + 1e-9) degraded++;
}

const pl = valid.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fw = valid.map((c) => c.extra && c.extra.fw_detector_step_ms).filter((n) => typeof n === 'number');
const asm = valid.map((c) => c.extra && c.extra.fw_detector && c.extra.fw_detector.spanAssemblyV4 && c.extra.fw_detector.spanAssemblyV4.assemblyMs).filter((n) => typeof n === 'number');

const v4 = valid.map((c) => c.extra && c.extra.fw_detector && c.extra.fw_detector.spanAssemblyV4).filter(Boolean);

function domainMetric(key) {
  const vals = v4.map((d) => d[key]).filter((v) => typeof v === 'number');
  return { avg: Number(avg(vals).toFixed(3)), p50: Number(pct(vals, 50).toFixed(3)), p95: Number(pct(vals, 95).toFixed(3)) };
}

const domainDist = {};
for (const c of valid) {
  const d = c.extra && c.extra.fw_detector && c.extra.fw_detector.spanAssemblyV4 && c.extra.fw_detector.spanAssemblyV4.utteranceDomain;
  const k = d || 'unknown'; domainDist[k] = (domainDist[k] || 0) + 1;
}

// Samples
const samples = valid.slice(0, 10).map((c) => {
  const ref = refById[c.id] || '';
  const raw = (c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || '').trim();
  const v4d = c.extra && c.extra.fw_detector && c.extra.fw_detector.spanAssemblyV4;
  return {
    id: c.id,
    scenario: c.scenario,
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    pipeline_ms: c.pipeline_ms,
    assemblyMs: v4d && v4d.assemblyMs,
    utteranceDomain: v4d && v4d.utteranceDomain,
    domainCandidateCount: v4d && v4d.domainCandidateCount,
    baseCandidateCount: v4d && v4d.baseCandidateCount,
    mainDomainAwareSpanSetsTotal: v4d && v4d.mainDomainAwareSpanSetsTotal,
    shadowBeamSpanSetsTotal: v4d && v4d.shadowBeamSpanSetsTotal,
    raw: raw.slice(0, 60),
    fin: fin.slice(0, 60),
    ref: ref.slice(0, 60),
  };
});

const out = {
  evaluated: valid.length,
  contractPass: batch.summary.pass,
  stoppedReason: batch.stoppedReason,
  wallClockSec: batch.summary.wall_clock_sec,
  quality: {
    raw_cer_avg: Number(avg(rawCers).toFixed(4)),
    final_cer_avg: Number(avg(finalCers).toFixed(4)),
    raw_cer_p50: Number(pct(rawCers, 50).toFixed(4)),
    final_cer_p50: Number(pct(finalCers, 50).toFixed(4)),
    raw_cer_p95: Number(pct(rawCers, 95).toFixed(4)),
    final_cer_p95: Number(pct(finalCers, 95).toFixed(4)),
    exact_final_count: exact,
    improved_count: improved,
    degraded_count: degraded,
  },
  performance: {
    pipeline_ms_avg: Math.round(avg(pl)),
    pipeline_ms_p50: Math.round(pct(pl, 50)),
    pipeline_ms_p95: Math.round(pct(pl, 95)),
    fw_step_ms_avg: Math.round(avg(fw)),
    fw_step_ms_p50: Math.round(pct(fw, 50)),
    fw_step_ms_p95: Math.round(pct(fw, 95)),
    assembly_ms_avg: Math.round(avg(asm)),
    assembly_ms_p50: Math.round(pct(asm, 50)),
    assembly_ms_p95: Math.round(pct(asm, 95)),
  },
  domain_assembly: {
    utteranceDomain_dist: domainDist,
    domainCandidateCount: domainMetric('domainCandidateCount'),
    baseCandidateCount: domainMetric('baseCandidateCount'),
    sameDomainCandidateCount: domainMetric('sameDomainCandidateCount'),
    domainFilteredSpanCount: domainMetric('domainFilteredSpanCount'),
    mainDomainAwareSpanSetsTotal: domainMetric('mainDomainAwareSpanSetsTotal'),
    shadowBeamSpanSetsTotal: domainMetric('shadowBeamSpanSetsTotal'),
    domainAssemblyMs: domainMetric('domainAssemblyMs'),
    selectedCandidatesPerSpanAvg: domainMetric('selectedCandidatesPerSpanAvg'),
    fw_applied_cases: valid.filter((c) => (c.fw_applied_count || 0) > 0).length,
    text_changed_cases: valid.filter((c) => c.text_changed).length,
  },
  samples,
};

console.log(JSON.stringify(out, null, 2));
