/**
 * Recover V5 — window-level TopK score + DomainBoost (Final Freeze Spec §3).
 */

import { scorePinyinSimilarity } from './phonetic/pinyin';
import type { HotwordEntry } from './hotword-types';
import { computeDomainBoost } from './domain-boost-calculator';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';

export type CandidateScoreInput = {
  hotword: HotwordEntry;
  windowSyllables: string[];
  windowText: string;
  phoneticScore?: number;
  profile?: ActiveLexiconProfileSnapshot;
};

export type CandidateScoreBreakdown = {
  priorScore: number;
  phoneticSimilarity: number;
  exactLengthBonus: number;
  domainBoost: number;
  editDistancePenalty: number;
};

const EXACT_LENGTH_BONUS = 0.5;

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
  const profile = input.profile ?? defaultGeneralProfile();
  const phoneticSimilarity =
    input.phoneticScore ?? scorePinyinSimilarity(windowSyllables, hotword.pinyin);
  const exactLengthBonus =
    windowText.length === hotword.word.length && windowText.length > 0 ? EXACT_LENGTH_BONUS : 0;
  const domainBoost = computeDomainBoost(profile, hotwordDomains(hotword));
  const editDistancePenalty = computeEditDistancePenalty(windowText, hotword.word);
  return {
    priorScore: hotword.priorScore,
    phoneticSimilarity,
    exactLengthBonus,
    domainBoost,
    editDistancePenalty,
  };
}

export function computeCandidateScore(input: CandidateScoreInput): number {
  const b = computeCandidateScoreBreakdown(input);
  return (
    b.priorScore +
    b.phoneticSimilarity +
    b.exactLengthBonus +
    b.domainBoost -
    b.editDistancePenalty
  );
}
