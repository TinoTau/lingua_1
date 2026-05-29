/**
 * FW detector — bounded span TopK recall (exact pinyin bucket, no window-recall).
 */

import { lookupTopKByPinyin } from './pinyin-topk-lookup';
import type { LexiconRuntime } from './lexicon-runtime';
import { textToSyllables } from './phonetic/pinyin';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import type { WindowCandidateSource } from './window-candidate-source';
import { matchEnabledDomain } from './domain-filter';

export type LocalSpanRecallHit = {
  word: string;
  priorScore: number;
  candidateScore: number;
  phoneticScore: number;
  source: WindowCandidateSource;
  domains: string[];
  repairTarget: boolean;
};

export type LocalSpanRecallResult = {
  hits: LocalSpanRecallHit[];
  maxPhoneticScore: number;
  skippedReason?: 'empty' | 'syllable_out_of_range';
};

const MIN_SYLLABLES = 2;
const MAX_SYLLABLES = 5;

export function recallSpanTopK(
  runtime: LexiconRuntime,
  spanText: string,
  profile: ActiveLexiconProfileSnapshot,
  topK: number,
  minPrior: number,
  enabledDomains: string[]
): LocalSpanRecallResult {
  const trimmed = spanText.trim();
  if (!trimmed || topK <= 0) {
    return { hits: [], maxPhoneticScore: 0, skippedReason: 'empty' };
  }

  const syllables = textToSyllables(trimmed);
  if (syllables.length < MIN_SYLLABLES || syllables.length > MAX_SYLLABLES) {
    return { hits: [], maxPhoneticScore: 0, skippedReason: 'syllable_out_of_range' };
  }

  const { hits } = lookupTopKByPinyin(runtime, {
    syllables,
    windowText: trimmed,
    termLength: trimmed.length,
    topK,
    profile,
  });

  const filtered = hits
    .filter((h) => h.hotword.priorScore >= minPrior)
    .filter((h) => matchEnabledDomain(h.hotword.domains, enabledDomains))
    .map((h) => ({
      word: h.hotword.word,
      priorScore: h.hotword.priorScore,
      candidateScore: h.candidateScore,
      phoneticScore: h.phoneticScore,
      source: h.source,
      domains: h.hotword.domains?.length ? h.hotword.domains : h.hotword.domain ? [h.hotword.domain] : [],
      repairTarget: h.hotword.repairTarget === true,
    }));

  const maxPhoneticScore = filtered.reduce((m, h) => Math.max(m, h.phoneticScore), 0);
  return { hits: filtered, maxPhoneticScore };
}
