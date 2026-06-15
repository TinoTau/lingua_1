/**
 * FW detector — bounded span TopK recall (LexiconRuntimeV2 only).
 */

import { isMixedLatinToken } from './scored-lexicon';
import { textToSyllables } from './phonetic/pinyin';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import type { WindowCandidateSource } from './window-candidate-source';
import { matchEnabledDomain } from './domain-filter';
import { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2-holder';
import { resolveDomainIdsForRecall } from '../lexicon-v2/domain-recall-merge';
import {
  isFuzzyPinyinRecallEnabled,
  isWeakDomainRecallEnabled,
  shouldUseIndustryRouting,
} from '../lexicon-v2/lexicon-fw-recall-config';
import { getLexiconRecallContext } from '../lexicon-v2/lexicon-recall-context';
import { resolveRecallDomains } from '../lexicon-v2/industry-routing-domain-resolver';
import { recallSpanTopKV2 } from '../lexicon-v2/recall-span-topk-v2';
import { resolveWeakDomainRecallPlan } from '../lexicon-v2/weak-domain-recall-resolver';

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
  /** P0.5: acoustic tone pattern from CNN (Recall strict filter). */
  acousticTonePattern?: number[];
};

export type LocalSpanRecallResult = {
  hits: LocalSpanRecallHit[];
  maxPhoneticScore: number;
  skippedReason?: 'empty' | 'syllable_out_of_range' | 'v2_unavailable';
  recallToneCompatibleCount?: number;
  recallToneFallbackCount?: number;
};

const MIN_SYLLABLES = 2;
const MAX_SYLLABLES = 5;

function passesEnabledDomainFilter(hit: LocalSpanRecallHit, enabledDomains: string[]): boolean {
  if (!hit.domains.length) {
    return true;
  }
  return matchEnabledDomain(hit.domains, enabledDomains);
}

function mapHit(hit: {
  hotword: {
    word: string;
    priorScore: number;
    domains?: string[];
    domain?: string;
    repairTarget?: boolean;
    tonePinyinKey?: string;
  };
  candidateScore: number;
  phoneticScore: number;
  source: LocalSpanRecallHit['source'];
}): LocalSpanRecallHit {
  const domains = hit.hotword.domains?.length
    ? hit.hotword.domains
    : hit.hotword.domain
      ? [hit.hotword.domain]
      : [];
  return {
    word: hit.hotword.word,
    priorScore: hit.hotword.priorScore,
    candidateScore: hit.candidateScore,
    phoneticScore: hit.phoneticScore,
    source: hit.source,
    domains,
    repairTarget: hit.hotword.repairTarget === true,
    tonePinyinKey: hit.hotword.tonePinyinKey,
  };
}

function resolveRecallDomainIds(
  profile: ActiveLexiconProfileSnapshot,
  enabledDomains: readonly string[],
  weakEnabled: boolean
): string[] {
  if (weakEnabled) {
    return [...resolveWeakDomainRecallPlan(profile, enabledDomains, true).queryDomainIds];
  }
  if (shouldUseIndustryRouting()) {
    const runtimeV2 = getLexiconRuntimeV2();
    const sessionIntent = getLexiconRecallContext()?.sessionIntent;
    return resolveRecallDomains({
      sessionIntent,
      enabledDomains,
      runtimeV2,
    }).domainIds;
  }
  return resolveDomainIdsForRecall(profile);
}

export function recallSpanTopK(
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

  if (isMixedLatinToken(trimmed)) {
    return { hits: [], maxPhoneticScore: 0 };
  }

  const v2State = ensureLexiconRuntimeV2Loaded();
  if (v2State.status !== 'ok') {
    return { hits: [], maxPhoneticScore: 0, skippedReason: 'v2_unavailable' };
  }

  const weakEnabled = isWeakDomainRecallEnabled();
  const fuzzyEnabled = isFuzzyPinyinRecallEnabled();
  const weakDomainPlan = resolveWeakDomainRecallPlan(profile, enabledDomains, weakEnabled);

  const effectiveTopK = options?.perSpanLimit ?? topK;
  const runtimeV2 = getLexiconRuntimeV2();
  const domainIds = resolveRecallDomainIds(profile, enabledDomains, weakEnabled);
  const recallResult = recallSpanTopKV2(runtimeV2, {
    syllables,
    windowText: trimmed,
    termLength: trimmed.length,
    topK: effectiveTopK,
    profile,
    domainIds,
    perSpanLimit: options?.perSpanLimit,
    acousticTonePattern: options?.acousticTonePattern,
    weakDomainPlan: weakEnabled ? weakDomainPlan : undefined,
    fuzzyRecallEnabled: fuzzyEnabled,
  });
  const mapped = recallResult.hits.map(mapHit);
  const filtered = mapped
    .filter((h) => h.priorScore >= minPrior)
    .filter((h) => passesEnabledDomainFilter(h, enabledDomains));
  const maxPhoneticScore = filtered.reduce((m, h) => Math.max(m, h.phoneticScore), 0);
  return {
    hits: filtered,
    maxPhoneticScore,
    recallToneCompatibleCount: recallResult.recallToneCompatibleCount,
    recallToneFallbackCount: recallResult.recallToneFallbackCount,
  };
}
