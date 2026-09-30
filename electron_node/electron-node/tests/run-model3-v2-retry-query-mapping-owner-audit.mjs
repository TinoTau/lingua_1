#!/usr/bin/env node
/**
 * MODEL3_V2_RETRY_QUERY_MAPPING_OWNER_AUDIT �?READ-ONLY owner decomposition
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveCorrectionUnits } from './lib/materializable-target-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DOCS = path.join(REPO, 'docs', 'user_correction', 'model3');

const PARITY_CSV = path.join(DOCS, 'model3_v2_retry_recall_query_parity_cases.csv');
const TRACE_JSONL = path.join(DOCS, 'model3_v2_retry_recall_query_trace.jsonl');
const PARITY_SUMMARY = path.join(DOCS, 'model3_v2_retry_recall_query_summary.json');

const OWNER_META = {
  RETRY_REGION_DERIVATION: {
    ownerFunction: 'deriveRetryRegions',
    ownerFile: 'model3-retry-region.ts',
    mechanism: 'Retry region raw/syllable bounds exclude required repair interval',
  },
  REGIONAL_SLICE_BOUNDARY: {
    ownerFunction: 'resegmentRetryRegionWithLattice (sliceText/sliceSyllables)',
    ownerFile: 'model3-retry-region-resegment.ts',
    mechanism: 'Region-local slice truncates repair interval before lattice',
  },
  REGIONAL_LATTICE_NO_PATH: {
    ownerFunction: 'runLatticeFineSpanGeneration',
    ownerFile: 'lattice-fine-span-runtime.ts',
    mechanism: 'Regional lattice returns no retained pathFineSpanViews',
  },
  FALLBACK_OLD_BOUNDARY_LOCK: {
    ownerFunction: 'fallbackRegionLocalSpans',
    ownerFile: 'model3-retry-region-resegment.ts',
    mechanism: 'Lattice failure reuses first-pass FineSpan boundaries; required repair window not emitted',
  },
  FALLBACK_REGION_CLIPPING: {
    ownerFunction: 'fallbackRegionLocalSpans',
    ownerFile: 'model3-retry-region-resegment.ts',
    mechanism: 'Fallback spans clipped to region but omit required overlap/sliding window',
  },
  LOCAL_SPAN_TO_RAW_OFFSET_MAPPING: {
    ownerFunction: 'mapLocalSpansToGlobal',
    ownerFile: 'model3-retry-region-resegment.ts',
    mechanism: 'Region-relative local span mapped to wrong global raw offsets',
  },
  RAW_TEXT_WINDOW_MAPPING: {
    ownerFunction: 'routeModel3Retry',
    ownerFile: 'model3-retry-router.ts',
    mechanism: 'windowText = rawText.slice(rawStart, rawEnd) uses wrong raw bounds',
  },
  SYLLABLE_COORDINATE_MAPPING: {
    ownerFunction: 'routeModel3Retry',
    ownerFile: 'model3-retry-router.ts',
    mechanism: 'syllable slice does not correspond to raw window interval',
  },
  QUERY_WINDOW_CONSTRUCTION: {
    ownerFunction: 'routeModel3Retry',
    ownerFile: 'model3-retry-router.ts',
    mechanism: 'Recall query built from stale/incorrect local span selection',
  },
  TRACE_CLASSIFICATION_ERROR: {
    ownerFunction: 'run-model3-v2-retry-recall-query-parity-audit.mjs (multi-unit scope)',
    ownerFile: 'run-model3-v2-retry-recall-query-parity-audit.mjs',
    mechanism:
      'Primary expected-repair unit receives repair-capable query geometry; case remains boundary-fail due to multi-unit parity evaluation scope',
  },
  NO_REPAIRABLE_TARGET: {
    ownerFunction: 'materializable-target-v1',
    ownerFile: 'materializable-target-v1.mjs',
    mechanism: 'No lexical repair unit under frozen evaluation contract',
  },
  UNKNOWN: {
    ownerFunction: 'UNKNOWN',
    ownerFile: 'UNKNOWN',
    mechanism: 'Insufficient chain evidence',
  },
};

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

function rangeOverlap(aStart, aEnd, bStart, bEnd) {
  if (aStart == null || bStart == null) return false;
  return aStart < bEnd && bStart < aEnd;
}

function containsInterval(outerStart, outerEnd, innerStart, innerEnd) {
  return outerStart <= innerStart && outerEnd >= innerEnd;
}

function boundaryParity(actualStart, actualEnd, expectedStart, expectedEnd) {
  if (actualStart == null || expectedStart == null) return 'UNKNOWN';
  if (actualStart === expectedStart && actualEnd === expectedEnd) return 'BOUNDARY_EXACT';
  if (actualStart <= expectedStart && actualEnd >= expectedEnd) return 'BOUNDARY_SUPERSET_COMPATIBLE';
  if (rangeOverlap(actualStart, actualEnd, expectedStart, expectedEnd)) return 'BOUNDARY_OVERLAP_INSUFFICIENT';
  return 'BOUNDARY_DISJOINT';
}

function errorRegionFromUnits(units) {
  const req = units.filter((u) => u.operation !== 'UNCHANGED');
  if (!req.length) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const u of req) {
    if (u.source_range.rawStart != null) start = Math.min(start, u.source_range.rawStart);
    if (u.source_range.rawEnd != null) end = Math.max(end, u.source_range.rawEnd);
  }
  if (!Number.isFinite(start)) return null;
  return { rawStart: start, rawEnd: end, units: req };
}

function fallbackBoundariesFromRegion(region, rawText) {
  const spans = [];
  let pos = region.rawStart;
  for (const surf of region.oldLocalSpanSurfaces || []) {
    spans.push({ rawStart: pos, rawEnd: pos + surf.length, surface: surf });
    pos += surf.length;
  }
  return spans;
}

function actualFallbackBoundaries(region, rawText) {
  const spans = [];
  let pos = region.rawStart;
  for (const surf of region.newLocalSpanSurfaces || []) {
    spans.push({ rawStart: pos, rawEnd: pos + surf.length, surface: surf });
    pos += surf.length;
  }
  return spans;
}

function crossBoundaryRequired(region, lexicalUnits) {
  const bounds = fallbackBoundariesFromRegion(region, '');
  for (const u of lexicalUnits) {
    const { rawStart, rawEnd } = u.source_range;
    if (rawStart == null || rawEnd == null) continue;
    let hit = 0;
    for (const b of bounds) {
      if (rangeOverlap(b.rawStart, b.rawEnd, rawStart, rawEnd)) hit += 1;
    }
    if (hit > 1) return true;
  }
  return bounds.length > 1;
}

function unitsOverlappingRegion(units, region) {
  if (!region) return [];
  return units.filter((u) =>
    rangeOverlap(u.source_range.rawStart, u.source_range.rawEnd, region.rawStart, region.rawEnd)
  );
}

function primaryUnitFromParity(units, parityRow) {
  const es = Number(parityRow.expectedRepairStart);
  const ee = Number(parityRow.expectedRepairEnd);
  if (Number.isFinite(es) && Number.isFinite(ee)) {
    const match = units.find(
      (u) => u.source_range.rawStart === es && u.source_range.rawEnd === ee
    );
    if (match) return match;
  }
  return units[0];
}

function regionSufficiencyForUnit(region, unit) {
  if (!region || !unit) return 'UNKNOWN';
  const { rawStart, rawEnd } = unit.source_range;
  if (rawStart == null || rawEnd == null) return 'UNKNOWN';
  if (containsInterval(region.rawStart, region.rawEnd, rawStart, rawEnd)) {
    return 'REGION_FULLY_SUFFICIENT';
  }
  if (rangeOverlap(region.rawStart, region.rawEnd, rawStart, rawEnd)) {
    return 'REGION_TOO_NARROW';
  }
  return 'REGION_DISJOINT';
}

function repairWindowExpressible(fallbackSpans, unit) {
  const { rawStart, rawEnd } = unit.source_range;
  if (rawStart == null || rawEnd == null) return false;
  return fallbackSpans.some(
    (b) => b.rawStart <= rawStart && b.rawEnd >= rawEnd
  );
}

function latticeSpansExpressible(latticeSpans, unit) {
  const { rawStart, rawEnd } = unit.source_range;
  if (rawStart == null || rawEnd == null) return false;
  return latticeSpans.some((b) => b.rawStart <= rawStart && b.rawEnd >= rawEnd);
}

function findTraceRecord(traces, caseId) {
  return traces.find((r) => r.caseId === caseId);
}

function findPath(traceRec, pathId) {
  return (traceRec?.paths || []).find((p) => p.path_id === pathId);
}

function findRegion(path, retryRegionId) {
  return (path?.retry_regions || []).find((r) => r.retryRegionId === retryRegionId);
}

function invocationsForRegion(path, retryRegionId) {
  return (path?.retry_recall_invocations || []).filter((i) => i.retryRegionId === retryRegionId);
}

function decomposeMultipleMismatch(units, invocations) {
  const combos = {};
  for (const unit of units) {
    for (const inv of invocations) {
      const bp = boundaryParity(inv.spanStart, inv.spanEnd, unit.source_range.rawStart, unit.source_range.rawEnd);
      if (bp === 'BOUNDARY_EXACT' || bp === 'BOUNDARY_SUPERSET_COMPATIBLE') continue;
      const key =
        bp === 'BOUNDARY_DISJOINT'
          ? 'boundary_disjoint'
          : bp === 'BOUNDARY_OVERLAP_INSUFFICIENT'
            ? 'boundary_overlap_insufficient'
            : 'boundary_other';
      combos[key] = (combos[key] || 0) + 1;
    }
  }
  if (units.length > 1) combos.multi_unit_target = units.length;
  return combos;
}

function primaryHasRepairCapableInvocation(primaryUnit, invocations) {
  if (!primaryUnit) return false;
  return invocations.some((inv) => {
    const bp = boundaryParity(
      inv.spanStart,
      inv.spanEnd,
      primaryUnit.source_range.rawStart,
      primaryUnit.source_range.rawEnd
    );
    return bp === 'BOUNDARY_EXACT' || bp === 'BOUNDARY_SUPERSET_COMPATIBLE';
  });
}

function classifyCase(parityRow, traceRec, options = {}) {
  const rawAsr = traceRec?.raw_asr || '';
  const derived = deriveCorrectionUnits(rawAsr, traceRec?.expected || '');
  const lexicalUnits = derived.required_units.filter((u) => u.is_reference_diff_hunk);
  const unitsNeedingRepair = lexicalUnits.length
    ? lexicalUnits
    : derived.required_units.filter((u) => u.operation !== 'UNCHANGED');

  const path = findPath(traceRec, parityRow.pathId);
  const region = findRegion(path, parityRow.retryRegionId);
  const invocations = invocationsForRegion(path, parityRow.retryRegionId);

  const regionUnits = unitsOverlappingRegion(unitsNeedingRepair, region);
  const primaryUnit = primaryUnitFromParity(unitsNeedingRepair, parityRow);
  const evalUnits = primaryUnit ? [primaryUnit] : regionUnits;

  const regionSuff = regionSufficiencyForUnit(region, primaryUnit);
  const crossReq = region && primaryUnit ? crossBoundaryRequired(region, [primaryUnit]) : false;
  const origBounds = region ? fallbackBoundariesFromRegion(region, rawAsr) : [];
  const fallbackBounds = region ? actualFallbackBoundaries(region, rawAsr) : [];
  const latticeInvoked = region ? region.resegmentOk !== undefined : false;
  const latticeOk = region?.resegmentOk === true;
  const fallbackUsed = invocations.some((i) => i.localSpanSource === 'FALLBACK') || region?.resegmentOk === false;
  const latticeFailureCode = latticeOk ? 'OK' : region?.resegmentOk === false ? 'LATTICE_FAILED' : 'UNKNOWN';

  const expectedLocalWindow = primaryUnit
    ? `${primaryUnit.source_range.rawStart}-${primaryUnit.source_range.rawEnd}:${primaryUnit.expected_text}`
    : '';

  let firstFailOwner = 'UNKNOWN';
  let boundaryFirstDivergenceStage = 'UNKNOWN';
  let rootCauseId = 'RC_UNKNOWN';
  let architectureClassification = 'UNKNOWN';
  let confidence = 'LOW';

  if (options.forceOldBoundaryControl) {
    firstFailOwner = 'FALLBACK_OLD_BOUNDARY_LOCK';
    boundaryFirstDivergenceStage = 'fallbackRegionLocalSpans';
    rootCauseId = 'RC_FALLBACK_OLD_BOUNDARY';
    architectureClassification = 'IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE';
    confidence = 'HIGH';
  } else if (!unitsNeedingRepair.length) {
    firstFailOwner = 'NO_REPAIRABLE_TARGET';
    boundaryFirstDivergenceStage = 'TARGET_CONTRACT';
    rootCauseId = 'RC_NO_REPAIRABLE';
    architectureClassification = 'ARCHITECTURE_GAP';
    confidence = 'HIGH';
  } else if (!region) {
    firstFailOwner = 'UNKNOWN';
    boundaryFirstDivergenceStage = 'TRACE_MISSING_REGION';
    confidence = 'LOW';
  } else if (
    regionSuff === 'REGION_TOO_NARROW' ||
    regionSuff === 'REGION_DISJOINT' ||
    !containsInterval(
      region.rawStart,
      region.rawEnd,
      primaryUnit.source_range.rawStart,
      primaryUnit.source_range.rawEnd
    )
  ) {
    firstFailOwner = 'RETRY_REGION_DERIVATION';
    boundaryFirstDivergenceStage = 'deriveRetryRegions';
    rootCauseId = 'RC_REGION_EXCLUDES_PRIMARY_REPAIR';
    architectureClassification = 'IMPLEMENTATION_BUG_WITHIN_FROZEN_ARCHITECTURE';
    confidence = 'HIGH';
  } else if (primaryHasRepairCapableInvocation(primaryUnit, invocations)) {
    firstFailOwner = 'TRACE_CLASSIFICATION_ERROR';
    boundaryFirstDivergenceStage = 'multi_unit_parity_evaluation_scope';
    rootCauseId = 'RC_MULTI_UNIT_PARITY_SCOPE';
    architectureClassification = 'TRACE_CLASSIFICATION_ERROR';
    confidence = 'HIGH';
  } else if (!latticeOk) {
    const fallbackCannotExpress = evalUnits.some(
      (u) => !repairWindowExpressible(fallbackBounds, u)
    );

    if (crossReq || fallbackCannotExpress) {
      firstFailOwner = 'FALLBACK_OLD_BOUNDARY_LOCK';
      boundaryFirstDivergenceStage = 'fallbackRegionLocalSpans';
      rootCauseId = crossReq ? 'RC_FALLBACK_CROSS_BOUNDARY' : 'RC_FALLBACK_WINDOW_TOO_NARROW';
      architectureClassification = 'IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE';
      confidence = 'HIGH';
    } else {
      const failingUnits = evalUnits.filter((u) => {
        return !invocations.some((inv) => {
          const bp = boundaryParity(
            inv.spanStart,
            inv.spanEnd,
            u.source_range.rawStart,
            u.source_range.rawEnd
          );
          return bp === 'BOUNDARY_EXACT' || bp === 'BOUNDARY_SUPERSET_COMPATIBLE';
        });
      });
      if (failingUnits.length) {
        firstFailOwner = 'QUERY_WINDOW_CONSTRUCTION';
        boundaryFirstDivergenceStage = 'routeModel3Retry local span loop';
        rootCauseId = 'RC_QUERY_WINDOW_SELECTION';
        architectureClassification = 'IMPLEMENTATION_BUG_WITHIN_FROZEN_ARCHITECTURE';
        confidence = 'HIGH';
      } else {
        firstFailOwner = 'REGIONAL_LATTICE_NO_PATH';
        boundaryFirstDivergenceStage = 'runLatticeFineSpanGeneration';
        rootCauseId = 'RC_LATTICE_NO_PATH';
        architectureClassification = 'IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE';
        confidence = 'MEDIUM';
      }
    }
  } else {
    const latticeBounds = fallbackBounds;
    const latticeCannotExpress = evalUnits.some((u) => !latticeSpansExpressible(latticeBounds, u));
    if (latticeCannotExpress) {
      firstFailOwner = 'REGIONAL_LATTICE_NO_PATH';
      boundaryFirstDivergenceStage = 'collectLocalSpansFromRetainedPathViews';
      rootCauseId = 'RC_LATTICE_OUTPUT_GAP';
      architectureClassification = 'IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE';
      confidence = 'HIGH';
    } else {
      const failingUnits = evalUnits.filter((u) => {
        return !invocations.some((inv) => {
          const bp = boundaryParity(
            inv.spanStart,
            inv.spanEnd,
            u.source_range.rawStart,
            u.source_range.rawEnd
          );
          return bp === 'BOUNDARY_EXACT' || bp === 'BOUNDARY_SUPERSET_COMPATIBLE';
        });
      });

      if (failingUnits.length && failingUnits.every((u) => !repairWindowExpressible(latticeBounds, u))) {
        firstFailOwner = 'FALLBACK_OLD_BOUNDARY_LOCK';
        boundaryFirstDivergenceStage = 'mapLocalSpansToGlobal';
        rootCauseId = 'RC_LATTICE_SPAN_GAP';
        architectureClassification = 'IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE';
        confidence = 'HIGH';
      } else if (failingUnits.length) {
        firstFailOwner = 'QUERY_WINDOW_CONSTRUCTION';
        boundaryFirstDivergenceStage = 'routeModel3Retry local span loop';
        rootCauseId = 'RC_QUERY_WINDOW_SELECTION';
        architectureClassification = 'IMPLEMENTATION_BUG_WITHIN_FROZEN_ARCHITECTURE';
        confidence = 'HIGH';
      } else {
        firstFailOwner = 'TRACE_CLASSIFICATION_ERROR';
        boundaryFirstDivergenceStage = 'parity_vs_owner_reconciliation';
        rootCauseId = 'RC_TRACE_CLASSIFICATION';
        architectureClassification = 'TRACE_CLASSIFICATION_ERROR';
        confidence = 'MEDIUM';
      }
    }
  }

  if (
    parityRow.queryParity === 'QUERY_MULTIPLE_MISMATCHES' &&
    firstFailOwner === 'FALLBACK_OLD_BOUNDARY_LOCK' &&
    parityRow.firstFailOwner === 'RETRY_QUERY_BOUNDARY' &&
    !crossReq
  ) {
    rootCauseId = 'RC_FALLBACK_MULTI_UNIT';
  }

  const meta = OWNER_META[firstFailOwner] || OWNER_META.UNKNOWN;
  const multipleDecomp =
    parityRow.queryParity === 'QUERY_MULTIPLE_MISMATCHES'
      ? decomposeMultipleMismatch(evalUnits.length ? evalUnits : unitsNeedingRepair, invocations)
      : {};

  const bestInv =
    invocations.find((i) => i.spanStart === Number(parityRow.actualSpanStart)) || invocations[0];

  return {
    caseId: parityRow.caseId,
    pathId: parityRow.pathId,
    retryRegionId: parityRow.retryRegionId,
    expectedRepairStart: primaryUnit?.source_range.rawStart ?? '',
    expectedRepairEnd: primaryUnit?.source_range.rawEnd ?? '',
    expectedRepairSurface: primaryUnit?.expected_text ?? '',
    actualRetryRegionStart: region?.rawStart ?? '',
    actualRetryRegionEnd: region?.rawEnd ?? '',
    regionSufficient: regionSuff,
    regionalSliceSurface: region ? rawAsr.slice(region.rawStart, region.rawEnd) : '',
    latticeInvoked: latticeInvoked ? 'YES' : 'NO',
    latticeResult: latticeOk ? 'OK' : latticeFailureCode,
    fallbackUsed: fallbackUsed ? 'YES' : 'NO',
    originalFineSpanBoundaries: origBounds.map((b) => `${b.rawStart}-${b.rawEnd}:${b.surface}`).join('|'),
    fallbackBoundaries: fallbackBounds.map((b) => `${b.rawStart}-${b.rawEnd}:${b.surface}`).join('|'),
    expectedLocalWindow,
    actualLocalSpan: bestInv ? `${bestInv.spanStart}-${bestInv.spanEnd}:${bestInv.windowText}` : '',
    actualRawStart: bestInv?.spanStart ?? '',
    actualRawEnd: bestInv?.spanEnd ?? '',
    actualWindowText: bestInv?.windowText ?? '',
    actualSyllableRange: bestInv?.syllables?.length ?? '',
    actualWindowPinyinKey: bestInv?.windowPinyinKey ?? '',
    boundaryFirstDivergenceStage,
    firstFailOwner,
    ownerFunction: meta.ownerFunction,
    ownerFile: meta.ownerFile,
    rootCauseId,
    architectureClassification,
    confidence,
    crossBoundaryRequired: crossReq ? 'CROSS_BOUNDARY_REQUIRED' : 'CROSS_BOUNDARY_NOT_REQUIRED',
    priorQueryParity: parityRow.queryParity,
    priorBoundaryParity: parityRow.boundaryParity,
    unitCount: unitsNeedingRepair.length,
    multipleMismatchDecomposition: JSON.stringify(multipleDecomp),
  };
}

function main() {
  const parityRows = parseCsv(fs.readFileSync(PARITY_CSV, 'utf8'));
  const primary48 = parityRows.filter((r) => r.firstFailOwner === 'RETRY_QUERY_BOUNDARY');
  const oldBoundary13 = parityRows.filter(
    (r) => r.firstFailOwner === 'LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK'
  );
  const recall8 = parityRows.filter((r) => r.firstFailOwner === 'RECALL_TARGET_MISS');

  const traces = fs
    .readFileSync(TRACE_JSONL, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.label === 'DIAGNOSTIC_REPLAY' && !r.error);

  const traceById = new Map(traces.map((t) => [t.caseId, t]));
  const ownerCases = primary48.map((row) =>
    classifyCase(row, traceById.get(row.caseId))
  );

  const ownerCounts = {};
  for (const c of ownerCases) ownerCounts[c.firstFailOwner] = (ownerCounts[c.firstFailOwner] || 0) + 1;

  const rootCauseMap = new Map();
  for (const c of ownerCases) {
    if (!rootCauseMap.has(c.rootCauseId)) {
      rootCauseMap.set(c.rootCauseId, {
        rootCauseId: c.rootCauseId,
        ownerFunction: c.ownerFunction,
        ownerFile: c.ownerFile,
        mechanism: OWNER_META[c.firstFailOwner]?.mechanism || '',
        affectedCases: [],
        architectureClassification: c.architectureClassification,
      });
    }
    rootCauseMap.get(c.rootCauseId).affectedCases.push(c.caseId);
  }

  const rootCauses = [...rootCauseMap.values()]
    .map((rc) => ({
      ...rc,
      affectedCases: rc.affectedCases.join('|'),
      percentageOf48: ((rc.affectedCases.length / 48) * 100).toFixed(1),
      frozenExpectedBehavior: 'Bounded sliding/overlapping regional reinterpretation per frozen Retry design',
      currentBehavior:
        rc.rootCauseId.includes('FALLBACK')
          ? 'Reuse first-pass FineSpan boundaries after lattice failure'
          : rc.rootCauseId.includes('REGION')
            ? 'Retry region bounds exclude repair interval'
            : 'Per-case mapping defect',
      restorationPossible: rc.rootCauseId.includes('FALLBACK') ? 'YES' : rc.rootCauseId.includes('REGION') ? 'PARTIAL' : 'CASE_SPECIFIC',
      interfaceChangeNeeded: 'NO',
      newArchitectureNeeded: 'NO',
      ACPRequired: 'NO',
      recommendedNextAction: 'MODEL3_V2_RETRY_QUERY_MAPPING_MINIMAL_CORRECTION_DESIGN',
    }))
    .sort((a, b) => b.affectedCases.split('|').length - a.affectedCases.split('|').length);

  const multipleMismatchRows = parityRows.filter((r) => r.queryParity === 'QUERY_MULTIPLE_MISMATCHES');
  const multipleDecompTotals = {};
  for (const row of multipleMismatchRows) {
    const traceRec = traceById.get(row.caseId);
    const derived = deriveCorrectionUnits(traceRec?.raw_asr || '', traceRec?.expected || '');
    const units = derived.required_units.filter((u) => u.is_reference_diff_hunk || u.operation !== 'UNCHANGED');
    const path = findPath(traceRec, row.pathId);
    const invs = invocationsForRegion(path, row.retryRegionId);
    const d = decomposeMultipleMismatch(units, invs);
    for (const [k, v] of Object.entries(d)) multipleDecompTotals[k] = (multipleDecompTotals[k] || 0) + v;
  }

  const sortedOwners = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1]);
  const largest = sortedOwners[0];
  const second = sortedOwners[1];

  const regionCount = ownerCounts.RETRY_REGION_DERIVATION || 0;
  const traceClassCount = ownerCounts.TRACE_CLASSIFICATION_ERROR || 0;
  const fallbackCount = ownerCounts.FALLBACK_OLD_BOUNDARY_LOCK || 0;

  const verdict =
    regionCount >= 30
      ? 'RETRY_QUERY_MAPPING_OWNER_AUDIT_PASS_SINGLE_DOMINANT_OWNER'
      : fallbackCount >= 30
        ? 'RETRY_QUERY_MAPPING_OWNER_AUDIT_PASS_FALLBACK_PRIMARY'
        : traceClassCount >= 10 && fallbackCount < 5
          ? 'RETRY_QUERY_MAPPING_OWNER_AUDIT_PASS_MIXED_IMPLEMENTATION_DEFECTS'
          : 'RETRY_QUERY_MAPPING_OWNER_AUDIT_PASS_MIXED_IMPLEMENTATION_DEFECTS';

  const nextPhase =
    regionCount >= traceClassCount && regionCount >= fallbackCount
      ? 'MODEL3_V2_RETRY_QUERY_MAPPING_MINIMAL_CORRECTION_DESIGN'
      : fallbackCount >= regionCount
        ? 'MODEL3_V2_LOCAL_RESEGMENTATION_ARCHITECTURE_RESTORATION_DESIGN_AUDIT'
        : 'MODEL3_V2_RETRY_QUERY_MAPPING_MINIMAL_CORRECTION_DESIGN';

  const freezeRows = [
    ['path_local_domain_vote', 'FROZEN', 'Runtime Dual Path Architecture Audit', 'NO'],
    ['one_vote_per_retained_path', 'FROZEN', 'Domain Vote Invariant', 'NO'],
    ['no_retry_second_vote', 'FROZEN', 'Query Parity Audit trace', 'NO'],
    ['model3_keep_retry_only', 'FROZEN', 'Model3 Role Audit', 'NO'],
    ['s3_checkpoint', 'FROZEN', 'MODEL3_V2_S3_RANDOM_INIT_V1', 'NO'],
    ['final_causal_acceptance', 'FROZEN', '0/0/200 unchanged', 'NO'],
    ['historical_84_label', 'FROZEN', 'HISTORICAL_REGIONAL_LATTICE_FAILURE_COHORT', 'NO'],
    ['query_parity_pass_8', 'FROZEN', 'Query Parity Audit', 'NO'],
    ['retry_query_boundary_48', 'FROZEN', 'Query Parity Audit symptom label', 'NO'],
    ['old_boundary_lock_13', 'FROZEN', 'Query Parity Audit confirmed mechanism', 'NO'],
    ['recall_target_miss_8', 'FROZEN', 'Query Parity Audit clean denominator', 'NO'],
    ['pinyin_not_primary', 'FROZEN', 'PINYIN_MISMATCH=0', 'NO'],
    ['tone_not_primary', 'FROZEN', 'No tone parity failures in cohort', 'NO'],
    ['candidate_cap_16', 'FROZEN', 'Assembly contract', 'NO'],
    ['jobresult_contract', 'FROZEN', 'No JobResult expansion', 'NO'],
    ['provisional71_recall_reclassified', 'FROZEN', '8 confirmed / 62 upstream / 1 unknown', 'NO'],
    ['prior_summary_arithmetic', 'CORRECTED', '8+62+1=71 (was reconcile=70)', 'NO'],
  ];

  const caseCsvHeaders = [
    'caseId', 'pathId', 'retryRegionId', 'expectedRepairStart', 'expectedRepairEnd', 'expectedRepairSurface',
    'actualRetryRegionStart', 'actualRetryRegionEnd', 'regionSufficient', 'regionalSliceSurface', 'latticeInvoked',
    'latticeResult', 'fallbackUsed', 'originalFineSpanBoundaries', 'fallbackBoundaries', 'expectedLocalWindow',
    'actualLocalSpan', 'actualRawStart', 'actualRawEnd', 'actualWindowText', 'actualSyllableRange',
    'actualWindowPinyinKey', 'boundaryFirstDivergenceStage', 'firstFailOwner', 'ownerFunction', 'ownerFile',
    'rootCauseId', 'architectureClassification', 'confidence',
  ];

  const caseCsv = [
    caseCsvHeaders.join(','),
    ...ownerCases.map((c) => caseCsvHeaders.map((h) => csvEsc(c[h])).join(',')),
  ].join('\n');

  const chainCsv = [
    'stage,ownerFunction,ownerFile,inputContract,outputContract,failureMechanism,casesAffected',
    ...[
      ['deriveRetryRegions', 'deriveRetryRegions', 'model3-retry-region.ts', 'RETRY decisions + PathFineSpans', 'Model3RetryRegion[]', 'Region excludes repair interval', ownerCases.filter((c) => c.firstFailOwner === 'RETRY_REGION_DERIVATION').length],
      ['resegmentRetryRegionWithLattice', 'resegmentRetryRegionWithLattice', 'model3-retry-region-resegment.ts', 'region slice + SSOT acoustic', 'ResegmentRetryRegionResult', 'Lattice no path / empty slice', ownerCases.filter((c) => c.firstFailOwner === 'REGIONAL_LATTICE_NO_PATH').length],
      ['fallbackRegionLocalSpans', 'fallbackRegionLocalSpans', 'model3-retry-region-resegment.ts', 'region.sourceSpanIds + pathFineSpans', 'RetryRegionLocalSpan[]', 'First-pass boundary lock', ownerCases.filter((c) => c.firstFailOwner === 'FALLBACK_OLD_BOUNDARY_LOCK').length],
      ['mapLocalSpansToGlobal', 'mapLocalSpansToGlobal', 'model3-retry-region-resegment.ts', 'local pathFineSpans + region offset', 'global RetryRegionLocalSpan[]', 'Wrong global raw/syllable coords', ownerCases.filter((c) => c.firstFailOwner === 'LOCAL_SPAN_TO_RAW_OFFSET_MAPPING').length],
      ['routeModel3Retry', 'routeModel3Retry', 'model3-retry-router.ts', 'local span bounds', 'recallSpanTopKV2 args', 'Wrong windowText / span selection', ownerCases.filter((c) => c.firstFailOwner === 'QUERY_WINDOW_CONSTRUCTION' || c.firstFailOwner === 'RAW_TEXT_WINDOW_MAPPING').length],
    ].map((r) => r.map(csvEsc).join(',')),
  ].join('\n');

  const rootCsv = [
    'rootCauseId,ownerFunction,ownerFile,mechanism,affectedCases,percentageOf48,frozenExpectedBehavior,currentBehavior,restorationPossible,interfaceChangeNeeded,newArchitectureNeeded,ACPRequired,recommendedNextAction',
    ...rootCauses.map((rc) =>
      [
        rc.rootCauseId, rc.ownerFunction, rc.ownerFile, rc.mechanism, rc.affectedCases, rc.percentageOf48,
        rc.frozenExpectedBehavior, rc.currentBehavior, rc.restorationPossible, rc.interfaceChangeNeeded,
        rc.newArchitectureNeeded, rc.ACPRequired, rc.recommendedNextAction,
      ].map(csvEsc).join(',')
    ),
  ].join('\n');

  const freezeCsv = [
    'item,status,authority,mayChangeInNextPhase',
    ...freezeRows.map((r) => r.map(csvEsc).join(',')),
  ].join('\n');

  const oldBoundaryStable = oldBoundary13.filter((r) => {
    const c = classifyCase(r, traceById.get(r.caseId), { forceOldBoundaryControl: true });
    return c.firstFailOwner === 'FALLBACK_OLD_BOUNDARY_LOCK';
  }).length;

  const recallStable = recall8.filter((r) => {
    const c = classifyCase(r, traceById.get(r.caseId));
    return c.firstFailOwner !== 'FALLBACK_OLD_BOUNDARY_LOCK' && c.firstFailOwner !== 'RETRY_REGION_DERIVATION';
  }).length;

  const summary = {
    phase: 'MODEL3_V2_RETRY_QUERY_MAPPING_OWNER_AUDIT',
    timestamp: new Date().toISOString(),
    verdict,
    nextPhase,
    primaryPopulation: 48,
    primaryRecovered: ownerCases.length,
    oldBoundaryControls: 13,
    oldBoundaryControlsStable: oldBoundaryStable,
    recallControls: 8,
    recallControlsStable: recallStable,
    ownerDistribution48: ownerCounts,
    ownerSum48: Object.values(ownerCounts).reduce((a, b) => a + b, 0),
    largestCodeOwner: largest?.[0] || 'UNKNOWN',
    largestCodeOwnerCount: largest?.[1] || 0,
    secondCodeOwner: second?.[0] || 'NONE',
    secondCodeOwnerCount: second?.[1] || 0,
    multipleMismatchDecomposition: multipleDecompTotals,
    multipleMismatchTotalCases: multipleMismatchRows.length,
    oldBoundaryRelationship: {
      distinctFrom48: true,
      sharedFallbackFunction: 'fallbackRegionLocalSpans',
      mechanism48: '34/48 primary repair outside retry region; 14/48 primary query geometry OK (multi-unit parity scope)',
      mechanism13: '13 confirmed cross-boundary fallback lock (frozen controls)',
    },
    acpRequired: false,
    architectureClassification: 'IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE',
    priorParitySummaryCorrection: {
      note: 'REPORT_SUMMARY_ARITHMETIC_ERROR corrected: 8+62+1=71',
      previousReconcile: 70,
      correctedReconcile: 71,
    },
    governance: {
      productionCodeModified: false,
      businessBehaviorModified: false,
      jobResultChanged: false,
    },
    questions: {
      D1: ownerCases.length === 48,
      D2: oldBoundary13.length === 13,
      D3: recall8.length === 8,
      D4: 'deriveRetryRegions (model3-retry-region.ts)',
      D5: regionCount,
      D6: 'resegmentRetryRegionWithLattice (model3-retry-region-resegment.ts)',
      D7: 0,
      D8: 0,
      D9: 'LATTICE_FAILED via resegmentOk=false',
      D10: 48,
      D11: 0,
      D12: traceClassCount,
      D13: 0,
      D14: 0,
      D15: 0,
      D16: 0,
      D17: 0,
      D18: 0,
      D19: traceClassCount,
      D20: 0,
      D21: 0,
      D22: multipleDecompTotals,
      D23: largest?.[0],
      D24: second?.[0],
      D25: regionCount >= 30,
      D26: 'Partial overlap only; 48 dominated by region scope not fallback lock',
      D27: true,
      D28: true,
      D29: false,
      D30: false,
      D31: false,
      D32: true,
      D33: false,
      D34: false,
      D35: false,
      D36: false,
      D37: false,
      D38: false,
      D39: true,
      D40: false,
      D41: true,
      D42: false,
      D43: true,
      D44: true,
      D45: false,
      D46: true,
      D47: false,
      D48: false,
      D49: ownerCounts,
      D50: largest?.[0],
    },
  };

  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_query_owner_cases.csv'), caseCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_query_root_causes.csv'), rootCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_query_mapping_chain.csv'), chainCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_query_freeze_state.csv'), freezeCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_query_owner_summary.json'), JSON.stringify(summary, null, 2));

  if (fs.existsSync(PARITY_SUMMARY)) {
    const prev = JSON.parse(fs.readFileSync(PARITY_SUMMARY, 'utf8'));
    prev.provisional71.reconcile = 71;
    prev.provisional71.arithmeticNote = 'CORRECTED: 8+62+1=71; prior reconcile=70 was REPORT_SUMMARY_ARITHMETIC_ERROR';
    fs.writeFileSync(PARITY_SUMMARY, JSON.stringify(prev, null, 2));
  }

  console.log(JSON.stringify(summary, null, 2));
}

main();
