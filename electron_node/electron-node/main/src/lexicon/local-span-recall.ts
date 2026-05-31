/**
 * FW detector — bounded span TopK recall (exact pinyin bucket, no window-recall).
 */

import { lookupTopKByPinyin } from './pinyin-topk-lookup';
import type { LexiconRuntime } from './lexicon-runtime';
import { textToSyllables } from './phonetic/pinyin';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import type { WindowCandidateSource } from './window-candidate-source';
import { matchEnabledDomain } from './domain-filter';
import { isLexiconRuntimeV2RecallEnabled } from '../lexicon-v2/lexicon-fw-recall-config';
import { recallSpanTopKViaRuntimeV2 } from '../lexicon-v2/runtime-v2-recall-adapter';

export type LocalSpanRecallHit = {
  word: string;
  priorScore: number;
  candidateScore: number;
  phoneticScore: number;
  source: WindowCandidateSource;
  domains: string[];
  repairTarget: boolean;
  tonePinyinKey?: string;
};

export type LocalSpanRecallOptions = {
  /** P4: combined domain+alias+base cap (replaces tier叠加 merge). */
  perSpanLimit?: number;
};

export type LocalSpanRecallResult = {
  hits: LocalSpanRecallHit[];
  maxPhoneticScore: number;
  skippedReason?: 'empty' | 'syllable_out_of_range';
};

const MIN_SYLLABLES = 2;
const MAX_SYLLABLES = 5;

function passesEnabledDomainFilter(hit: LocalSpanRecallHit, enabledDomains: string[]): boolean {
  if (!hit.domains.length) {
    return true;
  }
  return matchEnabledDomain(hit.domains, enabledDomains);
}

function recallSpanTopKV1(
  runtime: LexiconRuntime,
  trimmed: string,
  syllables: string[],
  profile: ActiveLexiconProfileSnapshot,
  topK: number,
  minPrior: number,
  enabledDomains: string[]
): LocalSpanRecallResult {
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

export function recallSpanTopK(
  runtime: LexiconRuntime,
  spanText: string,
  profile: ActiveLexiconProfileSnapshot,
  topK: number,
  minPrior: number,
  enabledDomains: string[],
  options?: LocalSpanRecallOptions
): LocalSpanRecallResult {
  const trimmed = spanText.trim();
  if (!trimmed || topK <= 0) {
    return { hits: [], maxPhoneticScore: 0, skippedReason: 'empty' };
  }

  const syllables = textToSyllables(trimmed);
  if (syllables.length < MIN_SYLLABLES || syllables.length > MAX_SYLLABLES) {
    return { hits: [], maxPhoneticScore: 0, skippedReason: 'syllable_out_of_range' };
  }

  if (!isLexiconRuntimeV2RecallEnabled()) {
    return recallSpanTopKV1(runtime, trimmed, syllables, profile, topK, minPrior, enabledDomains);
  }

  const effectiveTopK = options?.perSpanLimit ?? topK;
  const v2Result = recallSpanTopKViaRuntimeV2(
    runtime,
    trimmed,
    profile,
    effectiveTopK,
    enabledDomains,
    options
  );
  const filtered = v2Result.hits
    .filter((h) => h.priorScore >= minPrior)
    .filter((h) => passesEnabledDomainFilter(h, enabledDomains));

  const maxPhoneticScore = filtered.reduce((m, h) => Math.max(m, h.phoneticScore), 0);
  return { hits: filtered, maxPhoneticScore };
}
