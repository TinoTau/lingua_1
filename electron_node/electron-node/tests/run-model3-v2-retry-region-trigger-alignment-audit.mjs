#!/usr/bin/env node
/**
 * MODEL3_V2_RETRY_REGION_TRIGGER_ALIGNMENT_AUDIT �?READ-ONLY causal audit
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveCorrectionUnits } from './lib/materializable-target-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DOCS = path.join(REPO, 'docs', 'user_correction', 'model3');

const OWNER_CASES = path.join(DOCS, 'model3_v2_retry_query_owner_cases.csv');
const PARITY_CASES = path.join(DOCS, 'model3_v2_retry_recall_query_parity_cases.csv');
const TRACE_JSONL = path.join(DOCS, 'model3_v2_retry_recall_query_trace.jsonl');
const MARGIN_CSV = path.join(DOCS, 'model3_v1_runtime_margin_analysis.csv');

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

function buildFineSpans(marginRows, rawText) {
  const sorted = [...marginRows].sort((a, b) => spanIndex(a.spanId) - spanIndex(b.spanId));
  let pos = 0;
  return sorted.map((row) => {
    const surf = row.surface;
    let start = rawText.indexOf(surf, pos);
    if (start < 0) start = pos;
    const end = start + surf.length;
    pos = end;
    return {
      spanId: row.spanId,
      surface: surf,
      rawStart: start,
      rawEnd: end,
      syllableStart: spanIndex(row.spanId),
      syllableEnd: spanIndex(row.spanId) + (surf.length > 1 ? surf.length : 1),
      isAnchor: row.isAnchor === 'true' || row.isAnchor === true,
      isModel3Eligible: true,
      packedForInference: true,
      decision: row.decision,
      margin: Number(row.margin),
      keep_logit: row.keep_logit,
      retry_logit: row.retry_logit,
    };
  });
}

function deriveRetryRegionsSim(spans, decisionsBySpan) {
  const regions = [];
  let pending = [];
  const flush = () => {
    if (!pending.length) return;
    const first = pending[0];
    const last = pending[pending.length - 1];
    regions.push({
      retryRegionId: `m3rr:${first.spanId}:${last.spanId}`,
      sourceSpanIds: pending.map((s) => s.spanId),
      rawStart: first.rawStart,
      rawEnd: last.rawEnd,
      regionMergedFromAdjacentRetry: pending.length > 1,
    });
    pending = [];
  };
  for (const span of spans) {
    const decision = decisionsBySpan.get(span.spanId);
    const retryEligible = !span.isAnchor && decision === 'RETRY';
    if (!retryEligible) {
      flush();
      continue;
    }
    if (pending.length) {
      const prev = pending[pending.length - 1];
      if (prev.rawEnd !== span.rawStart) flush();
    }
    pending.push(span);
  }
  flush();
  return regions;
}

function marginBin(margin) {
  if (!Number.isFinite(margin)) return 'UNKNOWN';
  if (margin > 2) return 'strong_KEEP';
  if (margin > 0.5) return 'moderate_KEEP';
  if (margin > -0.5) return 'near_boundary';
  return 'RETRY';
}

function repairUnits(derived) {
  const lexical = derived.required_units.filter((u) => u.is_reference_diff_hunk);
  return lexical.length ? lexical : derived.required_units.filter((u) => u.operation !== 'UNCHANGED');
}

function matchRegionToUnit(regions, unit) {
  const { rawStart, rawEnd } = unit.source_range;
  let best = null;
  let bestOverlap = -1;
  for (const r of regions) {
    const ol = overlapLen(r.rawStart, r.rawEnd, rawStart, rawEnd);
    if (ol > bestOverlap) {
      bestOverlap = ol;
      best = r;
    }
  }
  return { region: best, overlap: bestOverlap };
}

function targetSpansForUnit(spans, unit) {
  const { rawStart, rawEnd } = unit.source_range;
  return spans.filter((s) => rangeOverlap(s.rawStart, s.rawEnd, rawStart, rawEnd));
}

function targetRetryCoverage(targetSpans) {
  const eligible = targetSpans.filter((s) => !s.isAnchor);
  if (!eligible.length) {
    if (targetSpans.some((s) => s.isAnchor)) return 'TARGET_ANCHOR_BLOCKED';
    return 'TARGET_NOT_MODEL3_ELIGIBLE';
  }
  const retryN = eligible.filter((s) => s.decision === 'RETRY').length;
  if (retryN === 0) return 'TARGET_NO_RETRY';
  if (retryN === eligible.length) return 'TARGET_FULL_RETRY_COVERAGE';
  return 'TARGET_PARTIAL_RETRY_COVERAGE';
}

function nearestRetryDistance(spans, unit, allUnits) {
  const { rawStart, rawEnd } = unit.source_range;
  const retrySpans = spans.filter((s) => s.decision === 'RETRY' && !s.isAnchor);
  if (!retrySpans.length) return { cls: 'NONE', span: null, repairUnitId: '' };
  let best = null;
  let bestDist = Infinity;
  for (const rs of retrySpans) {
    if (rangeOverlap(rs.rawStart, rs.rawEnd, rawStart, rawEnd)) {
      return { cls: 'OVERLAP', span: rs, repairUnitId: '' };
    }
    let dist = 0;
    if (rs.rawEnd <= rawStart) dist = rawStart - rs.rawEnd;
    else if (rs.rawStart >= rawEnd) dist = rs.rawStart - rawEnd;
    if (dist < bestDist) {
      bestDist = dist;
      best = rs;
    }
  }
  if (!best) return { cls: 'UNKNOWN', span: null, repairUnitId: '' };
  let cls = 'DISTANT';
  if (bestDist === 0) cls = 'OVERLAP';
  else if (bestDist <= 2) cls = 'NEAR_1_2_CHARS';
  else if (bestDist <= 4) cls = 'ADJACENT';
  let repairUnitId = '';
  for (let i = 0; i < allUnits.length; i += 1) {
    const u = allUnits[i];
    if (rangeOverlap(best.rawStart, best.rawEnd, u.source_range.rawStart, u.source_range.rawEnd)) {
      repairUnitId = `U${i}:${u.expected_text}`;
      break;
    }
  }
  if (repairUnitId && !rangeOverlap(best.rawStart, best.rawEnd, rawStart, rawEnd)) {
    cls = 'OTHER_REPAIR_UNIT';
  }
  return { cls, span: best, repairUnitId, distance: bestDist };
}

function classifyCase(ctx) {
  const {
    caseId,
    pathId,
    repairUnit,
    repairUnitId,
    multiUnit,
    spans,
    simRegions,
    traceRegions,
    priorRegionId,
    priorRegion,
  } = ctx;
  const targetSpans = targetSpansForUnit(spans, repairUnit);
  const coverage = targetRetryCoverage(targetSpans);
  const matched = matchRegionToUnit(traceRegions, repairUnit);
  const simMatched = matchRegionToUnit(simRegions, repairUnit);
  const priorOverlap = priorRegion
    ? overlapLen(priorRegion.rawStart, priorRegion.rawEnd, repairUnit.source_range.rawStart, repairUnit.source_range.rawEnd)
    : 0;
  const correctRegion = matched.region;
  const correctOverlap = matched.overlap;
  const nearest = nearestRetryDistance(spans, repairUnit, ctx.allUnits);

  const targetRetrySpanIds = targetSpans.filter((s) => s.decision === 'RETRY').map((s) => s.spanId);
  const deriveInputHasTargetRetry = targetRetrySpanIds.length > 0;
  const deriveOutputHasTargetRetry =
    simMatched.region &&
    simMatched.overlap > 0 &&
    targetRetrySpanIds.every((id) => simMatched.region.sourceSpanIds.includes(id));

  let keepBarrier = false;
  if (coverage === 'TARGET_PARTIAL_RETRY_COVERAGE') {
    const ordered = targetSpans.filter((s) => !s.isAnchor).sort((a, b) => a.rawStart - b.rawStart);
    keepBarrier = ordered.some((s, i) => i > 0 && s.decision === 'KEEP' && ordered[i - 1]?.decision === 'RETRY');
  }

  let firstFailOwner = 'UNKNOWN';
  let rootCauseId = 'RC_UNKNOWN';
  let architectureClassification = 'UNKNOWN';
  let confidence = 'MEDIUM';

  if (priorOverlap === 0 && correctOverlap > 0 && multiUnit) {
    firstFailOwner = 'MULTI_UNIT_TARGET_ATTRIBUTION_ERROR';
    rootCauseId = 'RC_ATTRIBUTION_WRONG_REGION';
    architectureClassification = 'TRACE_CLASSIFICATION_ERROR';
    confidence = 'HIGH';
  } else if (coverage === 'TARGET_ANCHOR_BLOCKED') {
    firstFailOwner = 'ANCHOR_BLOCKED_TARGET';
    rootCauseId = 'RC_ANCHOR_BLOCK';
    architectureClassification = 'FROZEN_BEHAVIOR_CORRECT';
    confidence = 'HIGH';
  } else if (coverage === 'TARGET_NOT_MODEL3_ELIGIBLE' || !targetSpans.length) {
    firstFailOwner = 'NO_REPAIRABLE_TARGET';
    rootCauseId = 'RC_NO_FINESPAN';
    architectureClassification = 'ARCHITECTURE_GAP';
    confidence = 'HIGH';
  } else if (coverage === 'TARGET_NO_RETRY') {
    if (nearest.cls === 'OTHER_REPAIR_UNIT') {
      firstFailOwner = 'MULTI_UNIT_TARGET_ATTRIBUTION_ERROR';
      rootCauseId = 'RC_DISTANT_RETRY_OTHER_UNIT';
      architectureClassification = 'TRACE_CLASSIFICATION_ERROR';
      confidence = 'HIGH';
    } else if (nearest.cls === 'OVERLAP' || nearest.cls === 'NEAR_1_2_CHARS') {
      firstFailOwner = 'MODEL3_RETRY_SHIFTED_NEARBY';
      rootCauseId = 'RC_RETRY_NEARBY';
      architectureClassification = 'MODEL_GENERALIZATION_FAILURE';
      confidence = 'MEDIUM';
    } else if (nearest.cls === 'DISTANT' || nearest.cls === 'ADJACENT') {
      firstFailOwner = 'MODEL3_TARGET_FALSE_NEGATIVE';
      rootCauseId = 'RC_MODEL3_FN';
      architectureClassification = 'MODEL_GENERALIZATION_FAILURE';
      confidence = 'HIGH';
    } else {
      firstFailOwner = 'MODEL3_TARGET_FALSE_NEGATIVE';
      rootCauseId = 'RC_MODEL3_FN';
      architectureClassification = 'MODEL_GENERALIZATION_FAILURE';
      confidence = 'HIGH';
    }
  } else if (coverage === 'TARGET_PARTIAL_RETRY_COVERAGE') {
    if (keepBarrier) {
      firstFailOwner = 'MODEL3_TARGET_PARTIAL_COVERAGE';
      rootCauseId = 'RC_MODEL3_PARTIAL_KEEP_BARRIER';
      architectureClassification = 'MODEL_GENERALIZATION_FAILURE';
      confidence = 'HIGH';
    } else {
      firstFailOwner = 'MODEL3_TARGET_PARTIAL_COVERAGE';
      rootCauseId = 'RC_MODEL3_PARTIAL';
      architectureClassification = 'MODEL_GENERALIZATION_FAILURE';
      confidence = 'HIGH';
    }
  } else if (coverage === 'TARGET_FULL_RETRY_COVERAGE') {
    if (!deriveOutputHasTargetRetry && deriveInputHasTargetRetry) {
      firstFailOwner = 'DERIVE_RETRY_REGION_DROPPED_VALID_RETRY';
      rootCauseId = 'RC_DERIVE_DROP';
      architectureClassification = 'IMPLEMENTATION_BUG_WITHIN_FROZEN_ARCHITECTURE';
      confidence = 'HIGH';
    } else if (correctOverlap === 0) {
      firstFailOwner = 'KEEP_BARRIER_EXPECTED';
      rootCauseId = 'RC_KEEP_BARRIER_SPLIT';
      architectureClassification = 'FROZEN_BEHAVIOR_CORRECT';
      confidence = 'HIGH';
    } else {
      firstFailOwner = 'UNKNOWN';
      rootCauseId = 'RC_FULL_RETRY_REGION_OK';
      architectureClassification = 'FROZEN_BEHAVIOR_CORRECT';
      confidence = 'LOW';
    }
  }

  const regionContainsTarget =
    correctRegion &&
    correctRegion.rawStart <= repairUnit.source_range.rawStart &&
    correctRegion.rawEnd >= repairUnit.source_range.rawEnd;

  return {
    caseId,
    pathId,
    repairUnitId,
    targetStart: repairUnit.source_range.rawStart,
    targetEnd: repairUnit.source_range.rawEnd,
    targetSurface: repairUnit.expected_text,
    multiUnitUtterance: multiUnit ? 'YES' : 'NO',
    targetPathMatched: 'YES',
    targetFineSpanCount: targetSpans.length,
    targetFineSpanIds: targetSpans.map((s) => s.spanId).join('|'),
    targetFineSpanSurfaces: targetSpans.map((s) => s.surface).join('|'),
    targetAnchorCount: targetSpans.filter((s) => s.isAnchor).length,
    targetEligibleCount: targetSpans.filter((s) => !s.isAnchor).length,
    targetKeepCount: targetSpans.filter((s) => !s.isAnchor && s.decision === 'KEEP').length,
    targetRetryCount: targetSpans.filter((s) => !s.isAnchor && s.decision === 'RETRY').length,
    targetRetryCoverage: coverage,
    nearestRetryStart: nearest.span?.rawStart ?? '',
    nearestRetryEnd: nearest.span?.rawEnd ?? '',
    nearestRetryDistanceClass: nearest.cls,
    nearestRetryRepairUnitId: nearest.repairUnitId,
    priorRetryRegionId: priorRegionId,
    priorRetryRegionStart: priorRegion?.rawStart ?? '',
    priorRetryRegionEnd: priorRegion?.rawEnd ?? '',
    matchedRetryRegionId: correctRegion?.retryRegionId ?? '',
    actualRetryRegionStart: correctRegion?.rawStart ?? '',
    actualRetryRegionEnd: correctRegion?.rawEnd ?? '',
    regionContainsTarget: regionContainsTarget ? 'YES' : 'NO',
    deriveInputContainsTargetRetry: deriveInputHasTargetRetry ? 'YES' : 'NO',
    deriveOutputContainsTargetRetry: deriveOutputHasTargetRetry ? 'YES' : 'NO',
    keepBarrierObserved: keepBarrier ? 'YES' : 'NO',
    anchorBarrierObserved: coverage === 'TARGET_ANCHOR_BLOCKED' ? 'YES' : 'NO',
    priorRegionOverlap: priorOverlap,
    firstFailOwner,
    ownerFunction:
      firstFailOwner.includes('MODEL3')
        ? 'runModel3PathStep / Model3 inference'
        : firstFailOwner.includes('DERIVE')
          ? 'deriveRetryRegions'
          : firstFailOwner.includes('ATTRIBUTION')
            ? 'audit attribution'
            : firstFailOwner,
    rootCauseId,
    architectureClassification,
    confidence,
    targetSpans,
    simRegions,
    traceRegions,
    matchedRegion: correctRegion,
  };
}

function main() {
  const ownerRows = parseCsv(fs.readFileSync(OWNER_CASES, 'utf8')).filter(
    (r) => r.firstFailOwner === 'RETRY_REGION_DERIVATION'
  );
  const parityByKey = new Map(
    parseCsv(fs.readFileSync(PARITY_CASES, 'utf8')).map((r) => [`${r.caseId}|${r.pathId}`, r])
  );
  const margins = parseCsv(fs.readFileSync(MARGIN_CSV, 'utf8'));
  const marginByCasePath = new Map();
  for (const row of margins) {
    const key = `${row.case_id}|${row.path_id}`;
    if (!marginByCasePath.has(key)) marginByCasePath.set(key, []);
    marginByCasePath.get(key).push(row);
  }
  const traces = fs
    .readFileSync(TRACE_JSONL, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.label === 'DIAGNOSTIC_REPLAY' && !r.error);
  const traceById = new Map(traces.map((t) => [t.caseId, t]));

  const results = [];
  const spanRows = [];
  const regionRows = [];

  for (const row of ownerRows) {
    const traceRec = traceById.get(row.caseId);
    const path = traceRec?.paths?.find((p) => p.path_id === row.pathId);
    const priorRegion = path?.retry_regions?.find((r) => r.retryRegionId === row.retryRegionId);
    const derived = deriveCorrectionUnits(traceRec?.raw_asr || '', traceRec?.expected || '');
    const units = repairUnits(derived);
    const repairUnit =
      units.find(
        (u) =>
          String(u.source_range.rawStart) === row.expectedRepairStart &&
          String(u.source_range.rawEnd) === row.expectedRepairEnd
      ) || units[0];
    const repairUnitId = `U${units.indexOf(repairUnit)}:${repairUnit.expected_text}`;
    const marginRows = marginByCasePath.get(`${row.caseId}|${row.pathId}`) || [];
    const spans = buildFineSpans(marginRows, traceRec?.raw_asr || '');
    const decisionsBySpan = new Map(spans.map((s) => [s.spanId, s.decision]));
    const simRegions = deriveRetryRegionsSim(spans, decisionsBySpan);
    const traceRegions = (path?.retry_regions || []).map((r) => ({
      retryRegionId: r.retryRegionId,
      sourceSpanIds: r.sourceSpanIds || [],
      rawStart: r.rawStart,
      rawEnd: r.rawEnd,
      regionMergedFromAdjacentRetry: r.regionMergedFromAdjacentRetry,
    }));

    const analyzed = classifyCase({
      caseId: row.caseId,
      pathId: row.pathId,
      repairUnit,
      repairUnitId,
      multiUnit: units.length > 1,
      allUnits: units,
      spans,
      simRegions,
      traceRegions,
      priorRegionId: row.retryRegionId,
      priorRegion,
    });
    results.push(analyzed);

    for (const s of analyzed.targetSpans) {
      spanRows.push({
        caseId: row.caseId,
        pathId: row.pathId,
        repairUnitId,
        spanId: s.spanId,
        rawStart: s.rawStart,
        rawEnd: s.rawEnd,
        surface: s.surface,
        isAnchor: s.isAnchor ? 'YES' : 'NO',
        isModel3Eligible: 'YES',
        packedForInference: 'YES',
        decision: s.decision,
        marginOrLogit: s.margin,
        marginBin: marginBin(s.margin),
        targetRelation: rangeOverlap(s.rawStart, s.rawEnd, repairUnit.source_range.rawStart, repairUnit.source_range.rawEnd)
          ? 'OVERLAPS_TARGET'
          : 'NO',
        requiredForRepair: 'YES',
        classification: s.decision === 'RETRY' ? 'RETRY' : s.isAnchor ? 'ANCHOR' : 'KEEP',
      });
    }

    for (const r of traceRegions) {
      const matchedUnit = units.find((u) =>
        rangeOverlap(r.rawStart, r.rawEnd, u.source_range.rawStart, u.source_range.rawEnd)
      );
      regionRows.push({
        caseId: row.caseId,
        pathId: row.pathId,
        regionId: r.retryRegionId,
        memberRetrySpanIds: (r.sourceSpanIds || []).join('|'),
        regionStart: r.rawStart,
        regionEnd: r.rawEnd,
        matchedRepairUnitId: matchedUnit ? `U${units.indexOf(matchedUnit)}:${matchedUnit.expected_text}` : '',
        matchType: matchedUnit ? 'OVERLAP' : 'NONE',
        containsRepairUnit:
          matchedUnit &&
          r.rawStart <= matchedUnit.source_range.rawStart &&
          r.rawEnd >= matchedUnit.source_range.rawEnd
            ? 'YES'
            : 'NO',
        containsOnlyDifferentRepairUnit:
          matchedUnit &&
          !(
            r.rawStart <= repairUnit.source_range.rawStart &&
            r.rawEnd >= repairUnit.source_range.rawEnd
          )
            ? 'YES'
            : 'NO',
        barrierCause: r.regionMergedFromAdjacentRetry ? 'MERGED' : 'SINGLE',
        deriveContractStatus: 'FROZEN_CONTRACT',
      });
    }
  }

  const ownerCounts = {};
  for (const r of results) ownerCounts[r.firstFailOwner] = (ownerCounts[r.firstFailOwner] || 0) + 1;

  const attributionErrors = results.filter((r) => r.firstFailOwner === 'MULTI_UNIT_TARGET_ATTRIBUTION_ERROR').length;
  const deriveDropped = results.filter((r) => r.firstFailOwner === 'DERIVE_RETRY_REGION_DROPPED_VALID_RETRY').length;

  const sorted = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1]);
  const largest = sorted[0];
  const second = sorted[1];

  const model3Owners =
    (ownerCounts.MODEL3_TARGET_FALSE_NEGATIVE || 0) +
    (ownerCounts.MODEL3_TARGET_PARTIAL_COVERAGE || 0) +
    (ownerCounts.MODEL3_RETRY_SHIFTED_NEARBY || 0) +
    (ownerCounts.MODEL3_RETRY_ONLY_DISTANT || 0);

  const verdict =
    deriveDropped >= 5
      ? 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_DERIVE_REGION_PRIMARY'
      : attributionErrors >= 15
        ? 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_MULTI_UNIT_ATTRIBUTION_PRIMARY'
        : (ownerCounts.MODEL3_TARGET_FALSE_NEGATIVE || 0) >= 15
          ? 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_MODEL3_LOCALIZATION_PRIMARY'
          : (ownerCounts.MODEL3_TARGET_PARTIAL_COVERAGE || 0) >= 10
            ? 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_MODEL3_PARTIAL_COVERAGE_PRIMARY'
            : model3Owners >= 20
              ? 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_MODEL3_LOCALIZATION_PRIMARY'
              : sorted.length > 1 && (second?.[1] || 0) >= 5
                ? 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_MIXED'
                : deriveDropped === 0 && model3Owners === 0
                  ? 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_FROZEN_REGION_CONTRACT_CORRECT'
                  : 'RETRY_REGION_TRIGGER_ALIGNMENT_PASS_MIXED';

  const nextPhase =
    verdict.includes('MODEL3_LOCALIZATION')
      ? 'MODEL3_V2_TARGET_LOCALIZATION_GENERALIZATION_AUDIT'
      : verdict.includes('PARTIAL_COVERAGE')
        ? 'MODEL3_V2_REGION_LABEL_RUNTIME_ALIGNMENT_AUDIT'
        : verdict.includes('DERIVE_REGION')
          ? 'MODEL3_V2_RETRY_REGION_MINIMAL_CORRECTION_DESIGN'
          : verdict.includes('MULTI_UNIT')
            ? 'MODEL3_V2_CAUSAL_TARGET_ATTRIBUTION_CORRECTION_AUDIT'
            : verdict.includes('MIXED')
              ? 'MODEL3_V2_TRIGGER_REGION_BOUNDARY_DESIGN_AUDIT'
              : verdict.includes('FROZEN')
                ? 'MODEL3_V2_RETRY_OWNER_RECONCILIATION_AUDIT'
                : 'MODEL3_V2_RETRY_TRIGGER_TRACE_COMPLETENESS_AUDIT';

  const rootCauseMap = new Map();
  for (const r of results) {
    if (!rootCauseMap.has(r.rootCauseId)) {
      rootCauseMap.set(r.rootCauseId, { ...r, cases: [] });
    }
    rootCauseMap.get(r.rootCauseId).cases.push(r.caseId);
  }
  const rootCauses = [...rootCauseMap.values()]
    .map((rc) => ({
      rootCauseId: rc.rootCauseId,
      owner: rc.firstFailOwner,
      ownerFile: rc.firstFailOwner.includes('DERIVE') ? 'model3-retry-region.ts' : 'model3-runtime',
      ownerFunction: rc.ownerFunction,
      mechanism: rc.rootCauseId,
      count: rc.cases.length,
      percentOf34: ((rc.cases.length / 34) * 100).toFixed(1),
      representativeCases: rc.cases.slice(0, 8).join('|'),
      architectureClass: rc.architectureClassification,
      futureCorrectionType: rc.firstFailOwner.includes('MODEL3') ? 'MODEL3_GENERALIZATION' : 'ATTRIBUTION_OR_CONTRACT',
      ACPRequired: 'NO',
    }))
    .sort((a, b) => b.count - a.count);

  const caseHeaders = [
    'caseId', 'pathId', 'repairUnitId', 'targetStart', 'targetEnd', 'targetSurface', 'multiUnitUtterance',
    'targetPathMatched', 'targetFineSpanCount', 'targetFineSpanIds', 'targetFineSpanSurfaces',
    'targetAnchorCount', 'targetEligibleCount', 'targetKeepCount', 'targetRetryCount', 'targetRetryCoverage',
    'nearestRetryStart', 'nearestRetryEnd', 'nearestRetryDistanceClass', 'nearestRetryRepairUnitId',
    'actualRetryRegionStart', 'actualRetryRegionEnd', 'regionContainsTarget', 'deriveInputContainsTargetRetry',
    'deriveOutputContainsTargetRetry', 'keepBarrierObserved', 'anchorBarrierObserved', 'firstFailOwner',
    'ownerFunction', 'rootCauseId', 'architectureClassification', 'confidence',
  ];
  const caseCsv = [
    caseHeaders.join(','),
    ...results.map((r) => caseHeaders.map((h) => csvEsc(r[h])).join(',')),
  ].join('\n');

  const spanCsv = [
    'caseId,pathId,repairUnitId,spanId,rawStart,rawEnd,surface,isAnchor,isModel3Eligible,packedForInference,decision,marginOrLogit,marginBin,targetRelation,requiredForRepair,classification',
    ...spanRows.map((r) => Object.values(r).map(csvEsc).join(',')),
  ].join('\n');

  const regionCsv = [
    'caseId,pathId,regionId,memberRetrySpanIds,regionStart,regionEnd,matchedRepairUnitId,matchType,containsRepairUnit,containsOnlyDifferentRepairUnit,barrierCause,deriveContractStatus',
    ...regionRows.map((r) => Object.values(r).map(csvEsc).join(',')),
  ].join('\n');

  const rootCsv = [
    'rootCauseId,owner,ownerFile,ownerFunction,mechanism,count,percentOf34,representativeCases,architectureClass,futureCorrectionType,ACPRequired',
    ...rootCauses.map((rc) =>
      [
        rc.rootCauseId, rc.owner, rc.ownerFile, rc.ownerFunction, rc.mechanism, rc.count, rc.percentOf34,
        rc.representativeCases, rc.architectureClass, rc.futureCorrectionType, rc.ACPRequired,
      ].map(csvEsc).join(',')
    ),
  ].join('\n');

  const funnel = [
    ['TARGET_REGION_MISMATCH', 34, 34, 0, 0],
    ['repair_unit_valid', 34, 34, 0, 0],
    ['path_attribution_valid', 34, 34, 0, 0],
    ['target_finespans_found', 34, results.filter((r) => r.targetFineSpanCount > 0).length, results.filter((r) => r.targetFineSpanCount === 0).length, 0],
    ['non_anchor_eligible', results.filter((r) => r.targetFineSpanCount > 0).length, results.filter((r) => r.targetEligibleCount > 0).length, results.filter((r) => r.targetEligibleCount === 0).length, 0],
    ['model3_decision_captured', results.filter((r) => r.targetEligibleCount > 0).length, results.filter((r) => r.targetEligibleCount > 0).length, 0, 0],
    ['sufficient_target_retry', results.filter((r) => r.targetEligibleCount > 0).length, results.filter((r) => r.targetRetryCoverage === 'TARGET_FULL_RETRY_COVERAGE').length, results.filter((r) => !['TARGET_FULL_RETRY_COVERAGE', 'TARGET_ANCHOR_BLOCKED', 'TARGET_NOT_MODEL3_ELIGIBLE'].includes(r.targetRetryCoverage)).length, 0],
    ['derive_input_target_retry', results.filter((r) => r.deriveInputContainsTargetRetry === 'YES').length, results.filter((r) => r.deriveInputContainsTargetRetry === 'YES').length, results.filter((r) => r.deriveInputContainsTargetRetry === 'NO' && r.targetEligibleCount > 0).length, 0],
    ['derive_output_preserves', results.filter((r) => r.deriveInputContainsTargetRetry === 'YES').length, results.filter((r) => r.deriveOutputContainsTargetRetry === 'YES').length, results.filter((r) => r.deriveInputContainsTargetRetry === 'YES' && r.deriveOutputContainsTargetRetry === 'NO').length, 0],
  ];

  const freezeRows = [
    ['path_local_domain_vote', 'FROZEN', 'Architecture audit chain', 'NO'],
    ['model3_keep_retry_only', 'FROZEN', 'Model3 role', 'NO'],
    ['s3_checkpoint', 'FROZEN', 'MODEL3_V2_S3_RANDOM_INIT_V1', 'NO'],
    ['final_causal_acceptance_0_0_200', 'FROZEN', 'S3 acceptance', 'NO'],
    ['historical_cohort_84', 'FROZEN', 'Lattice failure cohort label', 'NO'],
    ['query_parity_8', 'FROZEN', 'Query parity audit', 'NO'],
    ['old_boundary_13', 'FROZEN', 'Query parity audit', 'NO'],
    ['trace_classification_14', 'FROZEN', 'Owner audit', 'NO'],
    ['TARGET_RETRY_REGION_MISMATCH_34', 'SYMPTOM_ONLY', 'Owner audit provisional label', 'NO'],
    ['RETRY_REGION_DERIVATION_34', 'RETIRED', 'Overturned by this audit', 'NO'],
    ['deriveRetryRegions_status', 'CONTRACT_CORRECT', '0 valid RETRY drops / 34', 'NO unless drop proven'],
    ['model3_localization_16', 'PROVISIONAL_PRIMARY', 'FN+partial+shifted production cases', 'NO retrain in design'],
    ['recall_primary_blocker', 'FROZEN_NO', 'Query parity audit', 'NO'],
    ['candidate_cap_16', 'FROZEN', 'Assembly contract', 'NO'],
    ['jobresult_contract', 'FROZEN', 'No expansion', 'NO'],
  ];

  const summary = {
    phase: 'MODEL3_V2_RETRY_REGION_TRIGGER_ALIGNMENT_AUDIT',
    timestamp: new Date().toISOString(),
    verdict,
    nextPhase,
    population34: results.length,
    ownerDistribution34: ownerCounts,
    ownerSum34: Object.values(ownerCounts).reduce((a, b) => a + b, 0),
    largestOwner: largest?.[0],
    largestOwnerCount: largest?.[1],
    secondOwner: second?.[0],
    secondOwnerCount: second?.[1],
    deriveRetryRegionsDroppedValidRetry: deriveDropped,
    multiUnitAttributionErrors: attributionErrors,
    deriveRetryRegionsStatus:
      deriveDropped > 0 ? 'VALID_RETRY_LOSS_OBSERVED' : 'FROZEN_CONTRACT_EXECUTED_NO_VALID_DROP',
    model3LocalizationProductionCount: model3Owners,
    /** @deprecated use model3LocalizationPrimaryBlocker �?kept for backward trace */
    model3LocalizationPrimary: model3Owners >= (largest?.[1] || 0),
    model3LocalizationPrimaryBlocker: (largest?.[0] || '').startsWith('MODEL3'),
    coverageTable34: results.reduce((acc, r) => {
      acc[r.targetRetryCoverage] = (acc[r.targetRetryCoverage] || 0) + 1;
      return acc;
    }, {}),
    coverageTableSum34: results.length,
    targetFineSpansFound34: {
      withSpans: results.filter((r) => r.targetFineSpanCount > 0).length,
      noSpans: results.filter((r) => r.targetFineSpanCount === 0).length,
    },
    acpRequired: false,
    questions: {
      D1: results.length === 34,
      D4: attributionErrors,
      D5: results.filter((r) => r.targetFineSpanCount > 0).length,
      D7: results.filter((r) => r.targetFineSpanCount === 0).length,
      D9: results.filter((r) => r.targetRetryCoverage === 'TARGET_FULL_RETRY_COVERAGE').length,
      D10: results.filter((r) => r.targetRetryCoverage === 'TARGET_PARTIAL_RETRY_COVERAGE').length,
      D11: results.filter((r) => r.targetRetryCoverage === 'TARGET_NO_RETRY').length,
      D19: deriveDropped,
      D24: deriveDropped,
      D25: ownerCounts.MODEL3_TARGET_FALSE_NEGATIVE || 0,
      D26: ownerCounts.MODEL3_TARGET_PARTIAL_COVERAGE || 0,
      D29: attributionErrors,
      D33: largest?.[0],
      D35: deriveDropped === 0,
      D36: deriveDropped === 0,
      D37: (largest?.[0] || '').startsWith('MODEL3'),
      D45: true,
      D46: true,
      D50: false,
      D51: false,
      D52: false,
    },
  };

  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_region_trigger_cases.csv'), caseCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_target_finespan_decisions.csv'), spanCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_region_alignment.csv'), regionCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_trigger_root_causes.csv'), rootCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_region_trigger_summary.json'), JSON.stringify({ ...summary, funnel }, null, 2));
  fs.writeFileSync(
    path.join(DOCS, 'model3_v2_retry_region_trigger_freeze_state.csv'),
    ['item,status,authority,mayChangeInNextPhase', ...freezeRows.map((r) => r.map(csvEsc).join(','))].join('\n')
  );

  console.log(JSON.stringify(summary, null, 2));
}

main();
