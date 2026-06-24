/**
 * Recover V5 — window-level TopK score (Context Prior moved to Vote-after ReRank).
 * Primary score excludes edit distance (tie-breaker only per V1.2).
 */

import { scorePinyinSimilarity } from './phonetic/pinyin';
import type { HotwordEntry } from './hotword-types';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';

export type RecallCandidateKind =
  | 'exact_base'
  | 'exact_domain_strong'
  | 'exact_domain_weak'
  | 'fuzzy_plain'
  | 'fuzzy_plain_domain';

export type CandidateScoreInput = {
  hotword: HotwordEntry;
  windowSyllables: string[];
  windowText: string;
  phoneticScore?: number;
  profile?: ActiveLexiconProfileSnapshot;
  recallCandidateKind?: RecallCandidateKind;
};

export type CandidateScoreBreakdown = {
  priorScore: number;
  phoneticSimilarity: number;
  exactLengthBonus: number;
  domainBoost: number;
  editDistancePenalty: number;
  fuzzyPenalty: number;
  recallCandidateKind?: RecallCandidateKind;
};

const EXACT_LENGTH_BONUS = 0.5;

export function recallKindFuzzyPenalty(kind: RecallCandidateKind): number {
  switch (kind) {
    case 'exact_base':
    case 'exact_domain_strong':
      return 0;
    case 'exact_domain_weak':
      return 0.02;
    case 'fuzzy_plain':
      return 0.08;
    case 'fuzzy_plain_domain':
      return 0.1;
  }
}

function charEditDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return m;
  }
  if (m === 0) {
    return n;
  }
  const dp: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = tmp;
    }
  }
  return dp[m];
}

export function computeEditDistancePenalty(windowText: string, word: string): number {
  const a = windowText.trim();
  const b = word.trim();
  if (!a && !b) {
    return 0;
  }
  const maxLen = Math.max(a.length, b.length, 1);
  const distance = charEditDistance(a, b);
  return Math.min(1, distance / maxLen);
}

export function hotwordDomains(entry: HotwordEntry): string[] {
  if (entry.domains?.length) {
    return entry.domains;
  }
  if (entry.domain) {
    return [entry.domain];
  }
  return ['general'];
}

export function computeCandidateScoreBreakdown(input: CandidateScoreInput): CandidateScoreBreakdown {
  const { hotword, windowSyllables, windowText } = input;
  const phoneticSimilarity =
    input.phoneticScore ?? scorePinyinSimilarity(windowSyllables, hotword.pinyin);
  const exactLengthBonus =
    windowText.length === hotword.word.length && windowText.length > 0 ? EXACT_LENGTH_BONUS : 0;
  const domainBoost = 0;
  const editDistancePenalty = computeEditDistancePenalty(windowText, hotword.word);
  const recallCandidateKind = input.recallCandidateKind;
  const fuzzyPenalty = recallCandidateKind ? recallKindFuzzyPenalty(recallCandidateKind) : 0;
  return {
    priorScore: hotword.priorScore,
    phoneticSimilarity,
    exactLengthBonus,
    domainBoost,
    editDistancePenalty,
    fuzzyPenalty,
    recallCandidateKind,
  };
}

/** Primary recall score — edit distance excluded (tie-breaker only per V1.2). */
export function computeCandidateScore(input: CandidateScoreInput): number {
  const b = computeCandidateScoreBreakdown(input);
  return (
    b.priorScore +
    b.phoneticSimilarity +
    b.exactLengthBonus +
    b.domainBoost -
    b.fuzzyPenalty
  );
}

export function isEditDistanceTieBreakEligible(kind?: RecallCandidateKind): boolean {
  return kind !== 'fuzzy_plain' && kind !== 'fuzzy_plain_domain';
}

export type RecallScoreTieBreakable = {
  candidateScore: number;
  candidateScoreBreakdown: CandidateScoreBreakdown;
  recallCandidateKind?: RecallCandidateKind;
};

/** Same pinyin_key bucket: score desc, then editDistance asc (non-fuzzy only). */
export function compareRecallHitsPrimaryScore(a: RecallScoreTieBreakable, b: RecallScoreTieBreakable): number {
  if (b.candidateScore !== a.candidateScore) {
    return b.candidateScore - a.candidateScore;
  }
  const kindA = a.recallCandidateKind ?? a.candidateScoreBreakdown.recallCandidateKind;
  const kindB = b.recallCandidateKind ?? b.candidateScoreBreakdown.recallCandidateKind;
  const edA = isEditDistanceTieBreakEligible(kindA)
    ? a.candidateScoreBreakdown.editDistancePenalty
    : Number.POSITIVE_INFINITY;
  const edB = isEditDistanceTieBreakEligible(kindB)
    ? b.candidateScoreBreakdown.editDistancePenalty
    : Number.POSITIVE_INFINITY;
  return edA - edB;
}
