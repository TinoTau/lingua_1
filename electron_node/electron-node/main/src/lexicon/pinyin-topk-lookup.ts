/**
 * Recover V5 — scored legal lexicon TopK (exact bucket only when nearPinyinEnabled=false).
 */

import { scorePinyinSimilarity } from './phonetic/pinyin';
import {
  computeCandidateScore,
  computeCandidateScoreBreakdown,
  type CandidateScoreBreakdown,
} from './candidate-score';
import { syllablesKey } from './pinyin-index';
import { isMixedLatinToken } from './scored-lexicon';
import { getRecoverQualityConfig } from '../recover-quality/quality-config';
import type { HotwordEntry } from './hotword-types';
import type { LexiconRuntime } from './lexicon-runtime';

export type TopKMatchType = 'exact' | 'near';

export type LexiconTopKHit = {
  hotword: HotwordEntry;
  phoneticScore: number;
  candidateScore: number;
  candidateScoreBreakdown: CandidateScoreBreakdown;
  termLength: number;
  rankInTopK: number;
  matchType: TopKMatchType;
  source: 'lexicon_pinyin_topk';
};

export type LookupTopKInput = {
  syllables: string[];
  windowText: string;
  termLength: number;
  domain?: string;
  topK: number;
};

export type LookupTopKResult = {
  hits: LexiconTopKHit[];
  nearPinyinAttemptCount: number;
};

function minCandidateScore(): number {
  return getRecoverQualityConfig().minCandidateScore;
}

function collectScored(
  hotword: HotwordEntry,
  syllables: string[],
  windowText: string,
  termLength: number,
  domain: string | undefined,
  matchType: TopKMatchType,
  seen: Set<string>,
  scored: Array<{
    hotword: HotwordEntry;
    phoneticScore: number;
    candidateScore: number;
    candidateScoreBreakdown: CandidateScoreBreakdown;
    matchType: TopKMatchType;
  }>
): void {
  if (!hotword.enabled || hotword.word.length !== termLength) {
    return;
  }
  if (!Number.isFinite(hotword.priorScore) || hotword.priorScore <= 0) {
    return;
  }
  if (seen.has(hotword.id)) {
    return;
  }
  const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
  const candidateScoreBreakdown = computeCandidateScoreBreakdown({
    hotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    domain,
  });
  const candidateScore =
    candidateScoreBreakdown.priorScore +
    candidateScoreBreakdown.phoneticSimilarity +
    candidateScoreBreakdown.exactLengthBonus +
    candidateScoreBreakdown.domainBoost -
    candidateScoreBreakdown.editDistancePenalty;
  if (candidateScore < minCandidateScore()) {
    return;
  }
  seen.add(hotword.id);
  scored.push({ hotword, phoneticScore, candidateScore, candidateScoreBreakdown, matchType });
}

function lookupExactLatin(
  runtime: LexiconRuntime,
  windowText: string,
  topK: number
): LookupTopKResult {
  const termLength = windowText.length;
  if (termLength < 2 || termLength > 5) {
    return { hits: [], nearPinyinAttemptCount: 0 };
  }
  const hits = runtime.lookupHotwordsByExactWord(windowText).filter(
    (h) => h.word.length === termLength
  );
  const scored = hits
    .filter((h) => Number.isFinite(h.priorScore) && h.priorScore > 0)
    .map((hotword) => {
      const candidateScoreBreakdown = computeCandidateScoreBreakdown({
        hotword,
        windowSyllables: hotword.pinyin,
        windowText,
        phoneticScore: 1,
      });
      const candidateScore = computeCandidateScore({
        hotword,
        windowSyllables: hotword.pinyin,
        windowText,
        phoneticScore: 1,
      });
      return {
        hotword,
        phoneticScore: 1,
        candidateScore,
        candidateScoreBreakdown,
        matchType: 'exact' as const,
      };
    })
    .filter((s) => s.candidateScore >= minCandidateScore())
    .sort((a, b) => b.candidateScore - a.candidateScore)
    .slice(0, topK);

  return {
    hits: scored.map((s, i) => ({
      ...s,
      termLength,
      rankInTopK: i + 1,
      source: 'lexicon_pinyin_topk' as const,
    })),
    nearPinyinAttemptCount: 0,
  };
}

/**
 * TopK by pinyin index (CJK exact bucket; near bucket only if nearPinyinEnabled).
 */
export function lookupTopKByPinyin(
  runtime: LexiconRuntime,
  input: LookupTopKInput
): LookupTopKResult {
  const { syllables, windowText, termLength, domain, topK } = input;
  if (topK <= 0 || termLength < 2 || termLength > 5) {
    return { hits: [], nearPinyinAttemptCount: 0 };
  }

  if (isMixedLatinToken(windowText)) {
    return lookupExactLatin(runtime, windowText.trim(), topK);
  }

  if (!syllables.length) {
    return { hits: [], nearPinyinAttemptCount: 0 };
  }

  const cfg = getRecoverQualityConfig();
  const seen = new Set<string>();
  const scored: Array<{
    hotword: HotwordEntry;
    phoneticScore: number;
    candidateScore: number;
    candidateScoreBreakdown: CandidateScoreBreakdown;
    matchType: TopKMatchType;
  }> = [];
  let nearPinyinAttemptCount = 0;

  const exactKey = syllablesKey(syllables);
  for (const hotword of runtime.getPinyinBucket(exactKey)) {
    if (hotword.word.length !== termLength) {
      continue;
    }
    collectScored(hotword, syllables, windowText, termLength, domain, 'exact', seen, scored);
  }

  if (cfg.nearPinyinEnabled) {
    const maxDelta = cfg.recallFuzzyPinyinMaxSyllableDelta;
    runtime.forEachPinyinBucket((key, bucket) => {
      if (key === exactKey) {
        return;
      }
      const keySyllables = key.split('|').filter(Boolean);
      if (Math.abs(keySyllables.length - syllables.length) > maxDelta) {
        return;
      }
      nearPinyinAttemptCount += 1;
      for (const hotword of bucket) {
        if (hotword.word.length !== termLength) {
          continue;
        }
        const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
        if (phoneticScore < cfg.recallMinPhoneticScore) {
          continue;
        }
        collectScored(hotword, syllables, windowText, termLength, domain, 'near', seen, scored);
      }
    });
  }

  scored.sort((a, b) => b.candidateScore - a.candidateScore);
  const hits = scored.slice(0, topK).map((s, i) => ({
    hotword: s.hotword,
    phoneticScore: s.phoneticScore,
    candidateScore: s.candidateScore,
    candidateScoreBreakdown: s.candidateScoreBreakdown,
    termLength,
    rankInTopK: i + 1,
    matchType: s.matchType,
    source: 'lexicon_pinyin_topk' as const,
  }));

  return { hits, nearPinyinAttemptCount };
}

/** @deprecated 使用 LookupTopKResult.hits */
export function lookupTopKByPinyinHitsOnly(
  runtime: LexiconRuntime,
  input: LookupTopKInput
): LexiconTopKHit[] {
  return lookupTopKByPinyin(runtime, input).hits;
}
