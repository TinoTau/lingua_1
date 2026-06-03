import { buildCharSyllableRanges, type CharSyllableRange } from './pinyin-ime-v2-pinyin-stream';

export type RawBoundaryKind = 'punctuation' | 'space' | 'cjk_run';

export type RawBoundary = {
  start: number;
  end: number;
  syllableStart: number;
  syllableEnd: number;
  kind: RawBoundaryKind;
};

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/u;
const PUNCT_RE = /[，。！？；：、（）【】「」—…·,.!?;:'"()[\]{}<>]/u;
const SPACE_RE = /[\s\u3000]/;

function syllableIndexForCharOffset(ranges: CharSyllableRange[], charOffset: number): number {
  for (const range of ranges) {
    if (charOffset < range.charStart) {
      return range.syllableStart;
    }
    if (charOffset >= range.charStart && charOffset < range.charEnd) {
      const runLen = range.charEnd - range.charStart;
      const syllableCount = range.syllableEnd - range.syllableStart;
      if (runLen <= 0 || syllableCount <= 0) {
        return range.syllableStart;
      }
      const rel = charOffset - range.charStart;
      const idx = Math.floor((rel / runLen) * syllableCount);
      return Math.min(range.syllableEnd - 1, range.syllableStart + idx);
    }
  }
  const last = ranges[ranges.length - 1];
  return last ? last.syllableEnd : 0;
}

/**
 * Extract coarse boundaries from raw ASR text (prior-only signal; not a hard filter).
 */
export function extractRawCoarseBoundaries(rawAsrText: string): RawBoundary[] {
  const text = rawAsrText ?? '';
  if (!text.length) {
    return [];
  }

  const ranges = buildCharSyllableRanges(text);
  const boundaries: RawBoundary[] = [];

  for (const range of ranges) {
    boundaries.push({
      start: range.charStart,
      end: range.charEnd,
      syllableStart: range.syllableStart,
      syllableEnd: range.syllableEnd,
      kind: 'cjk_run',
    });
  }

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (SPACE_RE.test(ch)) {
      const start = i;
      while (i < text.length && SPACE_RE.test(text[i])) {
        i++;
      }
      boundaries.push({
        start,
        end: i,
        syllableStart: syllableIndexForCharOffset(ranges, start),
        syllableEnd: syllableIndexForCharOffset(ranges, Math.max(start, i - 1)),
        kind: 'space',
      });
      continue;
    }
    if (PUNCT_RE.test(ch)) {
      const start = i;
      while (i < text.length && PUNCT_RE.test(text[i])) {
        i++;
      }
      boundaries.push({
        start,
        end: i,
        syllableStart: syllableIndexForCharOffset(ranges, start),
        syllableEnd: syllableIndexForCharOffset(ranges, Math.max(start, i - 1)),
        kind: 'punctuation',
      });
      continue;
    }
    if (CJK_RE.test(ch)) {
      i++;
      continue;
    }
    i++;
  }

  return boundaries.sort((a, b) => a.start - b.start || a.end - b.end);
}
