import { applySingleSpanReplacement } from '../lexicon/selector/applySpanReplacements';
import type { FwTextSpan } from './types';

export function buildCandidateSentence(
  rawText: string,
  span: FwTextSpan,
  candidateWord: string
): string {
  return applySingleSpanReplacement(rawText, span.start, span.end, candidateWord);
}

export function buildCandidateSentencesForSpan(
  rawText: string,
  span: FwTextSpan,
  candidateWords: string[]
): string[] {
  return candidateWords.map((word) => buildCandidateSentence(rawText, span, word));
}
