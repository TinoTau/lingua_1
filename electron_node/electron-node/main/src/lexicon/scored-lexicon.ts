/**
 * Recover V5 / Lexicon World — scored lexicon schema helpers (build + runtime).
 */

import type { HotwordEntry } from './hotword-types';
import type { LexiconManifest } from './lexicon-types';

export const LEXICON_SCHEMA_VERSION = 'final-v1';
export const SCORED_LEXICON_VERSION = LEXICON_SCHEMA_VERSION;

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const LATIN_OR_DIGIT_RE = /[A-Za-z0-9]/;

/** 构建脚本迁移：legacy seed 无 priorScore 时用 frequency 生成 initial prior（仅 build）。 */
export const PRIOR_SCORE_SCALE = 5.0;

export function initialPriorScoreFromFrequency(frequency: number): number {
  return Math.min(Math.log1p(Math.max(1, frequency)) / PRIOR_SCORE_SCALE, 1.0);
}

export function parseTagsField(raw: string | null | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  } catch {
    return [];
  }
}

export function parseAliasesField(raw: string | null | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
  } catch {
    return [];
  }
}

/** 英文/数字 token：含拉丁字母或数字且无 CJK。 */
export function isMixedLatinToken(word: string): boolean {
  const w = word.trim();
  if (!w) {
    return false;
  }
  return LATIN_OR_DIGIT_RE.test(w) && !CJK_RE.test(w);
}

export function isIndexableHotwordEntry(entry: HotwordEntry): boolean {
  if (!entry.enabled || !entry.word.trim()) {
    return false;
  }
  if (!Number.isFinite(entry.priorScore) || entry.priorScore <= 0) {
    return false;
  }
  if (entry.pinyin.length > 0) {
    return true;
  }
  return isMixedLatinToken(entry.word);
}

export type ScoredLexiconManifestStats = {
  scored_lexicon_version: string;
  term_count: number;
  enabled_term_count: number;
  terms_with_prior_count: number;
  terms_without_prior_count: number;
  pinyin_index_count: number;
  mixed_token_count: number;
  prior_score_migration?: string;
};

export function countMixedTokens(entries: readonly HotwordEntry[]): number {
  return entries.filter((e) => e.enabled && isMixedLatinToken(e.word)).length;
}

export function buildManifestStats(
  allRows: readonly HotwordEntry[],
  indexable: readonly HotwordEntry[],
  pinyinIndexSize: number,
  priorScoreMigration?: string
): ScoredLexiconManifestStats {
  const enabled = allRows.filter((e) => e.enabled);
  const withPrior = enabled.filter((e) => Number.isFinite(e.priorScore) && e.priorScore > 0);
  const withoutPrior = enabled.length - withPrior.length;
  return {
    scored_lexicon_version: SCORED_LEXICON_VERSION,
    term_count: allRows.length,
    enabled_term_count: enabled.length,
    terms_with_prior_count: withPrior.length,
    terms_without_prior_count: withoutPrior,
    pinyin_index_count: pinyinIndexSize,
    mixed_token_count: countMixedTokens(enabled),
    ...(priorScoreMigration ? { prior_score_migration: priorScoreMigration } : {}),
  };
}

export function assertLexiconManifestReady(manifest: LexiconManifest): void {
  const schemaVersion = manifest.schemaVersion;
  if (schemaVersion !== LEXICON_SCHEMA_VERSION) {
    throw new Error(
      `[LEXICON_RUNTIME] manifest schemaVersion must be ${LEXICON_SCHEMA_VERSION}, got ${schemaVersion ?? 'missing'}`
    );
  }
  if ((manifest.terms_without_prior_count ?? 0) !== 0) {
    throw new Error(
      `Lexicon manifest terms_without_prior_count must be 0, got ${manifest.terms_without_prior_count}`
    );
  }
}
