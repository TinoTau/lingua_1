/**
 * Phase 3 hotfix — V2 tier recall with SQL-limited candidates + merge cap.
 */

import {
  computeCandidateScoreBreakdown,
  hotwordDomains,
  type CandidateScoreBreakdown,
  type RecallCandidateKind,
} from '../lexicon/candidate-score';
import type { DomainBoostContext } from '../lexicon/domain-boost-calculator';
import { scorePinyinSimilarity } from '../lexicon/phonetic/pinyin';
import { syllablesKey } from '../lexicon/pinyin-index';
import { getAsrRepairQualityConfig } from '../asr-repair-quality/quality-config';
import type { HotwordEntry } from '../lexicon/hotword-types';
import { resolveWindowCandidateSource, type WindowCandidateSource } from '../lexicon/window-candidate-source';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { recordRecallSpanDiagnostics, type RecallSourceBreakdown } from './recall-v2-diagnostics';
import { isIndustryRoutingEnabled } from './lexicon-fw-recall-config';
import { getLexiconRuntimeV2Config } from './lexicon-runtime-v2-config';
import { sortRecallHitsByToneCompatibility } from '../lexicon/tone-recall-sort';
import type { ToneReason } from '../fw-detector/tone-match-score';
import {
  collectTierCandidatesToneFirst,
  type ToneLookupStage,
} from './tone-first-tier-collector';
import {
  alignVariantWindowText,
  buildFuzzyPinyinVariants,
  exactFuzzyPinyinVariant,
  type FuzzyPinyinVariant,
} from './fuzzy-pinyin-key-builder';
import type { WeakDomainRecallPlan } from './weak-domain-recall-resolver';

export type RecallSpanTopKV2Hit = {
  hotword: HotwordEntry;
  phoneticScore: number;
  candidateScore: number;
  candidateScoreBreakdown: CandidateScoreBreakdown;
  source: WindowCandidateSource;
  matchedAlias?: string;
  acousticTonePattern?: number[];
  toneLookupStage?: ToneLookupStage;
  toneCompatible?: boolean;
  tonePenalty?: number;
  toneReason?: ToneReason;
};

export type RecallSpanTopKV2Result = {
  hits: RecallSpanTopKV2Hit[];
  maxDomainBoostApplied: number;
  recallToneCompatibleCount: number;
  recallToneFallbackCount: number;
  queryTonePinyinKey?: string;
  toneExactHitCount?: number;
  plainFallbackHitCount?: number;
};

export type RecallSpanTopKV2Input = {
  syllables: string[];
  windowText: string;
  termLength: number;
  topK: number;
  profile?: ActiveLexiconProfileSnapshot;
  domainIds: readonly string[];
  /** P4: combined limit merge (domain>alias>base). */
  perSpanLimit?: number;
  /** P0.5: acoustic tone pattern from CNN toneTokens only. */
  acousticTonePattern?: number[];
  weakDomainPlan?: WeakDomainRecallPlan;
  fuzzyRecallEnabled?: boolean;
  /** Fuzzy path SQL cap per variant (default 2). */
  perVariantLimit?: number;
};

const DEFAULT_PER_VARIANT_LIMIT = 2;

function minCandidateScore(): number {
  return getAsrRepairQualityConfig().minCandidateScore;
}

function domainBoostContextFromPlan(plan?: WeakDomainRecallPlan): DomainBoostContext | undefined {
  if (!plan?.enabled) {
    return undefined;
  }
  return {
    strongDomainIds: plan.strongDomainIds,
    weakDomainIds: plan.weakDomainIds,
  };
}

function isDomainHotword(hotword: HotwordEntry): boolean {
  return Boolean(hotword.domain || hotword.domains?.length);
}

function classifyRecallCandidateKind(
  hotword: HotwordEntry,
  variant: FuzzyPinyinVariant
): RecallCandidateKind {
  const domains = hotwordDomains(hotword);
  const domainId = domains[0] ?? 'general';
  const domainHit = isDomainHotword(hotword);

  if (variant.isFuzzy) {
    return domainHit && domainId !== 'general' ? 'fuzzy_plain_domain' : 'fuzzy_plain';
  }

  if (!domainHit) {
    return 'exact_base';
  }

  return 'exact_domain_strong';
}

function bumpSourceBreakdown(
  breakdown: RecallSourceBreakdown,
  kind: RecallCandidateKind
): void {
  switch (kind) {
    case 'exact_base':
      breakdown.exactBase += 1;
      break;
    case 'exact_domain_strong':
      breakdown.exactDomainStrong += 1;
      break;
    case 'exact_domain_weak':
      breakdown.exactDomainWeak += 1;
      break;
    case 'fuzzy_plain':
      breakdown.fuzzyPlain += 1;
      break;
    case 'fuzzy_plain_domain':
      breakdown.fuzzyPlainDomain += 1;
      break;
  }
}

function scoreHotword(
  hotword: HotwordEntry,
  variant: FuzzyPinyinVariant,
  windowText: string,
  profile: ActiveLexiconProfileSnapshot,
  boostContext: DomainBoostContext | undefined,
  plan: WeakDomainRecallPlan | undefined,
  acousticTonePattern: number[] | undefined,
  toneLookupStage: ToneLookupStage | undefined,
  bestById: Map<string, RecallSpanTopKV2Hit>,
  sourceBreakdown: RecallSourceBreakdown,
  weakDomainCandidateCount: { value: number }
): void {
  const syllables = variant.syllables;
  if (!hotword.enabled || hotword.word.length !== syllables.length) {
    return;
  }
  if (!Number.isFinite(hotword.priorScore) || hotword.priorScore <= 0) {
    return;
  }

  const recallCandidateKind = classifyRecallCandidateKind(hotword, variant);
  const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
  const candidateScoreBreakdown = computeCandidateScoreBreakdown({
    hotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    profile,
    recallCandidateKind,
    domainBoostContext: undefined,
  });
  const candidateScore =
    candidateScoreBreakdown.priorScore +
    candidateScoreBreakdown.phoneticSimilarity +
    candidateScoreBreakdown.exactLengthBonus +
    candidateScoreBreakdown.domainBoost -
    candidateScoreBreakdown.editDistancePenalty -
    candidateScoreBreakdown.fuzzyPenalty;
  if (candidateScore < minCandidateScore()) {
    return;
  }

  const existing = bestById.get(hotword.id);
  if (existing) {
    if (existing.toneLookupStage === 'tone_exact' && toneLookupStage !== 'tone_exact') {
      return;
    }
    if (existing.candidateScore >= candidateScore) {
      return;
    }
  }

  bumpSourceBreakdown(sourceBreakdown, recallCandidateKind);

  const tonePattern = acousticTonePattern?.length
    ? acousticTonePattern.slice(0, syllables.length)
    : undefined;

  bestById.set(hotword.id, {
    hotword,
    phoneticScore,
    candidateScore,
    candidateScoreBreakdown,
    source: resolveWindowCandidateSource({ viaPinyin: true }),
    acousticTonePattern: tonePattern,
    toneLookupStage,
    ...(toneLookupStage === 'tone_exact'
      ? { toneCompatible: true, tonePenalty: 1.0, toneReason: 'match' as const }
      : {}),
  });
}

function collectTierCandidates(
  runtimeV2: LexiconRuntimeV2,
  key: string,
  termLength: number,
  domainIds: readonly string[],
  perSpanLimit: number | undefined,
  variantSyllables: string[],
  acousticTonePattern?: number[]
) {
  return collectTierCandidatesToneFirst(
    runtimeV2,
    key,
    termLength,
    domainIds,
    perSpanLimit,
    variantSyllables,
    acousticTonePattern
  );
}

function resolveVariants(
  syllables: string[],
  fuzzyRecallEnabled: boolean
): FuzzyPinyinVariant[] {
  if (!fuzzyRecallEnabled) {
    return [exactFuzzyPinyinVariant(syllables)];
  }
  const built = buildFuzzyPinyinVariants(syllables);
  return built.length ? built : [exactFuzzyPinyinVariant(syllables)];
}

export function recallSpanTopKV2(
  runtimeV2: LexiconRuntimeV2,
  input: RecallSpanTopKV2Input
): RecallSpanTopKV2Result {
  const {
    syllables,
    windowText,
    topK,
    domainIds,
    perSpanLimit,
    acousticTonePattern,
  } = input;
  const profile = input.profile ?? defaultGeneralProfile();
  const cfg = getLexiconRuntimeV2Config();
  const recallStart = Date.now();
  const fuzzyRecallEnabled = input.fuzzyRecallEnabled === true;

  if (topK <= 0 || syllables.length < 2 || syllables.length > 5 || !syllables.length) {
    return {
      hits: [],
      maxDomainBoostApplied: 0,
      recallToneCompatibleCount: 0,
      recallToneFallbackCount: 0,
    };
  }

  const variants = resolveVariants(syllables, fuzzyRecallEnabled);
  const perVariantLimit = fuzzyRecallEnabled
    ? Math.min(DEFAULT_PER_VARIANT_LIMIT, input.perVariantLimit ?? DEFAULT_PER_VARIANT_LIMIT)
    : perSpanLimit;

  let baseHitsTotal = 0;
  let domainHitsTotal = 0;
  let idiomHitsTotal = 0;
  let baseLookupMs = 0;
  let domainLookupMs = 0;
  let idiomLookupMs = 0;
  let candidateCountBeforeMerge = 0;
  let toneExactHitCount = 0;
  let plainFallbackHitCount = 0;
  let toneSqlCount = 0;
  let queryTonePinyinKey: string | undefined;

  const bestById = new Map<string, RecallSpanTopKV2Hit>();
  const sourceBreakdown: RecallSourceBreakdown = {
    exactBase: 0,
    exactDomainStrong: 0,
    exactDomainWeak: 0,
    fuzzyPlain: 0,
    fuzzyPlainDomain: 0,
  };
  let exactScoredCount = 0;

  const mergeStart = Date.now();
  for (const variant of variants) {
    const variantKey = syllablesKey(variant.syllables);
    const variantTermLength = variant.syllables.length;
    const variantWindowText = alignVariantWindowText(windowText, variant);
    const tier = collectTierCandidates(
      runtimeV2,
      variantKey,
      variantTermLength,
      domainIds,
      perVariantLimit,
      variant.syllables,
      acousticTonePattern
    );

    toneExactHitCount += tier.toneExactHitCount;
    plainFallbackHitCount += tier.plainFallbackHitCount;
    toneSqlCount += tier.toneSqlCount;
    if (tier.queryTonePinyinKey) {
      queryTonePinyinKey = tier.queryTonePinyinKey;
    }

    baseHitsTotal += tier.baseHits.length;
    domainHitsTotal += tier.domainHits.length;
    idiomHitsTotal += tier.idiomHits.length;
    baseLookupMs += tier.baseLookupMs;
    domainLookupMs += tier.domainLookupMs;
    idiomLookupMs += tier.idiomLookupMs;
    candidateCountBeforeMerge += tier.entries.length;

    for (const hotword of tier.entries) {
      scoreHotword(
        hotword,
        variant,
        variantWindowText,
        profile,
        undefined,
        undefined,
        acousticTonePattern,
        tier.entryStages.get(hotword.id),
        bestById,
        sourceBreakdown,
        { value: 0 }
      );
    }
    if (!variant.isFuzzy) {
      exactScoredCount = bestById.size;
    }
  }

  const scored = Array.from(bestById.values());
  scored.sort((a, b) => b.candidateScore - a.candidateScore);
  const toneSorted = sortRecallHitsByToneCompatibility(scored, acousticTonePattern);
  const effectiveLimit = perSpanLimit != null && perSpanLimit > 0 ? perSpanLimit : topK;
  const hits = toneSorted.hits.slice(0, effectiveLimit);
  const mergeMs = Date.now() - mergeStart;
  const v2RecallMs = Date.now() - recallStart;

  const fuzzyVariantExamples = fuzzyRecallEnabled
    ? variants.filter((v) => v.isFuzzy).map((v) => v.syllables.join('|'))
    : undefined;

  recordRecallSpanDiagnostics({
    base_hits: baseHitsTotal,
    domain_hits: domainHitsTotal,
    idiom_hits: idiomHitsTotal,
    base_after_limit: perSpanLimit != null ? baseHitsTotal : Math.min(baseHitsTotal, cfg.maxBaseCandidates),
    domain_after_limit:
      perSpanLimit != null ? domainHitsTotal : Math.min(domainHitsTotal, cfg.maxDomainCandidates),
    idiom_after_limit:
      cfg.maxIdiomCandidates > 0
        ? perSpanLimit != null
          ? idiomHitsTotal
          : Math.min(idiomHitsTotal, cfg.maxIdiomCandidates)
        : 0,
    candidate_count_before_merge: candidateCountBeforeMerge,
    candidate_count_after_merge: scored.length,
    sent_to_kenlm: hits.length,
    active_domain: domainIds.length ? domainIds.join('|') : 'base_only',
    industry_routing_used: isIndustryRoutingEnabled(),
    v2_recall_ms: v2RecallMs,
    base_lookup_ms: baseLookupMs,
    domain_lookup_ms: domainLookupMs,
    idiom_lookup_ms: idiomLookupMs,
    merge_ms: mergeMs,
    weakDomainEnabled: undefined,
    weakDomainIds: undefined,
    weakDomainCandidateCount: undefined,
    fuzzyRecallEnabled,
    fuzzyVariantCount: fuzzyRecallEnabled ? variants.length : undefined,
    fuzzyCandidateCount:
      fuzzyRecallEnabled
        ? sourceBreakdown.fuzzyPlain + sourceBreakdown.fuzzyPlainDomain
        : undefined,
    candidateSourceBreakdown: fuzzyRecallEnabled ? sourceBreakdown : undefined,
    recallEmptyBeforeFuzzy: fuzzyRecallEnabled ? exactScoredCount === 0 : undefined,
    recallEmptyAfterFuzzy: fuzzyRecallEnabled ? scored.length === 0 : undefined,
    domainHitsBeforeWeak: undefined,
    domainHitsAfterWeak: undefined,
    fuzzyVariantExamples,
    tone_exact_hits: toneSqlCount > 0 || toneExactHitCount > 0 ? toneExactHitCount : undefined,
    plain_fallback_hits: plainFallbackHitCount > 0 ? plainFallbackHitCount : undefined,
    tone_sql_count: toneSqlCount > 0 ? toneSqlCount : undefined,
    query_tone_pinyin_key: queryTonePinyinKey,
  });

  const maxDomainBoostApplied = hits.reduce(
    (max, hit) => Math.max(max, hit.candidateScoreBreakdown.domainBoost),
    0
  );
  return {
    hits,
    maxDomainBoostApplied,
    recallToneCompatibleCount: toneSorted.recallToneCompatibleCount,
    recallToneFallbackCount: toneSorted.recallToneFallbackCount,
    queryTonePinyinKey,
    toneExactHitCount: toneExactHitCount > 0 ? toneExactHitCount : undefined,
    plainFallbackHitCount: plainFallbackHitCount > 0 ? plainFallbackHitCount : undefined,
  };
}
