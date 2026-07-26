import { textToSyllables } from '../../lexicon/phonetic/pinyin';

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const CJK_RUN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;

export type PinyinStreamResult = {
  syllables: string[];
  hasCjk: boolean;
};

export type CharSyllableRange = {
  charStart: number;
  charEnd: number;
  syllableStart: number;
  syllableEnd: number;
};

/**
 * FineSpan syllable coordinate SSOT (Phase 0).
 * Only CJK runs contribute syllables; Latin/punct/space stay in rawText only.
 */
export type UtteranceSyllableCoordinate = {
  syllables: string[];
  ranges: CharSyllableRange[];
  hasCjk: boolean;
  coverage: {
    syllableCount: number;
    coveredCount: number;
    coverageOk: boolean;
  };
};

/**
 * Single construction entry for FineSpan syllable stream + raw char ranges.
 * Must be shared by textToPinyinStream, CoarseSpan, and LTR.
 */
export function buildUtteranceSyllableCoordinate(rawText: string): UtteranceSyllableCoordinate {
  const text = rawText ?? '';
  const ranges: CharSyllableRange[] = [];
  const syllables: string[] = [];
  let syllableOffset = 0;

  CJK_RUN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CJK_RUN_RE.exec(text)) !== null) {
    const runText = match[0];
    const runSyllables = textToSyllables(runText);
    if (!runSyllables.length) {
      continue;
    }
    ranges.push({
      charStart: match.index,
      charEnd: match.index + runText.length,
      syllableStart: syllableOffset,
      syllableEnd: syllableOffset + runSyllables.length,
    });
    for (const syl of runSyllables) {
      syllables.push(syl);
    }
    syllableOffset += runSyllables.length;
  }

  const syllableCount = syllables.length;
  let coveredCount = 0;
  for (const range of ranges) {
    coveredCount += range.syllableEnd - range.syllableStart;
  }

  return {
    syllables,
    ranges,
    hasCjk: syllableCount > 0 && CJK_RE.test(text),
    coverage: {
      syllableCount,
      coveredCount,
      coverageOk: syllableCount > 0 && coveredCount === syllableCount,
    },
  };
}

export function textToPinyinStream(text: string): PinyinStreamResult {
  const trimmed = (text ?? '').trim();
  if (!trimmed || !CJK_RE.test(trimmed)) {
    return { syllables: [], hasCjk: false };
  }
  const coord = buildUtteranceSyllableCoordinate(trimmed);
  return { syllables: [...coord.syllables], hasCjk: coord.hasCjk };
}

/**
 * Map each contiguous CJK run in raw text to syllable index ranges.
 * Delegates to buildUtteranceSyllableCoordinate (FineSpan SSOT).
 */
export function buildCharSyllableRanges(rawText: string): CharSyllableRange[] {
  return buildUtteranceSyllableCoordinate(rawText ?? '').ranges.map((r) => ({ ...r }));
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
