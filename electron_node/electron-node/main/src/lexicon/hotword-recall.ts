import { getRecoverQualityConfig } from '../recover-quality/quality-config';
import { lookupTopKByPinyin } from './pinyin-topk-lookup';
import type { AsrWindow } from './lexicon-types';
import type { HotwordEntry, HotwordRecallHit, HotwordRecallPath } from './hotword-types';
import type { LexiconRuntime } from './lexicon-runtime';

export type HotwordRecallStats = {
  hitsObserved: number;
  hitsPinyin: number;
  hitsConfusion: number;
  hitsFuzzyObserved: number;
  hitsLexiconPinyinTopk: number;
  droppedBelowPinyinThreshold: number;
  topkDroppedBelowMinScore: number;
  fuzzyObservedAttemptCount: number;
  fuzzyObservedHitCount: number;
  fuzzyObservedRejectedCount: number;
  pinyinAttemptCount: number;
  pinyinHitCount: number;
  pinyinNoHitCount: number;
  topkAttemptsByTermLength: Record<string, number>;
  topkHitsByTermLength: Record<string, number>;
  outOfBundleCandidateCount: number;
  nearPinyinAttemptCount: number;
};

export function emptyHotwordRecallStats(): HotwordRecallStats {
  return {
    hitsObserved: 0,
    hitsPinyin: 0,
    hitsConfusion: 0,
    hitsFuzzyObserved: 0,
    hitsLexiconPinyinTopk: 0,
    droppedBelowPinyinThreshold: 0,
    topkDroppedBelowMinScore: 0,
    fuzzyObservedAttemptCount: 0,
    fuzzyObservedHitCount: 0,
    fuzzyObservedRejectedCount: 0,
    pinyinAttemptCount: 0,
    pinyinHitCount: 0,
    pinyinNoHitCount: 0,
    topkAttemptsByTermLength: {},
    topkHitsByTermLength: {},
    outOfBundleCandidateCount: 0,
    nearPinyinAttemptCount: 0,
  };
}

function observedRecallEnabled(): boolean {
  return getRecoverQualityConfig().observedRecallEnabled === true;
}

function topKForTermLength(termLength: number): number {
  const map = getRecoverQualityConfig().topKByTermLength;
  return map[String(termLength)] ?? 0;
}

function hitDedupeKey(windowId: string, hotwordId: string, path: HotwordRecallPath): string {
  return `${windowId}\0${hotwordId}\0${path}`;
}

function toHit(
  window: AsrWindow,
  hotword: HotwordEntry,
  recallPath: HotwordRecallPath,
  phoneticScore: number,
  extra?: Pick<
    HotwordRecallHit,
    'candidateScore' | 'candidateScoreBreakdown' | 'rankInTopK' | 'termLength' | 'matchType'
  >
): HotwordRecallHit {
  return {
    hotword,
    windowId: window.windowId,
    recallPath,
    phoneticScore,
    priorScore: hotword.priorScore,
    ...extra,
  };
}

/**
 * V5: TopK pinyin lookup only (observed/fuzzy disabled by default).
 */
export function recallHotwordsForWindow(
  window: AsrWindow,
  runtime: LexiconRuntime,
  _maxHits?: number,
  stats?: HotwordRecallStats
): HotwordRecallHit[] {
  if (observedRecallEnabled()) {
    return [];
  }

  const cfg = getRecoverQualityConfig();
  const termLength = window.text.length;
  if (!cfg.allowedWindowLengths.includes(termLength)) {
    return [];
  }

  const topK = topKForTermLength(termLength);
  if (topK <= 0) {
    return [];
  }

  const lenKey = String(termLength);
  if (stats) {
    stats.pinyinAttemptCount += 1;
    stats.topkAttemptsByTermLength[lenKey] =
      (stats.topkAttemptsByTermLength[lenKey] ?? 0) + 1;
  }

  const { hits: topkHits, nearPinyinAttemptCount } = lookupTopKByPinyin(runtime, {
    syllables: window.syllables,
    windowText: window.text,
    termLength,
    topK,
  });

  if (stats) {
    stats.nearPinyinAttemptCount += nearPinyinAttemptCount;
  }

  const out: HotwordRecallHit[] = [];
  for (const hit of topkHits) {
    if (hit.hotword.word === window.text) {
      continue;
    }
    out.push(
      toHit(window, hit.hotword, 'lexicon_pinyin_topk', hit.phoneticScore, {
        candidateScore: hit.candidateScore,
        candidateScoreBreakdown: hit.candidateScoreBreakdown,
        rankInTopK: hit.rankInTopK,
        termLength: hit.termLength,
        matchType: hit.matchType,
      })
    );
  }

  if (stats) {
    if (out.length > 0) {
      stats.hitsLexiconPinyinTopk += out.length;
      stats.hitsPinyin += out.length;
      stats.pinyinHitCount += out.length;
      stats.topkHitsByTermLength[lenKey] = (stats.topkHitsByTermLength[lenKey] ?? 0) + out.length;
    } else if (stats.pinyinAttemptCount > 0) {
      stats.pinyinNoHitCount += 1;
    }
  }

  return out;
}
