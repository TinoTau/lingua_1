import { detectSuspiciousSpans, type TextSpan } from './suspicious-span-detector';
import { isFuzzyObservedMatch } from './segment-text-normalize';
import { scorePinyinSimilarity, textToSyllables } from './phonetic/pinyin';
import { syllablesKey } from './pinyin-index';

/**
 * Locate bundle confusion observed strings in text (exact substring).
 */
export function findConfusionObservedSpans(
  text: string,
  observedStrings: readonly string[]
): TextSpan[] {
  const trimmed = text.trim();
  if (!trimmed || !observedStrings.length) {
    return [];
  }

  const sorted = [...observedStrings]
    .filter((o) => o.length >= 2)
    .sort((a, b) => b.length - a.length);

  const spans: TextSpan[] = [];
  for (const observed of sorted) {
    let idx = 0;
    while (idx <= trimmed.length - observed.length) {
      const at = trimmed.indexOf(observed, idx);
      if (at < 0) {
        break;
      }
      spans.push({
        text: observed,
        start: at,
        end: at + observed.length,
      });
      idx = at + 1;
    }
  }
  return spans;
}

function spanKey(span: TextSpan): string {
  return `${span.start}:${span.end}:${span.text}`;
}

/** V3 D-04：同 normalized 拼音或音节编辑≤1（仅生成窗，候选仍来自 bundle）。 */
export function isPinyinAlignedObservedMatch(slice: string, observed: string): boolean {
  const w = textToSyllables(slice);
  const o = textToSyllables(observed);
  if (w.length < 2 || o.length < 2) {
    return false;
  }
  if (syllablesKey(w) === syllablesKey(o)) {
    return true;
  }
  const maxLen = Math.max(w.length, o.length);
  return scorePinyinSimilarity(w, o) >= 1 - 1 / maxLen;
}

/**
 * Fuzzy observed（edit≤1 或拼音对齐）：仅用于生成 confusion 窗，候选仍来自 bundle。
 */
export function findFuzzyConfusionObservedSpans(
  text: string,
  observedStrings: readonly string[],
  maxEdit = 1
): TextSpan[] {
  const trimmed = text.trim();
  if (!trimmed || !observedStrings.length) {
    return [];
  }
  const sorted = [...observedStrings]
    .filter((o) => o.length >= 2)
    .sort((a, b) => b.length - a.length);
  const seen = new Set<string>();
  const spans: TextSpan[] = [];
  const maxLen = Math.min(8, trimmed.length);

  for (let start = 0; start < trimmed.length; start++) {
    for (let len = 2; len <= maxLen && start + len <= trimmed.length; len++) {
      const slice = trimmed.slice(start, start + len);
      for (const observed of sorted) {
        if (
          !isFuzzyObservedMatch(slice, observed, maxEdit) &&
          !isPinyinAlignedObservedMatch(slice, observed)
        ) {
          continue;
        }
        const span: TextSpan = { text: slice, start, end: start + len };
        const key = spanKey(span);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        spans.push(span);
      }
    }
  }
  return spans;
}

/**
 * 标点 chunk 整段与 observed 拼音对齐时生成窗（补 sliding 2–8 字漏检）。
 */
export function findChunkPinyinAlignedObservedSpans(
  text: string,
  observedStrings: readonly string[]
): TextSpan[] {
  const trimmed = text.trim();
  if (!trimmed || !observedStrings.length) {
    return [];
  }
  const sorted = [...observedStrings]
    .filter((o) => o.length >= 2)
    .sort((a, b) => b.length - a.length);
  const seen = new Set<string>();
  const spans: TextSpan[] = [];

  for (const chunk of detectSuspiciousSpans(trimmed)) {
    if (chunk.text.length < 2) {
      continue;
    }
    for (const observed of sorted) {
      if (!isPinyinAlignedObservedMatch(chunk.text, observed)) {
        continue;
      }
      const key = spanKey(chunk);
      if (seen.has(key)) {
        break;
      }
      seen.add(key);
      spans.push({ text: chunk.text, start: chunk.start, end: chunk.end });
      break;
    }
  }
  return spans;
}
