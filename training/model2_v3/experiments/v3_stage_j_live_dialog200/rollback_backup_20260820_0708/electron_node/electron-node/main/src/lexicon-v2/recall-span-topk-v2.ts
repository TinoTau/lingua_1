/**
 * Phase 3 hotfix — V2 tier recall with SQL-limited candidates + merge cap.
 */

import {
  compareRecallHitsPrimaryScore,
  computeCandidateScore,
  computeCandidateScoreBreakdown,
  hotwordDomains,
  type CandidateScoreBreakdown,
  type RecallCandidateKind,
} from '../lexicon/candidate-score';
import { scorePinyinSimilarity } from '../lexicon/phonetic/pinyin';
import { syllablesKey } from '../lexicon/pinyin-index';
import { getAsrRepairQualityConfig } from '../asr-repair-quality/quality-config';
import type { HotwordEntry } from '../lexicon/hotword-types';
import { resolveWindowCandidateSource, type WindowCandidateSource } from '../lexicon/window-candidate-source';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
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
  resolveToneRecallReadiness,
  type ToneRecallReadiness,
} from './tone-recall-readiness';
import { normalizeTraditionalChinese } from '../fw-detector/pinyin-ime-v2/normalize-for-ime-alignment';
import {
  SINGLE_CHAR_COLLECTOR_TRACE_V1,
  classifyLength1CollectorTerminal,
  compactLength1SqlHits,
  type Length1CollectorDiagnostic,
  type Length1ChosenSource,
} from './single-char-collector-trace';
import {
  alignVariantWindowText,
  buildFuzzyPinyinVariants,
  exactFuzzyPinyinVariant,
  type FuzzyPinyinVariant,
} from './fuzzy-pinyin-key-builder';
import type { WeakDomainRecallPlan } from './weak-domain-recall-resolver';
import { buildSingleCharCandidateSetV1 } from './single-char-candidate-set-v1';
import type { SingleCharCandidateV1 } from '../model2-runtime/single-char-disambiguation-v1';

export type RecallSpanTopKV2Hit = {
  hotword: HotwordEntry;
  phoneticScore: number;
  candidateScore: number;
  candidateScoreBreakdown: CandidateScoreBreakdown;
  recallCandidateKind?: RecallCandidateKind;
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
  /** Always 0 after Batch 1.1C (Plain fill removed). */
  plainFallbackHitCount?: number;
  toneRecallReadiness?: ToneRecallReadiness;
  /** Observation-only SINGLE_CHAR_COLLECTOR_TRACE_V1. Absent on 2–5 recall. */
  length1Collector?: Length1CollectorDiagnostic;
  /**
   * Internal bounded ambiguous set (N>=2). Never copied into hits / Assembly.
   * Production unique-only hits remain 0 or 1.
   */
  singleCharAmbiguousSet?: SingleCharCandidateV1[];
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
  /**
   * Batch 1.1C: when false, caller closed tone channel → Fail Closed (Empty).
   * Undefined = enabled; decide from pattern + Runtime support.
   */
  toneCallerEnabled?: boolean;
  weakDomainPlan?: WeakDomainRecallPlan;
  fuzzyRecallEnabled?: boolean;
  /** Fuzzy path SQL cap per variant (default 2). */
  perVariantLimit?: number;
};

const DEFAULT_PER_VARIANT_LIMIT = 2;

function minCandidateScore(): number {
  return getAsrRepairQualityConfig().minCandidateScore;
}

function isDomainHotword(hotword: HotwordEntry): boolean {
  return Boolean(hotword.domains?.length);
}

function classifyRecallCandidateKind(
  hotword: HotwordEntry,
  variant: FuzzyPinyinVariant
): RecallCandidateKind {
  const domains = hotwordDomains(hotword);
  const domainHit = isDomainHotword(hotword);

  if (variant.isFuzzy) {
    return domainHit ? 'fuzzy_plain_domain' : 'fuzzy_plain';
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
  acousticTonePattern: number[] | undefined,
  toneLookupStage: ToneLookupStage | undefined,
  bestById: Map<string, RecallSpanTopKV2Hit>,
  sourceBreakdown: RecallSourceBreakdown
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
    recallCandidateKind,
  });
  const candidateScore = computeCandidateScore({
    hotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    recallCandidateKind,
  });
  if (candidateScore < minCandidateScore()) {
    return;
  }

  const existing = bestById.get(hotword.id);
  if (existing) {
    if (existing.toneLookupStage === 'tone_exact' && toneLookupStage !== 'tone_exact') {
      return;
    }
    const candidateHit: RecallSpanTopKV2Hit = {
      hotword,
      phoneticScore,
      candidateScore,
      candidateScoreBreakdown,
      recallCandidateKind,
      source: resolveWindowCandidateSource({ viaPinyin: true }),
      acousticTonePattern: undefined,
      toneLookupStage,
    };
    if (compareRecallHitsPrimaryScore(existing, candidateHit) <= 0) {
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
    recallCandidateKind,
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
  acousticTonePattern?: number[],
  toneCallerEnabled?: boolean
) {
  return collectTierCandidatesToneFirst(
    runtimeV2,
    key,
    termLength,
    domainIds,
    perSpanLimit,
    variantSyllables,
    acousticTonePattern,
    toneCallerEnabled
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

/** SQL fetch window for length=1 ambiguity detection (final return still capped at 1). */
const LENGTH1_AMBIGUITY_SQL_LIMIT = 8;

function filterEligibleBaseSingleChar(entries: readonly HotwordEntry[]): HotwordEntry[] {
  return entries.filter((h) => {
    if (!h.enabled || h.word.length !== 1) {
      return false;
    }
    if (h.isAlias === true) {
      return false;
    }
    if (!Number.isFinite(h.priorScore) || h.priorScore <= 0) {
      return false;
    }
    return true;
  });
}

/**
 * Mechanical truncation signal: Runtime returned a full LIMIT page.
 * Does not assert that more rows exist — only that the fetch may be incomplete.
 */
function length1FetchMayBeTruncated(
  returnedCount: number,
  requestedLimit: number = LENGTH1_AMBIGUITY_SQL_LIMIT
): boolean {
  return requestedLimit > 0 && returnedCount >= requestedLimit;
}

function pickUniqueSurfaceExact(
  entries: readonly HotwordEntry[],
  windowText: string
): HotwordEntry | null {
  const surface = windowText.trim();
  if (!surface) {
    return null;
  }
  const matches = entries.filter((h) => h.word === surface);
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Resolve length=1 base candidates under conservative ambiguity policy (CR 1.0.2 / 1.0.4).
 * Never Top1-guess among same-tone / plain homophones; surface exact may disambiguate
 * among the visible eligible set. Truncation-aware: residual singleton after a full LIMIT
 * page is NOT semantic unique (CR 1.0.4).
 */
function resolveLength1BaseCandidate(
  entries: readonly HotwordEntry[],
  windowText: string,
  fetchMayBeTruncated: boolean
): HotwordEntry | null {
  if (entries.length === 0) {
    return null;
  }
  if (entries.length === 1) {
    if (fetchMayBeTruncated) {
      return null;
    }
    return entries[0]!;
  }
  return pickUniqueSurfaceExact(entries, windowText);
}

function scoreLength1BaseHit(
  hotword: HotwordEntry,
  syllables: string[],
  windowText: string,
  toneLookupStage: ToneLookupStage,
  acousticTonePattern: number[] | undefined
): RecallSpanTopKV2Hit | null {
  // Force base-only semantics: empty domains, connectivity chars are not repair targets.
  const baseHotword: HotwordEntry = {
    ...hotword,
    domains: [],
    repairTarget: false,
    isAlias: false,
  };
  const variant = exactFuzzyPinyinVariant(syllables);
  const recallCandidateKind: RecallCandidateKind = 'exact_base';
  const phoneticScore = scorePinyinSimilarity(syllables, baseHotword.pinyin);
  const candidateScoreBreakdown = computeCandidateScoreBreakdown({
    hotword: baseHotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    recallCandidateKind,
  });
  const candidateScore = computeCandidateScore({
    hotword: baseHotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    recallCandidateKind,
  });
  if (candidateScore < minCandidateScore()) {
    return null;
  }
  const tonePattern = acousticTonePattern?.length
    ? acousticTonePattern.slice(0, syllables.length)
    : undefined;
  return {
    hotword: baseHotword,
    phoneticScore,
    candidateScore,
    candidateScoreBreakdown,
    recallCandidateKind,
    source: resolveWindowCandidateSource({ viaPinyin: true }),
    acousticTonePattern: tonePattern,
    toneLookupStage,
    ...(toneLookupStage === 'tone_exact'
      ? { toneCompatible: true, tonePenalty: 1.0, toneReason: 'match' as const }
      : {}),
  };
}

/**
 * Batch 1.1B — independent exact-surface identity when ambiguity path yields no Candidate.
 * Runtime returns rows only (LIMIT 2); Recall decides accept via eligibility + unique identity.
 * Batch 1.1C: only Tone exact API (Mandatory Tone Recall — no Plain exact).
 */
function tryExactSurfaceBaseIdentity(
  runtimeV2: LexiconRuntimeV2,
  input: {
    pinyinKey: string;
    windowText: string;
    tonePinyinKey: string;
  }
): {
  chosen: HotwordEntry | null;
  lookupMs: number;
  toneSqlDelta: number;
  sqlHitCount: number;
  eligibleCount: number;
} {
  const surface = input.windowText.trim();
  if (!surface) {
    return { chosen: null, lookupMs: 0, toneSqlDelta: 0, sqlHitCount: 0, eligibleCount: 0 };
  }
  const t0 = Date.now();
  const exactRaw = runtimeV2.lookupBaseByExactSurfacePinyinAndTone(
    input.pinyinKey,
    input.tonePinyinKey,
    surface,
    1
  );
  const lookupMs = Date.now() - t0;
  const eligible = filterEligibleBaseSingleChar(exactRaw);
  // LIMIT 2: 0 → miss; 1 → identity; ≥2 → defensive reject (schema PK makes ≥2 unlikely).
  if (eligible.length !== 1) {
    return { chosen: null, lookupMs, toneSqlDelta: 1, sqlHitCount: exactRaw.length, eligibleCount: eligible.length };
  }
  const only = eligible[0]!;
  if (only.word !== surface) {
    return { chosen: null, lookupMs, toneSqlDelta: 1, sqlHitCount: exactRaw.length, eligibleCount: eligible.length };
  }
  return { chosen: only, lookupMs, toneSqlDelta: 1, sqlHitCount: exactRaw.length, eligibleCount: eligible.length };
}

/**
 * Controlled length=1 Lattice Recall: base_lexicon only; Mandatory Tone Recall (1.1C).
 */
function collectBaseOnlySingleCharCandidate(
  runtimeV2: LexiconRuntimeV2,
  input: {
    syllables: string[];
    windowText: string;
    acousticTonePattern?: number[];
    toneCallerEnabled?: boolean;
  }
): {
  hit: RecallSpanTopKV2Hit | null;
  baseLookupMs: number;
  toneExactHitCount: number;
  plainFallbackHitCount: number;
  toneSqlCount: number;
  queryTonePinyinKey?: string;
  toneRecallReadiness: ToneRecallReadiness;
  diagnostic: Length1CollectorDiagnostic;
  ambiguousSet: SingleCharCandidateV1[];
} {
  const { syllables, windowText, acousticTonePattern, toneCallerEnabled } = input;
  const key = syllablesKey(syllables);
  const sqlLimit = LENGTH1_AMBIGUITY_SQL_LIMIT;
  const windowTextCanonical = normalizeTraditionalChinese((windowText || '').normalize('NFKC'));
  const minScore = minCandidateScore();

  const readiness = resolveToneRecallReadiness({
    syllables,
    runtimeSupportsTone: runtimeV2.supportsToneFirstRecall(),
    acousticTonePattern,
    toneCallerEnabled,
  });

  const buildDiagnostic = (args: {
    sqlExecuted: boolean;
    sqlHits: ReturnType<typeof compactLength1SqlHits>;
    sqlHitCount: number;
    eligibleHitCount: number;
    truncated: boolean;
    identityLookupRan: boolean;
    identitySqlHitCount: number;
    identityEligibleCount: number;
    chosenSource: Length1ChosenSource;
    chosenWord: string | null;
    candidateScore: number | null;
    scoreRejected: boolean;
    hitPresent: boolean;
    queryTonePinyinKey?: string;
  }): Length1CollectorDiagnostic => {
    const uniqueToneExact = args.eligibleHitCount === 1 && !args.truncated;
    const surfaceExactHitCount = args.sqlHits.filter((h) => h.surface === windowText.trim()).length;
    const canonicalInSqlHits = args.sqlHits.some((h) => h.surface === windowTextCanonical);
    const terminalReason = classifyLength1CollectorTerminal({
      syllablesLength: syllables.length,
      pinyinKey: key,
      windowText,
      windowTextCanonical,
      readinessState: readiness.state,
      sqlExecuted: args.sqlExecuted,
      sqlLimit,
      sqlHitCount: args.sqlHitCount,
      eligibleHitCount: args.eligibleHitCount,
      truncated: args.truncated,
      identityLookupRan: args.identityLookupRan,
      identitySqlHitCount: args.identitySqlHitCount,
      identityEligibleCount: args.identityEligibleCount,
      chosenSource: args.chosenSource,
      chosenWord: args.chosenWord,
      candidateScore: args.candidateScore,
      minCandidateScore: minScore,
      scoreRejected: args.scoreRejected,
      hitPresent: args.hitPresent,
      canonicalInSqlHits,
    });
    return {
      contract: SINGLE_CHAR_COLLECTOR_TRACE_V1,
      pinyinKey: key,
      windowText,
      windowTextCanonical,
      toneRecallReadiness: readiness.state,
      queryExecuted: args.sqlExecuted,
      querySource: 'live',
      sqlLimit,
      sqlHitCount: args.sqlHitCount,
      postLimitCount: args.sqlHitCount,
      preLimitCount: args.truncated ? null : args.sqlHitCount,
      truncated: args.truncated,
      eligibleHitCount: args.eligibleHitCount,
      toneExactHitCount: args.eligibleHitCount,
      uniqueToneExact,
      surfaceExactHitCount,
      chosenSource: args.chosenSource,
      selectedCandidate: args.chosenWord,
      candidateScore: args.candidateScore,
      minCandidateScore: minScore,
      terminalReason,
      sqlHits: args.sqlHits,
      queryTonePinyinKey: args.queryTonePinyinKey ?? null,
    };
  };

  if (readiness.state !== 'ready') {
    return {
      hit: null,
      baseLookupMs: 0,
      toneExactHitCount: 0,
      plainFallbackHitCount: 0,
      toneSqlCount: 0,
      queryTonePinyinKey: undefined,
      toneRecallReadiness: readiness,
      diagnostic: buildDiagnostic({
        sqlExecuted: false,
        sqlHits: [],
        sqlHitCount: 0,
        eligibleHitCount: 0,
        truncated: false,
        identityLookupRan: false,
        identitySqlHitCount: 0,
        identityEligibleCount: 0,
        chosenSource: null,
        chosenWord: null,
        candidateScore: null,
        scoreRejected: false,
        hitPresent: false,
      }),
      ambiguousSet: [],
    };
  }

  const tonePinyinKey = readiness.tonePinyinKey;
  const t0 = Date.now();
  const raw = runtimeV2.lookupBaseByPinyinAndToneKey(key, tonePinyinKey, 1, sqlLimit);
  let baseLookupMs = Date.now() - t0;
  let toneSqlCount = 1;
  const eligible = filterEligibleBaseSingleChar(raw);
  const truncated = length1FetchMayBeTruncated(raw.length, sqlLimit);
  let chosenSource: Length1ChosenSource = null;
  let chosen = resolveLength1BaseCandidate(eligible, windowText, truncated);
  if (chosen) {
    chosenSource = eligible.length === 1 ? 'unique_tone_exact' : 'page_surface_exact';
  }
  let identityLookupRan = false;
  let identitySqlHitCount = 0;
  let identityEligibleCount = 0;
  // Batch 1.1B: only when ambiguity yields no Candidate — Tone exact only (1.1C).
  if (!chosen) {
    const exact = tryExactSurfaceBaseIdentity(runtimeV2, {
      pinyinKey: key,
      windowText,
      tonePinyinKey,
    });
    baseLookupMs += exact.lookupMs;
    toneSqlCount += exact.toneSqlDelta;
    identityLookupRan = exact.toneSqlDelta > 0 || Boolean(windowText.trim());
    identitySqlHitCount = exact.sqlHitCount;
    identityEligibleCount = exact.eligibleCount;
    chosen = exact.chosen;
    if (chosen) {
      chosenSource = 'identity_surface_exact';
    }
  }
  const scored = chosen
    ? scoreLength1BaseHit(chosen, syllables, windowText, 'tone_exact', acousticTonePattern)
    : null;
  const scoreRejected = Boolean(chosen) && !scored;
  const hit = scored;
  const sqlHits = compactLength1SqlHits(raw);
  return {
    hit,
    baseLookupMs,
    toneExactHitCount: eligible.length,
    plainFallbackHitCount: 0,
    toneSqlCount,
    queryTonePinyinKey: tonePinyinKey,
    toneRecallReadiness: readiness,
    diagnostic: buildDiagnostic({
      sqlExecuted: true,
      sqlHits,
      sqlHitCount: raw.length,
      eligibleHitCount: eligible.length,
      truncated,
      identityLookupRan,
      identitySqlHitCount,
      identityEligibleCount,
      chosenSource,
      chosenWord: chosen?.word ?? null,
      candidateScore: scored?.candidateScore ?? null,
      scoreRejected,
      hitPresent: Boolean(hit),
      queryTonePinyinKey: tonePinyinKey,
    }),
    ambiguousSet:
      !hit && !truncated && eligible.length >= 2
        ? buildSingleCharCandidateSetV1({
            eligible,
            truncated: false,
            origin_span_id: 'length1',
            raw_start: 0,
            raw_end: (windowText || '').length,
            syllable_start: 0,
            syllable_end: 1,
            lexical_source: 'base_lexicon_internal',
          })
        : [],
  };
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
    toneCallerEnabled,
  } = input;
  const cfg = getLexiconRuntimeV2Config();
  const recallStart = Date.now();
  const fuzzyRecallEnabled = input.fuzzyRecallEnabled === true;

  if (topK <= 0 || syllables.length < 1 || syllables.length > 5 || !syllables.length) {
    return {
      hits: [],
      maxDomainBoostApplied: 0,
      recallToneCompatibleCount: 0,
      recallToneFallbackCount: 0,
    };
  }

  // Length=1: independent base-only branch (CR 1.0.2). Must not run 2–5 tier/fuzzy flow.
  if (syllables.length === 1) {
    const effectiveTopK = Math.min(topK, 1);
    if (effectiveTopK <= 0) {
      return {
        hits: [],
        maxDomainBoostApplied: 0,
        recallToneCompatibleCount: 0,
        recallToneFallbackCount: 0,
      };
    }
    const collected = collectBaseOnlySingleCharCandidate(runtimeV2, {
      syllables,
      windowText,
      acousticTonePattern,
      toneCallerEnabled,
    });
    const hits = collected.hit ? [collected.hit] : [];
    const v2RecallMs = Date.now() - recallStart;
    recordRecallSpanDiagnostics({
      base_hits: collected.toneExactHitCount,
      domain_hits: 0,
      idiom_hits: 0,
      base_after_limit: hits.length,
      domain_after_limit: 0,
      idiom_after_limit: 0,
      candidate_count_before_merge: collected.toneExactHitCount,
      candidate_count_after_merge: hits.length,
      sent_to_kenlm: hits.length,
      active_domain: 'base_only',
      industry_routing_used: isIndustryRoutingEnabled(),
      v2_recall_ms: v2RecallMs,
      base_lookup_ms: collected.baseLookupMs,
      domain_lookup_ms: 0,
      idiom_lookup_ms: 0,
      merge_ms: 0,
      weakDomainEnabled: undefined,
      weakDomainIds: undefined,
      weakDomainCandidateCount: undefined,
      fuzzyRecallEnabled: false,
      fuzzyVariantCount: undefined,
      fuzzyCandidateCount: undefined,
      candidateSourceBreakdown: undefined,
      recallEmptyBeforeFuzzy: undefined,
      recallEmptyAfterFuzzy: undefined,
      domainHitsBeforeWeak: undefined,
      domainHitsAfterWeak: undefined,
      fuzzyVariantExamples: undefined,
      tone_exact_hits:
        collected.toneSqlCount > 0 || collected.toneExactHitCount > 0
          ? collected.toneExactHitCount
          : undefined,
      plain_fallback_hits: undefined,
      tone_sql_count: collected.toneSqlCount > 0 ? collected.toneSqlCount : undefined,
      query_tone_pinyin_key: collected.queryTonePinyinKey,
    });
    return {
      hits,
      maxDomainBoostApplied: 0,
      recallToneCompatibleCount: collected.hit?.toneLookupStage === 'tone_exact' ? 1 : 0,
      recallToneFallbackCount: 0,
      queryTonePinyinKey: collected.queryTonePinyinKey,
      toneExactHitCount:
        collected.toneExactHitCount > 0 ? collected.toneExactHitCount : undefined,
      plainFallbackHitCount: undefined,
      toneRecallReadiness: collected.toneRecallReadiness,
      length1Collector: collected.diagnostic,
      singleCharAmbiguousSet: collected.ambiguousSet.length
        ? collected.ambiguousSet
        : undefined,
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
  let toneSqlCount = 0;
  let queryTonePinyinKey: string | undefined;
  let toneRecallReadiness: ToneRecallReadiness | undefined;

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
      acousticTonePattern,
      toneCallerEnabled
    );

    toneExactHitCount += tier.toneExactHitCount;
    toneSqlCount += tier.toneSqlCount;
    toneRecallReadiness = tier.toneRecallReadiness;
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
        acousticTonePattern,
        tier.entryStages.get(hotword.id),
        bestById,
        sourceBreakdown
      );
    }
    if (!variant.isFuzzy) {
      exactScoredCount = bestById.size;
    }
  }

  const scored = Array.from(bestById.values());
  scored.sort(compareRecallHitsPrimaryScore);
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
    plain_fallback_hits: undefined,
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
    plainFallbackHitCount: undefined,
    toneRecallReadiness,
  };
}
