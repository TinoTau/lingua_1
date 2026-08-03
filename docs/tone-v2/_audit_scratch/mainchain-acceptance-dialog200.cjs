#!/usr/bin/env node
/**
 * Acceptance audit runner — Electron :5020 full chain dialog_200.
 * Read-only vs production code; writes compact metrics + sample traces.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '../../..');
const DIALOG_DIR = path.join(PROJECT_ROOT, 'test wav', 'dialog_200');
const MANIFEST = path.join(DIALOG_DIR, 'cases.manifest.json');
const OUT_DIR = path.join(__dirname, 'tone_evidence_ssot_attribution_2026_07_29');
const LIMIT = process.env.ACCEPT_LIMIT ? parseInt(process.env.ACCEPT_LIMIT, 10) : 200;
const TRACE_N = process.env.ACCEPT_TRACE_N ? parseInt(process.env.ACCEPT_TRACE_N, 10) : 30;
const PORT = (() => {
  const p = path.join(process.env.APPDATA || '', 'lingua-electron-node', 'electron-node-config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')).testServer?.port || 5020;
  } catch {
    return 5020;
  }
})();

const REGRESSION_IDS = new Set([
  // Prefer cases whose expected text matches key phrases when present; else fill randomly later
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitOk(url, maxMs = 300000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch (_) {}
    await sleep(2000);
  }
  return false;
}

function pickTone(extra) {
  const fw = extra.fw_detector || {};
  const spanV4 = fw.spanAssemblyV4 || {};
  return spanV4.tone || fw.tone || {};
}

function countCandidates(extra) {
  const fw = extra.fw_detector || {};
  const spans = fw.spans || [];
  let total = 0;
  let withTone = 0;
  let withoutTone = 0;
  for (const sp of spans) {
    const cands = sp.candidates || sp.topCandidates || [];
    for (const c of cands) {
      total += 1;
      const hasTone =
        (c.acousticTonePattern && c.acousticTonePattern.length) ||
        c.toneReason === 'match' ||
        c.toneReason === 'mismatch' ||
        c.toneCompatible != null ||
        c.toneLookupStage === 'tone_exact';
      if (hasTone) withTone += 1;
      else withoutTone += 1;
    }
  }
  // Also summary-level
  const summaryCand = fw.summary?.candidateCount;
  return { total: total || summaryCand || 0, withTone, withoutTone, summaryCandidateCount: summaryCand ?? null };
}

function extractCompact(caseDef, data, err) {
  if (err) {
    return { id: caseDef.id, ok: false, error: String(err) };
  }
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const tone = pickTone(extra);
  const utteranceTone = extra.utterance_tone || null;
  const spanV4 = fw.spanAssemblyV4 || {};
  const cands = countCandidates(extra);
  const summary = fw.summary || {};
  const kenlm = fw.sentenceRerank || spanV4.kenlm || {};
  const ssotSliceCount = tone.toneSliceCount ?? utteranceTone?.sliceCount ?? 0;
  const apiSliceCount = utteranceTone?.sliceCount ?? 0;

  return {
    id: caseDef.id,
    ok: true,
    text_asr: (data.text_asr || '').slice(0, 120),
    raw_asr: (extra.raw_asr_text || '').slice(0, 120),
    text_nmt: (data.text_nmt || data.translation || '').slice(0, 120),
    asr_service_id: extra.asr_service_id,
    fw_triggered: fw.triggered === true,
    pipeline_ms: extra.pipeline_ms,
    asr_ms: extra.asr_ms,
    batchCount: extra.asr_diagnostics?.audio_segmentation?.node_audio_segment_count ?? null,
    tone: {
      toneEvidenceSliceCount: ssotSliceCount,
      apiToneSliceCount: apiSliceCount,
      ssotEqualsApi: ssotSliceCount === apiSliceCount,
      toneEnabled: tone.toneEnabled ?? utteranceTone?.toneEnabled,
      toneSkippedReason: tone.toneSkippedReason ?? utteranceTone?.skippedReason,
      wordTimeSpanCount: tone.wordTimeSpanCount ?? 0,
      tonePatternAttemptCount: tone.ngramTonePatternAttemptCount ?? 0,
      tonePatternHitCount: tone.ngramTonePatternHitCount ?? 0,
      tonePatternMappingMissCount: tone.tonePatternMappingMissCount ?? 0,
      patternAttempt: tone.ngramTonePatternAttemptCount ?? 0,
      patternHit: tone.ngramTonePatternHitCount ?? 0,
      patternMiss: tone.ngramTonePatternMissCount ?? 0,
      toneOverlapHit: tone.toneOverlapHitCount ?? 0,
      toneOverlapMiss: tone.toneOverlapMissCount ?? 0,
      toneExactHitCount: tone.toneExactHitCount ?? 0,
      plainFallbackHitCount: tone.plainFallbackHitCount ?? 0,
      recallToneCompatible: tone.recallToneCompatibleCount ?? 0,
      recallToneFallback: tone.recallToneFallbackCount ?? 0,
      evidenceProductionStatusCounts: tone.evidenceProductionStatusCounts || {},
      mappingMissReasonCounts: tone.mappingMissReasonCounts || {},
      mappingMissAttributionCounts: tone.mappingMissAttributionCounts || {},
      evidenceProduction: (utteranceTone?.evidenceProduction || []).slice(0, 40),
      exampleWindows: (tone.exampleToneWindows || []).slice(0, 5).map((w) => ({
        text: w.text,
        pinyinKey: w.pinyinKey,
        pattern: w.acousticTonePattern,
        hasPattern: Array.isArray(w.acousticTonePattern) && w.acousticTonePattern.length > 0,
        mappingMissReason: w.mappingMissReason,
        mappingMissAttribution: w.mappingMissAttribution,
      })),
    },
    recall: {
      logicalWindowRecallCount: spanV4.logicalWindowRecallCount ?? summary.logicalWindowRecallCount ?? null,
      physicalSqlStatementCount: spanV4.physicalSqlStatementCount ?? null,
    },
    candidates: cands,
    assembly: {
      spanCount: summary.spanCount ?? (fw.spans || []).length,
      appliedCount: summary.appliedCount ?? 0,
      candidateSentenceCount: summary.candidateSentenceCount ?? 0,
      pickedTopKWinCount: summary.pickedTopKWinCount ?? 0,
    },
    kenlm: {
      queryCount: summary.kenlmQueryCount ?? 0,
      approved: summary.kenlmApprovedCount ?? 0,
      vetoed: summary.kenlmVetoedCount ?? 0,
      pickedIsRaw: kenlm.pickedIsRaw,
      maxDelta: kenlm.maxDelta,
      combinationCount: kenlm.combinationCount,
    },
  };
}

function buildTrace(caseDef, data) {
  const extra = data.extra || {};
  const fw = extra.fw_detector || {};
  const tone = pickTone(extra);
  const utteranceTone = extra.utterance_tone || null;
  const spans = (fw.spans || []).slice(0, 8).map((sp) => ({
    text: sp.text || sp.spanText || sp.rawText,
    applied: sp.applied,
    candidateCount: (sp.candidates || sp.topCandidates || []).length,
    sampleCandidates: (sp.candidates || sp.topCandidates || []).slice(0, 3).map((c) => ({
      replacement: c.replacement || c.word || c.text,
      toneReason: c.toneReason,
      toneCompatible: c.toneCompatible,
      tonePenalty: c.tonePenalty,
      toneLookupStage: c.toneLookupStage,
      acousticTonePattern: c.acousticTonePattern,
      domainIds: c.domainIds || c.domains,
    })),
  }));
  return {
    id: caseDef.id,
    expected: caseDef.expectedText || caseDef.utterance,
    asr: data.text_asr,
    raw_asr: extra.raw_asr_text,
    nmt: data.text_nmt || data.translation,
    asr_service_id: extra.asr_service_id,
    utterance_tone: utteranceTone
      ? {
          toneEnabled: utteranceTone.toneEnabled,
          sliceCount: utteranceTone.sliceCount,
          skippedReason: utteranceTone.skippedReason,
          evidenceProductionCount: (utteranceTone.evidenceProduction || []).length,
          firstSlicePosterior: utteranceTone.acousticToneSlices?.[0]?.tonePosterior,
        }
      : null,
    toneDiag: {
      toneEnabled: tone.toneEnabled,
      toneSliceCount: tone.toneSliceCount,
      wordTimeSpanCount: tone.wordTimeSpanCount,
      ngramTonePatternAttemptCount: tone.ngramTonePatternAttemptCount,
      ngramTonePatternHitCount: tone.ngramTonePatternHitCount,
      ngramTonePatternMissCount: tone.ngramTonePatternMissCount,
      tonePatternMappingMissCount: tone.tonePatternMappingMissCount,
      evidenceProductionStatusCounts: tone.evidenceProductionStatusCounts,
      mappingMissReasonCounts: tone.mappingMissReasonCounts,
      mappingMissAttributionCounts: tone.mappingMissAttributionCounts,
      toneExactHitCount: tone.toneExactHitCount,
      plainFallbackHitCount: tone.plainFallbackHitCount,
      exampleToneWindows: tone.exampleToneWindows,
    },
    summary: fw.summary,
    sentenceRerank: fw.sentenceRerank,
    spans,
  };
}

async function runOne(caseDef) {
  const wavPath = path.join(DIALOG_DIR, caseDef.file);
  const body = {
    wavPath,
    srcLang: 'zh',
    tgtLang: 'en',
    use_lexicon: true,
    is_manual_cut: true,
    session_id: `accept-${caseDef.id}-${Date.now()}`,
    lexicon_v2_intent_enabled: false,
  };
  const res = await fetch(`http://127.0.0.1:${PORT}/run-pipeline-with-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function summarize(rows) {
  const ok = rows.filter((r) => r.ok);
  const fail = rows.filter((r) => !r.ok);
  let patternAttempt = 0;
  let patternHit = 0;
  let patternMiss = 0;
  let mappingMiss = 0;
  let toneExact = 0;
  let plainFb = 0;
  let sliceSum = 0;
  let apiSliceSum = 0;
  let wtsSum = 0;
  let batchSum = 0;
  let candTotal = 0;
  let candTone = 0;
  let candNoTone = 0;
  let kenlmQ = 0;
  let kenlmApp = 0;
  let fwTrig = 0;
  let nmtOk = 0;
  let ssotApiMismatch = 0;
  const skipReasons = {};
  const evidenceStatus = {};
  const missReasons = {};
  const missAttr = {};

  for (const r of ok) {
    patternAttempt += r.tone.tonePatternAttemptCount ?? r.tone.patternAttempt ?? 0;
    patternHit += r.tone.tonePatternHitCount ?? r.tone.patternHit ?? 0;
    patternMiss += r.tone.patternMiss ?? 0;
    mappingMiss += r.tone.tonePatternMappingMissCount ?? 0;
    toneExact += r.tone.toneExactHitCount;
    plainFb += r.tone.plainFallbackHitCount;
    sliceSum += r.tone.toneEvidenceSliceCount ?? 0;
    apiSliceSum += r.tone.apiToneSliceCount ?? 0;
    wtsSum += r.tone.wordTimeSpanCount;
    batchSum += r.batchCount || 0;
    if (r.tone.ssotEqualsApi === false) ssotApiMismatch += 1;
    candTotal += r.candidates.total;
    candTone += r.candidates.withTone;
    candNoTone += r.candidates.withoutTone;
    kenlmQ += r.kenlm.queryCount;
    kenlmApp += r.kenlm.approved;
    if (r.fw_triggered) fwTrig += 1;
    if (r.text_nmt) nmtOk += 1;
    const sr = r.tone.toneSkippedReason || 'none';
    skipReasons[sr] = (skipReasons[sr] || 0) + 1;
    for (const [k, v] of Object.entries(r.tone.evidenceProductionStatusCounts || {})) {
      evidenceStatus[k] = (evidenceStatus[k] || 0) + (v || 0);
    }
    for (const [k, v] of Object.entries(r.tone.mappingMissReasonCounts || {})) {
      missReasons[k] = (missReasons[k] || 0) + (v || 0);
    }
    for (const [k, v] of Object.entries(r.tone.mappingMissAttributionCounts || {})) {
      missAttr[k] = (missAttr[k] || 0) + (v || 0);
    }
  }

  const evidenceRate = patternAttempt > 0 ? patternHit / patternAttempt : null;
  const attributionTable = Object.entries(missAttr).map(([cause, count]) => ({
    cause,
    count,
    pctOfMappingMiss: mappingMiss > 0 ? count / mappingMiss : null,
  }));

  return {
    total: rows.length,
    success: ok.length,
    failure: fail.length,
    fw_triggered: fwTrig,
    nmt_nonempty: nmtOk,
    batchCountSum: batchSum,
    tone: {
      totalToneEvidenceSliceCount: sliceSum,
      totalApiToneSliceCount: apiSliceSum,
      ssotApiMismatchCases: ssotApiMismatch,
      totalWordTimeSpanCount: wtsSum,
      totalPatternAttempt: patternAttempt,
      totalPatternHit: patternHit,
      totalPatternMiss: patternMiss,
      totalTonePatternMappingMiss: mappingMiss,
      evidenceCoverage: evidenceRate,
      totalToneExactHit: toneExact,
      totalPlainFallback: plainFb,
      avgSliceCount: ok.length ? sliceSum / ok.length : 0,
      avgWordTimeSpanCount: ok.length ? wtsSum / ok.length : 0,
      skipReasons,
      evidenceProductionStatusCounts: evidenceStatus,
      mappingMissReasonCounts: missReasons,
      mappingMissAttributionCounts: missAttr,
      attributionTable,
    },
    candidates: {
      total: candTotal,
      withTone: candTone,
      withoutTone: candNoTone,
      avgPerCase: ok.length ? candTotal / ok.length : 0,
    },
    kenlm: {
      totalQuery: kenlmQ,
      totalApproved: kenlmApp,
      avgQueryPerCase: ok.length ? kenlmQ / ok.length : 0,
    },
    avgPipelineMs: ok.length
      ? ok.reduce((s, r) => s + (r.pipeline_ms || 0), 0) / ok.length
      : 0,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('[accept] waiting Electron', PORT);
  if (!(await waitOk(`http://127.0.0.1:${PORT}/health`))) {
    console.error('[accept] Electron not ready');
    process.exit(1);
  }
  console.log('[accept] waiting FW 6007');
  if (!(await waitOk('http://127.0.0.1:6007/health'))) {
    console.error('[accept] FW not ready');
    process.exit(1);
  }
  // Confirm model via FW health/diagnostics if available
  try {
    const h = await (await fetch('http://127.0.0.1:6007/health')).json();
    fs.writeFileSync(path.join(OUT_DIR, 'fw_health.json'), JSON.stringify(h, null, 2));
  } catch (_) {}

  const manifestRaw = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let cases = Array.isArray(manifestRaw) ? manifestRaw : manifestRaw.cases || [];
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  // Prefer regression phrase cases for traces
  const phraseNeedles = ['你好', '我们', '订单', '预订', '前台', '接口', '上线计划', '机场高速', '大杯小杯'];
  const preferredTrace = [];
  for (const c of cases) {
    const t = `${c.expectedText || ''} ${c.utterance || ''}`;
    if (phraseNeedles.some((p) => t.includes(p))) preferredTrace.push(c.id);
  }

  const rows = [];
  const traces = [];
  const traceIds = new Set(preferredTrace.slice(0, Math.min(15, TRACE_N)));

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`[accept] ${i + 1}/${cases.length} ${c.id} ... `);
    try {
      const data = await runOne(c);
      const row = extractCompact(c, data);
      rows.push(row);
      console.log(
        'ok ssot',
        row.tone.toneEvidenceSliceCount,
        'api',
        row.tone.apiToneSliceCount,
        'eq',
        row.tone.ssotEqualsApi,
        'pat',
        `${row.tone.patternHit}/${row.tone.patternAttempt}`,
        'mapMiss',
        row.tone.tonePatternMappingMissCount
      );
      if (traceIds.size < TRACE_N && !traceIds.has(c.id)) {
        // fill remaining randomly-ish by stride
        if (i % Math.max(1, Math.floor(cases.length / TRACE_N)) === 0) traceIds.add(c.id);
      }
      if (traceIds.has(c.id) && traces.length < TRACE_N) {
        const tr = buildTrace(c, data);
        traces.push(tr);
        fs.writeFileSync(path.join(OUT_DIR, `trace_${c.id}.json`), JSON.stringify(tr, null, 2));
      }
    } catch (e) {
      rows.push({ id: c.id, ok: false, error: e.message });
      console.log('FAIL', e.message);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  const summary = summarize(rows);
  const out = {
    timestamp: new Date().toISOString(),
    port: PORT,
    projectRoot: PROJECT_ROOT,
    limit: LIMIT,
    summary,
    failures: rows.filter((r) => !r.ok),
    traceIds: traces.map((t) => t.id),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'traces_index.json'), JSON.stringify(traces, null, 2));
  console.log('[accept] wrote', OUT_DIR);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
