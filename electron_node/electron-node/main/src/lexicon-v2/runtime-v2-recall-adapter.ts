/**
 * Phase 3/4 — bridge LexiconRuntimeV2 recall into local-span-recall contract.
 */

import { lookupTopKByPinyin } from '../lexicon/pinyin-topk-lookup';
import type { LexiconRuntime } from '../lexicon/lexicon-runtime';
import { isMixedLatinToken } from '../lexicon/scored-lexicon';
import { textToSyllables } from '../lexicon/phonetic/pinyin';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { ensureLexiconRuntimeV2Loaded, getLexiconRuntimeV2 } from './lexicon-runtime-v2-holder';
import { resolveDomainIdsForRecall } from './domain-recall-merge';
import { isIndustryRoutingEnabled } from './lexicon-fw-recall-config';
import { getLexiconRecallContext } from './lexicon-recall-context';
import { resolveRecallDomains } from './industry-routing-domain-resolver';
import { recallSpanTopKV2 } from './recall-span-topk-v2';
import type { LocalSpanRecallHit, LocalSpanRecallOptions } from '../lexicon/local-span-recall';

export type RuntimeV2RecallAdapterResult = {
  hits: LocalSpanRecallHit[];
  maxPhoneticScore: number;
  fallbackReason?: 'v2_unavailable';
};

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
  enabledDomains: readonly string[]
): string[] {
  if (isIndustryRoutingEnabled()) {
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

export function recallSpanTopKViaRuntimeV2(
  v1Runtime: LexiconRuntime,
  spanText: string,
  profile: ActiveLexiconProfileSnapshot,
  topK: number,
  enabledDomains: readonly string[],
  options?: LocalSpanRecallOptions
): RuntimeV2RecallAdapterResult {
  const trimmed = spanText.trim();
  const syllables = textToSyllables(trimmed);

  if (isMixedLatinToken(trimmed)) {
    const { hits } = lookupTopKByPinyin(v1Runtime, {
      syllables,
      windowText: trimmed,
      termLength: trimmed.length,
      topK,
      profile,
    });
    const mapped = hits.map(mapHit);
    const maxPhoneticScore = mapped.reduce((max, hit) => Math.max(max, hit.phoneticScore), 0);
    return { hits: mapped, maxPhoneticScore };
  }

  const v2State = ensureLexiconRuntimeV2Loaded();
  if (v2State.status !== 'ok') {
    return { hits: [], maxPhoneticScore: 0, fallbackReason: 'v2_unavailable' };
  }

  const runtimeV2 = getLexiconRuntimeV2();
  const domainIds = resolveRecallDomainIds(profile, enabledDomains);
  const { hits } = recallSpanTopKV2(runtimeV2, {
    syllables,
    windowText: trimmed,
    termLength: trimmed.length,
    topK,
    profile,
    domainIds,
    perSpanLimit: options?.perSpanLimit,
  });
  const mapped = hits.map(mapHit);
  const maxPhoneticScore = mapped.reduce((max, hit) => Math.max(max, hit.phoneticScore), 0);
  return { hits: mapped, maxPhoneticScore };
}
