/**
 * Alignment-only normalization for IME span proposal (Phase 4B / 4B.1).
 * Does not mutate rawAsrText, segmentForJobResult, or business ASR output.
 */

/** OpenCC t→cn (package export `opencc-js/t2cn`); not used for rawAsrText / business text. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpenCC = require('opencc-js/t2cn') as {
  Converter: (options: { from: string; to: string }) => (text: string) => string;
};

const PUNCT_AND_SPACE_RE =
  /[\s\u3000-\u303f\uff00-\uffef.,!?;:'"()[\]{}<>，。！？；：、（）【】「」—…·\-@#$%^&*+=|\\/~～]+/u;

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/u;

/** NFKC + OpenCC (t→cn) + drop punctuation/whitespace; charMap[i] = raw index for normalized[i]. */
export type NormalizedText = {
  normalized: string;
  charMap: number[];
  traditionalCharCount: number;
  openccConvertedCount: number;
};

let traditionalToSimplifiedConverter: ((text: string) => string) | undefined;

function getTraditionalToSimplifiedConverter(): (text: string) => string {
  if (!traditionalToSimplifiedConverter) {
    traditionalToSimplifiedConverter = OpenCC.Converter({ from: 't', to: 'cn' });
  }
  return traditionalToSimplifiedConverter;
}

/** Test-only: reset lazy converter between cases. */
export function resetOpenccConverterForTest(): void {
  traditionalToSimplifiedConverter = undefined;
}

function isSkippableChar(ch: string): boolean {
  return PUNCT_AND_SPACE_RE.test(ch);
}

function isCjkChar(ch: string): boolean {
  return CJK_RE.test(ch);
}

/**
 * OpenCC Traditional → Simplified (OpenCC standard `t` → `cn`, not `twp` phrase preset).
 */
export function normalizeTraditionalChinese(text: string): string {
  if (!text) {
    return '';
  }
  return getTraditionalToSimplifiedConverter()(text);
}

/**
 * raw → NFKC → OpenCC T→S → emit non-skippable chars with per-output-char charMap to raw index.
 */
export function normalizeForImeAlignment(raw: string): NormalizedText {
  const normalizedChars: string[] = [];
  const charMap: number[] = [];
  let traditionalCharCount = 0;
  let openccConvertedCount = 0;
  const converter = getTraditionalToSimplifiedConverter();

  for (let rawIndex = 0; rawIndex < raw.length; rawIndex++) {
    const rawChar = raw[rawIndex];
    const nfkc = rawChar.normalize('NFKC');
    if (!nfkc || isSkippableChar(nfkc)) {
      continue;
    }

    const t2s = converter(nfkc);
    if (isCjkChar(nfkc) && t2s !== nfkc) {
      traditionalCharCount++;
      openccConvertedCount++;
    }

    for (const ch of t2s) {
      if (isSkippableChar(ch)) {
        continue;
      }
      normalizedChars.push(ch);
      charMap.push(rawIndex);
    }
  }

  return {
    normalized: normalizedChars.join(''),
    charMap,
    traditionalCharCount,
    openccConvertedCount,
  };
}

/** Map normalized [nStart, nEnd) to raw [rawStart, rawEnd) using charMap. */
export function mapNormalizedSpanToRaw(
  charMap: number[],
  nStart: number,
  nEnd: number
): { start: number; end: number } | null {
  if (!charMap.length || nStart < 0 || nEnd <= nStart || nEnd > charMap.length) {
    return null;
  }
  const start = charMap[nStart];
  const end = charMap[nEnd - 1] + 1;
  return { start, end };
}
