import { scorePinyinSimilarity } from './phonetic/pinyin';
import { getRecoverQualityConfig } from '../recover-quality/quality-config';
import type { HotwordEntry } from './hotword-types';

/** @deprecated 使用 quality-config.recallFuzzyPinyinMaxSyllableDelta */
export const FUZZY_PINYIN_MAX_SYLLABLE_DELTA = 1;

function fuzzyPinyinMaxSyllableDelta(): number {
  return getRecoverQualityConfig().recallFuzzyPinyinMaxSyllableDelta;
}

export type FuzzyPinyinHit = {
  hotword: HotwordEntry;
  phoneticScore: number;
};

/**
 * Syllable similarity against enabled hotwords (not exact-index lookup).
 */
export function recallHotwordsByFuzzyPinyin(
  syllables: string[],
  hotwords: readonly HotwordEntry[],
  minScore: number,
  maxHits: number
): FuzzyPinyinHit[] {
  if (!syllables.length || !hotwords.length || maxHits <= 0) {
    return [];
  }

  const scored: FuzzyPinyinHit[] = [];
  for (const hotword of hotwords) {
    if (!hotword.enabled || !hotword.pinyin.length) {
      continue;
    }
    const delta = Math.abs(hotword.pinyin.length - syllables.length);
    if (delta > fuzzyPinyinMaxSyllableDelta()) {
      continue;
    }
    const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
    if (phoneticScore < minScore) {
      continue;
    }
    scored.push({ hotword, phoneticScore });
  }

  scored.sort((a, b) => {
    if (b.phoneticScore !== a.phoneticScore) {
      return b.phoneticScore - a.phoneticScore;
    }
    return b.hotword.frequency - a.hotword.frequency;
  });

  return scored.slice(0, maxHits);
}
