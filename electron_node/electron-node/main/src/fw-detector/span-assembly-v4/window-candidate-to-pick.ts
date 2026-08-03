import type { SpanReplacementPick } from '../build-sentence-candidates';
import type { CoarseSpan } from '../span-assembly-shared/types';
import type { DomainAwareSpanReplacementPick } from './domain-assembly-types';
import type { PathFineSpan } from './path-fine-span-types';
import type { WindowCandidate } from './v4-types';
import {
  isCandidateEligibleForSpanAssembly,
  type SpanAssemblyEligibilityDropReason,
  type SpanAssemblyRange,
} from './candidate-span-assembly-eligibility';

export type WindowCandidateToPickResult =
  | { ok: true; pick: DomainAwareSpanReplacementPick; dropReason?: undefined }
  | { ok: false; pick?: undefined; dropReason: SpanAssemblyEligibilityDropReason };

/**
 * Convert an eligible WindowCandidate into a DomainAware pick for SameDomain Assembly.
 * Eligibility is span-coverage / source / identity based — not hitKind===exact_term.
 */
export function windowCandidateToDomainAwarePickResult(
  candidate: WindowCandidate,
  rawText: string,
  fineSpan: SpanAssemblyRange
): WindowCandidateToPickResult {
  const eligibility = isCandidateEligibleForSpanAssembly(candidate, fineSpan);
  if (!eligibility.eligible) {
    return { ok: false, dropReason: eligibility.dropReason };
  }

  return {
    ok: true,
    pick: {
      span: {
        text: rawText.slice(candidate.rawStart, candidate.rawEnd),
        start: candidate.rawStart,
        end: candidate.rawEnd,
      },
      word: candidate.replacement,
      candidateId: candidate.candidateId,
      domains: candidate.domains,
      graphSource: candidate.source as DomainAwareSpanReplacementPick['graphSource'],
      hitKind: candidate.hitKind,
      score: candidate.score,
      repairTarget: candidate.repairTarget,
      recallSource: candidate.recallSource,
    },
  };
}

/**
 * @deprecated Prefer windowCandidateToDomainAwarePickResult for drop reasons.
 * Returns null when ineligible (same eligibility contract).
 */
export function windowCandidateToDomainAwarePick(
  candidate: WindowCandidate,
  rawText: string,
  fineSpan?: SpanAssemblyRange
): DomainAwareSpanReplacementPick | null {
  const range: SpanAssemblyRange = fineSpan ?? {
    rawStart: candidate.rawStart,
    rawEnd: candidate.rawEnd,
    syllableStart: candidate.syllableStart,
    syllableEnd: candidate.syllableEnd,
  };
  const result = windowCandidateToDomainAwarePickResult(candidate, rawText, range);
  return result.ok ? result.pick : null;
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

/** Raw/ASR preservation candidate for a PathFineSpan (not a silent winner fill). */
export function domainAwareCanonicalFromPathFineSpan(
  span: PathFineSpan,
  rawText: string
): DomainAwareSpanReplacementPick {
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

export function domainAwareCanonicalFromCoarseSpan(span: CoarseSpan): DomainAwareSpanReplacementPick {
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
