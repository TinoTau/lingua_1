import { priorScoreFromFrequency } from './pinyin-index';
import { scorePinyinSimilarity } from './phonetic/pinyin';
import { recallHotwordsByFuzzyPinyin } from './fuzzy-pinyin-recall';
import { isFuzzyObservedMatch } from './segment-text-normalize';
import { isPinyinAlignedObservedMatch } from './confusion-observed-spans';
import { getRecoverQualityConfig } from '../recover-quality/quality-config';
import type { AsrWindow } from './lexicon-types';
import type { HotwordEntry, HotwordRecallHit, HotwordRecallPath } from './hotword-types';
import type { LexiconRuntime } from './lexicon-runtime';

const DEFAULT_MAX_HITS = 16;

export type HotwordRecallStats = {
  hitsObserved: number;
  hitsPinyin: number;
  hitsConfusion: number;
  hitsFuzzyObserved: number;
  droppedBelowPinyinThreshold: number;
  fuzzyObservedAttemptCount: number;
  fuzzyObservedHitCount: number;
  fuzzyObservedRejectedCount: number;
  pinyinAttemptCount: number;
  pinyinHitCount: number;
  pinyinNoHitCount: number;
};

export function emptyHotwordRecallStats(): HotwordRecallStats {
  return {
    hitsObserved: 0,
    hitsPinyin: 0,
    hitsConfusion: 0,
    hitsFuzzyObserved: 0,
    droppedBelowPinyinThreshold: 0,
    fuzzyObservedAttemptCount: 0,
    fuzzyObservedHitCount: 0,
    fuzzyObservedRejectedCount: 0,
    pinyinAttemptCount: 0,
    pinyinHitCount: 0,
    pinyinNoHitCount: 0,
  };
}

function recallMinPhoneticScore(): number {
  return getRecoverQualityConfig().recallMinPhoneticScore;
}

function appendObservedHits(
  window: AsrWindow,
  runtime: LexiconRuntime,
  maxHits: number,
  seen: Set<string>,
  out: HotwordRecallHit[],
  stats?: HotwordRecallStats
): boolean {
  for (const { hotword, recallPath } of runtime.recallHotwordsByObservedLoose(window.text, maxHits)) {
    if (hotword.word === window.text) {
      continue;
    }
    const key = hitDedupeKey(window.windowId, hotword.id, recallPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const phoneticScore = scorePinyinSimilarity(window.syllables, hotword.pinyin);
    const minScore = recallMinPhoneticScore();
    out.push(toHit(window, hotword, recallPath, Math.max(phoneticScore, minScore)));
    if (stats) {
      if (recallPath === 'confusion_evidence') {
        stats.hitsConfusion += 1;
      } else {
        stats.hitsObserved += 1;
      }
    }
    if (out.length >= maxHits) {
      return true;
    }
  }
  return false;
}

function appendFuzzyObservedHits(
  window: AsrWindow,
  runtime: LexiconRuntime,
  maxHits: number,
  seen: Set<string>,
  out: HotwordRecallHit[],
  stats?: HotwordRecallStats
): boolean {
  let fuzzyAttemptRecorded = false;
  for (const observed of runtime.getConfusionObservedStrings()) {
    if (stats && !fuzzyAttemptRecorded) {
      stats.fuzzyObservedAttemptCount += 1;
      fuzzyAttemptRecorded = true;
    }
    const pinyinAligned = isPinyinAlignedObservedMatch(window.text, observed);
    if (!isFuzzyObservedMatch(window.text, observed, 1) && !pinyinAligned) {
      if (stats) {
        stats.fuzzyObservedRejectedCount += 1;
      }
      continue;
    }
    for (const { hotword } of runtime.recallHotwordsByObserved(observed, maxHits)) {
      if (hotword.word === window.text) {
        continue;
      }
      const path: HotwordRecallPath = 'fuzzy_observed';
      const key = hitDedupeKey(window.windowId, hotword.id, path);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const phoneticScore = scorePinyinSimilarity(window.syllables, hotword.pinyin);
      const minScore = recallMinPhoneticScore();
      out.push(toHit(window, hotword, path, Math.max(phoneticScore, minScore)));
      if (stats) {
        stats.hitsFuzzyObserved += 1;
        stats.fuzzyObservedHitCount += 1;
      }
      if (out.length >= maxHits) {
        return true;
      }
    }
  }
  return false;
}

function hitDedupeKey(windowId: string, hotwordId: string, path: HotwordRecallPath): string {
  return `${windowId}\0${hotwordId}\0${path}`;
}

function toHit(
  window: AsrWindow,
  hotword: HotwordEntry,
  recallPath: HotwordRecallPath,
  phoneticScore: number
): HotwordRecallHit {
  return {
    hotword,
    windowId: window.windowId,
    recallPath,
    phoneticScore,
    priorScore: priorScoreFromFrequency(hotword.frequency),
  };
}

/**
 * Window syllables → hotword recall (observed exact + pinyin index + fuzzy pinyin).
 */
export function recallHotwordsForWindow(
  window: AsrWindow,
  runtime: LexiconRuntime,
  maxHits: number = DEFAULT_MAX_HITS,
  stats?: HotwordRecallStats
): HotwordRecallHit[] {
  const out: HotwordRecallHit[] = [];
  const seen = new Set<string>();
  const minScore = recallMinPhoneticScore();

  if (appendObservedHits(window, runtime, maxHits, seen, out, stats)) {
    return out;
  }
  if (appendFuzzyObservedHits(window, runtime, maxHits, seen, out, stats)) {
    return out;
  }

  if (stats) {
    stats.pinyinAttemptCount += 1;
  }
  let pinyinHitsThisWindow = 0;
  for (const hotword of runtime.recallHotwordsByPinyin(window.syllables, maxHits)) {
    if (hotword.word === window.text) {
      continue;
    }
    const phoneticScore = scorePinyinSimilarity(window.syllables, hotword.pinyin);
    if (phoneticScore < minScore) {
      if (stats) {
        stats.droppedBelowPinyinThreshold += 1;
      }
      continue;
    }
    const path: HotwordRecallPath = 'pinyin';
    const key = hitDedupeKey(window.windowId, hotword.id, path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(toHit(window, hotword, path, phoneticScore));
    if (stats) {
      stats.hitsPinyin += 1;
      stats.pinyinHitCount += 1;
      pinyinHitsThisWindow += 1;
    }
    if (out.length >= maxHits) {
      return out;
    }
  }

  const fuzzyHits = recallHotwordsByFuzzyPinyin(
    window.syllables,
    runtime.getEnabledHotwords(),
    minScore,
    maxHits
  );
  for (const { hotword, phoneticScore } of fuzzyHits) {
    if (hotword.word === window.text) {
      continue;
    }
    const path: HotwordRecallPath = 'pinyin';
    const key = hitDedupeKey(window.windowId, hotword.id, path);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(toHit(window, hotword, path, phoneticScore));
    if (stats) {
      stats.hitsPinyin += 1;
      stats.pinyinHitCount += 1;
      pinyinHitsThisWindow += 1;
    }
    if (out.length >= maxHits) {
      return out;
    }
  }

  if (stats && stats.pinyinAttemptCount > 0 && pinyinHitsThisWindow === 0) {
    stats.pinyinNoHitCount += 1;
  }

  return out;
}
