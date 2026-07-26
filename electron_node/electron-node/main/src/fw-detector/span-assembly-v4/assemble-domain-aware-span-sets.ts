import { getPerSpanCandidateLimit } from '../per-span-candidate-limit';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { UtteranceDomainVoteResult } from '../span-assembly-shared/utterance-domain-vote';
import { voteUtteranceDomainFromPool } from '../span-assembly-shared/utterance-domain-vote';
import type { DomainPrior } from '../domain-context-contract';
import { applyDomainPriorQuota } from './apply-domain-prior-quota';
import { findOwningCoarseSpanIndexV4 } from './find-owning-coarse-span-v4';
import type { FormalFineSpan } from './ltr-fine-span-generator';
import { assertFormalFineSpansNonOverlapping } from './ltr-fine-span-generator';
import type {
  DomainAwareAssemblyMetrics,
  DomainAwareAssemblyResult,
  DomainAwareSpanReplacementPick,
  DomainFilteredSpanSet,
  FineSpanCandidatePool,
} from './domain-assembly-types';
import type { WindowCandidate } from './v4-types';
import {
  canonicalSpanReplacementPick,
  domainAwarePickToSpanReplacementPick,
  windowCandidateToDomainAwarePick,
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

function dedupePicks(picks: DomainAwareSpanReplacementPick[]): DomainAwareSpanReplacementPick[] {
  const byKey = new Map<string, DomainAwareSpanReplacementPick>();
  for (const pick of stableSortPicks(picks)) {
    const key = pick.candidateId || `${pick.span.start}:${pick.span.end}:${pick.word}`;
    if (!byKey.has(key)) {
      byKey.set(key, pick);
    }
  }
  return [...byKey.values()];
}

/** Pool by committed Formal FineSpan (not coarse span). Production API — FormalFineSpan[] required. */
export function buildFineSpanCandidatePool(
  activeCandidates: WindowCandidate[],
  _coarseSpans: CoarseSpan[],
  formalSpans: readonly FormalFineSpan[]
): FineSpanCandidatePool[] {
  if (!formalSpans.length) {
    throw new Error(
      '[FORMAL_POOL] production API requires FormalFineSpan[]; silent coarse fallback is forbidden'
    );
  }
  assertFormalFineSpansNonOverlapping(formalSpans);
  const pools: FineSpanCandidatePool[] = formalSpans.map((span) => ({
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

/** Map coarse partition spans to FormalFineSpan stubs for unit tests that lack an LTR run. */
export function coarseSpansAsFormalFineSpansForTests(
  coarseSpans: CoarseSpan[]
): FormalFineSpan[] {
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

    for (const candidate of spanPool.candidates) {
      if (candidate.isCovered) {
        continue;
      }
      const pick = windowCandidateToDomainAwarePick(candidate, rawText);
      if (!pick) {
        continue;
      }

      if (!isBaseOnly && bucketDomain && isSameDomainCandidate(pick, bucketDomain)) {
        sameDomainCandidates.push(pick);
      } else if (isBaseCandidate(pick)) {
        baseCandidates.push(pick);
      } else if (isBaseOnly) {
        fallbackCandidates.push(pick);
      }
    }

    return {
      fineSpanId: spanPool.fineSpanId,
      coarseSpanId: spanPool.coarseSpanId,
      rawRange: spanPool.rawRange,
      syllableRange: spanPool.syllableRange,
      sameDomainCandidates: dedupePicks(sameDomainCandidates),
      baseCandidates: dedupePicks(baseCandidates),
      fallbackCandidates: dedupePicks(fallbackCandidates),
      selectedCandidates: [],
      bucketDomain: isBaseOnly ? null : bucketDomain,
    };
  });
}

export function selectPerSpanCandidates(
  filteredSets: DomainFilteredSpanSet[],
  spanSlotCount: number,
  coarseSpans: CoarseSpan[],
  formalSpans?: readonly FormalFineSpan[],
  rawText = '',
  domainPriors: readonly DomainPrior[] = []
): DomainFilteredSpanSet[] {
  const perSpanLimit = getPerSpanCandidateLimit(spanSlotCount);
  const spanById = new Map(coarseSpans.map((span) => [span.id, span]));
  const formalById = new Map((formalSpans ?? []).map((s) => [s.spanId, s]));

  return filteredSets.map((set) => {
    const ordered = [
      ...stableSortPicks(set.sameDomainCandidates),
      ...stableSortPicks(set.baseCandidates),
      ...stableSortPicks(set.fallbackCandidates),
    ];

    // Soft prior reorder is opt-in only (domainPriors present); Vote/bucket ordering above is
    // otherwise untouched, so behavior without priors is byte-for-byte identical to before.
    let selected = domainPriors.length
      ? applyDomainPriorQuota(ordered, domainPriors, perSpanLimit)
      : ordered.slice(0, perSpanLimit);
    if (!selected.length) {
      const formal = set.fineSpanId ? formalById.get(set.fineSpanId) : undefined;
      if (formal) {
        selected = [domainAwarePickFromFormal(formal, rawText)];
      } else {
        const span = spanById.get(set.coarseSpanId);
        if (span) {
          selected = [domainAwarePickFromCanonical(span)];
        }
      }
    }

    return { ...set, selectedCandidates: selected };
  });
}

function domainAwarePickFromFormal(span: FormalFineSpan, rawText: string): DomainAwareSpanReplacementPick {
  const text = rawText.slice(span.rawStart, span.rawEnd);
  return {
    span: {
      text,
      start: span.rawStart,
      end: span.rawEnd,
    },
    word: text,
    candidateId: `canonical:${span.spanId}`,
    graphSource: 'base_term',
    hitKind: 'exact_term',
    score: 0,
    repairTarget: false,
    recallSource: 'canonical_exact',
  };
}

function domainAwarePickFromCanonical(span: CoarseSpan): DomainAwareSpanReplacementPick {
  return {
    span: { text: span.text, start: span.rawStart, end: span.rawEnd },
    word: span.text,
    candidateId: `canonical:${span.id}`,
    graphSource: 'base_term',
    hitKind: 'exact_term',
    score: 0,
    repairTarget: false,
    recallSource: 'canonical_exact',
  };
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
  formalSpans: readonly FormalFineSpan[],
  domainPriors: readonly DomainPrior[] = []
): DomainAwareAssemblyResult {
  const start = Date.now();
  if (!formalSpans.length) {
    throw new Error(
      '[FORMAL_POOL] runDomainAwareAssembly requires FormalFineSpan[]; coarse fallback is forbidden'
    );
  }
  assertFormalFineSpansNonOverlapping(formalSpans);
  const pool = buildFineSpanCandidatePool(activeCandidates, coarseSpans, formalSpans);
  const vote = voteUtteranceDomainFromPool(pool);

  const bucketDomains: Array<string | null> =
    vote.insufficientEvidence || vote.retainedDomains.length === 0
      ? [null]
      : [...vote.retainedDomains];

  const bucketSpanSets: import('../build-sentence-candidates').SpanReplacementPick[][][] = [];
  let primaryFiltered: DomainFilteredSpanSet[] = [];
  let aggregateSameDomain = 0;
  let aggregateBase = 0;
  const slotCount = formalSpans.length;

  for (const bucketDomain of bucketDomains) {
    const filtered = filterDomainCandidatesPerSpan(pool, vote, rawText, bucketDomain);
    const selected = selectPerSpanCandidates(
      filtered,
      slotCount,
      coarseSpans,
      formalSpans,
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
