/**
 * Mixed-language exact word index — latin tokens without pinyin bucket.
 */

import { isIndexableHotwordEntry, isMixedLatinToken } from './scored-lexicon';
import type { HotwordEntry } from './hotword-types';

export type ExactWordIndex = Map<string, HotwordEntry[]>;

function pushExactKey(index: ExactWordIndex, key: string, entry: HotwordEntry): void {
  if (!key) {
    return;
  }
  const bucket = index.get(key) ?? [];
  if (bucket.some((h) => h.id === entry.id)) {
    return;
  }
  bucket.push(entry);
  bucket.sort((a, b) => b.priorScore - a.priorScore);
  index.set(key, bucket);
}

export function buildExactWordIndex(entries: readonly HotwordEntry[]): ExactWordIndex {
  const index: ExactWordIndex = new Map();

  for (const entry of entries) {
    if (!isIndexableHotwordEntry(entry) || !isMixedLatinToken(entry.word)) {
      continue;
    }
    pushExactKey(index, entry.word, entry);
    if (isMixedLatinToken(entry.word)) {
      pushExactKey(index, entry.word.toLowerCase(), entry);
    } else {
      pushExactKey(index, entry.normalized?.trim() || entry.word, entry);
    }
  }

  return index;
}

export function lookupExactWord(index: ExactWordIndex, text: string): HotwordEntry[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  return index.get(trimmed) ?? index.get(trimmed.toLowerCase()) ?? [];
}
