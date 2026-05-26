/**
 * Alias index — exact + pinyin lookup entries pointing to canonical hotwords.
 */

import { pinyin } from 'pinyin-pro';
import { syllablesKey } from './pinyin-index';
import { isMixedLatinToken } from './scored-lexicon';
import type { HotwordEntry } from './hotword-types';

export type AliasMatch = {
  hotword: HotwordEntry;
  matchedAlias: string;
  matchType: 'alias_exact' | 'alias_pinyin';
};

export type AliasExactIndex = Map<string, AliasMatch[]>;
export type AliasPinyinIndex = Map<string, AliasMatch[]>;

function aliasPinyinKey(alias: string): string | null {
  if (!/[\u4e00-\u9fff\u3400-\u4dbf]/.test(alias)) {
    return null;
  }
  try {
    const syllables = pinyin(alias, { toneType: 'none', type: 'array' }) as string[];
    const normalized = syllables
      .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);
    return normalized.length ? syllablesKey(normalized) : null;
  } catch {
    return null;
  }
}

function pushAliasIndex(
  index: Map<string, AliasMatch[]>,
  key: string,
  match: AliasMatch
): void {
  if (!key) {
    return;
  }
  const bucket = index.get(key) ?? [];
  if (bucket.some((b) => b.hotword.id === match.hotword.id && b.matchedAlias === match.matchedAlias)) {
    return;
  }
  bucket.push(match);
  bucket.sort((a, b) => b.hotword.priorScore - a.hotword.priorScore);
  index.set(key, bucket);
}

export function buildAliasIndexes(entries: readonly HotwordEntry[]): {
  exactIndex: AliasExactIndex;
  pinyinIndex: AliasPinyinIndex;
  exactIndexCount: number;
  aliasIndexCount: number;
} {
  const exactIndex: AliasExactIndex = new Map();
  const pinyinIndex: AliasPinyinIndex = new Map();
  const exactKeys = new Set<string>();
  const pinyinKeys = new Set<string>();

  for (const entry of entries) {
    if (!entry.enabled || !entry.aliases?.length) {
      continue;
    }
    for (const alias of entry.aliases) {
      const trimmed = alias.trim();
      if (!trimmed || trimmed === entry.word) {
        continue;
      }
      const match: AliasMatch = {
        hotword: entry,
        matchedAlias: trimmed,
        matchType: 'alias_exact',
      };
      pushAliasIndex(exactIndex, trimmed, match);
      exactKeys.add(trimmed);
      if (isMixedLatinToken(trimmed)) {
        pushAliasIndex(exactIndex, trimmed.toLowerCase(), match);
        exactKeys.add(trimmed.toLowerCase());
      }
      const pyKey = aliasPinyinKey(trimmed);
      if (pyKey) {
        const pyMatch: AliasMatch = { ...match, matchType: 'alias_pinyin' };
        pushAliasIndex(pinyinIndex, pyKey, pyMatch);
        pinyinKeys.add(pyKey);
      }
    }
  }

  return {
    exactIndex,
    pinyinIndex,
    exactIndexCount: exactKeys.size,
    aliasIndexCount: exactKeys.size + pinyinKeys.size,
  };
}

export function lookupAliasExact(index: AliasExactIndex, text: string): AliasMatch[] {
  return index.get(text) ?? index.get(text.toLowerCase()) ?? [];
}

export function lookupAliasPinyin(index: AliasPinyinIndex, key: string): AliasMatch[] {
  return index.get(key) ?? [];
}
