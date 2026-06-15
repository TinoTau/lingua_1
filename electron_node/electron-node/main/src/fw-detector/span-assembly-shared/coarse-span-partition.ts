import { textToPinyinStream } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import {
  buildCoarseSpansFromRawImeBoundary,
  type BuildCoarseSpansFromRawImeBoundaryInput,
  type BuildCoarseSpansFromRawImeBoundaryResult,
} from './coarse-boundary-import';
import type { CoarseSpan } from './types';

export type PartitionCoarseSpansInput = BuildCoarseSpansFromRawImeBoundaryInput;

export type PartitionCoarseSpansResult = BuildCoarseSpansFromRawImeBoundaryResult;

/**
 * Build mutually exclusive coarse spans via raw/IME boundary import (not punctuation-only).
 */
export function partitionCoarseSpans(input: PartitionCoarseSpansInput): PartitionCoarseSpansResult {
  return buildCoarseSpansFromRawImeBoundary(input);
}

export function countTotalCjkSyllables(rawText: string): number {
  return textToPinyinStream(rawText).syllables.length;
}

export function verifyCoarseSpanCoverage(rawText: string, spans: CoarseSpan[]): boolean {
  const total = countTotalCjkSyllables(rawText);
  if (total === 0) {
    return spans.length === 0;
  }
  const covered = new Set<number>();
  for (const span of spans) {
    for (let i = span.syllableStart; i < span.syllableEnd; i++) {
      if (covered.has(i)) {
        return false;
      }
      covered.add(i);
    }
  }
  for (let i = 0; i < total; i++) {
    if (!covered.has(i)) {
      return false;
    }
  }
  return true;
}
