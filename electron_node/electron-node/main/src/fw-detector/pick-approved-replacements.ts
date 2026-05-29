import { spansOverlap } from '../lexicon/selector/applySpanReplacements';
import type {
  FwApprovedReplacement,
  FwDetectorSignal,
  FwSpanCandidateDiag,
  FwTextSpan,
} from './types';

export type SpanPickCandidate = {
  span: FwTextSpan;
  spanMeta: {
    domain: string;
    riskScore: number;
    signals: FwDetectorSignal[];
  };
  candidate: FwSpanCandidateDiag;
};

/** Per span: highest finalScore among non-vetoed candidates. */
export function pickBestCandidatePerSpan(
  span: FwTextSpan,
  spanMeta: SpanPickCandidate['spanMeta'],
  candidates: FwSpanCandidateDiag[]
): SpanPickCandidate | null {
  const eligible = candidates
    .filter((c) => !c.vetoed)
    .sort((a, b) => b.finalScore - a.finalScore);
  const best = eligible[0];
  if (!best) {
    return null;
  }
  return { span, spanMeta, candidate: best };
}

/**
 * D-greedy: sort span-level winners by finalScore, greedily add non-overlapping replacements.
 */
export function pickApprovedReplacementsGreedy(
  spanPicks: SpanPickCandidate[]
): FwApprovedReplacement[] {
  const sorted = [...spanPicks].sort(
    (a, b) => b.candidate.finalScore - a.candidate.finalScore
  );
  const approved: FwApprovedReplacement[] = [];

  for (const pick of sorted) {
    const { span, candidate } = pick;
    const overlaps = approved.some((r) =>
      spansOverlap(r.start, r.end, span.start, span.end)
    );
    if (overlaps) {
      continue;
    }
    approved.push({
      start: span.start,
      end: span.end,
      candidateText: candidate.word,
      span: { text: span.text, start: span.start, end: span.end },
    });
  }

  return approved;
}

export function markSelectedCandidates(
  allCandidates: FwSpanCandidateDiag[],
  selected: FwSpanCandidateDiag | undefined
): void {
  for (const c of allCandidates) {
    c.selected = selected != null && c.candidateIndex === selected.candidateIndex;
  }
}
