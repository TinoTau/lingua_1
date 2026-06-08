#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH = path.join(__dirname, '../weak-domain-fuzzy-dialog200-batch-result.json');
const BASELINE = path.join(__dirname, '../lexicon-tone-dialog200-local-raw-ime-batch-result.json');
const MANIFEST = path.join(__dirname, '../../../../test wav/dialog_200/cases.manifest.json');
const OUT = path.join(__dirname, 'weak-domain-fuzzy-dialog200-quality-perf.json');

const r = JSON.parse(fs.readFileSync(BATCH, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const refById = Object.fromEntries(manifest.map((c) => [c.id, c]));
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
const baselineById = baseline
  ? Object.fromEntries(baseline.cases.filter((c) => !c.skip).map((c) => [c.id, c]))
  : {};

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
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
function cer(ref, hyp) {
  const R = norm(ref);
  const H = norm(hyp);
  if (!R.length) return H.length ? 1 : 0;
  return levenshtein(R, H) / R.length;
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

function recallDiagFromCase(c) {
  const spans = c.extra?.fw_detector?.recallV2Diagnostics?.spans || [];
  let domainHits = 0;
  let weakEnabled = 0;
  let fuzzyEnabled = 0;
  let fuzzyCandidates = 0;
  let weakCandidates = 0;
  const fuzzyExamples = [];
  for (const s of spans) {
    domainHits += s.domain_hits || 0;
    if (s.weakDomainEnabled) weakEnabled += 1;
    if (s.fuzzyRecallEnabled) fuzzyEnabled += 1;
    fuzzyCandidates += s.fuzzyCandidateCount || 0;
    weakCandidates += s.weakDomainCandidateCount || 0;
    if (s.fuzzyVariantExamples?.length) fuzzyExamples.push(...s.fuzzyVariantExamples);
  }
  return {
    spanCount: spans.length,
    domainHitsTotal: domainHits,
    weakDomainSpanCount: weakEnabled,
    fuzzyRecallSpanCount: fuzzyEnabled,
    fuzzyCandidateCount: fuzzyCandidates,
    weakDomainCandidateCount: weakCandidates,
    fuzzyVariantExamples: [...new Set(fuzzyExamples)].slice(0, 8),
  };
}

const cases = r.cases.filter((c) => !c.skip);
const pipelineMs = cases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const recallMs = cases.flatMap((c) =>
  (c.extra?.fw_detector?.recallV2Diagnostics?.spans || [])
    .map((s) => s.v2_recall_ms)
    .filter((n) => typeof n === 'number')
);

const perCase = [];
let exact = 0;
for (const c of cases) {
  const ref = refById[c.id]?.utterance || '';
  const raw = (c.extra?.raw_asr_text || c.raw_asr_preview || '').trim();
  const fin = (c.text_asr_preview || c.extra?.text_asr || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  if (norm(fin) === norm(ref)) exact += 1;
  const fw = c.extra?.fw_detector || {};
  const ime = fw.pinyinImeV2 || {};
  const b = baselineById[c.id];
  const recall = recallDiagFromCase(c);
  perCase.push({
    id: c.id,
    scenario: c.scenario,
    ref,
    raw,
    fin,
    rc,
    fc,
    fw: c.fw_triggered,
    reason: c.fw_reason,
    applied: c.fw_applied_count || 0,
    kenlmApproved: c.fw_kenlm_approved_count || 0,
    diffSpanCount: ime.diffSpanCount || 0,
    selectedSpanCount: ime.selectedSpanCount || 0,
    pipeline_ms: c.pipeline_ms,
    recall,
    baseline_fw: b?.fw_triggered ?? null,
    baseline_applied: b?.fw_applied_count ?? null,
    fw_delta: b ? (c.fw_triggered ? 1 : 0) - (b.fw_triggered ? 1 : 0) : null,
    applied_delta: b ? (c.fw_applied_count || 0) - (b.fw_applied_count || 0) : null,
  });
}

const rawCers = perCase.map((p) => p.rc);
const finalCers = perCase.map((p) => p.fc);
const cafe = perCase.filter((p) => p.scenario === 'cafe');
const fwTriggered = cases.filter((c) => c.fw_triggered).length;
const appliedGt0 = cases.filter((c) => (c.fw_applied_count || 0) > 0).length;
const baselineFw = baseline ? baseline.cases.filter((c) => !c.skip && c.fw_triggered).length : null;
const baselineApplied = baseline
  ? baseline.cases.filter((c) => !c.skip && (c.fw_applied_count || 0) > 0).length
  : null;

const out = {
  batch: {
    timestamp: r.timestamp,
    evaluated: cases.length,
    totalManifest: r.totalManifestCases,
    stoppedReason: r.stoppedReason,
    contract_pass: cases.filter((c) => c.pass).length,
    wall_clock_sec: r.summary?.wall_clock_sec,
  },
  fw: {
    triggered: fwTriggered,
    applied_gt0: appliedGt0,
    kenlm_approved_total: cases.reduce((s, c) => s + (c.fw_kenlm_approved_count || 0), 0),
    baseline_triggered: baselineFw,
    baseline_applied_gt0: baselineApplied,
    delta_triggered: baselineFw != null ? fwTriggered - baselineFw : null,
    delta_applied_gt0: baselineApplied != null ? appliedGt0 - baselineApplied : null,
  },
  recall: {
    cases_with_domain_hits: perCase.filter((p) => p.recall.domainHitsTotal > 0).length,
    cases_with_weak_domain: perCase.filter((p) => p.recall.weakDomainSpanCount > 0).length,
    cases_with_fuzzy: perCase.filter((p) => p.recall.fuzzyRecallSpanCount > 0).length,
    total_domain_hits: perCase.reduce((s, p) => s + p.recall.domainHitsTotal, 0),
    total_fuzzy_candidates: perCase.reduce((s, p) => s + p.recall.fuzzyCandidateCount, 0),
    total_weak_candidates: perCase.reduce((s, p) => s + p.recall.weakDomainCandidateCount, 0),
    recall_ms_avg: avg(recallMs),
    recall_ms_p95: pct(recallMs, 95),
  },
  cer: {
    raw_avg: avg(rawCers),
    raw_p50: pct(rawCers, 50),
    raw_p95: pct(rawCers, 95),
    final_avg: avg(finalCers),
    final_p50: pct(finalCers, 50),
    final_p95: pct(finalCers, 95),
    exact_final: exact,
    baseline_final_avg: baseline
      ? avg(
          baseline.cases
            .filter((c) => !c.skip)
            .map((c) => cer(refById[c.id]?.utterance || '', (c.text_asr_preview || '').trim()))
        )
      : null,
  },
  perf: {
    pipeline_avg: avg(pipelineMs),
    pipeline_p50: pct(pipelineMs, 50),
    pipeline_p95: pct(pipelineMs, 95),
    pipeline_min: pipelineMs.length ? Math.min(...pipelineMs) : null,
    pipeline_max: pipelineMs.length ? Math.max(...pipelineMs) : null,
  },
  cafe_cer: {
    raw_avg: avg(cafe.map((p) => p.rc)),
    final_avg: avg(cafe.map((p) => p.fc)),
    applied_gt0: cafe.filter((p) => p.applied > 0).length,
  },
  keyCases: {
    d001: perCase.find((p) => p.id === 'd001'),
    d002: perCase.find((p) => p.id === 'd002'),
    d003: perCase.find((p) => p.id === 'd003'),
  },
  samples: {
    applied_gt0: perCase.filter((p) => p.applied > 0).slice(0, 10),
    recall_domain_hits: perCase.filter((p) => p.recall.domainHitsTotal > 0).slice(0, 8),
    worst_final_cer: [...perCase].sort((a, b) => b.fc - a.fc).slice(0, 5),
    best_final_cer: perCase.filter((p) => p.fc === 0).slice(0, 5),
    cafe: cafe.slice(0, 6),
  },
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify({ out: OUT, batch: out.batch, fw: out.fw, recall: out.recall, cer: out.cer, perf: out.perf, keyCases: out.keyCases }, null, 2));
