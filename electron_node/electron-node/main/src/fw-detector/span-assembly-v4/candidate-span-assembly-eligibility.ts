/**
 * Span-assembly eligibility: can this WindowCandidate fully replace a FineSpan?
 * Replaces the historical exact_term-only gate. HitKind alone must not decide.
 */

import type { WindowCandidate } from './v4-types';

export type SpanAssemblyRange = {
  fineSpanId?: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
};

export type SpanAssemblyEligibilityDropReason =
  | 'DROP_COVERED_CANDIDATE'
  | 'DROP_EMPTY_REPLACEMENT'
  | 'DROP_UNSUPPORTED_RECALL_SOURCE'
  | 'DROP_RANGE_MISMATCH'
  | 'DROP_INCOMPLETE_SPAN_COVERAGE'
  | 'DROP_INVALID_IDENTITY'
  | 'DROP_INVALID_SPAN_RANGE';

export type SpanAssemblyEligibilityResult =
  | { eligible: true; dropReason?: undefined }
  | { eligible: false; dropReason: SpanAssemblyEligibilityDropReason };

const ASSEMBLY_GRAPH_SOURCES = new Set([
  'base_term',
  'domain_term',
  'passive_domain_weak',
]);

/**
 * Pure: whether candidate can completely replace the given FineSpan for sentence assembly.
 */
export function isCandidateEligibleForSpanAssembly(
  candidate: WindowCandidate,
  fineSpan: SpanAssemblyRange
): SpanAssemblyEligibilityResult {
  if (candidate.isCovered === true) {
    return { eligible: false, dropReason: 'DROP_COVERED_CANDIDATE' };
  }

  const replacement = typeof candidate.replacement === 'string' ? candidate.replacement : '';
  if (!replacement.length) {
    return { eligible: false, dropReason: 'DROP_EMPTY_REPLACEMENT' };
  }

  if (!ASSEMBLY_GRAPH_SOURCES.has(candidate.source)) {
    return { eligible: false, dropReason: 'DROP_UNSUPPORTED_RECALL_SOURCE' };
  }

  const hasIdentity =
    (candidate.candidateId != null && String(candidate.candidateId).length > 0) ||
    (candidate.termId != null && String(candidate.termId).length > 0);
  if (!hasIdentity) {
    return { eligible: false, dropReason: 'DROP_INVALID_IDENTITY' };
  }

  if (
    !(
      Number.isFinite(fineSpan.rawStart) &&
      Number.isFinite(fineSpan.rawEnd) &&
      fineSpan.rawEnd > fineSpan.rawStart &&
      Number.isFinite(fineSpan.syllableStart) &&
      Number.isFinite(fineSpan.syllableEnd) &&
      fineSpan.syllableEnd > fineSpan.syllableStart
    )
  ) {
    return { eligible: false, dropReason: 'DROP_INVALID_SPAN_RANGE' };
  }

  if (
    candidate.rawStart !== fineSpan.rawStart ||
    candidate.rawEnd !== fineSpan.rawEnd ||
    candidate.syllableStart !== fineSpan.syllableStart ||
    candidate.syllableEnd !== fineSpan.syllableEnd
  ) {
    // Proper subset of FineSpan → incomplete coverage; otherwise range mismatch.
    const nested =
      candidate.syllableStart >= fineSpan.syllableStart &&
      candidate.syllableEnd <= fineSpan.syllableEnd &&
      (candidate.syllableStart > fineSpan.syllableStart ||
        candidate.syllableEnd < fineSpan.syllableEnd);
    return {
      eligible: false,
      dropReason: nested ? 'DROP_INCOMPLETE_SPAN_COVERAGE' : 'DROP_RANGE_MISMATCH',
    };
  }

  return { eligible: true };
}
