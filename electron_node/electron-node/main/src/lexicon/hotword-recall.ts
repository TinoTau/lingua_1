import { getAsrRepairQualityConfig } from '../asr-repair-quality/quality-config';
import { lookupTopKByPinyin } from './pinyin-topk-lookup';
import type { AsrWindow } from './lexicon-types';
import type { HotwordEntry, HotwordRecallHit } from './hotword-types';
import { isV3WindowCandidateSource } from './window-candidate-source';
import type { LexiconRuntime } from './lexicon-runtime';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';

export type HotwordRecallStats = {
  hitsLexiconPinyinTopk: number;
  topkDroppedBelowMinScore: number;
  pinyinAttemptCount: number;
  pinyinHitCount: number;
  pinyinNoHitCount: number;
  topkAttemptsByTermLength: Record<string, number>;
  topkHitsByTermLength: Record<string, number>;
  outOfBundleCandidateCount: number;
  maxDomainBoostApplied: number;
};

export function emptyHotwordRecallStats(): HotwordRecallStats {
  return {
    hitsLexiconPinyinTopk: 0,
    topkDroppedBelowMinScore: 0,
    pinyinAttemptCount: 0,
    pinyinHitCount: 0,
    pinyinNoHitCount: 0,
    topkAttemptsByTermLength: {},
    topkHitsByTermLength: {},
    outOfBundleCandidateCount: 0,
    maxDomainBoostApplied: 0,
  };
}

function topKForTermLength(termLength: number): number {
  const map = getAsrRepairQualityConfig().topKByTermLength;
  return map[String(termLength)] ?? 0;
}

function toHit(
  window: AsrWindow,
  hotword: HotwordEntry,
  phoneticScore: number,
  recallPath: HotwordRecallHit['recallPath'],
  extra?: Pick<
    HotwordRecallHit,
    | 'candidateScore'
    | 'candidateScoreBreakdown'
    | 'rankInTopK'
    | 'termLength'
    | 'matchType'
    | 'matchedAlias'
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

export function recallHotwordsForWindow(
  window: AsrWindow,
  runtime: LexiconRuntime,
  profile: ActiveLexiconProfileSnapshot = defaultGeneralProfile(),
  stats?: HotwordRecallStats
): HotwordRecallHit[] {
  const cfg = getAsrRepairQualityConfig();
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

  const out: HotwordRecallHit[] = [];

  const { hits: topkHits, maxDomainBoostApplied } = lookupTopKByPinyin(runtime, {
    syllables: window.syllables,
    windowText: window.text,
    termLength,
    topK,
    profile,
  });

  if (stats) {
    stats.maxDomainBoostApplied = Math.max(stats.maxDomainBoostApplied, maxDomainBoostApplied);
  }

  for (const hit of topkHits) {
    if (hit.hotword.word === window.text) {
      continue;
    }
    out.push(
      toHit(window, hit.hotword, hit.phoneticScore, hit.source, {
        candidateScore: hit.candidateScore,
        candidateScoreBreakdown: hit.candidateScoreBreakdown,
        rankInTopK: hit.rankInTopK,
        termLength: hit.termLength,
        matchType: hit.matchType,
        matchedAlias: hit.matchedAlias,
      })
    );
  }

  if (stats) {
    const recalled = out.filter((h) => isV3WindowCandidateSource(h.recallPath));
    if (recalled.length > 0) {
      stats.hitsLexiconPinyinTopk += recalled.length;
      stats.pinyinHitCount += recalled.length;
      stats.topkHitsByTermLength[lenKey] =
        (stats.topkHitsByTermLength[lenKey] ?? 0) + recalled.length;
    } else if (stats.pinyinAttemptCount > 0) {
      stats.pinyinNoHitCount += 1;
    }
  }

  return out;
}
