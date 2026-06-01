/**
 * Recover V5 — scored legal lexicon TopK (exact pinyin bucket only).
 */

import { scorePinyinSimilarity } from './phonetic/pinyin';
import {
  computeCandidateScore,
  computeCandidateScoreBreakdown,
  type CandidateScoreBreakdown,
} from './candidate-score';
import { syllablesKey } from './pinyin-index';
import { isMixedLatinToken } from './scored-lexicon';
import { getAsrRepairQualityConfig } from '../asr-repair-quality/quality-config';
import type { HotwordEntry } from './hotword-types';
import { resolveWindowCandidateSource, type WindowCandidateSource } from './window-candidate-source';
import type { LexiconRuntime } from './lexicon-runtime';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';

export type TopKMatchType = 'exact';

export type LexiconTopKHit = {
  hotword: HotwordEntry;
  phoneticScore: number;
  candidateScore: number;
  candidateScoreBreakdown: CandidateScoreBreakdown;
  termLength: number;
  rankInTopK: number;
  matchType: TopKMatchType;
  source: WindowCandidateSource;
  matchedAlias?: string;
};

export type LookupTopKInput = {
  syllables: string[];
  windowText: string;
  termLength: number;
  topK: number;
  profile?: ActiveLexiconProfileSnapshot;
};

export type LookupTopKResult = {
  hits: LexiconTopKHit[];
  maxDomainBoostApplied: number;
};

function minCandidateScore(): number {
  return getAsrRepairQualityConfig().minCandidateScore;
}

function collectScored(
  hotword: HotwordEntry,
  syllables: string[],
  windowText: string,
  profile: ActiveLexiconProfileSnapshot,
  seen: Set<string>,
  scored: Array<{
    hotword: HotwordEntry;
    phoneticScore: number;
    candidateScore: number;
    candidateScoreBreakdown: CandidateScoreBreakdown;
    matchedAlias?: string;
  }>,
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
  scored.push({ hotword, phoneticScore, candidateScore, candidateScoreBreakdown, matchedAlias });
}

function collectExactLatinScored(
  hotword: HotwordEntry,
  windowText: string,
  profile: ActiveLexiconProfileSnapshot,
  seen: Set<string>,
  scored: Array<{
    hotword: HotwordEntry;
    phoneticScore: number;
    candidateScore: number;
    candidateScoreBreakdown: CandidateScoreBreakdown;
    matchedAlias?: string;
  }>,
  matchedAlias?: string
): void {
  if (!hotword.enabled || !Number.isFinite(hotword.priorScore) || hotword.priorScore <= 0) {
    return;
  }
  if (seen.has(hotword.id)) {
    return;
  }
  const windowSyllables = hotword.pinyin.length ? hotword.pinyin : [];
  const phoneticScore = 1;
  const candidateScoreBreakdown = computeCandidateScoreBreakdown({
    hotword,
    windowSyllables,
    windowText,
    phoneticScore,
    profile,
  });
  const candidateScore = computeCandidateScore({
    hotword,
    windowSyllables,
    windowText,
    phoneticScore,
    profile,
  });
  if (candidateScore < minCandidateScore()) {
    return;
  }
  seen.add(hotword.id);
  scored.push({ hotword, phoneticScore, candidateScore, candidateScoreBreakdown, matchedAlias });
}

function lookupExactLatin(
  runtime: LexiconRuntime,
  windowText: string,
  topK: number,
  profile: ActiveLexiconProfileSnapshot
): LookupTopKResult {
  const termLength = windowText.length;
  if (termLength < 2 || termLength > 5) {
    return { hits: [], maxDomainBoostApplied: 0 };
  }
  const seen = new Set<string>();
  const scored: Array<{
    hotword: HotwordEntry;
    phoneticScore: number;
    candidateScore: number;
    candidateScoreBreakdown: CandidateScoreBreakdown;
    matchedAlias?: string;
  }> = [];

  for (const hotword of runtime.lookupHotwordsByExactWord(windowText)) {
    if (hotword.word.length !== termLength) {
      continue;
    }
    collectExactLatinScored(hotword, windowText, profile, seen, scored);
  }
  for (const aliasMatch of runtime.lookupAliasExactMatches(windowText)) {
    if (aliasMatch.hotword.word.length !== termLength) {
      continue;
    }
    collectExactLatinScored(
      aliasMatch.hotword,
      windowText,
      profile,
      seen,
      scored,
      aliasMatch.matchedAlias
    );
  }

  const ranked = scored
    .sort((a, b) => b.candidateScore - a.candidateScore)
    .slice(0, topK);

  const maxDomainBoostApplied = ranked.reduce(
    (m, s) => Math.max(m, s.candidateScoreBreakdown.domainBoost),
    0
  );

  return {
    hits: ranked.map((s, i) => ({
      ...s,
      termLength,
      rankInTopK: i + 1,
      matchType: 'exact' as const,
      source: resolveWindowCandidateSource({
        matchedAlias: s.matchedAlias,
        viaPinyin: false,
      }),
    })),
    maxDomainBoostApplied,
  };
}

export function lookupTopKByPinyin(
  runtime: LexiconRuntime,
  input: LookupTopKInput
): LookupTopKResult {
  const { syllables, windowText, termLength, topK } = input;
  const profile = input.profile ?? defaultGeneralProfile();

  if (topK <= 0 || termLength < 2 || termLength > 5) {
    return { hits: [], maxDomainBoostApplied: 0 };
  }

  if (isMixedLatinToken(windowText)) {
    return lookupExactLatin(runtime, windowText.trim(), topK, profile);
  }

  if (!syllables.length) {
    return { hits: [], maxDomainBoostApplied: 0 };
  }

  const seen = new Set<string>();
  const scored: Array<{
    hotword: HotwordEntry;
    phoneticScore: number;
    candidateScore: number;
    candidateScoreBreakdown: CandidateScoreBreakdown;
    matchedAlias?: string;
  }> = [];

  const exactKey = syllablesKey(syllables);
  for (const hotword of runtime.getPinyinBucket(exactKey)) {
    if (hotword.word.length !== termLength) {
      continue;
    }
    collectScored(hotword, syllables, windowText, profile, seen, scored);
  }

  for (const aliasMatch of runtime.lookupAliasPinyinMatches(exactKey)) {
    if (aliasMatch.hotword.word.length !== termLength) {
      continue;
    }
    collectScored(
      aliasMatch.hotword,
      syllables,
      windowText,
      profile,
      seen,
      scored,
      aliasMatch.matchedAlias
    );
  }

  scored.sort((a, b) => b.candidateScore - a.candidateScore);
  const hits = scored.slice(0, topK).map((s, i) => ({
    hotword: s.hotword,
    phoneticScore: s.phoneticScore,
    candidateScore: s.candidateScore,
    candidateScoreBreakdown: s.candidateScoreBreakdown,
    termLength,
    rankInTopK: i + 1,
    matchType: 'exact' as const,
    source: resolveWindowCandidateSource({
      matchedAlias: s.matchedAlias,
      viaPinyin: true,
    }),
    matchedAlias: s.matchedAlias,
  }));

  const maxDomainBoostApplied = hits.reduce(
    (m, h) => Math.max(m, h.candidateScoreBreakdown.domainBoost),
    0
  );

  return { hits, maxDomainBoostApplied };
}
