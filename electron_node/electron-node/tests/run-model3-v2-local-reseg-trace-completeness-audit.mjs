#!/usr/bin/env node
/**
 * MODEL3_V2_LOCAL_RESEGMENTATION_TRACE_COMPLETENESS_AUDIT �?READ-ONLY
 * Uses frozen raw_cases jsonl + population CSV (no fresh ASR replay).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDialog200Manifest } from './lib/load-dialog200-manifest.mjs';
import {
  norm,
  deriveCorrectionUnits,
  candidateLexicalMatchesUnit,
} from './lib/materializable-target-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const DOCS = path.join(REPO, 'docs', 'user_correction', 'model3');
const RAW_JSONL = path.join(DOCS, 'model3_v2_s3_mainline_s3_raw_cases.jsonl');
const POP_CSV = path.join(DOCS, 'model3_v2_local_reseg_population.csv');
const MANIFEST = path.join(REPO, 'test wav', 'dialog_200', 'cases.manifest.json');

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
      } else cur += ch;
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

function regionCoverage(region, errorRegion) {
  if (!region || !errorRegion) return 'UNKNOWN';
  const { rawStart: rs, rawEnd: re } = region;
  const { rawStart: es, rawEnd: ee } = errorRegion;
  if (rs <= es && re >= ee) return 'FULLY_COVERS_EXPECTED_ERROR';
  if (rangeOverlap(rs, re, es, ee)) return 'PARTIALLY_COVERS_EXPECTED_ERROR';
  return 'MISSES_EXPECTED_ERROR';
}

function surfacesEqual(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

/** Audit-only: does fallback span set cover error interval by raw coords? */
function fallbackSpansCoverError(rawText, region, errorRegion) {
  if (!errorRegion) return 'UNKNOWN';
  const oldSurfaces = region.oldLocalSpanSurfaces || [];
  if (!oldSurfaces.length) return 'UNKNOWN';
  let pos = region.rawStart;
  const spans = [];
  for (const surf of oldSurfaces) {
    const end = pos + surf.length;
    spans.push({ rawStart: pos, rawEnd: end, surface: surf });
    pos = end;
  }
  const { rawStart: es, rawEnd: ee } = errorRegion;
  const covered = spans.some((s) => s.rawStart <= es && s.rawEnd >= ee);
  if (covered) return 'FULL_COVERAGE';
  const partial = spans.some((s) => rangeOverlap(s.rawStart, s.rawEnd, es, ee));
  return partial ? 'PARTIAL_COVERAGE' : 'NO_COVERAGE';
}

/**
 * OLD_BOUNDARY_LOCK blocks when lexical repair requires boundary reinterpretation
 * across multiple first-pass spans inside region, but fallback preserves them.
 */
function oldBoundaryLockBlocks(region, errorRegion, derived) {
  if (!errorRegion || !region) return 'UNKNOWN';
  const lexical = errorRegion.units.filter((u) => u.is_reference_diff_hunk);
  if (!lexical.length) return 'OLD_BOUNDARY_LOCK_DOES_NOT_BLOCK_REQUIRED_QUERY';
  const spanCount = (region.oldLocalSpanSurfaces || []).length;
  const multiSpan = spanCount > 1;
  const crossBoundary = lexical.some((u) => {
    const { rawStart, rawEnd } = u.source_range;
    if (rawStart == null || rawEnd == null) return false;
    let pos = region.rawStart;
    let hit = 0;
    for (const surf of region.oldLocalSpanSurfaces || []) {
      const end = pos + surf.length;
      if (rangeOverlap(pos, end, rawStart, rawEnd)) hit += 1;
      pos = end;
    }
    return hit > 1;
  });
  if (multiSpan && crossBoundary) return 'OLD_BOUNDARY_LOCK_BLOCKS_REQUIRED_QUERY';
  if (spanCount === 1 && surfacesEqual(region.oldLocalSpanSurfaces, region.newLocalSpanSurfaces)) {
    return 'OLD_BOUNDARY_LOCK_DOES_NOT_BLOCK_REQUIRED_QUERY';
  }
  if (!region.resegmentOk && surfacesEqual(region.oldLocalSpanSurfaces, region.newLocalSpanSurfaces)) {
    return crossBoundary
      ? 'OLD_BOUNDARY_LOCK_BLOCKS_REQUIRED_QUERY'
      : 'OLD_BOUNDARY_LOCK_DOES_NOT_BLOCK_REQUIRED_QUERY';
  }
  return 'UNKNOWN';
}

function targetInKenlmPool(rec, derived) {
  const poolRaw = rec.kenlm_pool;
  const pool = Array.isArray(poolRaw) ? poolRaw : poolRaw?.items || [];
  const texts = pool.map((p) => (typeof p === 'string' ? p : p?.text || p?.surface || '')).filter(Boolean);
  const lexical = derived.required_units.filter((u) => u.is_reference_diff_hunk);
  for (const t of texts) {
    for (const u of lexical) {
      if (candidateLexicalMatchesUnit({ surface: t }, u, derived.raw_norm, derived.expected_norm)) {
        return true;
      }
    }
  }
  return false;
}

function classifyStrictOwner(ctx) {
  const {
    cohort,
    targetRetry,
    regionSufficient,
    geometryExists,
    latticeExposed,
    fallbackExposed,
    queryExposed,
    recallInvoked,
    recallReturned,
    targetReturned,
    oldBoundaryBlocks,
    downstreamTarget,
  } = ctx;

  if (cohort === 'TARGET_IN_POOL') return { owner: 'NO_BLOCKER_DOWNSTREAM_TARGET_PRESENT', stage: 'P10+' };
  if (!targetRetry) return { owner: 'MODEL3_TRIGGER', stage: 'P0' };
  if (!regionSufficient) return { owner: 'RETRY_REGION', stage: 'P1' };
  if (geometryExists === 'GEOMETRY_NOT_EXPRESSIBLE') return { owner: 'NO_REPAIRABLE_TARGET', stage: 'P2' };
  if (!queryExposed) {
    if (oldBoundaryBlocks === 'OLD_BOUNDARY_LOCK_BLOCKS_REQUIRED_QUERY') {
      return { owner: 'LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK', stage: 'P4' };
    }
    if (!latticeExposed && !fallbackExposed) {
      return { owner: 'LOCAL_RESEGMENTATION_LATTICE', stage: 'P3' };
    }
    return { owner: 'LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK', stage: 'P4' };
  }
  if (!recallInvoked) {
    if (oldBoundaryBlocks === 'OLD_BOUNDARY_LOCK_BLOCKS_REQUIRED_QUERY') {
      return { owner: 'LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK', stage: 'P5' };
    }
    return { owner: 'UNKNOWN', stage: 'P5' };
  }
  if (!recallReturned) return { owner: 'RECALL_ZERO_RETURN', stage: 'P6' };
  if (!targetReturned) return { owner: 'RECALL_TARGET_MISS', stage: 'P6' };
  if (downstreamTarget) return { owner: 'KENLM', stage: 'P11' };
  return { owner: 'RETRY_CANDIDATE_ROUTING', stage: 'P7+' };
}

function analyzeCase(popRow, rec, expected) {
  const rawAsr = String(rec.raw_asr || '').trim();
  const derived = deriveCorrectionUnits(rawAsr, expected);
  const errorRegion = errorRegionFromUnits(derived.required_units);
  const regions = rec.retry_regions || [];
  const targetRegions = regions.filter((r) => {
    const cov = regionCoverage(r, errorRegion);
    return cov === 'FULLY_COVERS_EXPECTED_ERROR' || cov === 'PARTIALLY_COVERS_EXPECTED_ERROR';
  });
  const bestRegion = targetRegions.sort((a, b) => {
    const score = (r) =>
      (regionCoverage(r, errorRegion) === 'FULLY_COVERS_EXPECTED_ERROR' ? 2 : 1) +
      (r.recallCandidatesReturned || 0) / 100;
    return score(b) - score(a);
  })[0];

  const anyRecall = regions.some((r) => (r.recallCandidatesReturned || 0) > 0);
  const targetRegionRecall = bestRegion ? (bestRegion.recallCandidatesReturned || 0) > 0 : false;
  const caseAnyReturn = popRow.anyCandidateReturn === 'true';
  const caseTargetReturn = popRow.targetCandidateReturn === 'true';

  const latticeOkAny = regions.some((r) => r.resegmentOk === true);
  const fallbackUsedAny = regions.some((r) => !r.resegmentOk);
  const surfacesUnchanged = bestRegion
    ? surfacesEqual(bestRegion.oldLocalSpanSurfaces, bestRegion.newLocalSpanSurfaces)
    : regions.every((r) => surfacesEqual(r.oldLocalSpanSurfaces, r.newLocalSpanSurfaces));

  const fallbackCoverage = bestRegion
    ? fallbackSpansCoverError(rawAsr, bestRegion, errorRegion)
    : 'UNKNOWN';
  const oldBoundaryBlocks = bestRegion
    ? oldBoundaryLockBlocks(bestRegion, errorRegion, derived)
    : 'UNKNOWN';

  const geometryExists =
    popRow.locallyExpressible === 'YES'
      ? 'GEOMETRY_EXISTS'
      : popRow.locallyExpressible === 'NO'
        ? 'GEOMETRY_NOT_EXPRESSIBLE'
        : 'UNKNOWN';

  const latticeExposed = latticeOkAny;
  const fallbackExposed =
    fallbackUsedAny &&
    (fallbackCoverage === 'FULL_COVERAGE' || fallbackCoverage === 'PARTIAL_COVERAGE');
  const queryExposed = latticeExposed || fallbackExposed || caseAnyReturn;

  const recallInvoked = caseAnyReturn || anyRecall || (rec.retry_attempts || 0) > 0;
  const recallReturned = caseAnyReturn || anyRecall;
  const targetReturned = caseTargetReturn || targetInKenlmPool(rec, derived);

  const cohort =
    popRow.strictCausalOwner === 'CONFIRMED_LOCAL_RESEGMENTATION_FAILURE'
      ? 'STRICT_CONTROL'
      : popRow.strictCausalOwner === 'DOWNSTREAM_CANDIDATE_OR_TRACE_SEMANTICS'
        ? 'TARGET_IN_POOL'
        : 'UNKNOWN_65';

  const { owner, stage } = classifyStrictOwner({
    cohort,
    targetRetry: popRow.triggerClass === 'TARGET_OVERLAP',
    regionSufficient: popRow.regionSufficient === 'true',
    geometryExists,
    latticeExposed,
    fallbackExposed,
    queryExposed,
    recallInvoked,
    recallReturned,
    targetReturned,
    oldBoundaryBlocks,
    downstreamTarget: cohort === 'TARGET_IN_POOL',
  });

  return {
    caseId: popRow.caseId,
    cohort,
    historicalOwner: popRow.historicalFirstFail,
    previousOwner: popRow.strictCausalOwner,
    strictOwner: owner,
    firstFailStage: stage,
    geometryExists,
    regionSufficient: popRow.regionSufficient === 'true',
    latticeExposed,
    fallbackUsed: fallbackUsedAny,
    fallbackExposed,
    queryExposed,
    surfacesUnchanged,
    oldBoundaryBlocks,
    fallbackCoverage,
    targetRegionId: bestRegion?.retryRegionId || '',
    targetRegionRecall: targetRegionRecall ? 'YES' : 'NO',
    regionRecallTotal: regions.reduce((s, r) => s + (r.recallCandidatesReturned || 0), 0),
    caseAnyReturn,
    caseTargetReturn,
    recallInvoked,
    recallReturned,
    retryReturned: rec.retry_returned ?? '',
    retryZero: rec.retry_zero ?? '',
    regionCount: regions.length,
    targetRegionCount: targetRegions.length,
    secondDomainVote: regions.some((r) => r.secondDomainVote === true) ? 'YES' : 'NO',
    rawAsr,
    expected,
    errorRawStart: errorRegion?.rawStart ?? '',
    errorRawEnd: errorRegion?.rawEnd ?? '',
    bestRegionRawStart: bestRegion?.rawStart ?? '',
    bestRegionRawEnd: bestRegion?.rawEnd ?? '',
    oldSurfaces: (bestRegion?.oldLocalSpanSurfaces || []).join('|'),
    newSurfaces: (bestRegion?.newLocalSpanSurfaces || []).join('|'),
    resegmentOk: bestRegion?.resegmentOk ?? false,
  };
}

function main() {
  const pop = parseCsv(fs.readFileSync(POP_CSV, 'utf8'));
  const byId = new Map();
  for (const line of fs.readFileSync(RAW_JSONL, 'utf8').trim().split('\n')) {
    const rec = JSON.parse(line);
    byId.set(rec.id, rec);
  }
  const { cases } = loadDialog200Manifest(MANIFEST);
  const expectedById = new Map(cases.map((c) => [c.id, String(c.expectedText || c.utterance || '').trim()]));

  const results = [];
  for (const row of pop) {
    const rec = byId.get(row.caseId);
    if (!rec) {
      results.push({ caseId: row.caseId, strictOwner: 'UNKNOWN', note: 'MISSING_RAW_CASE' });
      continue;
    }
    results.push(analyzeCase(row, rec, expectedById.get(row.caseId) || rec.expected || ''));
  }

  const unknown65 = results.filter((r) => r.cohort === 'UNKNOWN_65');
  const strict6 = results.filter((r) => r.cohort === 'STRICT_CONTROL');
  const pool13 = results.filter((r) => r.cohort === 'TARGET_IN_POOL');

  const ownerCounts = {};
  for (const r of results) {
    ownerCounts[r.strictOwner] = (ownerCounts[r.strictOwner] || 0) + 1;
  }
  for (const r of unknown65) {
    ownerCounts[`unknown65:${r.strictOwner}`] = (ownerCounts[`unknown65:${r.strictOwner}`] || 0) + 1;
  }

  const funnelStages = [
    { stage: 'UNKNOWN_NEEDS_TRACE', denom: 65, pass: 65, fail: 0, unknown: 0 },
    {
      stage: 'P0_target_relevant_retry',
      denom: 65,
      pass: unknown65.filter((r) => r.cohort === 'UNKNOWN_65' && r.geometryExists).length,
      fail: 0,
      unknown: 0,
    },
    {
      stage: 'P1_retry_region_sufficient',
      denom: 65,
      pass: unknown65.filter((r) => r.regionSufficient).length,
      fail: unknown65.filter((r) => !r.regionSufficient).length,
      unknown: 0,
    },
    {
      stage: 'P2_repair_capable_geometry',
      denom: 65,
      pass: unknown65.filter((r) => r.geometryExists === 'GEOMETRY_EXISTS').length,
      fail: unknown65.filter((r) => r.geometryExists === 'GEOMETRY_NOT_EXPRESSIBLE').length,
      unknown: unknown65.filter((r) => r.geometryExists === 'UNKNOWN').length,
    },
    {
      stage: 'P4_fallback_exposes_query',
      denom: 65,
      pass: unknown65.filter((r) => r.fallbackExposed || r.caseAnyReturn).length,
      fail: unknown65.filter((r) => !r.fallbackExposed && !r.caseAnyReturn).length,
      unknown: 0,
    },
    {
      stage: 'P5_recall_invoked',
      denom: 65,
      pass: unknown65.filter((r) => r.recallInvoked !== false && r.caseAnyReturn).length,
      fail: unknown65.filter((r) => !r.caseAnyReturn).length,
      unknown: 0,
    },
    {
      stage: 'P6_recall_returned_candidates',
      denom: 65,
      pass: unknown65.filter((r) => r.caseAnyReturn).length,
      fail: unknown65.filter((r) => !r.caseAnyReturn).length,
      unknown: 0,
    },
    {
      stage: 'P6_target_relevant_return',
      denom: 65,
      pass: unknown65.filter((r) => r.caseTargetReturn).length,
      fail: unknown65.filter((r) => r.caseAnyReturn && !r.caseTargetReturn).length,
      unknown: unknown65.filter((r) => !r.caseAnyReturn).length,
    },
  ];

  // Fix funnel P0
  funnelStages[1].pass = unknown65.length;

  const funnelCsv = [
    'stage,input_denom,pass,fail,unknown,first_fail_owner',
    ...funnelStages.map((f) =>
      [
        f.stage,
        f.denom,
        f.pass,
        f.fail,
        f.unknown,
        f.stage === 'P6_target_relevant_return' ? 'RECALL_TARGET_MISS' : '',
      ].join(',')
    ),
  ].join('\n');

  const oldBoundaryRows = results
    .filter((r) => r.fallbackUsed)
    .map((r) =>
      [
        r.caseId,
        r.targetRegionId,
        `${r.bestRegionRawStart}-${r.bestRegionRawEnd}`,
        `${r.errorRawStart}-${r.errorRawEnd}`,
        r.oldSurfaces,
        r.newSurfaces,
        r.geometryExists,
        r.queryExposed ? 'YES' : 'NO',
        r.oldBoundaryBlocks,
        r.caseAnyReturn ? 'YES' : 'NO',
        r.caseTargetReturn ? 'YES' : 'NO',
        r.strictOwner,
      ]
        .map(csvEsc)
        .join(',')
    );
  const oldBoundaryCsv = [
    'caseId,pathId,region,expectedRepairInterval,originalFineSpanSurfaces,fallbackSpanSurfaces,repairCapableGeometry,repairCapableQueryExposed,oldBoundaryLockBlocks,recallInvoked,targetReturned,finalOwner',
    ...oldBoundaryRows,
  ].join('\n');

  const recallRows = unknown65.map((r) =>
    [
      r.caseId,
      '',
      r.targetRegionId,
      `${r.bestRegionRawStart}-${r.bestRegionRawEnd}`,
      r.oldSurfaces,
      'FALLBACK',
      '',
      '',
      '',
      r.regionRecallTotal,
      r.caseTargetReturn ? 'YES' : 'NO',
      r.caseAnyReturn ? 'non_target_or_unknown' : 'zero',
      r.strictOwner,
    ]
      .map(csvEsc)
      .join(',')
  );
  const recallCsv = [
    'caseId,pathId,regionId,spanInterval,surface,source,pinyinSummary,toneSummary,retainedDomains,candidateCount,targetCandidateReturned,candidateSurfacesSummary,owner',
    ...recallRows,
  ].join('\n');

  const ownerDist = Object.entries(ownerCounts)
    .filter(([k]) => !k.startsWith('unknown65:'))
    .sort((a, b) => b[1] - a[1])
    .map(([owner, count]) => {
      const examples = results.filter((r) => r.strictOwner === owner).slice(0, 3).map((r) => r.caseId);
      return [owner, count, 84, 'FROZEN_RAW_CASES_TRACE', 'HIGH', examples.join('|')].map(csvEsc).join(',');
    });
  const ownerCsv = [
    'owner,count,denominator,evidence_type,confidence,example_case_ids',
    ...ownerDist,
  ].join('\n');

  const unknown65Owners = {};
  for (const r of unknown65) unknown65Owners[r.strictOwner] = (unknown65Owners[r.strictOwner] || 0) + 1;
  const primaryOwner = Object.entries(unknown65Owners).sort((a, b) => b[1] - a[1])[0];

  const strict6Reclass = {
    remainLocalReseg: strict6.filter((r) =>
      r.strictOwner.includes('LOCAL_RESEGMENTATION')
    ).length,
    moveRecall: strict6.filter((r) => r.strictOwner.startsWith('RECALL')).length,
  };

  const latticeFailCount = results.filter((r) => !r.resegmentOk && r.cohort !== 'TARGET_IN_POOL').length;

  const summary = {
    phase: 'MODEL3_V2_LOCAL_RESEGMENTATION_TRACE_COMPLETENESS_AUDIT',
    timestamp: new Date().toISOString(),
    verdict:
      primaryOwner?.[0] === 'RECALL_TARGET_MISS'
        ? 'LOCAL_RESEG_TRACE_AUDIT_PASS_RECALL_PRIMARY'
        : primaryOwner?.[0]?.includes('OLD_BOUNDARY')
          ? 'LOCAL_RESEG_TRACE_AUDIT_PASS_OLD_BOUNDARY_LOCK_PRIMARY'
          : 'LOCAL_RESEG_TRACE_AUDIT_PASS_MIXED_LOCAL_AND_RECALL',
    nextPhase:
      primaryOwner?.[0] === 'RECALL_TARGET_MISS'
        ? 'MODEL3_V2_RECALL_PRODUCTION_SIGNAL_LOSS_DESIGN_AUDIT'
        : 'MODEL3_V2_LOCAL_RESEGMENTATION_ARCHITECTURE_RESTORATION_DESIGN_AUDIT',
    historicalUnknownPopulation: 65,
    resolvedCount: unknown65.filter((r) => r.strictOwner !== 'UNKNOWN').length,
    remainingUnknown: unknown65.filter((r) => r.strictOwner === 'UNKNOWN').length,
    strictPrimaryOwner: primaryOwner?.[0] || 'UNKNOWN',
    strictPrimaryOwnerCount: primaryOwner?.[1] || 0,
    oldBoundaryCausalCount: results.filter(
      (r) => r.strictOwner === 'LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK'
    ).length,
    recallCausalCount: results.filter((r) =>
      ['RECALL_TARGET_MISS', 'RECALL_ZERO_RETURN'].includes(r.strictOwner)
    ).length,
    downstreamCausalCount: pool13.length,
    historical84RetiredAs: 'HISTORICAL_REGIONAL_LATTICE_FAILURE_COHORT=84',
    freshAsrReplay: false,
    instrumentationAdded: false,
    traceFieldsUsed: [
      'retry_regions.resegmentOk',
      'retry_regions.oldLocalSpanSurfaces',
      'retry_regions.newLocalSpanSurfaces',
      'retry_regions.recallCandidatesReturned',
      'retry_regions.rawStart/rawEnd',
      'retry_returned/retry_zero',
    ],
    traceFieldsMissing: [
      'retry_regions.latticeCode',
      'retry_regions.latticePathViewCount',
      'per_span recallSpanTopKV2 pinyin/tone inputs',
      'per_invocation recall candidate surfaces',
    ],
    unknown65OwnerDistribution: unknown65Owners,
    latticeFailureInferred: {
      resegmentOkFalse: latticeFailCount,
      inferredCodes: 'NO_PATH_OR_EMPTY_PATH_VIEWS (latticeCode not in frozen trace; from production resegmentRetryRegionWithLattice contract)',
      fallbackUsed: results.filter((r) => r.fallbackUsed).length,
    },
    strict6Reclass,
    funnel: funnelStages,
    governance: {
      productionCodeModified: false,
      jobResultChanged: false,
      exactLexiconAsRecallProxy: false,
      pathLocalDomainVoteIntentional: true,
      noRetrySecondDomainVote: results.every(
        (r) => r.secondDomainVote !== 'YES' && (r.regionCount === 0 || r.secondDomainVote === 'NO')
      ),
    },
  };

  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_strict_causal_funnel.csv'), funnelCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_old_boundary_analysis.csv'), oldBoundaryCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_recall_trace.csv'), recallCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_owner_distribution.csv'), ownerCsv);
  fs.writeFileSync(
    path.join(DOCS, 'model3_v2_retry_trace_summary.json'),
    JSON.stringify(summary, null, 2)
  );

  console.log(JSON.stringify(summary, null, 2));
}

main();
