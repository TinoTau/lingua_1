import { normalizeSyllable, textToSyllables } from './phonetic/pinyin';
import { isIndexableHotwordEntry } from './scored-lexicon';
import type { HotwordEntry } from './hotword-types';

export { normalizeSyllable };

export function syllablesKey(syllables: string[]): string {
  return syllables.map(normalizeSyllable).filter(Boolean).join('|');
}

export type HotwordPinyinIndex = Map<string, HotwordEntry[]>;

export function buildHotwordPinyinIndex(entries: HotwordEntry[]): HotwordPinyinIndex {
  const index: HotwordPinyinIndex = new Map();

  for (const entry of entries) {
    if (!isIndexableHotwordEntry(entry)) {
      continue;
    }
    const key = syllablesKey(entry.pinyin);
    if (!key) {
      continue;
    }
    const bucket = index.get(key) ?? [];
    bucket.push(entry);
    index.set(key, bucket);
  }

  for (const bucket of index.values()) {
    bucket.sort((a, b) => b.priorScore - a.priorScore);
  }

  return index;
}

/**
 * @deprecated 仅 build 脚本迁移 seed 用；runtime 索引禁止调用。
 * 见 scored-lexicon.ts `initialPriorScoreFromFrequency`。
 */
export function priorScoreFromFrequency(frequency: number): number {
  return Math.log1p(Math.max(1, frequency));
}
