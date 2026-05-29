/**
 * Detector-layer pinyin hint — syllable shape only, no lexicon recall.
 */

import { textToSyllables } from '../lexicon/phonetic/pinyin';

const MIN_SYLLABLES = 2;
const MAX_SYLLABLES = 5;

export type SpanDetectorHint = {
  syllables: string[];
  syllableCount: number;
  hasPinyinHint: boolean;
};

export type SpanDetectorHintFn = (spanText: string) => SpanDetectorHint;

export function evaluateSpanDetectorHint(spanText: string): SpanDetectorHint {
  const syllables = textToSyllables(spanText);
  const syllableCount = syllables.length;
  const hasPinyinHint = syllableCount >= MIN_SYLLABLES && syllableCount <= MAX_SYLLABLES;
  return { syllables, syllableCount, hasPinyinHint };
}

export function createSpanDetectorHint(): SpanDetectorHintFn {
  return evaluateSpanDetectorHint;
}
