/**
 * Phase 3 hotfix — V2 tier recall with SQL-limited candidates + merge cap.
 */

import {
  computeCandidateScoreBreakdown,
  type CandidateScoreBreakdown,
} from '../lexicon/candidate-score';
import { scorePinyinSimilarity } from '../lexicon/phonetic/pinyin';
import { syllablesKey } from '../lexicon/pinyin-index';
import { getAsrRepairQualityConfig } from '../asr-repair-quality/quality-config';
import type { HotwordEntry } from '../lexicon/hotword-types';
import { resolveWindowCandidateSource, type WindowCandidateSource } from '../lexicon/window-candidate-source';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { defaultGeneralProfile } from './profile-registry';
import type { LexiconRuntimeV2 } from './lexicon-runtime-v2';
import { recordRecallSpanDiagnostics } from './recall-v2-diagnostics';
import { isIndustryRoutingEnabled } from './lexicon-fw-recall-config';
import { getLexiconRuntimeV2Config } from './lexicon-runtime-v2-config';
import { mergeSpanCandidatesCombined, type TierHotwordRow } from './merge-span-candidates';

export type RecallSpanTopKV2Hit = {
  hotword: HotwordEntry;
  phoneticScore: number;
  candidateScore: number;
  candidateScoreBreakdown: CandidateScoreBreakdown;
  source: WindowCandidateSource;
  matchedAlias?: string;
};

export type RecallSpanTopKV2Result = {
  hits: RecallSpanTopKV2Hit[];
  maxDomainBoostApplied: number;
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
};

function minCandidateScore(): number {
  return getAsrRepairQualityConfig().minCandidateScore;
}

function scoreHotword(
  hotword: HotwordEntry,
  syllables: string[],
  windowText: string,
  profile: ActiveLexiconProfileSnapshot,
  seen: Set<string>,
  scored: RecallSpanTopKV2Hit[],
  matchedAlias?: string
): void {
  if (!hotword.enabled || hotword.word.length !== syllables.length) {
    return;
  }
  if (!Number.isFinite(hotword.priorScore) || hotword.priorScore <= 0) {
    return;
  }
  if (seen.has(hotword.id)) {
    return;
  }

  const phoneticScore = scorePinyinSimilarity(syllables, hotword.pinyin);
  const candidateScoreBreakdown = computeCandidateScoreBreakdown({
    hotword,
    windowSyllables: syllables,
    windowText,
    phoneticScore,
    profile,
  });
  const candidateScore =
    candidateScoreBreakdown.priorScore +
    candidateScoreBreakdown.phoneticSimilarity +
    candidateScoreBreakdown.exactLengthBonus +
    candidateScoreBreakdown.domainBoost -
    candidateScoreBreakdown.editDistancePenalty;
  if (candidateScore < minCandidateScore()) {
    return;
  }

  seen.add(hotword.id);
  scored.push({
    hotword,
    phoneticScore,
    candidateScore,
    candidateScoreBreakdown,
    source: resolveWindowCandidateSource({ matchedAlias, viaPinyin: true }),
    matchedAlias,
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

export function recallSpanTopKV2(
  runtimeV2: LexiconRuntimeV2,
  input: RecallSpanTopKV2Input
): RecallSpanTopKV2Result {
  const { syllables, windowText, termLength, topK, domainIds, perSpanLimit } = input;
  const profile = input.profile ?? defaultGeneralProfile();
  const cfg = getLexiconRuntimeV2Config();
  const recallStart = Date.now();

  if (topK <= 0 || termLength < 2 || termLength > 5 || !syllables.length) {
    return { hits: [], maxDomainBoostApplied: 0 };
  }

  const key = syllablesKey(syllables);
  const tier = collectTierCandidates(runtimeV2, key, termLength, domainIds, perSpanLimit);
  const candidateCountAfterMerge = tier.entries.length;

  const mergeStart = Date.now();
  const seen = new Set<string>();
  const scored: RecallSpanTopKV2Hit[] = [];
  for (const hotword of tier.entries) {
    scoreHotword(hotword, syllables, windowText, profile, seen, scored);
  }

  scored.sort((a, b) => b.candidateScore - a.candidateScore);
  const effectiveLimit = perSpanLimit != null && perSpanLimit > 0 ? perSpanLimit : topK;
  const hits = scored.slice(0, effectiveLimit);
  const mergeMs = Date.now() - mergeStart;
  const v2RecallMs = Date.now() - recallStart;

  recordRecallSpanDiagnostics({
    base_hits: tier.baseHits.length,
    domain_hits: tier.domainHits.length,
    idiom_hits: tier.idiomHits.length,
    base_after_limit: perSpanLimit != null ? tier.baseHits.length : Math.min(tier.baseHits.length, cfg.maxBaseCandidates),
    domain_after_limit:
      perSpanLimit != null ? tier.domainHits.length : Math.min(tier.domainHits.length, cfg.maxDomainCandidates),
    idiom_after_limit:
      cfg.maxIdiomCandidates > 0
        ? perSpanLimit != null
          ? tier.idiomHits.length
          : Math.min(tier.idiomHits.length, cfg.maxIdiomCandidates)
        : 0,
    candidate_count_before_merge: candidateCountAfterMerge,
    candidate_count_after_merge: candidateCountAfterMerge,
    sent_to_kenlm: hits.length,
    active_domain: domainIds.length ? domainIds.join('|') : 'base_only',
    industry_routing_used: isIndustryRoutingEnabled(),
    v2_recall_ms: v2RecallMs,
    base_lookup_ms: tier.baseLookupMs,
    domain_lookup_ms: tier.domainLookupMs,
    idiom_lookup_ms: tier.idiomLookupMs,
    merge_ms: mergeMs,
  });

  const maxDomainBoostApplied = hits.reduce(
    (max, hit) => Math.max(max, hit.candidateScoreBreakdown.domainBoost),
    0
  );
  return { hits, maxDomainBoostApplied };
}
