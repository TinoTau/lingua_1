import type { WindowCandidateSource } from '../lexicon/window-candidate-source';
import type { FwTextSpan } from './types';

export type SpanReplacementPick = {
  span: FwTextSpan;
  word: string;
  source: WindowCandidateSource;
  priorScore: number;
  repairTarget: boolean;
  candidateScore: number;
};

export type SentenceCombination = {
  text: string;
  replacements: SpanReplacementPick[];
  candidateScore: number;
};

function applyReplacementsRightToLeft(
  rawText: string,
  picks: Array<{ start: number; end: number; word: string }>
): string {
  let text = rawText;
  const sorted = [...picks].sort((a, b) => b.start - a.start);
  for (const pick of sorted) {
    text = text.slice(0, pick.start) + pick.word + text.slice(pick.end);
  }
  return text;
}

function combinationScore(picks: SpanReplacementPick[]): number {
  return picks.reduce((sum, pick) => sum + pick.candidateScore, 0);
}

/**
 * Cartesian product of per-span candidates; cap at maxSentenceCandidates.
 */
export function buildSentenceCandidates(
  rawText: string,
  spanSets: SpanReplacementPick[][],
  maxSentenceCandidates: number
): SentenceCombination[] {
  if (!spanSets.length || maxSentenceCandidates <= 0) {
    return [];
  }

  let combinations: SpanReplacementPick[][] = [[]];
  for (const spanCandidates of spanSets) {
    if (!spanCandidates.length) {
      return [];
    }
    const next: SpanReplacementPick[][] = [];
    for (const prefix of combinations) {
      for (const pick of spanCandidates) {
        next.push([...prefix, pick]);
      }
    }
    combinations = next;
  }

  const scored = combinations.map((picks) => {
    const text = applyReplacementsRightToLeft(
      rawText,
      picks.map((p) => ({ start: p.span.start, end: p.span.end, word: p.word }))
    );
    return { text, replacements: picks, candidateScore: combinationScore(picks) };
  });

  scored.sort((a, b) => b.candidateScore - a.candidateScore);
  return scored.slice(0, maxSentenceCandidates);
}
