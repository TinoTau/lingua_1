import type { LexiconRecallCandidate, LexiconRecallEvidence } from '../lexicon-types';

export type ResolvedSpan = {
  spanText: string;
  spanStart?: number;
  spanEnd?: number;
};

function isValidRange(start: number, end: number, textLen: number): boolean {
  return start >= 0 && end > start && end <= textLen;
}

type SpanCandidate = LexiconRecallCandidate | LexiconRecallEvidence;

/**
 * P2 span: ASR window owns coordinates; term indexOf only for legacy exact-term path.
 */
export function resolveSpanTextAndRange(
  top1Text: string,
  candidate: SpanCandidate
): ResolvedSpan {
  const windowText = candidate.windowText?.trim();
  const wStart = candidate.windowStart ?? candidate.start;
  const wEnd = candidate.windowEnd ?? candidate.end;

  if (
    windowText &&
    typeof wStart === 'number' &&
    typeof wEnd === 'number' &&
    isValidRange(wStart, wEnd, top1Text.length) &&
    top1Text.slice(wStart, wEnd) === windowText
  ) {
    return { spanText: windowText, spanStart: wStart, spanEnd: wEnd };
  }

  if (candidate.recallPath === 'pinyin') {
    return { spanText: '' };
  }

  const term = candidate.term?.trim() ?? '';
  if (term) {
    const idx = top1Text.indexOf(term);
    if (idx >= 0) {
      return { spanText: term, spanStart: idx, spanEnd: idx + term.length };
    }
    return { spanText: term };
  }

  if (typeof wStart === 'number' && typeof wEnd === 'number' && isValidRange(wStart, wEnd, top1Text.length)) {
    return {
      spanText: top1Text.slice(wStart, wEnd),
      spanStart: wStart,
      spanEnd: wEnd,
    };
  }

  return { spanText: '' };
}
