import type { ActiveSelectorDecision, LexiconBoundCandidate } from './types';

const DEFAULT_MIN_PHONETIC_SCORE = 0.85;

function pickBestCandidate(candidates: LexiconBoundCandidate[]): LexiconBoundCandidate | undefined {
  let best: LexiconBoundCandidate | undefined;
  for (const candidate of candidates) {
    const score = candidate.replacement.phoneticScore ?? 0;
    if (!best) {
      best = candidate;
      continue;
    }
    const bestScore = best.replacement.phoneticScore ?? 0;
    if (score > bestScore) {
      best = candidate;
    }
  }
  return best;
}

export function selectActiveUtteranceText(params: {
  originalText: string;
  candidates: LexiconBoundCandidate[];
  minPhoneticScore?: number;
}): ActiveSelectorDecision {
  const originalText = params.originalText;
  const minScore = params.minPhoneticScore ?? DEFAULT_MIN_PHONETIC_SCORE;

  if (!params.candidates.length) {
    return {
      selectedText: originalText,
      applied: false,
      selectedReason: 'no_candidate',
    };
  }

  const best = pickBestCandidate(params.candidates);
  if (!best || best.candidateText === originalText) {
    return {
      selectedText: originalText,
      applied: false,
      selectedReason: 'no_candidate',
    };
  }

  const bestScore = best.replacement.phoneticScore ?? 0;
  if (bestScore < minScore) {
    return {
      selectedText: originalText,
      applied: false,
      selectedReason: 'score_below_threshold',
    };
  }

  return {
    selectedText: best.candidateText,
    applied: true,
    selectedReason: 'phonetic_candidate_selected',
    selectedCandidate: best,
  };
}
