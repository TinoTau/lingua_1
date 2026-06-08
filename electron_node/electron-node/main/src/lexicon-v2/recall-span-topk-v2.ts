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
import { mergeSpanCandidatesCombined, type TierHotwordRow } from './merge-span-candidates';
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
};

export type RecallSpanTopKV2Result = {
  hits: RecallSpanTopKV2Hit[];
  maxDomainBoostApplied: number;
  recallToneCompatibleCount: number;
  recallToneFallbackCount: number;
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
  variant: FuzzyPinyinVariant,
  plan?: WeakDomainRecallPlan
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

  if (plan?.enabled) {
    if (plan.strongDomainIds.includes(domainId)) {
      return 'exact_domain_strong';
    }
    if (plan.weakDomainIds.includes(domainId)) {
      return 'exact_domain_weak';
    }
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

  const recallCandidateKind = classifyRecallCandidateKind(hotword, variant, plan);
  const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
  const candidateScoreBreakdown = computeCandidateScoreBreakdown({
    hotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    profile,
    recallCandidateKind,
    domainBoostContext: boostContext,
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
  if (existing && existing.candidateScore >= candidateScore) {
    return;
  }

  bumpSourceBreakdown(sourceBreakdown, recallCandidateKind);
  if (plan?.enabled) {
    const domains = hotwordDomains(hotword);
    if (domains.some((d) => plan.weakDomainIds.includes(d))) {
      weakDomainCandidateCount.value += 1;
    }
  }

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
  });
}

function hotwordToTierRow(hotword: HotwordEntry, tier: TierHotwordRow['tier']): TierHotwordRow {
  return {
    ...hotword,
    isAlias: hotword.isAlias === true,
    tier,
  };
}

function mergeTierCandidates(
  baseHits: HotwordEntry[],
  domainHits: HotwordEntry[],
  idiomHits: HotwordEntry[],
  cfg: ReturnType<typeof getLexiconRuntimeV2Config>,
  perSpanLimit?: number,
  domainIds?: readonly string[]
): HotwordEntry[] {
  if (perSpanLimit != null && perSpanLimit > 0) {
    const rows: TierHotwordRow[] = [
      ...domainHits.map((h) => hotwordToTierRow(h, 'domain')),
      ...baseHits.map((h) => hotwordToTierRow(h, 'base')),
      ...idiomHits.map((h) => hotwordToTierRow(h, 'idiom')),
    ];
    const hasActiveDomain = (domainIds?.length ?? 0) > 0;
    return mergeSpanCandidatesCombined(rows, perSpanLimit, hasActiveDomain);
  }

  const base = baseHits.slice(0, cfg.maxBaseCandidates);
  const domain = [...domainHits]
    .sort((a, b) => b.priorScore - a.priorScore)
    .slice(0, cfg.maxDomainCandidates);
  const idiom =
    cfg.maxIdiomCandidates > 0
      ? idiomHits.slice(0, cfg.maxIdiomCandidates)
      : [];
  return [...base, ...domain, ...idiom];
}

function collectTierCandidates(
  runtimeV2: LexiconRuntimeV2,
  key: string,
  termLength: number,
  domainIds: readonly string[],
  perSpanLimit?: number
): {
  entries: HotwordEntry[];
  baseHits: HotwordEntry[];
  domainHits: HotwordEntry[];
  idiomHits: HotwordEntry[];
  baseLookupMs: number;
  domainLookupMs: number;
  idiomLookupMs: number;
} {
  const cfg = getLexiconRuntimeV2Config();
  const sqlLimit = perSpanLimit != null ? Math.max(perSpanLimit, 8) : undefined;

  const t0 = Date.now();
  const baseHits = runtimeV2.lookupBaseByPinyinKey(key, termLength, sqlLimit);
  const baseLookupMs = Date.now() - t0;

  const domainHits: HotwordEntry[] = [];
  let domainLookupMs = 0;
  for (const domainId of domainIds) {
    const td = Date.now();
    domainHits.push(...runtimeV2.lookupDomainByPinyinKey(domainId, key, termLength, sqlLimit));
    domainLookupMs += Date.now() - td;
  }

  let idiomHits: HotwordEntry[] = [];
  let idiomLookupMs = 0;
  if (termLength === 4 && cfg.maxIdiomCandidates > 0) {
    const ti = Date.now();
    idiomHits = runtimeV2.lookupIdiomByPinyinKey(key, termLength, sqlLimit);
    idiomLookupMs = Date.now() - ti;
  }

  const entries = mergeTierCandidates(
    baseHits,
    domainHits,
    idiomHits,
    cfg,
    perSpanLimit,
    domainIds
  );
  return { entries, baseHits, domainHits, idiomHits, baseLookupMs, domainLookupMs, idiomLookupMs };
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
    weakDomainPlan,
  } = input;
  const profile = input.profile ?? defaultGeneralProfile();
  const cfg = getLexiconRuntimeV2Config();
  const recallStart = Date.now();
  const fuzzyRecallEnabled = input.fuzzyRecallEnabled === true;
  const boostContext = domainBoostContextFromPlan(weakDomainPlan);

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

  const legacyDomainIds =
    profile.primaryDomain && profile.primaryDomain !== 'general' ? domainIds : [];
  const domainHitsBeforeWeak = weakDomainPlan?.enabled
    ? collectTierCandidates(
        runtimeV2,
        syllablesKey(syllables),
        syllables.length,
        [...legacyDomainIds],
        perSpanLimit
      ).domainHits.length
    : undefined;

  const bestById = new Map<string, RecallSpanTopKV2Hit>();
  const sourceBreakdown: RecallSourceBreakdown = {
    exactBase: 0,
    exactDomainStrong: 0,
    exactDomainWeak: 0,
    fuzzyPlain: 0,
    fuzzyPlainDomain: 0,
  };
  const weakDomainCandidateCount = { value: 0 };
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
      perVariantLimit
    );

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
        boostContext,
        weakDomainPlan,
        acousticTonePattern,
        bestById,
        sourceBreakdown,
        weakDomainCandidateCount
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
    weakDomainEnabled: weakDomainPlan?.enabled,
    weakDomainIds: weakDomainPlan?.enabled ? weakDomainPlan.weakDomainIds.join('|') : undefined,
    weakDomainCandidateCount: weakDomainPlan?.enabled ? weakDomainCandidateCount.value : undefined,
    fuzzyRecallEnabled,
    fuzzyVariantCount: fuzzyRecallEnabled ? variants.length : undefined,
    fuzzyCandidateCount:
      fuzzyRecallEnabled
        ? sourceBreakdown.fuzzyPlain + sourceBreakdown.fuzzyPlainDomain
        : undefined,
    candidateSourceBreakdown: weakDomainPlan?.enabled || fuzzyRecallEnabled ? sourceBreakdown : undefined,
    recallEmptyBeforeFuzzy: fuzzyRecallEnabled ? exactScoredCount === 0 : undefined,
    recallEmptyAfterFuzzy: fuzzyRecallEnabled ? scored.length === 0 : undefined,
    domainHitsBeforeWeak,
    domainHitsAfterWeak: weakDomainPlan?.enabled ? domainHitsTotal : undefined,
    fuzzyVariantExamples,
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
  };
}
