import { textToSyllables } from '../../lexicon/phonetic/pinyin';

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export type PinyinStreamResult = {
  syllables: string[];
  hasCjk: boolean;
};

export function textToPinyinStream(text: string): PinyinStreamResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed || !CJK_RE.test(trimmed)) {
    return { syllables: [], hasCjk: false };
  }
  const syllables = textToSyllables(trimmed);
  return { syllables, hasCjk: syllables.length > 0 };
}

export type CharSyllableRange = {
  charStart: number;
  charEnd: number;
  syllableStart: number;
  syllableEnd: number;
};

/**
 * Map each contiguous CJK run in raw text to syllable index ranges.
 * Used by boundary discovery to snap char spans to syllable boundaries.
 */
export function buildCharSyllableRanges(rawText: string): CharSyllableRange[] {
  const ranges: CharSyllableRange[] = [];
  const cjkRun = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;
  let match: RegExpExecArray | null;
  let syllableOffset = 0;

  while ((match = cjkRun.exec(rawText)) !== null) {
    const runText = match[0];
    const runSyllables = textToSyllables(runText);
    ranges.push({
      charStart: match.index,
      charEnd: match.index + runText.length,
      syllableStart: syllableOffset,
      syllableEnd: syllableOffset + runSyllables.length,
    });
    syllableOffset += runSyllables.length;
  }

  return ranges;
}

export function snapSpanToSyllableBoundaries(
  rawText: string,
  start: number,
  end: number,
  ranges: CharSyllableRange[]
): { start: number; end: number } {
  if (!ranges.length || start >= end) {
    return { start, end };
  }

  for (const range of ranges) {
    if (end <= range.charStart || start >= range.charEnd) {
      continue;
    }
    const runLen = range.charEnd - range.charStart;
    const syllableCount = range.syllableEnd - range.syllableStart;
    if (runLen === 0 || syllableCount === 0) {
      return { start, end };
    }

    const relStart = Math.max(0, start - range.charStart);
    const relEnd = Math.min(runLen, end - range.charStart);
    const charsPerSyllable = runLen / syllableCount;

    const sylStart = Math.floor(relStart / charsPerSyllable);
    const sylEnd = Math.ceil(relEnd / charsPerSyllable);
    const snappedStart = range.charStart + Math.floor((sylStart / syllableCount) * runLen);
    const snappedEnd = range.charStart + Math.ceil((sylEnd / syllableCount) * runLen);

    return {
      start: Math.max(range.charStart, snappedStart),
      end: Math.min(range.charEnd, snappedEnd),
    };
  }

  return { start, end };
}
