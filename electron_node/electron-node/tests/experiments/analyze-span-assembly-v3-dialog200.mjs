#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../span-assembly-v3-dialog200-batch-result.json'), 'utf8')
);
const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../../test wav/dialog_200/cases.manifest.json'), 'utf8')
);
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
const asrNotReadyCases = evaluated.filter((c) => c.error === 'No available ASR service');
const pipelineMs = validCases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = validCases.map((c) => c.extra?.fw_detector_step_ms).filter((n) => typeof n === 'number');
const asrLatency = validCases
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.asr_latency_ms)
  .filter((n) => typeof n === 'number');
const audioMs = validCases
  .map((c) => c.extra?.asr_diagnostics?.audio_segmentation?.audio_ms)
  .filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
const probeCers = [];
let exactRaw = 0;
let exactFinal = 0;
let exactProbe = 0;
let improved = 0;
let degraded = 0;
const worstFinal = [];

for (const c of validCases) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
  const probe = (c.extra?.asr_merge_probe_text || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  const pc = cer(ref, probe);
  rawCers.push(rc);
  finalCers.push(fc);
  probeCers.push(pc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (norm(probe) === norm(ref)) exactProbe += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
  if (fc > 0.15) {
    worstFinal.push({
      id: c.id,
      scenario: c.scenario,
      cer: Number(fc.toFixed(4)),
      ref: ref.slice(0, 50),
      hyp: fin.slice(0, 50),
    });
  }
}
worstFinal.sort((a, b) => b.cer - a.cer);

const v3Cases = validCases.filter((c) => c.extra?.fw_detector?.pipelinePath === 'v3');
const biList = v3Cases
  .map((c) => c.extra?.fw_detector?.spanAssemblyV3?.boundaryImport)
  .filter(Boolean);
const avgBi = (k) => (biList.length ? avg(biList.map((b) => b[k] || 0)) : 0);
const srcTotals = {
  ime_token_boundary: 0,
  raw_ime_aligned_boundary: 0,
  proposal_active_boundary: 0,
  asr_word_boundary: 0,
  punctuation_fallback: 0,
};
for (const b of biList) {
  const br = b.boundarySourceBreakdown || {};
  for (const k of Object.keys(srcTotals)) {
    srcTotals[k] += br[k] || 0;
  }
}
const coverageOkCount = biList.filter((b) => b.coverageOk === true).length;
const toneList = v3Cases.map((c) => c.extra?.fw_detector?.spanAssemblyV3?.tone).filter(Boolean);
const toneModuleList = v3Cases.map((c) => c.extra?.fw_detector?.toneModule).filter(Boolean);
const avgTone = (k) => (toneList.length ? avg(toneList.map((t) => t[k] || 0)) : 0);
const tonePayloadOk = toneList.filter((t) => t.tonePayloadAvailable === true).length;
const tonePatternHitCases = toneList.filter((t) => (t.ngramTonePatternHitCount || 0) > 0).length;
const windowTimeAttemptTotal = toneList.reduce((s, t) => s + (t.windowTimeAttemptCount || 0), 0);
const windowTimeHitTotal = toneList.reduce((s, t) => s + (t.windowTimeHitCount || 0), 0);
const toneOverlapHitTotal = toneList.reduce((s, t) => s + (t.toneOverlapHitCount || 0), 0);
const alignmentTextUsedTotal = toneList.reduce((s, t) => s + (t.alignmentTextUsedCount || 0), 0);
const tokenTextUsedTotal = toneList.reduce((s, t) => s + (t.tokenTextUsedForAlignmentCount || 0), 0);
const charScanFallbackTotal = toneList.reduce((s, t) => s + (t.charScanFallbackCount || 0), 0);
const toneFilteredTotal = toneList.reduce((s, t) => s + (t.recallToneIncompatibleCount || 0), 0);
const toneCompatibleTotal = toneList.reduce((s, t) => s + (t.recallToneCompatibleCount || 0), 0);
const punctFallbackCases = biList.filter((b) => (b.punctuationFallbackBoundaryCount || 0) > 0).length;
const fallbackReasons = {};
for (const b of biList) {
  if (b.fallbackReason) {
    fallbackReasons[b.fallbackReason] = (fallbackReasons[b.fallbackReason] || 0) + 1;
  }
}

const d001 = validCases.find((c) => c.id === 'd001') || evaluated.find((c) => c.id === 'd001');
const sampleIds = ['d001', 'd004', 'd010', 'd050', 'd100', 'd150', 'd181'];
const samples = sampleIds
  .map((id) => {
    const c = evaluated.find((x) => x.id === id);
    if (!c) return null;
    const ref = refById[id] || '';
    const raw = (c.extra?.raw_asr_text || '').trim();
    const fin = (c.extra?.text_asr || c.text_asr_preview || '').trim();
    const sa = c.extra?.fw_detector?.spanAssemblyV3;
    return {
      id,
      scenario: c.scenario,
      reference: ref,
      hyp: fin,
      raw_asr: raw,
      cer_raw: Number(cer(ref, raw).toFixed(4)),
      cer_final: Number(cer(ref, fin).toFixed(4)),
      pipeline_ms: c.pipeline_ms,
      fw_step_ms: c.extra?.fw_detector_step_ms,
      pipelinePath: c.extra?.fw_detector?.pipelinePath,
      fw_applied: c.fw_applied_count,
      coarseSpanCount: sa?.coarseSpanCount,
      boundaryImport: sa?.boundaryImport,
      tone: sa?.tone,
      toneModule: c.extra?.fw_detector?.toneModule,
    };
  })
  .filter(Boolean);

const out = {
    meta: {
    timestamp: report.timestamp,
    config: {
      spanAssemblyV3Enabled: true,
      pipelinePath: 'v3',
      toneStrictFilter: true,
    },
    evaluated: evaluated.length,
    valid_cases: validCases.length,
    asr_not_ready_cases: asrNotReadyCases.length,
    wall_clock_sec: report.summary.wall_clock_sec,
    asrWarmup: report.asrWarmup || null,
  },
  quality: {
    avg_cer_raw: Number(avg(rawCers).toFixed(4)),
    avg_cer_final: Number(avg(finalCers).toFixed(4)),
    avg_cer_probe: Number(avg(probeCers).toFixed(4)),
    median_cer_raw: Number(pct(rawCers, 50).toFixed(4)),
    median_cer_final: Number(pct(finalCers, 50).toFixed(4)),
    p95_cer_raw: Number(pct(rawCers, 95).toFixed(4)),
    p95_cer_final: Number(pct(finalCers, 95).toFixed(4)),
    exact_match_raw: exactRaw,
    exact_match_final: exactFinal,
    exact_match_probe: exactProbe,
    fw_improved_cases: improved,
    fw_degraded_cases: degraded,
    fw_unchanged_cer_cases: validCases.length - improved - degraded,
    worst_final_cer_top10: worstFinal.slice(0, 10),
  },
  perf: {
    pipeline_ms: {
      avg: Math.round(avg(pipelineMs)),
      p50: pct(pipelineMs, 50),
      p95: pct(pipelineMs, 95),
      min: Math.min(...pipelineMs),
      max: Math.max(...pipelineMs),
    },
    fw_detector_step_ms: {
      avg: Math.round(avg(fwStepMs)),
      p50: pct(fwStepMs, 50),
      p95: pct(fwStepMs, 95),
    },
    asr_latency_ms: {
      avg: Math.round(avg(asrLatency)),
      p50: pct(asrLatency, 50),
      p95: pct(asrLatency, 95),
    },
    audio_ms: {
      avg: Math.round(avg(audioMs)),
      p50: pct(audioMs, 50),
      p95: pct(audioMs, 95),
    },
    rtf_pipeline: Number((avg(pipelineMs) / avg(audioMs)).toFixed(3)),
    rtf_asr: Number((avg(asrLatency) / avg(audioMs)).toFixed(3)),
  },
  contract: {
    ...report.summary,
    d001_pass: d001?.pass === true,
    d001_error: d001?.error || null,
  },
  boundaryImport: {
    v3_case_count: v3Cases.length,
    coverage_ok_count: coverageOkCount,
    coverage_ok_rate: biList.length ? Number((coverageOkCount / biList.length).toFixed(4)) : 0,
    avg_trustedTopKCount: Number(avgBi('trustedTopKCount').toFixed(2)),
    avg_finalCoarseSpanCount: Number(avgBi('finalCoarseSpanCount').toFixed(2)),
    avg_imeBoundaryCount: Number(avgBi('imeBoundaryCount').toFixed(2)),
    avg_proposalBoundaryCount: Number(avgBi('proposalBoundaryCount').toFixed(2)),
    punct_fallback_cases: punctFallbackCases,
    span_source_totals: srcTotals,
    fallback_reasons: fallbackReasons,
  },
  tone: {
    acceptance_source: 'spanAssemblyV3.tone',
    v3_case_count: toneList.length,
    tonePayloadAvailable_count: tonePayloadOk,
    windowTimeHit_total: windowTimeHitTotal,
    windowTimeAttempt_total: windowTimeAttemptTotal,
    windowTimeHit_rate: windowTimeAttemptTotal
      ? Number((windowTimeHitTotal / windowTimeAttemptTotal).toFixed(4))
      : 0,
    toneOverlapHit_total: toneOverlapHitTotal,
    toneOverlapSyllableMismatch_total: toneList.reduce(
      (s, t) => s + (t.toneOverlapSyllableMismatchCount || 0),
      0
    ),
    alignmentTextUsedCount_total: alignmentTextUsedTotal,
    tokenTextUsedForAlignmentCount_total: tokenTextUsedTotal,
    charScanFallbackCount_total: charScanFallbackTotal,
    compliance_ok:
      alignmentTextUsedTotal === 0 && tokenTextUsedTotal === 0 && charScanFallbackTotal === 0,
    ngramPatternHit_cases: tonePatternHitCases,
    avg_ngramTonePatternAttemptCount: Number(avgTone('ngramTonePatternAttemptCount').toFixed(2)),
    avg_ngramTonePatternHitCount: Number(avgTone('ngramTonePatternHitCount').toFixed(2)),
    avg_ngramTonePatternMissCount: Number(avgTone('ngramTonePatternMissCount').toFixed(2)),
    total_recallToneCompatibleCount: toneCompatibleTotal,
    total_recallToneIncompatibleCount: toneFilteredTotal,
    toneSkippedReasons: toneList.reduce((acc, t) => {
      if (t.toneSkippedReason) acc[t.toneSkippedReason] = (acc[t.toneSkippedReason] || 0) + 1;
      return acc;
    }, {}),
    deprecated_rerank_toneModule_cases: toneModuleList.length,
    deprecated_rerank_alignmentMatched: toneModuleList.filter((t) => t.alignmentTextMatched === true)
      .length,
  },
  d001: {
    reference: refById.d001,
    raw_asr: d001?.extra?.raw_asr_text,
    final_asr: d001?.extra?.text_asr,
    cer_raw: Number(cer(refById.d001, d001?.extra?.raw_asr_text || '').toFixed(4)),
    cer_final: Number(cer(refById.d001, d001?.extra?.text_asr || '').toFixed(4)),
    spanAssemblyV3: d001?.extra?.fw_detector?.spanAssemblyV3,
    toneModule: d001?.extra?.fw_detector?.toneModule,
  },
  samples,
};

const outPath = path.join(__dirname, 'span-assembly-v3-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log(JSON.stringify(out, null, 2));
