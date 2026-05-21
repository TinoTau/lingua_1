import { normalizeSyllable, textToSyllables } from './phonetic/pinyin';
import type { HotwordEntry } from './hotword-types';

export { normalizeSyllable };

export function syllablesKey(syllables: string[]): string {
  return syllables.map(normalizeSyllable).filter(Boolean).join('|');
}

export type HotwordPinyinIndex = Map<string, HotwordEntry[]>;

export function buildHotwordPinyinIndex(entries: HotwordEntry[]): HotwordPinyinIndex {
  const index: HotwordPinyinIndex = new Map();

  for (const entry of entries) {
    if (!entry.enabled || !entry.word.trim()) {
      continue;
    }
    const syllables =
      entry.pinyin.length > 0 ? entry.pinyin : textToSyllables(entry.word);
    if (!syllables.length) {
      continue;
    }
    const key = syllablesKey(syllables);
    const bucket = index.get(key) ?? [];
    bucket.push(entry);
    index.set(key, bucket);
  }

  for (const bucket of index.values()) {
    bucket.sort((a, b) => b.frequency - a.frequency);
  }

  return index;
}

/** Recover V2：prior 与 frequency 单调，使用 log1p */
export function priorScoreFromFrequency(frequency: number): number {
  return Math.log1p(Math.max(1, frequency));
}
