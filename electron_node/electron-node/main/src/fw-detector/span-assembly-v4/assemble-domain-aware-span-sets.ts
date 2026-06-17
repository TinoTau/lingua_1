import { getPerSpanCandidateLimit } from '../per-span-candidate-limit';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { UtteranceDomainVoteResult } from '../span-assembly-shared/utterance-domain-vote';
import { voteUtteranceDomainFromPool } from '../span-assembly-shared/utterance-domain-vote';
import { findOwningCoarseSpanIndexV4 } from './find-owning-coarse-span-v4';
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
  winningDomain: string
): boolean {
  return (
    (candidate.graphSource === 'domain_term' || candidate.graphSource === 'passive_domain_weak') &&
    candidate.domainId === winningDomain
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

export function buildFineSpanCandidatePool(
  activeCandidates: WindowCandidate[],
  coarseSpans: CoarseSpan[]
): FineSpanCandidatePool[] {
  const pools: FineSpanCandidatePool[] = coarseSpans.map((span) => ({
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

export function filterDomainCandidatesPerSpan(
  pool: FineSpanCandidatePool[],
  vote: UtteranceDomainVoteResult,
  rawText: string
): DomainFilteredSpanSet[] {
  const winningDomain = vote.utteranceDomain;
  const isGeneral = vote.insufficientEvidence || winningDomain === 'general';

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

      if (!isGeneral && isSameDomainCandidate(pick, winningDomain)) {
        sameDomainCandidates.push(pick);
      } else if (isBaseCandidate(pick)) {
        baseCandidates.push(pick);
      } else if (isGeneral) {
        fallbackCandidates.push(pick);
      }
    }

    return {
      coarseSpanId: spanPool.coarseSpanId,
      rawRange: spanPool.rawRange,
      syllableRange: spanPool.syllableRange,
      sameDomainCandidates: dedupePicks(sameDomainCandidates),
      baseCandidates: dedupePicks(baseCandidates),
      fallbackCandidates: dedupePicks(fallbackCandidates),
      selectedCandidates: [],
    };
  });
}

export function selectPerSpanCandidates(
  filteredSets: DomainFilteredSpanSet[],
  coarseSpanCount: number,
  coarseSpans: CoarseSpan[]
): DomainFilteredSpanSet[] {
  const perSpanLimit = getPerSpanCandidateLimit(coarseSpanCount);
  const spanById = new Map(coarseSpans.map((span) => [span.id, span]));

  return filteredSets.map((set) => {
    const ordered = [
      ...stableSortPicks(set.sameDomainCandidates),
      ...stableSortPicks(set.baseCandidates),
      ...stableSortPicks(set.fallbackCandidates),
    ];

    let selected = ordered.slice(0, perSpanLimit);
    if (!selected.length) {
      const span = spanById.get(set.coarseSpanId);
      if (span) {
        selected = [domainAwarePickFromCanonical(span)];
      }
    }

    return { ...set, selectedCandidates: selected };
  });
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
  domainAssemblyMs: number
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
  };
}

export function runDomainAwareAssembly(
  activeCandidates: WindowCandidate[],
  coarseSpans: CoarseSpan[],
  rawText: string
): DomainAwareAssemblyResult {
  const start = Date.now();
  const pool = buildFineSpanCandidatePool(activeCandidates, coarseSpans);
  const vote = voteUtteranceDomainFromPool(pool);
  const filtered = filterDomainCandidatesPerSpan(pool, vote, rawText);
  const selected = selectPerSpanCandidates(filtered, coarseSpans.length, coarseSpans);
  const spanSets = assembleDomainAwareSpanSets(selected);
  const domainAssemblyMs = Date.now() - start;

  return {
    vote,
    filteredSets: selected,
    spanSets,
    metrics: computeAssemblyMetrics(selected, spanSets, domainAssemblyMs),
  };
}

/** @internal test helper */
export function canonicalPickForSpan(span: CoarseSpan): import('../build-sentence-candidates').SpanReplacementPick {
  return canonicalSpanReplacementPick(span);
}
