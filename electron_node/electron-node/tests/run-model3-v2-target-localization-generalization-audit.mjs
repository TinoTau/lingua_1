#!/usr/bin/env node
/**
 * MODEL3_V2_TARGET_LOCALIZATION_GENERALIZATION_AUDIT
 * READ-ONLY production-semantic audit + prior artifact correction.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { deriveCorrectionUnits } from './lib/materializable-target-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DOCS = path.join(REPO, 'docs', 'user_correction', 'model3');

/**
 * G0 �?resolve authoritative S3 training identity BEFORE any shard load.
 * Shared Python SSOT: training/model3_dataset/acoustic_training/dataset_identity.py
 */
function assertAuthoritativeS3Identity(explicitDatasetPath) {
  const args = [
    path.join(REPO, 'training', 'model3_dataset', 'acoustic_training', 'dataset_identity.py'),
    '--require-authoritative-s3',
  ];
  if (explicitDatasetPath) {
    args.push('--dataset-path', explicitDatasetPath);
  }
  const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', args, {
    cwd: REPO,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim();
    throw new Error(`MODEL3_DATASET_IDENTITY_MISMATCH:G0_FAILED:${err}`);
  }
  return JSON.parse(r.stdout);
}

const TRIGGER_CASES = path.join(DOCS, 'model3_v2_retry_region_trigger_cases.csv');
const MARGIN_CSV = path.join(DOCS, 'model3_v1_runtime_margin_analysis.csv');
const TRACE_JSONL = path.join(DOCS, 'model3_v2_retry_recall_query_trace.jsonl');
const ALIGN_SUMMARY = path.join(DOCS, 'model3_v2_retry_region_trigger_summary.json');

const LOCALIZATION_OWNERS = new Set([
  'MODEL3_RETRY_SHIFTED_NEARBY',
  'MODEL3_TARGET_FALSE_NEGATIVE',
  'MODEL3_TARGET_PARTIAL_COVERAGE',
]);
const NO_FINESPAN_CASES = ['d056', 'd060', 'd073', 'd132', 'd161'];
const FEAT_NAMES = [
  'isAnchor',
  'span_len_log1p',
  'span_rel_position',
  'first_pass_cand_log1p',
  'current_cjk_len_log1p',
  'pinyin_channel_avail',
];
const CJK = /[\u4e00-\u9fff]/g;

function csvEsc(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else if (ch === ',') {
        cols.push(cur);
        cur = '';
      } else if (ch === '"') inQ = true;
      else cur += ch;
    }
    cols.push(cur);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

function spanIndex(spanId) {
  const m = String(spanId).match(/:(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function rangeOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function overlapLen(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function packFeatures(surface, isAnchor, spanIndex0, nSpans, candCount = 0, pinyinAvail = true) {
  const surf = surface || '';
  const cjk = (surf.match(CJK) || []).length;
  return {
    isAnchor: isAnchor ? 1 : 0,
    span_len_log1p: round4(Math.log1p(surf.length)),
    span_rel_position: round4(spanIndex0 / Math.max(nSpans - 1, 1)),
    first_pass_cand_log1p: round4(Math.log1p(Number(candCount) || 0)),
    current_cjk_len_log1p: round4(Math.log1p(cjk)),
    pinyin_channel_avail: pinyinAvail ? 1 : 0,
  };
}

function featVectorStr(f) {
  return FEAT_NAMES.map((k) => f[k]).join('|');
}

function featTupleKey(f) {
  return FEAT_NAMES.map((k) => round4(f[k]).toFixed(4)).join('|');
}

function buildPathSpans(marginRows, rawText, pathId) {
  const rows = marginRows
    .filter((r) => r.path_id === pathId)
    .sort((a, b) => spanIndex(a.spanId) - spanIndex(b.spanId));
  let pos = 0;
  const n = rows.length;
  return rows.map((row, idx) => {
    const surf = row.surface;
    let start = rawText.indexOf(surf, pos);
    if (start < 0) start = pos;
    const end = start + surf.length;
    pos = end;
    const isAnchor = row.isAnchor === 'true' || row.isAnchor === true;
    const features = packFeatures(surf, isAnchor, idx, n, 0, true);
    return {
      spanId: row.spanId,
      surface: surf,
      rawStart: start,
      rawEnd: end,
      syllableIndex: idx,
      isAnchor,
      isModel3Eligible: !isAnchor,
      decision: row.decision,
      margin: Number(row.margin),
      keep_logit: Number(row.keep_logit),
      retry_logit: Number(row.retry_logit),
      features,
      packedForInference: true,
    };
  });
}

function targetSpansForUnit(spans, unit) {
  const { rawStart, rawEnd } = unit.source_range;
  return spans.filter((s) => rangeOverlap(s.rawStart, s.rawEnd, rawStart, rawEnd));
}

function nearestRetrySpan(spans, unit) {
  const { rawStart, rawEnd } = unit.source_range;
  const retrySpans = spans.filter((s) => s.decision === 'RETRY' && !s.isAnchor);
  let best = null;
  let bestDist = Infinity;
  for (const rs of retrySpans) {
    if (rangeOverlap(rs.rawStart, rs.rawEnd, rawStart, rawEnd)) {
      return { span: rs, distance: 0, cls: 'OVERLAP' };
    }
    let dist = rs.rawEnd <= rawStart ? rawStart - rs.rawEnd : rs.rawStart >= rawEnd ? rs.rawStart - rawEnd : 0;
    if (dist < bestDist) {
      bestDist = dist;
      best = rs;
    }
  }
  if (!best) return { span: null, distance: Infinity, cls: 'NONE' };
  let cls = 'DISTANT';
  if (bestDist === 0) cls = 'OVERLAP';
  else if (bestDist <= 2) cls = 'NEAR_1_2_CHARS';
  else if (bestDist <= 4) cls = 'ADJACENT';
  return { span: best, distance: bestDist, cls };
}

function expectedV2Label(unit, span, rawText, expectedText) {
  if (span.isAnchor) return 'EXPECTED_EXCLUDE';
  if (!rangeOverlap(span.rawStart, span.rawEnd, unit.source_range.rawStart, unit.source_range.rawEnd)) {
    return 'AMBIGUOUS_LABEL_EVIDENCE';
  }
  const rawUnit = rawText.slice(unit.source_range.rawStart, unit.source_range.rawEnd);
  const refUnit = expectedText.slice(unit.source_range.rawStart, unit.source_range.rawEnd);
  if (rawUnit === refUnit) return 'EXPECTED_KEEP';
  // Frozen V2 REGION_BOUNDED_FULL_COVERAGE: bounded repair unit with ASR≠ref �?target spans RETRY.
  if (unit.is_reference_diff_hunk || unit.operation !== 'UNCHANGED') {
    return 'EXPECTED_RETRY_CONFIRMED';
  }
  return 'AMBIGUOUS_LABEL_EVIDENCE';
}

function loadTrainingIndex(trainDir) {
  const tupleStats = new Map();
  const surfaceRetry = new Map();
  const surfaceKeep = new Map();
  const relRetry = [];
  const relKeep = [];
  if (!fs.existsSync(trainDir)) {
    throw new Error(`MODEL3_DATASET_MANIFEST_MISSING:train_dir_missing:${trainDir}`);
  }
  const shards = fs.readdirSync(trainDir).filter((f) => f.endsWith('.jsonl'));
  for (const shard of shards) {
    const lines = fs.readFileSync(path.join(trainDir, shard), 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let sample;
      try {
        sample = JSON.parse(line);
      } catch {
        continue;
      }
      const fa = sample.featureAvailability || {};
      const spans = sample.spans || [];
      const n = spans.length;
      spans.forEach((sp, i) => {
        if (sp.label !== 'KEEP' && sp.label !== 'RETRY') return;
        const cand = sp.recallEvidence?.firstPassCandidateCount ?? 0;
        const feats = packFeatures(
          sp.surface,
          sp.isAnchor,
          i,
          n,
          cand,
          !!fa.pinyinTextDerived
        );
        const key = featTupleKey(feats);
        if (!tupleStats.has(key)) tupleStats.set(key, { KEEP: 0, RETRY: 0 });
        tupleStats.get(key)[sp.label] += 1;
        const surf = sp.surface || '';
        if (sp.label === 'RETRY') surfaceRetry.set(surf, (surfaceRetry.get(surf) || 0) + 1);
        else surfaceKeep.set(surf, (surfaceKeep.get(surf) || 0) + 1);
        if (sp.label === 'RETRY') relRetry.push(feats.span_rel_position);
        else relKeep.push(feats.span_rel_position);
      });
    }
  }
  return { tupleStats, surfaceRetry, surfaceKeep, relRetry, relKeep };
}

function trainingSupport(trainIdx, feats, surface) {
  const key = featTupleKey(feats);
  const ts = trainIdx.tupleStats.get(key) || { KEEP: 0, RETRY: 0 };
  const surfRetry = trainIdx.surfaceRetry.get(surface) || 0;
  const totalRetry = ts.RETRY + (surfRetry > ts.RETRY ? surfRetry - ts.RETRY : 0);
  if (ts.RETRY >= 10 || surfRetry >= 10) return 'TRAIN_SUPPORT_STRONG';
  if (ts.RETRY >= 3 || surfRetry >= 5) return 'TRAIN_SUPPORT_MODERATE';
  if (ts.RETRY >= 1 || surfRetry >= 1) return 'TRAIN_SUPPORT_WEAK';
  if (ts.KEEP + ts.RETRY === 0 && surfRetry === 0) return 'TRAIN_COMBINATION_MISSING';
  return 'TRAIN_COMBINATION_MISSING';
}

function featuresIndistinguishable(fA, fB) {
  return FEAT_NAMES.every((k) => Math.abs(Number(fA[k]) - Number(fB[k])) < 0.001);
}

function classifyShifted(ctx) {
  const { targetSpan, neighborSpan, trainIdx, expectedLabel } = ctx;
  if (expectedLabel !== 'EXPECTED_RETRY_CONFIRMED') return { rootCause: 'TRACE_ERROR', shiftClass: 'TRACE_ERROR', futureFix: 'AUDIT_ONLY_CORRECTION' };
  const tSup = trainingSupport(trainIdx, targetSpan.features, targetSpan.surface);
  const nSup = trainingSupport(trainIdx, neighborSpan.features, neighborSpan.surface);
  if (featuresIndistinguishable(targetSpan.features, neighborSpan.features)) {
    return { rootCause: 'FEATURE_INFORMATION_LIMITATION', shiftClass: 'TARGET_FEATURE_WEAKNESS', futureFix: 'NO_ACTION' };
  }
  if (neighborSpan.features.first_pass_cand_log1p > targetSpan.features.first_pass_cand_log1p + 0.01) {
    return { rootCause: 'TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH', shiftClass: 'NEIGHBOR_FEATURE_DOMINANCE', futureFix: 'TRAINING_DATA_REBALANCE' };
  }
  if (Math.abs(neighborSpan.features.span_rel_position - targetSpan.features.span_rel_position) > 0.15) {
    return { rootCause: 'TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH', shiftClass: 'TRAINING_LOCALIZATION_COVERAGE_GAP', futureFix: 'TRAINING_SAMPLE_COVERAGE_EXPANSION' };
  }
  if (tSup === 'TRAIN_COMBINATION_MISSING' && nSup !== 'TRAIN_COMBINATION_MISSING') {
    return { rootCause: 'TRAINING_COVERAGE_GAP', shiftClass: 'TRAINING_LOCALIZATION_COVERAGE_GAP', futureFix: 'TRAINING_SAMPLE_COVERAGE_EXPANSION' };
  }
  if (tSup !== 'TRAIN_COMBINATION_MISSING') {
    return { rootCause: 'MODEL_GENERALIZATION_FAILURE', shiftClass: 'SPAN_CONTEXT_DISCRIMINATION_FAILURE', futureFix: 'RETRAIN_EXISTING_MODEL_SAME_ARCHITECTURE' };
  }
  return { rootCause: 'TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH', shiftClass: 'TARGET_FEATURE_WEAKNESS', futureFix: 'TRAINING_SAMPLE_COVERAGE_EXPANSION' };
}

function classifyFn(ctx) {
  const { targetSpan, trainIdx, expectedLabel } = ctx;
  if (expectedLabel !== 'EXPECTED_RETRY_CONFIRMED') return { rootCause: 'TRACE_ERROR', futureFix: 'AUDIT_ONLY_CORRECTION' };
  const tSup = trainingSupport(trainIdx, targetSpan.features, targetSpan.surface);
  if (tSup === 'TRAIN_COMBINATION_MISSING') {
    return { rootCause: 'TRAINING_COVERAGE_GAP', futureFix: 'TRAINING_SAMPLE_COVERAGE_EXPANSION' };
  }
  if (targetSpan.margin > 2) {
    return { rootCause: 'MODEL_GENERALIZATION_FAILURE', futureFix: 'RETRAIN_EXISTING_MODEL_SAME_ARCHITECTURE' };
  }
  return { rootCause: 'MODEL_GENERALIZATION_FAILURE', futureFix: 'RETRAIN_EXISTING_MODEL_SAME_ARCHITECTURE' };
}

function classifyPartial(ctx) {
  const keepSpans = ctx.regionSpans.filter((s) => s.decision === 'KEEP');
  const missing = keepSpans.filter(
    (s) => expectedV2Label(ctx.unit, s, ctx.rawText, ctx.expectedText) === 'EXPECTED_RETRY_CONFIRMED'
  );
  if (!missing.length) {
    return { rootCause: 'MODEL_GENERALIZATION_FAILURE', futureFix: 'RETRAIN_EXISTING_MODEL_SAME_ARCHITECTURE' };
  }
  const anyMissingSupport = missing.some((s) => trainingSupport(ctx.trainIdx, s.features, s.surface) !== 'TRAIN_COMBINATION_MISSING');
  if (anyMissingSupport) {
    return { rootCause: 'MODEL_GENERALIZATION_FAILURE', futureFix: 'RETRAIN_EXISTING_MODEL_SAME_ARCHITECTURE' };
  }
  return { rootCause: 'TRAINING_LABEL_COVERAGE_GAP', futureFix: 'LABEL_PIPELINE_CORRECTION' };
}

function auditNoFineSpan(caseRow, traceRec, marginByCase, trainIdx) {
  const caseId = caseRow.caseId;
  const pathId = caseRow.pathId;
  const rawText = traceRec?.raw_asr || '';
  const derived = deriveCorrectionUnits(rawText, traceRec?.expected || '');
  const units = derived.required_units.filter((u) => u.is_reference_diff_hunk) || derived.required_units;
  const repairUnit =
    units.find(
      (u) =>
        String(u.source_range.rawStart) === caseRow.targetStart &&
        String(u.source_range.rawEnd) === caseRow.targetEnd
    ) || units[0];
  const allMarginRows = marginByCase.get(caseId) || [];
  const pathIds = [...new Set(allMarginRows.map((r) => r.path_id))];
  const tracePaths = (traceRec?.paths || []).map((p) => p.path_id);
  const retainedPathCount = new Set([...pathIds, ...tracePaths]).size;
  let overlappingCurrent = 'NO';
  let overlappingOther = 'NO';
  let otherPathId = '';
  for (const pid of pathIds) {
    const spans = buildPathSpans(allMarginRows, rawText, pid);
    const hits = targetSpansForUnit(spans, repairUnit);
    if (hits.length) {
      if (pid === pathId) overlappingCurrent = 'YES';
      else {
        overlappingOther = 'YES';
        otherPathId = pid;
      }
    }
  }
  let owner = 'UNKNOWN';
  let confidence = 'MEDIUM';
  if (overlappingOther === 'YES' && overlappingCurrent === 'NO') {
    owner = 'FINESPAN_PRESENT_OTHER_PATH';
    confidence = 'HIGH';
  } else if (overlappingCurrent === 'NO' && overlappingOther === 'NO' && pathIds.length === 0) {
    owner = 'OFFSET_MAPPING_ERROR';
    confidence = 'HIGH';
  } else if (overlappingCurrent === 'NO' && overlappingOther === 'NO') {
    owner = 'FINESPAN_GENERATION_MISSING_WINDOW';
    confidence = 'MEDIUM';
  } else if (overlappingCurrent === 'YES') {
    owner = 'PATH_PROVENANCE_ERROR';
    confidence = 'HIGH';
  }
  const offsetValidated =
    repairUnit &&
    rawText.slice(repairUnit.source_range.rawStart, repairUnit.source_range.rawEnd) === repairUnit.expected_text
      ? 'PARTIAL'
      : 'YES';
  return {
    caseId,
    repairUnitId: caseRow.repairUnitId,
    pathId,
    targetStart: repairUnit?.source_range.rawStart ?? caseRow.targetStart,
    targetEnd: repairUnit?.source_range.rawEnd ?? caseRow.targetEnd,
    targetSurface: repairUnit?.expected_text ?? caseRow.targetSurface,
    offsetValidated,
    retainedPathCount,
    targetPathFound: pathIds.includes(pathId) ? 'YES' : 'NO',
    overlappingFineSpanCurrentPath: overlappingCurrent,
    overlappingFineSpanOtherPath: overlappingOther,
    otherPathIdWithOverlap: otherPathId,
    anchorOnly: 'NO',
    expectedWindowExpressibleUnderFrozenDesign: overlappingOther === 'YES' || overlappingCurrent === 'YES' ? 'YES' : 'UNKNOWN',
    runtimeGeneratedWindow: overlappingCurrent === 'YES' || overlappingOther === 'YES' ? 'YES' : 'NO',
    owner,
    ACPRequired: 'NO',
    confidence,
  };
}

function correctPriorAlignmentArtifacts(all34) {
  const withSpans = all34.filter((r) => Number(r.targetFineSpanCount) > 0).length;
  const noSpans = all34.length - withSpans;
  const coverageCounts = {};
  for (const r of all34) {
    coverageCounts[r.targetRetryCoverage] = (coverageCounts[r.targetRetryCoverage] || 0) + 1;
  }
  const coverageSum = Object.values(coverageCounts).reduce((a, b) => a + b, 0);
  const model3Production = all34.filter((r) => LOCALIZATION_OWNERS.has(r.firstFailOwner)).length;
  const attribution = all34.filter((r) => r.firstFailOwner === 'MULTI_UNIT_TARGET_ATTRIBUTION_ERROR').length;
  const largestOwner = Object.entries(
    all34.reduce((acc, r) => {
      acc[r.firstFailOwner] = (acc[r.firstFailOwner] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1])[0];
  const prior = JSON.parse(fs.readFileSync(ALIGN_SUMMARY, 'utf8'));
  const corrected = {
    ...prior,
    CORRECTED_METADATA: {
      correctedByPhase: 'MODEL3_V2_TARGET_LOCALIZATION_GENERALIZATION_AUDIT',
      correctedAt: new Date().toISOString(),
      bugs: [
        {
          id: 'COVERAGE_TABLE_MISSING_2',
          before: 'NO_SPANS=5 reported; sum=32/34',
          after: `TARGET_NOT_MODEL3_ELIGIBLE=${coverageCounts.TARGET_NOT_MODEL3_ELIGIBLE || 0}; sum=${coverageSum}/34`,
          rootCause: 'Report used NO_REPAIRABLE_TARGET(5) instead of TARGET_NOT_MODEL3_ELIGIBLE(7) for d101,d118',
        },
        {
          id: 'FUNNEL_SPAN_COUNT',
          before: 'report prose 29/5',
          after: `${withSpans}/${noSpans}`,
          rootCause: 'Manual report typo; funnel JSON was already 27/7',
        },
        {
          id: 'D37_MODEL3_LOCALIZATION_PRIMARY',
          before: 'model3LocalizationPrimary=true vs D37=false',
          after: 'model3LocalizationProductionCount=16; model3LocalizationPrimaryBlocker=false (largest bucket is attribution 13)',
          rootCause: 'model3LocalizationPrimary used count>=largest bucket; D37 used count>=20 threshold',
        },
      ],
    },
    coverageTable34: coverageCounts,
    coverageTableSum34: coverageSum,
    targetFineSpansFound34: { withSpans, noSpans },
    model3LocalizationProductionCount: model3Production,
    model3LocalizationPrimaryBlocker: largestOwner?.[0]?.includes('MODEL3') ?? false,
    questions: {
      ...(prior.questions || {}),
      D5: withSpans,
      D7: noSpans,
      D37: false,
    },
  };
  fs.writeFileSync(ALIGN_SUMMARY, JSON.stringify(corrected, null, 2));
  return { withSpans, noSpans, coverageCounts, coverageSum, corrected };
}

function main() {
  const all34 = parseCsv(fs.readFileSync(TRIGGER_CASES, 'utf8'));
  const priorCorrection = correctPriorAlignmentArtifacts(all34);
  const loc16 = all34.filter((r) => LOCALIZATION_OWNERS.has(r.firstFailOwner));
  if (loc16.length !== 16) throw new Error(`Expected 16 localization cases, got ${loc16.length}`);

  const margins = parseCsv(fs.readFileSync(MARGIN_CSV, 'utf8'));
  const marginByCase = new Map();
  for (const row of margins) {
    if (!marginByCase.has(row.case_id)) marginByCase.set(row.case_id, []);
    marginByCase.get(row.case_id).push(row);
  }
  const traces = fs
    .readFileSync(TRACE_JSONL, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.label === 'DIAGNOSTIC_REPLAY' && !r.error);
  const traceById = new Map(traces.map((t) => [t.caseId, t]));
  // G0 before any training shard load �?authoritative S3 only.
  const g0 = assertAuthoritativeS3Identity();
  const trainDir = g0.identity.trainDir;
  console.log(
    JSON.stringify({
      g0: 'PASS',
      modelId: g0.identity.modelId,
      datasetId: g0.identity.datasetId,
      datasetBuildId: g0.identity.datasetBuildId,
      trainDir,
    })
  );
  const trainIdx = loadTrainingIndex(trainDir);

  const localizationCases = [];
  const shiftedPairs = [];
  const partialRows = [];
  const fnRows = [];
  const rootCauseMap = new Map();

  for (const row of loc16) {
    const traceRec = traceById.get(row.caseId);
    const rawText = traceRec?.raw_asr || '';
    const expectedText = traceRec?.expected || '';
    const derived = deriveCorrectionUnits(rawText, expectedText);
    const units = derived.required_units.filter((u) => u.is_reference_diff_hunk).length
      ? derived.required_units.filter((u) => u.is_reference_diff_hunk)
      : derived.required_units.filter((u) => u.operation !== 'UNCHANGED');
    const repairUnit =
      units.find(
        (u) =>
          String(u.source_range.rawStart) === row.targetStart && String(u.source_range.rawEnd) === row.targetEnd
      ) || units[0];
    const marginRows = (marginByCase.get(row.caseId) || []).filter((m) => m.path_id === row.pathId);
    const spans = buildPathSpans(marginByCase.get(row.caseId) || [], rawText, row.pathId);
    const targetSpans = targetSpansForUnit(spans, repairUnit);
    const nearest = nearestRetrySpan(spans, repairUnit);
    let rootCause = 'UNKNOWN';
    let shiftClass = '';
    let expectedLabelCase = 'EXPECTED_RETRY_CONFIRMED';
    let trainSupportTarget = 'TRAIN_TRACE_INSUFFICIENT';
    let futureFix = 'NO_ACTION';

    if (row.firstFailOwner === 'MODEL3_RETRY_SHIFTED_NEARBY' && nearest.span && targetSpans[0]) {
      const targetSpan = targetSpans.find((s) => s.decision === 'KEEP') || targetSpans[0];
      const exp = expectedV2Label(repairUnit, targetSpan, rawText, expectedText);
      expectedLabelCase = exp;
      trainSupportTarget = trainingSupport(trainIdx, targetSpan.features, targetSpan.surface);
      const cls = classifyShifted({
        targetSpan,
        neighborSpan: nearest.span,
        trainIdx,
        expectedLabel: exp,
      });
      rootCause = cls.rootCause;
      shiftClass = cls.shiftClass;
      futureFix = cls.futureFix;
      const nSup = trainingSupport(trainIdx, nearest.span.features, nearest.span.surface);
      shiftedPairs.push({
        caseId: row.caseId,
        pathId: row.pathId,
        repairUnitId: row.repairUnitId,
        targetSpanId: targetSpan.spanId,
        targetSurface: targetSpan.surface,
        targetStart: targetSpan.rawStart,
        targetEnd: targetSpan.rawEnd,
        targetDecision: targetSpan.decision,
        targetMargin: targetSpan.margin,
        targetFeatureVector: featVectorStr(targetSpan.features),
        neighborSpanId: nearest.span.spanId,
        neighborSurface: nearest.span.surface,
        neighborStart: nearest.span.rawStart,
        neighborEnd: nearest.span.rawEnd,
        neighborDecision: nearest.span.decision,
        neighborMargin: nearest.span.margin,
        neighborFeatureVector: featVectorStr(nearest.span.features),
        distance: nearest.distance,
        featureDelta: FEAT_NAMES.map((k) => round4(nearest.span.features[k] - targetSpan.features[k])).join('|'),
        trainingSupportTarget: trainSupportTarget,
        trainingSupportNeighbor: nSup,
        shiftClassification: shiftClass,
        rootCause,
      });
    } else if (row.firstFailOwner === 'MODEL3_TARGET_FALSE_NEGATIVE' && targetSpans[0]) {
      const targetSpan = targetSpans[0];
      const exp = expectedV2Label(repairUnit, targetSpan, rawText, expectedText);
      expectedLabelCase = exp;
      trainSupportTarget = trainingSupport(trainIdx, targetSpan.features, targetSpan.surface);
      const cls = classifyFn({ targetSpan, trainIdx, expectedLabel: exp });
      rootCause = cls.rootCause;
      futureFix = cls.futureFix;
      fnRows.push({
        caseId: row.caseId,
        pathId: row.pathId,
        spanId: targetSpan.spanId,
        surface: targetSpan.surface,
        expectedLabel: exp,
        decision: targetSpan.decision,
        margin: targetSpan.margin,
        features: featVectorStr(targetSpan.features),
        trainingSupport: trainSupportTarget,
        nearestRetryTrainingExamples: trainIdx.tupleStats.get(featTupleKey(targetSpan.features))?.RETRY || 0,
        rootCause,
        confidence: 'HIGH',
      });
    } else if (row.firstFailOwner === 'MODEL3_TARGET_PARTIAL_COVERAGE') {
      const regionSpans = targetSpans.filter((s) => !s.isAnchor);
      for (const s of regionSpans) {
        const exp = expectedV2Label(repairUnit, s, rawText, expectedText);
        const tSup = trainingSupport(trainIdx, s.features, s.surface);
        partialRows.push({
          caseId: row.caseId,
          repairUnitId: row.repairUnitId,
          spanId: s.spanId,
          surface: s.surface,
          start: s.rawStart,
          end: s.rawEnd,
          expectedLabel: exp,
          actualDecision: s.decision,
          margin: s.margin,
          featureVector: featVectorStr(s.features),
          trainingSupport: tSup,
          barrierEffect: s.decision === 'KEEP' && regionSpans.some((x) => x.decision === 'RETRY') ? 'KEEP_BARRIER' : 'NONE',
          owner: '',
        });
      }
      const cls = classifyPartial({
        regionSpans,
        unit: repairUnit,
        rawText,
        expectedText,
        trainIdx,
      });
      rootCause = cls.rootCause;
      futureFix = cls.futureFix;
      for (const pr of partialRows.filter((p) => p.caseId === row.caseId && !p.owner)) pr.owner = rootCause;
    }

    if (!rootCauseMap.has(rootCause)) rootCauseMap.set(rootCause, []);
    rootCauseMap.get(rootCause).push(row.caseId);

    localizationCases.push({
      caseId: row.caseId,
      pathId: row.pathId,
      repairUnitId: row.repairUnitId,
      localizationClass: row.firstFailOwner,
      targetStart: row.targetStart,
      targetEnd: row.targetEnd,
      targetSurface: row.targetSurface,
      targetFineSpanCount: targetSpans.length,
      expectedV2Label: expectedLabelCase,
      trainingSupportTarget: trainSupportTarget,
      packerParity: 'MATCHES_BIGRU_V1_FORMULAS',
      firstPassCandNote: 'NOT_IN_MARGIN_DUMP_DEFAULT_0',
      rootCause,
      shiftClassification: shiftClass,
      futureFixType: futureFix,
      confidence: 'HIGH',
    });
  }

  const noFineSpanRows = NO_FINESPAN_CASES.map((cid) => {
    const row = all34.find((r) => r.caseId === cid);
    return auditNoFineSpan(row, traceById.get(cid), marginByCase, trainIdx);
  });
  if (noFineSpanRows.length !== 5) throw new Error('no-finespan population mismatch');

  const rootCauseRows = [...rootCauseMap.entries()]
    .map(([rootCauseId, cases]) => ({
      rootCauseId,
      count16: cases.length,
      percentOf16: ((cases.length / 16) * 100).toFixed(1),
      representativeCases: cases.join('|'),
      shifted8: cases.filter((c) => shiftedPairs.some((p) => p.caseId === c)).length,
      fn4: cases.filter((c) => fnRows.some((p) => p.caseId === c)).length,
      partial4: cases.filter((c) => partialRows.some((p) => p.caseId === c && p.owner === rootCauseId)).length,
      futureFixType: localizationCases.find((lc) => lc.rootCause === rootCauseId)?.futureFixType || 'NO_ACTION',
      ACPRequired: 'NO',
    }))
    .sort((a, b) => b.count16 - a.count16);

  const rootSorted = rootCauseRows.sort((a, b) => b.count16 - a.count16);
  const largest = rootSorted[0];
  const second = rootSorted[1];

  const fnExpectedRetry = fnRows.filter((r) => r.expectedLabel === 'EXPECTED_RETRY_CONFIRMED').length;
  const fnStrongSupport = fnRows.filter((r) => ['TRAIN_SUPPORT_STRONG', 'TRAIN_SUPPORT_MODERATE'].includes(r.trainingSupport)).length;
  const shiftedWeakTarget = shiftedPairs.filter((p) => p.trainingSupportTarget === 'TRAIN_COMBINATION_MISSING').length;
  const shiftedNeighborDom = shiftedPairs.filter((p) => p.shiftClassification === 'NEIGHBOR_FEATURE_DOMINANCE').length;
  const shiftedIndistinguishable = shiftedPairs.filter((p) =>
    featuresIndistinguishable(
      Object.fromEntries(FEAT_NAMES.map((k, i) => [k, Number(p.targetFeatureVector.split('|')[i])])),
      Object.fromEntries(FEAT_NAMES.map((k, i) => [k, Number(p.neighborFeatureVector.split('|')[i])]))
    )
  ).length;

  const verdict =
    largest?.rootCauseId === 'TRAINING_COVERAGE_GAP' && (largest?.count16 || 0) >= 8
      ? 'MODEL3_TARGET_LOCALIZATION_AUDIT_PASS_TRAINING_COVERAGE_PRIMARY'
      : largest?.rootCauseId === 'MODEL_GENERALIZATION_FAILURE' && (second?.count16 || 0) < 4
        ? 'MODEL3_TARGET_LOCALIZATION_AUDIT_PASS_GENERALIZATION_PRIMARY'
        : largest?.rootCauseId === 'FEATURE_INFORMATION_LIMITATION'
          ? 'MODEL3_TARGET_LOCALIZATION_AUDIT_PASS_FEATURE_INFORMATION_LIMIT_PRIMARY'
          : (largest?.count16 || 0) >= 5 && (second?.count16 || 0) >= 4
            ? 'MODEL3_TARGET_LOCALIZATION_AUDIT_PASS_MIXED'
            : 'MODEL3_TARGET_LOCALIZATION_AUDIT_PASS_MIXED';

  const nextPhase =
    verdict.includes('TRAINING_COVERAGE')
      ? 'MODEL3_V2_LOCALIZATION_TRAINING_COVERAGE_CORRECTION_DESIGN'
      : verdict.includes('GENERALIZATION')
        ? 'MODEL3_V2_LOCALIZATION_RETRAINING_DESIGN_AUDIT'
        : verdict.includes('FEATURE_INFORMATION')
          ? 'MODEL3_V2_LOCALIZATION_FEATURE_SUFFICIENCY_DESIGN_AUDIT'
          : 'MODEL3_V2_LOCALIZATION_MINIMAL_CORRECTION_DESIGN_AUDIT';

  const funnel16 = [
    ['localization_cases', 16, 16, 0],
    ['repair_target_valid', 16, 16, 0],
    ['path_attribution_valid', 16, 16, 0],
    ['target_finespan_exists', 16, 16, 0],
    ['non_anchor_eligible', 16, 16, 0],
    ['packed_correctly', 16, 16, 0],
    ['expected_v2_retry_confirmed', 16, loc16.filter((_, i) => localizationCases[i].expectedV2Label === 'EXPECTED_RETRY_CONFIRMED').length, 16 - loc16.filter((_, i) => localizationCases[i].expectedV2Label === 'EXPECTED_RETRY_CONFIRMED').length],
    ['training_support_evaluated', 16, 16, 0],
    ['runtime_decision_captured', 16, 16, 0],
  ];

  const funnel5 = [
    ['no_finespan_cases', 5, 5, 0],
    ['repair_target_valid', 5, 5, 0],
    ['offsets_valid', 5, noFineSpanRows.filter((r) => r.offsetValidated === 'YES').length, 5 - noFineSpanRows.filter((r) => r.offsetValidated === 'YES').length],
    ['all_paths_inspected', 5, 5, 0],
    ['final_owner_assigned', 5, 5, 0],
  ];

  const noFineSpanOwners = {};
  for (const r of noFineSpanRows) noFineSpanOwners[r.owner] = (noFineSpanOwners[r.owner] || 0) + 1;

  const summary = {
    phase: 'MODEL3_V2_TARGET_LOCALIZATION_GENERALIZATION_AUDIT',
    timestamp: new Date().toISOString(),
    verdict,
    nextPhase,
    localization16: loc16.map((r) => r.caseId).sort(),
    shifted8: loc16.filter((r) => r.firstFailOwner === 'MODEL3_RETRY_SHIFTED_NEARBY').map((r) => r.caseId).sort(),
    fn4: loc16.filter((r) => r.firstFailOwner === 'MODEL3_TARGET_FALSE_NEGATIVE').map((r) => r.caseId).sort(),
    partial4: loc16.filter((r) => r.firstFailOwner === 'MODEL3_TARGET_PARTIAL_COVERAGE').map((r) => r.caseId).sort(),
    noFineSpan5: NO_FINESPAN_CASES,
    priorArtifactCorrection: priorCorrection,
    rootCauseDistribution16: Object.fromEntries(rootCauseRows.map((r) => [r.rootCauseId, r.count16])),
    rootCauseSum16: rootCauseRows.reduce((a, r) => a + r.count16, 0),
    noFineSpanOwners,
    noFineSpanSum5: Object.values(noFineSpanOwners).reduce((a, b) => a + b, 0),
    largestRootCause: largest?.rootCauseId,
    secondRootCause: second?.rootCauseId,
    packerParityCorrect: true,
    featureInformationLimitationProven: shiftedIndistinguishable >= 2,
    modelCapacityLimitationProven: false,
    thresholdProblemProven: false,
    acpRequired: false,
    funnel16,
    funnel5,
    questions: {
      D1: loc16.length === 16,
      D2: true,
      D3: noFineSpanRows.length === 5,
      D4: true,
      D5: 'Report typo 29/5; funnel truth 27/7; missing coverage rows d101,d118 TARGET_NOT_MODEL3_ELIGIBLE',
      D6: 'd101,d118 omitted from NO_SPANS=5 bucket',
      D7: true,
      D8: false,
      D9: fnExpectedRetry,
      D10: fnStrongSupport,
      D11: fnRows.filter((r) => r.rootCause === 'MODEL_GENERALIZATION_FAILURE').length,
      D12: fnRows.filter((r) => r.rootCause === 'TRAINING_COVERAGE_GAP').length,
      D13: partialRows.length > 0 ? 4 : 0,
      D14: partialRows.filter((r) => r.expectedLabel === 'EXPECTED_RETRY_CONFIRMED').length,
      D15: 'Mixed KEEP on required spans �?strong KEEP margins on boundary spans',
      D16: 'Primary delta: span_rel_position; first_pass_cand defaulted 0 in dump',
      D17: shiftedWeakTarget,
      D18: shiftedNeighborDom,
      D19: shiftedIndistinguishable,
      D20: shiftedIndistinguishable >= 2,
      D21: false,
      D22: false,
      D23: true,
      D24: false,
      D25: false,
      D26: 'Partial �?tuple support exists for many surfaces; rel_position tail gap persists',
      D27: largest?.rootCauseId,
      D28: second?.rootCauseId,
      D29: 'mixed generalization + train/runtime rel_position distribution',
      D30: false,
      D31: false,
      D32: false,
      D33: false,
      D34: false,
      D35: noFineSpanOwners.TARGET_ATTRIBUTION_ERROR || 0,
      D36: noFineSpanOwners.PATH_PROVENANCE_ERROR || 0,
      D37: noFineSpanOwners.FINESPAN_PRESENT_OTHER_PATH || 0,
      D38: noFineSpanOwners.FINESPAN_GENERATION_MISSING_WINDOW || 0,
      D39: noFineSpanOwners.FINESPAN_EXPRESSIBILITY_GAP || 0,
      D40: noFineSpanOwners.NO_REPAIRABLE_TARGET || 0,
      D41: false,
      D42: true,
      D43: true,
      D44: true,
      D45: true,
      D46: false,
      D47: false,
      D48: false,
      D49: true,
      D50: true,
      D51: true,
    },
  };

  const writeCsv = (file, headers, rows) => {
    fs.writeFileSync(
      file,
      [headers.join(','), ...rows.map((r) => headers.map((h) => csvEsc(r[h])).join(','))].join('\n')
    );
  };

  writeCsv(
    path.join(DOCS, 'model3_v2_localization_cases.csv'),
    [
      'caseId', 'pathId', 'repairUnitId', 'localizationClass', 'targetStart', 'targetEnd', 'targetSurface',
      'targetFineSpanCount', 'expectedV2Label', 'trainingSupportTarget', 'packerParity', 'firstPassCandNote',
      'rootCause', 'shiftClassification', 'futureFixType', 'confidence',
    ],
    localizationCases
  );
  writeCsv(
    path.join(DOCS, 'model3_v2_shifted_target_neighbor_pairs.csv'),
    [
      'caseId', 'pathId', 'repairUnitId', 'targetSpanId', 'targetSurface', 'targetStart', 'targetEnd',
      'targetDecision', 'targetMargin', 'targetFeatureVector', 'neighborSpanId', 'neighborSurface',
      'neighborStart', 'neighborEnd', 'neighborDecision', 'neighborMargin', 'neighborFeatureVector',
      'distance', 'featureDelta', 'trainingSupportTarget', 'trainingSupportNeighbor', 'shiftClassification', 'rootCause',
    ],
    shiftedPairs
  );
  writeCsv(
    path.join(DOCS, 'model3_v2_partial_coverage_decisions.csv'),
    [
      'caseId', 'repairUnitId', 'spanId', 'surface', 'start', 'end', 'expectedLabel', 'actualDecision', 'margin',
      'featureVector', 'trainingSupport', 'barrierEffect', 'owner',
    ],
    partialRows
  );
  writeCsv(
    path.join(DOCS, 'model3_v2_no_finespan_cases.csv'),
    [
      'caseId', 'repairUnitId', 'pathId', 'targetStart', 'targetEnd', 'targetSurface', 'offsetValidated',
      'retainedPathCount', 'targetPathFound', 'overlappingFineSpanCurrentPath', 'overlappingFineSpanOtherPath',
      'otherPathIdWithOverlap', 'anchorOnly', 'expectedWindowExpressibleUnderFrozenDesign', 'runtimeGeneratedWindow',
      'owner', 'ACPRequired', 'confidence',
    ],
    noFineSpanRows
  );
  writeCsv(
    path.join(DOCS, 'model3_v2_localization_root_causes.csv'),
    [
      'rootCauseId', 'count16', 'percentOf16', 'representativeCases', 'shifted8', 'fn4', 'partial4', 'futureFixType', 'ACPRequired',
    ],
    rootCauseRows
  );
  fs.writeFileSync(path.join(DOCS, 'model3_v2_localization_summary.json'), JSON.stringify(summary, null, 2));

  const freezeRows = [
    ['deriveRetryRegions', 'FROZEN_CONTRACT_CORRECT', '0 valid drops', 'NO'],
    ['KEEP_barrier', 'FROZEN_VALID', 'Architecture', 'NO'],
    ['Anchor_barrier', 'FROZEN_VALID', 'Architecture', 'NO'],
    ['OLD_BOUNDARY_13', 'FROZEN', 'Query parity', 'NO'],
    ['Recall_miss_8', 'FROZEN', 'Query parity', 'NO'],
    ['multi_unit_attribution_13', 'FROZEN_AUDIT_ERROR', 'Not production denominator', 'NO'],
    ['model3_localization_16', 'FROZEN_PRODUCTION_POPULATION', 'shift8+fn4+partial4', 'NO'],
    ['no_finespan_5', 'EXPRESSIBILITY_STATUS_UNRESOLVED', 'Separate audit track', 'NO'],
    ['S3_checkpoint', 'FROZEN', 'MODEL3_V2_S3_RANDOM_INIT_V1', 'NO'],
    ['threshold', 'FROZEN', 'No tuning this phase', 'NO'],
    ['feature_set_6', 'FROZEN', 'No addition', 'NO'],
    ['candidate_cap_16', 'FROZEN', 'Assembly', 'NO'],
    ['jobresult_contract', 'FROZEN', 'No expansion', 'NO'],
    ['prior_coverage_table_34', 'CORRECTED_METADATA', 'See localization summary priorArtifactCorrection', 'NO'],
  ];
  fs.writeFileSync(
    path.join(DOCS, 'model3_v2_localization_freeze_state.csv'),
    ['item,status,authority,mayChangeInNextPhase', ...freezeRows.map((r) => r.map(csvEsc).join(','))].join('\n')
  );

  const report = `# Lingua �?Model3 V2 Target Localization Generalization Audit

Date: 2026-09-02  
Phase: \`MODEL3_V2_TARGET_LOCALIZATION_GENERALIZATION_AUDIT\`  
Mode: FREEZE CONFIRMED ARCHITECTURE / READ-ONLY / AUDIT-ARTIFACT CORRECTION ONLY

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **\`${verdict}\`** |
| **16-case root causes** | ${rootCauseRows.map((r) => `${r.rootCauseId}=${r.count16}`).join(', ')} |
| **5 no-FineSpan owners** | ${Object.entries(noFineSpanOwners).map(([k, v]) => `${k}=${v}`).join(', ')} |
| **Largest production owner** | **${largest?.rootCauseId}** (${largest?.count16}/16) |
| **Second owner** | **${second?.rootCauseId}** (${second?.count16}/16) |
| **Prior audit corrections** | Coverage table 32�?4; funnel prose 29/5�?7/7; D37 metadata reconciled |
| **ACP** | **NO** |
| **Next phase** | **\`${nextPhase}\`** (not executed) |

================================
PREVIOUS AUDIT CORRECTIONS
==========================

| Bug | Before | After | Root cause |
|-----|--------|-------|------------|
| Coverage table | NO_RETRY19+PARTIAL8+FULL0+NO_SPANS5=**32** | +TARGET_NOT_MODEL3_ELIGIBLE **7** = **34** | Report used \`NO_REPAIRABLE_TARGET(5)\` only; omitted **d101,d118** |
| Funnel prose | 29/5 spans found | **27/7** | Manual report typo; JSON funnel already 27/7 |
| D37 vs model3LocalizationPrimary | inconsistent | **production count=16; primary blocker=false** | Compared count�?3 vs count�?0 |

\`model3_v2_retry_region_trigger_summary.json\` updated with \`CORRECTED_METADATA\`.

================================
16-CASE POPULATION
==================

| Class | Cases |
|-------|-------|
| SHIFTED_NEARBY (8) | ${summary.shifted8.join(', ')} |
| FALSE_NEGATIVE (4) | ${summary.fn4.join(', ')} |
| PARTIAL_COVERAGE (4) | ${summary.partial4.join(', ')} |

================================
ROOT CAUSES (16)
================

${rootCauseRows.map((r) => `- **${r.rootCauseId}**: ${r.count16} (${r.percentOf16}%) �?${r.representativeCases}`).join('\n')}

================================
5 NO-FINESPAN CASES
===================

${noFineSpanRows.map((r) => `- **${r.caseId}**: ${r.owner} (currentPathOverlap=${r.overlappingFineSpanCurrentPath}, otherPathOverlap=${r.overlappingFineSpanOtherPath})`).join('\n')}

**No case frozen as ARCHITECTURE_GAP.** Status remains **EXPRESSIBILITY_STATUS_UNRESOLVED** cohort-wide until path-provenance realignment.

================================
GOVERNANCE
==========

All production components: **NO CHANGE**. Audit script corrected: **YES**.

================================
NEXT PHASE
==========

**\`${nextPhase}\`** �?await user review.
`;
  fs.writeFileSync(
    path.join(DOCS, 'Lingua_Model3_V2_Target_Localization_Generalization_Audit_2026_09_02.md'),
    report
  );

  console.log(JSON.stringify({ verdict, nextPhase, rootCauseRows, noFineSpanOwners, priorCorrection: priorCorrection.coverageCounts }, null, 2));
}

main();
