import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { DomainAwareSpanReplacementPick } from './domain-assembly-types';
import type { WindowCandidate } from './v4-types';

export function windowCandidateToDomainAwarePick(
  candidate: WindowCandidate,
  rawText: string
): DomainAwareSpanReplacementPick | null {
  if (candidate.hitKind !== 'exact_term') {
    return null;
  }
  if (
    candidate.source !== 'domain_term' &&
    candidate.source !== 'base_term' &&
    candidate.source !== 'passive_domain_weak'
  ) {
    return null;
  }

  return {
    span: {
      text: rawText.slice(candidate.rawStart, candidate.rawEnd),
      start: candidate.rawStart,
      end: candidate.rawEnd,
    },
    word: candidate.replacement,
    candidateId: candidate.candidateId,
    domainId: candidate.domainId,
    graphSource: candidate.source,
    hitKind: candidate.hitKind,
    score: candidate.score,
    repairTarget: candidate.repairTarget,
    recallSource: candidate.recallSource,
  };
}

export function domainAwarePickToSpanReplacementPick(
  pick: DomainAwareSpanReplacementPick
): SpanReplacementPick {
  return {
    span: pick.span,
    word: pick.word,
    source: pick.recallSource,
    priorScore: pick.score,
    repairTarget: pick.repairTarget,
    candidateScore: pick.score,
  };
}

export function canonicalSpanReplacementPick(span: CoarseSpan): SpanReplacementPick {
  return {
    span: { text: span.text, start: span.rawStart, end: span.rawEnd },
    word: span.text,
    source: 'canonical_exact',
    priorScore: 1,
    repairTarget: false,
    candidateScore: 0,
  };
}
