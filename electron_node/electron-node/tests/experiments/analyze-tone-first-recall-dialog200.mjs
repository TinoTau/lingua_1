#!/usr/bin/env node
/** Analyze dialog_200 batch for Tone-First Recall V1.0.1 metrics + quality/perf. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const batchArg = process.argv[2];
const BATCH = batchArg
  ? path.resolve(batchArg)
  : path.join(__dirname, '../tone-first-recall-dialog200-batch-result.json');
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

const evaluated = report.cases.filter((c) => !c.skip && !c.error);
const validCases = evaluated.filter((c) => c.pass);
const pipelineMs = validCases.map((c) => c.pipeline_ms).filter((n) => typeof n === 'number');
const fwStepMs = validCases.map((c) => c.extra?.fw_detector_step_ms).filter((n) => typeof n === 'number');

const rawCers = [];
const finalCers = [];
let exactRaw = 0;
let exactFinal = 0;
let improved = 0;
let degraded = 0;

for (const c of validCases) {
  const ref = refById[c.id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || c.extra?.raw_asr_text || '').trim();
  const rc = cer(ref, raw);
  const fc = cer(ref, fin);
  rawCers.push(rc);
  finalCers.push(fc);
  if (norm(raw) === norm(ref)) exactRaw += 1;
  if (norm(fin) === norm(ref)) exactFinal += 1;
  if (fc < rc - 1e-9) improved += 1;
  if (fc > rc + 1e-9) degraded += 1;
}

function fwFromCase(c) {
  return c.extra?.fw_detector || {};
}

function toneFromCase(c) {
  return fwFromCase(c).spanAssemblyV4?.tone || fwFromCase(c).tone || {};
}

function preFilterHits(c) {
  return fwFromCase(c).spanAssemblyV4?.recallHitsPreFilter || [];
}

function v2Spans(c) {
  return fwFromCase(c).recallV2Diagnostics?.spans || [];
}

function stageDistribution(cases) {
  const counts = {
    tone_exact: 0,
    plain_fallback: 0,
    plain_only_no_pattern: 0,
    parent_fragment_omit: 0,
  };
  for (const c of cases) {
    for (const row of preFilterHits(c)) {
      if (row.toneLookupStage === 'tone_exact') counts.tone_exact += 1;
      else if (row.toneLookupStage === 'plain_fallback') counts.plain_fallback += 1;
      else if (row.toneLookupStage === 'plain_only_no_pattern') counts.plain_only_no_pattern += 1;
      else if (!row.toneLookupStage) counts.parent_fragment_omit += 1;
    }
  }
  return counts;
}

function findPreFilterEvidence(caseId, replacement, stage) {
  const c = evaluated.find((x) => x.id === caseId);
  if (!c) return null;
  return preFilterHits(c).find(
    (row) => row.replacement === replacement && (!stage || row.toneLookupStage === stage)
  );
}

function auditD001() {
  const zhongBei = findPreFilterEvidence('d001', '中杯', 'tone_exact');
  const lanMei = findPreFilterEvidence('d001', '蓝莓马芬', 'tone_exact');
  const fw = fwFromCase(evaluated.find((x) => x.id === 'd001') || {});
  return {
    pass: Boolean(zhongBei && lanMei),
    zhongBei: zhongBei
      ? {
          toneLookupStage: zhongBei.toneLookupStage,
          windowPinyinKey: zhongBei.windowPinyinKey,
          queryTonePinyinKey: zhongBei.queryTonePinyinKey,
        }
      : null,
    lanMei: lanMei
      ? {
          toneLookupStage: lanMei.toneLookupStage,
          windowPinyinKey: lanMei.windowPinyinKey,
          queryTonePinyinKey: lanMei.queryTonePinyinKey,
        }
      : null,
    traceTruncated: fw.spanAssemblyV4?.traceTruncated === true,
    traceTruncatedReason: fw.spanAssemblyV4?.traceTruncatedReason,
    v2SpanCount: v2Spans(evaluated.find((x) => x.id === 'd001') || {}).length,
  };
}

function auditD048() {
  const c = evaluated.find((x) => x.id === 'd048');
  if (!c) return { pass: false, reason: 'case_missing' };
  const rows = preFilterHits(c).filter((row) => row.replacement === '烧饼');
  const exact = rows.find((row) => row.toneLookupStage === 'plain_fallback');
  const fragmentOnly = rows.length > 0 && !exact;
  const pass = Boolean(
    exact &&
      exact.toneReason === 'mismatch' &&
      exact.toneCompatible === false
  );
  return {
    pass,
    fragmentOnly,
    evidence: exact
      ? {
          toneLookupStage: exact.toneLookupStage,
          toneReason: exact.toneReason,
          toneCompatible: exact.toneCompatible,
          windowPinyinKey: exact.windowPinyinKey,
          queryTonePinyinKey: exact.queryTonePinyinKey,
        }
      : null,
    traceTruncated: fwFromCase(c).spanAssemblyV4?.traceTruncated === true,
    traceTruncatedReason: fwFromCase(c).spanAssemblyV4?.traceTruncatedReason,
    v2SpanCount: v2Spans(c).length,
  };
}

const toneExactTotals = validCases.map((c) => toneFromCase(c).toneExactHitCount ?? 0);
const plainFallbackTotals = validCases.map((c) => toneFromCase(c).plainFallbackHitCount ?? 0);
const v2SpanNonEmpty = validCases.filter((c) => v2Spans(c).length > 0).length;

function pickSample(id) {
  const c = validCases.find((x) => x.id === id);
  if (!c) return null;
  const ref = refById[id] || '';
  const raw = (c.extra?.raw_asr_text || '').trim();
  const fin = (c.extra?.text_asr || c.text_asr_preview || c.extra?.raw_asr_text || '').trim();
  const fw = fwFromCase(c);
  const tone = toneFromCase(c);
  return {
    id,
    scenario: c.scenario,
    ref: ref.slice(0, 80),
    raw: raw.slice(0, 80),
    final: fin.slice(0, 80),
    raw_cer: Number(cer(ref, raw).toFixed(4)),
    final_cer: Number(cer(ref, fin).toFixed(4)),
    text_changed: raw !== fin,
    fw_applied: fw.summary?.appliedCount ?? 0,
    fw_triggered: fw.triggered,
    pipeline_ms: c.pipeline_ms,
    recallToneCompatibleCount: tone.recallToneCompatibleCount ?? 0,
    recallToneFallbackCount: tone.recallToneFallbackCount ?? 0,
    toneExactHitCount: tone.toneExactHitCount ?? 0,
    plainFallbackHitCount: tone.plainFallbackHitCount ?? 0,
    toneOverlapHitCount: tone.toneOverlapHitCount ?? 0,
    v2SpanCount: v2Spans(c).length,
    lexicon_runtime_status: c.lexicon_runtime_status,
  };
}

const toneCompat = validCases.map((c) => toneFromCase(c).recallToneCompatibleCount ?? 0);
const toneFallback = validCases.map((c) => toneFromCase(c).recallToneFallbackCount ?? 0);

const out = {
  batchFile: BATCH,
  feature: 'Tone-First Recall V1.0.1 + Diagnostics Trace V1.0.2',
  timestamp: report.timestamp,
  stoppedReason: report.stoppedReason,
  evaluated: evaluated.length,
  totalManifest: report.totalManifestCases,
  contract: {
    pass: report.summary?.pass ?? 0,
    fail: report.summary?.fail ?? 0,
    skip: report.summary?.skip ?? 0,
    pipeline_ok_rate: report.summary?.pipeline_ok_rate,
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
    unchanged_count: validCases.length - improved - degraded,
  },
  performance: {
    wall_clock_sec: report.summary?.wall_clock_sec,
    pipeline_ms_avg: Math.round(avg(pipelineMs)),
    pipeline_ms_p50: Math.round(pct(pipelineMs, 50)),
    pipeline_ms_p95: Math.round(pct(pipelineMs, 95)),
    fw_detector_step_ms_avg: Math.round(avg(fwStepMs)),
    fw_detector_step_ms_p50: Math.round(pct(fwStepMs, 50)),
    fw_detector_step_ms_p95: Math.round(pct(fwStepMs, 95)),
  },
  fw: {
    triggered_count: evaluated.filter((c) => c.fw_triggered).length,
    applied_case_count: evaluated.filter((c) => (c.fw_applied_count || 0) > 0).length,
    text_changed_count: evaluated.filter((c) => c.text_changed).length,
    lexicon_runtime_ok: evaluated.filter((c) => c.lexicon_runtime_status === 'ok').length,
  },
  tone_recall: {
    cases_with_tone_payload: validCases.filter((c) => toneFromCase(c).tonePayloadAvailable === true).length,
    cases_with_tone_overlap_hits: validCases.filter((c) => (toneFromCase(c).toneOverlapHitCount ?? 0) > 0).length,
    recall_tone_compatible_total: toneCompat.reduce((s, v) => s + v, 0),
    recall_tone_fallback_total: toneFallback.reduce((s, v) => s + v, 0),
    avg_recall_tone_compatible: Number(avg(toneCompat).toFixed(2)),
    avg_recall_tone_fallback: Number(avg(toneFallback).toFixed(2)),
    avg_tone_overlap_hit: Number(
      avg(validCases.map((c) => toneFromCase(c).toneOverlapHitCount ?? 0)).toFixed(2)
    ),
    cases_with_tone_fallback_penalty: validCases.filter(
      (c) => (toneFromCase(c).recallToneFallbackCount ?? 0) > 0
    ).length,
    tone_exact_hit_total: toneExactTotals.reduce((s, v) => s + v, 0),
    plain_fallback_hit_total: plainFallbackTotals.reduce((s, v) => s + v, 0),
    avg_tone_exact_hit: Number(avg(toneExactTotals).toFixed(2)),
    avg_plain_fallback_hit: Number(avg(plainFallbackTotals).toFixed(2)),
    v2_span_non_empty_cases: v2SpanNonEmpty,
    prefilter_stage_distribution: stageDistribution(validCases),
  },
  diagnostics_trace_audit: {
    d001: auditD001(),
    d048: auditD048(),
  },
  samples: {
    d001: pickSample('d001'),
    d003: pickSample('d003'),
    d048: pickSample('d048'),
    cafe: ['d001', 'd002', 'd003'].map(pickSample).filter(Boolean),
    applied: validCases
      .filter((c) => (c.extra?.fw_detector?.summary?.appliedCount || 0) > 0)
      .slice(0, 5)
      .map((c) => pickSample(c.id))
      .filter(Boolean),
    improved: validCases
      .filter((c) => {
        const ref = refById[c.id] || '';
        const raw = (c.extra?.raw_asr_text || '').trim();
        const fin = (c.extra?.text_asr || '').trim();
        return cer(ref, fin) < cer(ref, raw) - 1e-9;
      })
      .slice(0, 5)
      .map((c) => pickSample(c.id))
      .filter(Boolean),
    worst_cer: [...validCases]
      .map((c) => ({
        id: c.id,
        final_cer: Number(cer(refById[c.id] || '', c.extra?.text_asr || '').toFixed(4)),
        final: (c.extra?.text_asr || '').slice(0, 50),
      }))
      .sort((a, b) => b.final_cer - a.final_cer)
      .slice(0, 5),
  },
};

const outPath = path.join(__dirname, 'tone-first-recall-dialog200-quality-perf.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[analyze-tone-first] wrote', outPath);
console.log(JSON.stringify(out, null, 2));
