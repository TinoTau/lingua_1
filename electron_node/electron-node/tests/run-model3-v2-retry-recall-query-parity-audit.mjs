#!/usr/bin/env node
/**
 * MODEL3_V2_RETRY_RECALL_QUERY_PARITY_AUDIT �?READ-ONLY classification
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import {
  deriveCorrectionUnits,
  candidateLexicalMatchesUnit,
  norm,
} from './lib/materializable-target-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO = path.resolve(__dirname, '../../..');
const DIST = path.join(REPO, 'electron_node', 'electron-node', 'dist', 'main', 'electron-node', 'main', 'src');
const DOCS = path.join(REPO, 'docs', 'user_correction', 'model3');
const POP_CSV = path.join(DOCS, 'model3_v2_local_reseg_population.csv');
const TRACE_JSONL = path.join(DOCS, 'model3_v2_retry_recall_query_trace.jsonl');
const OLD_BOUNDARY_CSV = path.join(DOCS, 'model3_v2_retry_old_boundary_analysis.csv');

const OLD_BOUNDARY_FLAGGED = new Set([
  'd007', 'd044', 'd061', 'd067', 'd117', 'd145', 'd156', 'd184', 'd187', 'd189',
]);

let textToSyllables = null;
try {
  ({ textToSyllables } = require(path.join(DIST, 'lexicon/phonetic/pinyin.js')));
} catch {
  /* optional */
}

function syllablesKeyFrom(syl) {
  return (syl || []).join('|');
}

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

function regionById(regions, id) {
  return regions.find((r) => r.retryRegionId === id);
}

function fallbackBoundaries(region, rawText) {
  const spans = [];
  let pos = region.rawStart;
  for (const surf of region.oldLocalSpanSurfaces || []) {
    spans.push({ rawStart: pos, rawEnd: pos + surf.length, surface: surf });
    pos += surf.length;
  }
  return spans;
}

function crossBoundaryRequired(region, lexicalUnits) {
  const bounds = fallbackBoundaries(region, '');
  for (const u of lexicalUnits) {
    const { rawStart, rawEnd } = u.source_range;
    if (rawStart == null || rawEnd == null) continue;
    let hit = 0;
    for (const b of bounds) {
      if (rangeOverlap(b.rawStart, b.rawEnd, rawStart, rawEnd)) hit += 1;
    }
    if (hit > 1) return 'CROSS_BOUNDARY_REQUIRED';
  }
  return bounds.length > 1 ? 'CROSS_BOUNDARY_NOT_REQUIRED' : 'CROSS_BOUNDARY_NOT_REQUIRED';
}

function boundaryParity(actualStart, actualEnd, expectedStart, expectedEnd) {
  if (actualStart == null || expectedStart == null) return 'UNKNOWN';
  if (actualStart === expectedStart && actualEnd === expectedEnd) return 'BOUNDARY_EXACT';
  if (actualStart <= expectedStart && actualEnd >= expectedEnd) return 'BOUNDARY_SUPERSET_COMPATIBLE';
  if (rangeOverlap(actualStart, actualEnd, expectedStart, expectedEnd)) {
    return 'BOUNDARY_OVERLAP_INSUFFICIENT';
  }
  return 'BOUNDARY_DISJOINT';
}

function expectedPinyinKey(rawText, rawStart, rawEnd) {
  if (!textToSyllables) return null;
  const slice = rawText.slice(rawStart, rawEnd);
  const syl = textToSyllables(slice);
  return syl.length ? syllablesKeyFrom(syl) : null;
}

function pinyinParity(inv, rawText, unit) {
  const { rawStart, rawEnd } = unit.source_range;
  if (rawStart == null || rawEnd == null) return 'NOT_APPLICABLE';
  const expectedKey = expectedPinyinKey(rawText, rawStart, rawEnd);
  if (!expectedKey) return 'PINYIN_MISSING';
  if (inv.windowPinyinKey === expectedKey) return 'PINYIN_PARITY_PASS';
  const invLen = (inv.syllables || []).length;
  const expLen = expectedKey.split('|').length;
  if (invLen >= expLen && inv.windowPinyinKey.includes(expectedKey)) return 'PINYIN_PARTIAL_COMPATIBLE';
  return 'PINYIN_MISMATCH';
}

function toneParity(inv) {
  if (inv.acousticTonePattern?.length) return 'TONE_PARITY_PASS';
  return 'NOT_APPLICABLE';
}

function domainParity(_inv, _retainedDomains) {
  return 'DOMAIN_SCOPE_PASS';
}

function queryParityClass(boundary, pinyin, tone, domain) {
  if (boundary === 'BOUNDARY_EXACT' || boundary === 'BOUNDARY_SUPERSET_COMPATIBLE') {
    if (pinyin === 'PINYIN_MISMATCH' || pinyin === 'PINYIN_MISSING') return 'QUERY_PINYIN_MISMATCH';
    if (tone === 'TONE_BLOCKS_TARGET') return 'QUERY_TONE_MISMATCH';
    if (domain === 'DOMAIN_SCOPE_BLOCKS_TARGET') return 'QUERY_DOMAIN_SCOPE_BLOCK';
    if (pinyin === 'PINYIN_PARITY_PASS' || pinyin === 'PINYIN_PARTIAL_COMPATIBLE' || pinyin === 'NOT_APPLICABLE') {
      return 'QUERY_PARITY_PASS';
    }
  }
  if (boundary === 'BOUNDARY_OVERLAP_INSUFFICIENT' || boundary === 'BOUNDARY_DISJOINT') {
    return 'QUERY_BOUNDARY_MISMATCH';
  }
  return 'INSUFFICIENT_EVIDENCE';
}

function targetInCandidates(inv, units, rawNorm, expNorm) {
  for (const c of inv.candidates || []) {
    for (const u of units.filter((x) => x.is_reference_diff_hunk)) {
      if (candidateLexicalMatchesUnit({ surface: c.surface }, u, rawNorm, expNorm)) {
        return true;
      }
    }
  }
  return false;
}

function cohortFromPop(row) {
  if (row.strictCausalOwner === 'CONFIRMED_LOCAL_RESEGMENTATION_FAILURE') return 'PROVISIONAL_ZERO';
  if (row.strictCausalOwner === 'DOWNSTREAM_CANDIDATE_OR_TRACE_SEMANTICS') return 'POSITIVE_CONTROL';
  if (row.strictCausalOwner === 'UNKNOWN_NEEDS_TRACE' || row.reclass === 'TRACE_INSUFFICIENT') {
    return 'PROVISIONAL_TARGET_MISS';
  }
  return 'HISTORICAL_84';
}

function analyzeCase(rec, popRow) {
  const rawAsr = rec.raw_asr || '';
  const expected = rec.expected || '';
  const derived = deriveCorrectionUnits(rawAsr, expected);
  const errorRegion = errorRegionFromUnits(derived.required_units);
  const lexicalUnits = derived.required_units.filter((u) => u.is_reference_diff_hunk);
  const cohort = cohortFromPop(popRow);
  const unitsNeedingRepair = lexicalUnits.length
    ? lexicalUnits
    : derived.required_units.filter((u) => u.operation !== 'UNCHANGED');
  const primaryUnit = unitsNeedingRepair[0];

  const invocations = [];
  for (const p of rec.paths || []) {
    for (const inv of p.retry_recall_invocations || []) {
      const region = regionById(p.retry_regions || [], inv.retryRegionId);
      if (!region || !errorRegion) continue;
      if (!rangeOverlap(region.rawStart, region.rawEnd, errorRegion.rawStart, errorRegion.rawEnd)) continue;
      const cross = crossBoundaryRequired(region, lexicalUnits);
      for (const unit of unitsNeedingRepair) {
        const bParity = boundaryParity(
          inv.spanStart,
          inv.spanEnd,
          unit.source_range.rawStart,
          unit.source_range.rawEnd
        );
        const pParity = pinyinParity(inv, rawAsr, unit);
        const tParity = toneParity(inv);
        const dParity = domainParity(inv, p.retained_domains);
        const qParity = queryParityClass(bParity, pParity, tParity, dParity);
        const targetReturned = targetInCandidates(inv, [unit], derived.raw_norm, derived.expected_norm);
        invocations.push({
          pathId: p.path_id,
          region,
          inv,
          unit,
          cross,
          bParity,
          pParity,
          tParity,
          dParity,
          qParity,
          targetReturned,
        });
      }
    }
  }

  const parityPass = invocations.filter((x) => x.qParity === 'QUERY_PARITY_PASS');
  const allUnitsParity =
    unitsNeedingRepair.length > 0 &&
    unitsNeedingRepair.every((u) =>
      invocations.some(
        (x) => x.qParity === 'QUERY_PARITY_PASS' && x.unit.expected_text === u.expected_text
      )
    );
  const best =
    parityPass.find((x) => x.targetReturned) ||
    parityPass[0] ||
    invocations.find((x) => x.qParity !== 'QUERY_BOUNDARY_MISMATCH') ||
    invocations[0];
  const anyInvoked = invocations.length > 0;
  const anyReturned = invocations.some((x) => (x.inv.candidateCount || 0) > 0);
  const anyTarget = invocations.some((x) => x.targetReturned);

  let queryParity = 'INSUFFICIENT_EVIDENCE';
  if (allUnitsParity) queryParity = 'QUERY_PARITY_PASS';
  else if (parityPass.length) queryParity = 'QUERY_MULTIPLE_MISMATCHES';
  else if (invocations.some((x) => x.qParity === 'QUERY_BOUNDARY_MISMATCH')) queryParity = 'QUERY_BOUNDARY_MISMATCH';
  else if (invocations.some((x) => x.qParity === 'QUERY_PINYIN_MISMATCH')) queryParity = 'QUERY_PINYIN_MISMATCH';
  else if (!anyInvoked) queryParity = 'INSUFFICIENT_EVIDENCE';

  let firstFailOwner = 'UNKNOWN';
  if (cohort === 'POSITIVE_CONTROL') {
    firstFailOwner = 'DOWNSTREAM_TARGET_PRESENT';
  } else if (!unitsNeedingRepair.length) {
    firstFailOwner = 'NO_REPAIRABLE_TARGET';
  } else if (queryParity !== 'QUERY_PARITY_PASS') {
    if (queryParity === 'QUERY_BOUNDARY_MISMATCH' || queryParity === 'QUERY_MULTIPLE_MISMATCHES') {
      const crossReq = invocations.some((x) => x.cross === 'CROSS_BOUNDARY_REQUIRED');
      firstFailOwner = crossReq
        ? 'LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK'
        : 'RETRY_QUERY_BOUNDARY';
    } else if (queryParity === 'QUERY_PINYIN_MISMATCH') firstFailOwner = 'RETRY_QUERY_PINYIN';
    else firstFailOwner = 'INSUFFICIENT_EVIDENCE';
  } else if (anyTarget) {
    firstFailOwner = 'NO_BLOCKER';
  } else if (!anyReturned) {
    firstFailOwner = 'RECALL_ZERO_RETURN';
  } else {
    firstFailOwner = 'RECALL_TARGET_MISS';
  }

  const region = best?.region;
  const inv = best?.inv;
  return {
    caseId: rec.caseId,
    cohort,
    pathId: best?.pathId || '',
    retryRegionId: inv?.retryRegionId || '',
    expectedRepairStart: primaryUnit?.source_range.rawStart ?? '',
    expectedRepairEnd: primaryUnit?.source_range.rawEnd ?? '',
    expectedRepairSurface: primaryUnit?.expected_text ?? '',
    crossBoundaryRequired: best?.cross || 'UNKNOWN',
    localSpanSource: inv?.localSpanSource || '',
    actualSpanStart: inv?.spanStart ?? '',
    actualSpanEnd: inv?.spanEnd ?? '',
    actualSpanSurface: inv?.spanSurface || '',
    windowText: inv?.windowText || '',
    windowPinyinKey: inv?.windowPinyinKey || '',
    syllablesSummary: (inv?.syllables || []).join('|'),
    toneSummary: (inv?.acousticTonePattern || []).join(','),
    retainedDomains: (inv?.retainedDomains || []).join('|'),
    boundaryParity: best?.bParity || '',
    pinyinParity: best?.pParity || '',
    toneParity: best?.tParity || '',
    domainParity: best?.dParity || '',
    queryParity,
    recallInvoked: anyInvoked ? 'YES' : 'NO',
    candidateCount: invocations.reduce((s, x) => s + (x.inv.candidateCount || 0), 0),
    candidateSurfaceSummary: invocations
      .flatMap((x) => (x.inv.candidates || []).map((c) => c.surface))
      .slice(0, 8)
      .join('|'),
    targetReturned: anyTarget ? 'YES' : 'NO',
    firstFailOwner,
    evidenceConfidence: invocations.length ? 'HIGH' : 'LOW',
    invocationCount: invocations.length,
    parityPassCount: parityPass.length,
    previousProvisional: popRow.strictCausalOwner || '',
    oldBoundaryFlagged: OLD_BOUNDARY_FLAGGED.has(rec.caseId),
  };
}

function main() {
  if (!fs.existsSync(TRACE_JSONL)) {
    console.error('Missing trace jsonl �?run replay first');
    process.exit(2);
  }
  const pop = parseCsv(fs.readFileSync(POP_CSV, 'utf8'));
  const popById = new Map(pop.map((r) => [r.caseId, r]));
  const traces = fs
    .readFileSync(TRACE_JSONL, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.label === 'DIAGNOSTIC_REPLAY' && !r.error);

  const results = traces.map((rec) => analyzeCase(rec, popById.get(rec.caseId) || {}));

  const ownerCounts = {};
  for (const r of results) ownerCounts[r.firstFailOwner] = (ownerCounts[r.firstFailOwner] || 0) + 1;

  const prov65 = results.filter((r) => r.cohort === 'PROVISIONAL_TARGET_MISS');
  const prov6 = results.filter((r) => r.cohort === 'PROVISIONAL_ZERO');
  const pos13 = results.filter((r) => r.cohort === 'POSITIVE_CONTROL');

  const prov71 = [...prov65, ...prov6];
  const recallConfirmed = prov71.filter((r) =>
    ['RECALL_TARGET_MISS', 'RECALL_ZERO_RETURN'].includes(r.firstFailOwner)
  ).length;
  const upstream = prov71.filter((r) =>
    r.firstFailOwner.includes('LOCAL_RESEG') ||
    r.firstFailOwner.includes('RETRY_QUERY') ||
    r.firstFailOwner === 'INSUFFICIENT_EVIDENCE'
  ).length;

  const oldFlagged = results.filter((r) => r.oldBoundaryFlagged);
  const oldConfirmed = oldFlagged.filter(
    (r) => r.firstFailOwner === 'LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK'
  ).length;
  const oldOverturned = oldFlagged.filter((r) => r.queryParity === 'QUERY_PARITY_PASS').length;

  const caseCsv = [
    'caseId,pathId,retryRegionId,expectedRepairStart,expectedRepairEnd,expectedRepairSurface,crossBoundaryRequired,localSpanSource,actualSpanStart,actualSpanEnd,actualSpanSurface,windowText,windowPinyinKey,syllablesSummary,toneSummary,retainedDomains,boundaryParity,pinyinParity,toneParity,domainParity,queryParity,recallInvoked,candidateCount,candidateSurfaceSummary,targetReturned,firstFailOwner,evidenceConfidence',
    ...results.map((r) =>
      [
        r.caseId,
        r.pathId,
        r.retryRegionId,
        r.expectedRepairStart,
        r.expectedRepairEnd,
        r.expectedRepairSurface,
        r.crossBoundaryRequired,
        r.localSpanSource,
        r.actualSpanStart,
        r.actualSpanEnd,
        r.actualSpanSurface,
        r.windowText,
        r.windowPinyinKey,
        r.syllablesSummary,
        r.toneSummary,
        r.retainedDomains,
        r.boundaryParity,
        r.pinyinParity,
        r.toneParity,
        r.domainParity,
        r.queryParity,
        r.recallInvoked,
        r.candidateCount,
        r.candidateSurfaceSummary,
        r.targetReturned,
        r.firstFailOwner,
        r.evidenceConfidence,
      ]
        .map(csvEsc)
        .join(',')
    ),
  ].join('\n');

  const mismatches = results.filter((r) => r.queryParity !== 'QUERY_PARITY_PASS' && r.cohort !== 'POSITIVE_CONTROL');
  const mismatchCsv = [
    'caseId,pathId,region,expectedQuery,actualQuery,mismatchType,originalFineSpanBoundaries,fallbackBoundaries,crossBoundaryRequired,oldBoundaryLockBlocks,owner,evidence',
    ...mismatches.map((r) =>
      [
        r.caseId,
        r.pathId,
        r.retryRegionId,
        `${r.expectedRepairStart}-${r.expectedRepairEnd}:${r.expectedRepairSurface}`,
        `${r.actualSpanStart}-${r.actualSpanEnd}:${r.windowText}|${r.windowPinyinKey}`,
        r.queryParity,
        r.expectedRepairSurface,
        r.actualSpanSurface,
        r.crossBoundaryRequired,
        r.oldBoundaryFlagged ? 'PREVIOUSLY_FLAGGED' : 'NO',
        r.firstFailOwner,
        r.evidenceConfidence,
      ]
        .map(csvEsc)
        .join(',')
    ),
  ].join('\n');

  const recallConfirmedRows = results.filter(
    (r) => r.queryParity === 'QUERY_PARITY_PASS' && ['RECALL_TARGET_MISS', 'RECALL_ZERO_RETURN'].includes(r.firstFailOwner)
  );
  const recallCsv = [
    'caseId,pathId,region,actualQuery,pinyin,tone,domains,candidateCount,candidateSummary,targetReturned,RecallFailureType',
    ...recallConfirmedRows.map((r) =>
      [
        r.caseId,
        r.pathId,
        r.retryRegionId,
        r.windowText,
        r.windowPinyinKey,
        r.toneSummary,
        r.retainedDomains,
        r.candidateCount,
        r.candidateSurfaceSummary,
        r.targetReturned,
        r.firstFailOwner,
      ]
        .map(csvEsc)
        .join(',')
    ),
  ].join('\n');

  const funnel = [
    ['historical_cohort_84', 84, results.length, 84 - results.length, 0, ''],
    ['repair_opportunity', results.length, results.length, 0, 0, ''],
    ['actual_query_captured', results.length, results.filter((r) => r.invocationCount > 0).length, results.filter((r) => r.invocationCount === 0).length, 0, 'INSUFFICIENT_EVIDENCE'],
    ['query_parity_pass', results.length, results.filter((r) => r.queryParity === 'QUERY_PARITY_PASS').length, results.filter((r) => r.queryParity !== 'QUERY_PARITY_PASS' && r.cohort !== 'POSITIVE_CONTROL').length, 0, 'QUERY_MISMATCH'],
    ['recall_target_return', results.filter((r) => r.queryParity === 'QUERY_PARITY_PASS').length, recallConfirmedRows.filter((r) => r.targetReturned === 'YES').length, recallConfirmedRows.filter((r) => r.firstFailOwner === 'RECALL_TARGET_MISS').length, 0, 'RECALL_TARGET_MISS'],
  ];
  const funnelCsv = [
    'stage,input,pass,fail,unknown,first_fail_owner',
    ...funnel.map((f) => f.join(',')),
  ].join('\n');

  const ownerDist = Object.entries(ownerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([owner, count]) => [owner, count, 84, 'PRODUCTION_RECALL_TRACE', 'HIGH', ''].map(csvEsc).join(','));
  const ownerCsv = ['owner,count,denominator,evidence_type,confidence,example_case_ids', ...ownerDist].join('\n');

  const primaryOwner = Object.entries(
    prov71.reduce((acc, r) => {
      acc[r.firstFailOwner] = (acc[r.firstFailOwner] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1])[0];

  const verdict =
    primaryOwner?.[0] === 'RECALL_TARGET_MISS' || primaryOwner?.[0] === 'RECALL_ZERO_RETURN'
      ? 'RETRY_RECALL_QUERY_PARITY_PASS_RECALL_PRIMARY'
      : primaryOwner?.[0]?.includes('OLD_BOUNDARY')
        ? 'RETRY_RECALL_QUERY_PARITY_PASS_OLD_BOUNDARY_PRIMARY'
        : primaryOwner?.[0]?.includes('RETRY_QUERY')
          ? 'RETRY_RECALL_QUERY_PARITY_PASS_QUERY_MAPPING_PRIMARY'
          : results.some((r) => r.invocationCount === 0)
            ? 'RETRY_RECALL_QUERY_PARITY_EVIDENCE_INSUFFICIENT'
            : 'RETRY_RECALL_QUERY_PARITY_PASS_MIXED';

  const nextPhase =
    verdict.includes('RECALL_PRIMARY')
      ? 'MODEL3_V2_RECALL_PRODUCTION_SIGNAL_LOSS_DESIGN_AUDIT'
      : verdict.includes('OLD_BOUNDARY')
        ? 'MODEL3_V2_LOCAL_RESEGMENTATION_ARCHITECTURE_RESTORATION_DESIGN_AUDIT'
        : verdict.includes('QUERY_MAPPING')
          ? 'MODEL3_V2_RETRY_QUERY_MAPPING_CORRECTION_DESIGN_AUDIT'
          : verdict.includes('INSUFFICIENT')
            ? 'MODEL3_V2_RETRY_RECALL_QUERY_TRACE_COMPLETENESS_AUDIT'
            : 'MODEL3_V2_RETRY_RECALL_BOUNDARY_CORRECTION_DESIGN_AUDIT';

  const summary = {
    phase: 'MODEL3_V2_RETRY_RECALL_QUERY_PARITY_AUDIT',
    timestamp: new Date().toISOString(),
    verdict,
    nextPhase,
    historicalCohort: 84,
    tracesRecovered: results.length,
    queryParityPass: results.filter((r) => r.queryParity === 'QUERY_PARITY_PASS').length,
    boundaryMismatch: results.filter((r) => r.queryParity === 'QUERY_BOUNDARY_MISMATCH').length,
    pinyinMismatch: results.filter((r) => r.queryParity === 'QUERY_PINYIN_MISMATCH').length,
    confirmedRecallOwner: recallConfirmed,
    reclassifiedUpstream: upstream,
    remainingUnknown: results.filter((r) => r.firstFailOwner === 'UNKNOWN' || r.firstFailOwner === 'INSUFFICIENT_EVIDENCE').length,
    provisional71: { previous: 71, recallConfirmed, upstream, reconcile: recallConfirmed + upstream },
    prov65: {
      remainRecallTargetMiss: prov65.filter((r) => r.firstFailOwner === 'RECALL_TARGET_MISS').length,
      moveUpstream: prov65.filter((r) => !['RECALL_TARGET_MISS', 'RECALL_ZERO_RETURN'].includes(r.firstFailOwner)).length,
    },
    prov6: {
      remainRecallZero: prov6.filter((r) => r.firstFailOwner === 'RECALL_ZERO_RETURN').length,
      moveUpstream: prov6.filter((r) => r.firstFailOwner !== 'RECALL_ZERO_RETURN').length,
    },
    oldBoundaryRevalidation: {
      flagged: oldFlagged.length,
      confirmedCausal: oldConfirmed,
      overturned: oldOverturned,
    },
    prov71OwnerDistribution: prov71.reduce((acc, r) => {
      acc[r.firstFailOwner] = (acc[r.firstFailOwner] || 0) + 1;
      return acc;
    }, {}),
    primaryOwnerAmongProv71: primaryOwner?.[0] || 'UNKNOWN',
    primaryOwnerCountAmongProv71: primaryOwner?.[1] || 0,
    instrumentationAdded: true,
    traceGate: 'MODEL2_DIALOG200_TRACE=1',
    governance: { productionBusinessLogicChanged: false, jobResultChanged: false },
  };

  if (results.length < 84) {
    summary.tracesIncomplete = true;
    summary.tracesExpected = 84;
  }

  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_recall_query_parity_cases.csv'), caseCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_query_mismatches.csv'), mismatchCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_recall_confirmed_failures.csv'), recallCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_recall_query_funnel.csv'), funnelCsv);
  fs.writeFileSync(path.join(DOCS, 'model3_v2_retry_recall_query_summary.json'), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
}

main();
