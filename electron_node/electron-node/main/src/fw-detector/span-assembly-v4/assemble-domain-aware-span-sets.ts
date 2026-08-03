import { getPerSpanCandidateLimit } from '../per-span-candidate-limit';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { UtteranceDomainVoteResult } from '../span-assembly-shared/utterance-domain-vote';
import { voteUtteranceDomainFromPool } from '../span-assembly-shared/utterance-domain-vote';
import type { DomainPrior } from '../domain-context-contract';
import { applyDomainPriorQuota } from './apply-domain-prior-quota';
import { findOwningCoarseSpanIndexV4 } from './find-owning-coarse-span-v4';
import type { PathFineSpan } from './path-fine-span-types';
import { assertPathFineSpansNonOverlapping } from './path-fine-span-types';
import type {
  DomainAssemblyDropTrace,
  DomainAwareAssemblyMetrics,
  DomainAwareAssemblyResult,
  DomainAwareSpanReplacementPick,
  DomainFilteredSpanSet,
  FineSpanCandidatePool,
} from './domain-assembly-types';
import type { WindowCandidate } from './v4-types';
import {
  canonicalSpanReplacementPick,
  domainAwareCanonicalFromCoarseSpan,
  domainAwareCanonicalFromPathFineSpan,
  domainAwarePickToSpanReplacementPick,
  windowCandidateToDomainAwarePickResult,
} from './window-candidate-to-pick';

function isSameDomainCandidate(
  candidate: DomainAwareSpanReplacementPick,
  bucketDomain: string
): boolean {
  return (
    (candidate.graphSource === 'domain_term' || candidate.graphSource === 'passive_domain_weak') &&
    Boolean(candidate.domains?.includes(bucketDomain))
  );
}

function isBaseCandidate(candidate: DomainAwareSpanReplacementPick): boolean {
  return candidate.graphSource === 'base_term';
}

function stableSortPicks(picks: DomainAwareSpanReplacementPick[]): DomainAwareSpanReplacementPick[] {
  return [...picks].sort((a, b) => b.score - a.score || a.candidateId.localeCompare(b.candidateId));
}

function dedupePicksByIdentity(picks: DomainAwareSpanReplacementPick[]): DomainAwareSpanReplacementPick[] {
  const byKey = new Map<string, DomainAwareSpanReplacementPick>();
  for (const pick of stableSortPicks(picks)) {
    const key = pick.candidateId || `${pick.span.start}:${pick.span.end}:${pick.word}`;
    if (!byKey.has(key)) {
      byKey.set(key, pick);
    }
  }
  return [...byKey.values()];
}

/** Surface-text dedupe for Assembly Grid (first wins after stable sort). */
function dedupePicksBySurface(picks: DomainAwareSpanReplacementPick[]): DomainAwareSpanReplacementPick[] {
  const bySurface = new Map<string, DomainAwareSpanReplacementPick>();
  for (const pick of stableSortPicks(picks)) {
    if (!bySurface.has(pick.word)) {
      bySurface.set(pick.word, pick);
    }
  }
  return [...bySurface.values()];
}

/** Pool by PathFineSpan (not coarse span). Production API — PathFineSpan[] required. */
export function buildFineSpanCandidatePool(
  activeCandidates: WindowCandidate[],
  _coarseSpans: CoarseSpan[],
  pathFineSpans: readonly PathFineSpan[]
): FineSpanCandidatePool[] {
  if (!pathFineSpans.length) {
    throw new Error(
      '[PATH_FINE_SPAN_POOL] production API requires PathFineSpan[]; silent coarse fallback is forbidden'
    );
  }
  assertPathFineSpansNonOverlapping(pathFineSpans);
  const pools: FineSpanCandidatePool[] = pathFineSpans.map((span) => ({
    fineSpanId: span.spanId,
    coarseSpanId: span.coarseSpanIds[0] ?? span.spanId,
    coarseSpanIds: span.coarseSpanIds,
    rawRange: [span.rawStart, span.rawEnd] as [number, number],
    syllableRange: [span.syllableStart, span.syllableEnd] as [number, number],
    candidates: [],
    windowSource: span.windowSource,
  }));
  const byWindowKey = new Map(pools.map((p) => [p.fineSpanId.replace(/^fine:/, ''), p]));
  for (const candidate of activeCandidates) {
    const pool =
      byWindowKey.get(candidate.windowId) ??
      pools.find(
        (p) =>
          candidate.syllableStart >= p.syllableRange[0] &&
          candidate.syllableEnd <= p.syllableRange[1]
      );
    pool?.candidates.push(candidate);
  }
  return pools;
}

/**
 * Legacy coarse pooling — TEST ONLY.
 * Must never be imported by production orchestrator / Vote path.
 */
export function buildFineSpanCandidatePoolFromCoarseSpansForTests(
  activeCandidates: WindowCandidate[],
  coarseSpans: CoarseSpan[]
): FineSpanCandidatePool[] {
  const pools: FineSpanCandidatePool[] = coarseSpans.map((span) => ({
    fineSpanId: span.id,
    coarseSpanId: span.id,
    rawRange: [span.rawStart, span.rawEnd] as [number, number],
    syllableRange: [span.syllableStart, span.syllableEnd] as [number, number],
    candidates: [],
  }));

  for (const candidate of activeCandidates) {
    const spanIdx = findOwningCoarseSpanIndexV4(
      candidate.rawStart,
      candidate.rawEnd,
      coarseSpans,
      candidate.anchorCoarseSpanId
    );
    if (spanIdx < 0) {
      continue;
    }
    pools[spanIdx].candidates.push(candidate);
  }

  return pools;
}

/** Map coarse partition spans to PathFineSpan stubs for unit tests that lack a Path/LTR run. */
export function coarseSpansAsPathFineSpansForTests(coarseSpans: CoarseSpan[]): PathFineSpan[] {
  return coarseSpans.map((span) => ({
    spanId: `fine:${span.syllableStart}:${span.syllableEnd}`,
    rawStart: span.rawStart,
    rawEnd: span.rawEnd,
    syllableStart: span.syllableStart,
    syllableEnd: span.syllableEnd,
    coarseSpanIds: [span.id],
    boundaryCrossCount: 0 as const,
    windowSource: 'in_span_window' as const,
    candidates: [],
    selectionReason: 'complete_in_span' as const,
  }));
}

/**
 * @param bucketDomain — retained fine domain for this bucket; null/undefined = base-only / general fallback mode
 */
export function filterDomainCandidatesPerSpan(
  pool: FineSpanCandidatePool[],
  vote: UtteranceDomainVoteResult,
  rawText: string,
  bucketDomain?: string | null
): DomainFilteredSpanSet[] {
  const isBaseOnly =
    bucketDomain == null ||
    vote.insufficientEvidence ||
    vote.retainedDomains.length === 0;

  return pool.map((spanPool) => {
    const sameDomainCandidates: DomainAwareSpanReplacementPick[] = [];
    const baseCandidates: DomainAwareSpanReplacementPick[] = [];
    const fallbackCandidates: DomainAwareSpanReplacementPick[] = [];
    const assemblyDropTraces: DomainAssemblyDropTrace[] = [];
    const fineSpanRange = {
      fineSpanId: spanPool.fineSpanId,
      rawStart: spanPool.rawRange[0],
      rawEnd: spanPool.rawRange[1],
      syllableStart: spanPool.syllableRange[0],
      syllableEnd: spanPool.syllableRange[1],
    };

    for (const candidate of spanPool.candidates) {
      const converted = windowCandidateToDomainAwarePickResult(candidate, rawText, fineSpanRange);
      if (!converted.ok) {
        assemblyDropTraces.push({
          candidateId: candidate.candidateId,
          replacement: candidate.replacement,
          hitKind: candidate.hitKind,
          source: candidate.source,
          domains: candidate.domains,
          dropReason: converted.dropReason,
          fineSpanId: spanPool.fineSpanId,
          bucketDomain: isBaseOnly ? null : bucketDomain,
        });
        continue;
      }
      const pick = converted.pick;

      if (!isBaseOnly && bucketDomain && isSameDomainCandidate(pick, bucketDomain)) {
        sameDomainCandidates.push(pick);
      } else if (isBaseCandidate(pick)) {
        baseCandidates.push(pick);
      } else if (isBaseOnly) {
        fallbackCandidates.push(pick);
      }
      // Cross-domain domain_term for this bucket: intentionally excluded (not a drop of eligibility).
    }

    return {
      fineSpanId: spanPool.fineSpanId,
      coarseSpanId: spanPool.coarseSpanId,
      rawRange: spanPool.rawRange,
      syllableRange: spanPool.syllableRange,
      sameDomainCandidates: dedupePicksByIdentity(sameDomainCandidates),
      baseCandidates: dedupePicksByIdentity(baseCandidates),
      fallbackCandidates: dedupePicksByIdentity(fallbackCandidates),
      selectedCandidates: [],
      bucketDomain: isBaseOnly ? null : bucketDomain,
      assemblyDropTraces,
    };
  });
}

/**
 * Per-span candidate budget for Assembly (multi-candidate set).
 * Not per-span final winner selection.
 *
 * Always includes canonical/raw as a preservation candidate when a FineSpan/CoarseSpan
 * is available; surface-dedupes before applying per-span cap.
 */
export function selectPerSpanCandidates(
  filteredSets: DomainFilteredSpanSet[],
  spanSlotCount: number,
  coarseSpans: CoarseSpan[],
  pathFineSpans?: readonly PathFineSpan[],
  rawText = '',
  domainPriors: readonly DomainPrior[] = []
): DomainFilteredSpanSet[] {
  return budgetPerSpanCandidates(
    filteredSets,
    spanSlotCount,
    coarseSpans,
    pathFineSpans,
    rawText,
    domainPriors
  );
}

/** Preferred name: per-span budget, not winner selection. */
export function budgetPerSpanCandidates(
  filteredSets: DomainFilteredSpanSet[],
  spanSlotCount: number,
  coarseSpans: CoarseSpan[],
  pathFineSpans?: readonly PathFineSpan[],
  rawText = '',
  domainPriors: readonly DomainPrior[] = []
): DomainFilteredSpanSet[] {
  const perSpanLimit = getPerSpanCandidateLimit(spanSlotCount);
  const spanById = new Map(coarseSpans.map((span) => [span.id, span]));
  const pathFineSpanById = new Map((pathFineSpans ?? []).map((s) => [s.spanId, s]));

  return filteredSets.map((set) => {
    const pathSpan = set.fineSpanId ? pathFineSpanById.get(set.fineSpanId) : undefined;
    const coarseSpan = spanById.get(set.coarseSpanId);
    const canonical: DomainAwareSpanReplacementPick | null = pathSpan
      ? domainAwareCanonicalFromPathFineSpan(pathSpan, rawText)
      : coarseSpan
        ? domainAwareCanonicalFromCoarseSpan(coarseSpan)
        : null;

    const ordered = [
      ...stableSortPicks(set.sameDomainCandidates),
      ...stableSortPicks(set.baseCandidates),
      ...stableSortPicks(set.fallbackCandidates),
    ];

    // Canonical/raw is always a preservation candidate (coexists with Recall), not an empty-only mask.
    const withCanonical =
      canonical != null ? dedupePicksByIdentity([...ordered, canonical]) : ordered;
    const surfaceDeduped = dedupePicksBySurface(withCanonical);

    const budgeted = domainPriors.length
      ? applyDomainPriorQuota(surfaceDeduped, domainPriors, perSpanLimit)
      : surfaceDeduped.slice(0, perSpanLimit);

    // Guarantee at least canonical/raw so Assembly always has a legal slot.
    const selected =
      budgeted.length > 0
        ? budgeted
        : canonical != null
          ? [canonical]
          : [];

    return { ...set, selectedCandidates: selected };
  });
}

export function assembleDomainAwareSpanSets(
  filteredSets: DomainFilteredSpanSet[]
): import('../build-sentence-candidates').SpanReplacementPick[][] {
  return filteredSets.map((set) =>
    set.selectedCandidates.map((pick) => domainAwarePickToSpanReplacementPick(pick))
  );
}

function computeAssemblyMetrics(
  filteredSets: DomainFilteredSpanSet[],
  spanSets: import('../build-sentence-candidates').SpanReplacementPick[][],
  domainAssemblyMs: number,
  retainedBucketCount: number
): DomainAwareAssemblyMetrics {
  const domainCandidateCount = filteredSets.reduce(
    (sum, set) => sum + set.sameDomainCandidates.length,
    0
  );
  const baseCandidateCount = filteredSets.reduce((sum, set) => sum + set.baseCandidates.length, 0);
  const sameDomainCandidateCount = domainCandidateCount;
  const selectedTotal = spanSets.reduce((sum, set) => sum + set.length, 0);

  return {
    domainCandidateCount,
    baseCandidateCount,
    sameDomainCandidateCount,
    domainFilteredSpanCount: filteredSets.length,
    selectedCandidatesPerSpanAvg:
      filteredSets.length > 0 ? selectedTotal / filteredSets.length : 0,
    domainAssemblyMs,
    mainDomainAwareSpanSetsTotal: selectedTotal,
    retainedBucketCount,
  };
}

export function runDomainAwareAssembly(
  activeCandidates: WindowCandidate[],
  coarseSpans: CoarseSpan[],
  rawText: string,
  pathFineSpans: readonly PathFineSpan[],
  domainPriors: readonly DomainPrior[] = []
): DomainAwareAssemblyResult {
  const start = Date.now();
  if (!pathFineSpans.length) {
    throw new Error(
      '[PATH_FINE_SPAN_POOL] runDomainAwareAssembly requires PathFineSpan[]; coarse fallback is forbidden'
    );
  }
  assertPathFineSpansNonOverlapping(pathFineSpans);
  const pool = buildFineSpanCandidatePool(activeCandidates, coarseSpans, pathFineSpans);
  const vote = voteUtteranceDomainFromPool(pool);

  const bucketDomains: Array<string | null> =
    vote.insufficientEvidence || vote.retainedDomains.length === 0
      ? [null]
      : [...vote.retainedDomains];

  const bucketSpanSets: import('../build-sentence-candidates').SpanReplacementPick[][][] = [];
  let primaryFiltered: DomainFilteredSpanSet[] = [];
  let aggregateSameDomain = 0;
  let aggregateBase = 0;
  const slotCount = pathFineSpans.length;

  for (const bucketDomain of bucketDomains) {
    const filtered = filterDomainCandidatesPerSpan(pool, vote, rawText, bucketDomain);
    const selected = budgetPerSpanCandidates(
      filtered,
      slotCount,
      coarseSpans,
      pathFineSpans,
      rawText,
      domainPriors
    );
    const spanSets = assembleDomainAwareSpanSets(selected);
    bucketSpanSets.push(spanSets);
    aggregateSameDomain += selected.reduce((s, set) => s + set.sameDomainCandidates.length, 0);
    aggregateBase += selected.reduce((s, set) => s + set.baseCandidates.length, 0);
    if (!primaryFiltered.length) {
      primaryFiltered = selected;
    }
  }

  const domainAssemblyMs = Date.now() - start;
  const primarySpanSets = bucketSpanSets[0] ?? [];

  return {
    vote,
    filteredSets: primaryFiltered,
    spanSets: primarySpanSets,
    bucketSpanSets,
    metrics: {
      ...computeAssemblyMetrics(
        primaryFiltered,
        primarySpanSets,
        domainAssemblyMs,
        bucketDomains.length
      ),
      domainCandidateCount: aggregateSameDomain,
      baseCandidateCount: aggregateBase,
      sameDomainCandidateCount: aggregateSameDomain,
    },
  };
}

/** @internal test helper */
export function canonicalPickForSpan(
  span: CoarseSpan
): import('../build-sentence-candidates').SpanReplacementPick {
  return canonicalSpanReplacementPick(span);
}
