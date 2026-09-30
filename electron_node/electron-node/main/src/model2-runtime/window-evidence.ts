/**
 * Pre-LexicalEdge WindowEvidence — Model2 production input unit (Aug-12 SSOT).
 * Built from GlobalWindowDescriptor geometry; not a second FineSpan type.
 */

import type { GlobalWindowDescriptor, WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';

export type WindowEvidence = {
  windowId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  windowText: string;
  windowPinyinKey: string;
  spanSyllables: string[];
  /** Window-local acoustic tone pattern; null/empty when unavailable. */
  acousticTonePattern: number[] | null;
  baseCandidates: readonly WindowCandidate[];
};

export function buildWindowEvidence(args: {
  window: GlobalWindowDescriptor;
  rawText: string;
  globalSyllables: readonly string[];
  baseCandidates: readonly WindowCandidate[];
  acousticTonePattern?: number[] | null;
}): WindowEvidence {
  const { window, rawText, globalSyllables, baseCandidates, acousticTonePattern } = args;
  const spanSyllables = [...globalSyllables.slice(window.syllableStart, window.syllableEnd)];
  const windowPinyinKey =
    window.windowPinyinKey ||
    baseCandidates[0]?.windowPinyinKey ||
    spanSyllables.join('|');
  return {
    windowId: window.windowId,
    rawStart: window.rawStart,
    rawEnd: window.rawEnd,
    syllableStart: window.syllableStart,
    syllableEnd: window.syllableEnd,
    windowText: window.windowText || rawText.slice(window.rawStart, window.rawEnd),
    windowPinyinKey,
    spanSyllables,
    acousticTonePattern:
      Array.isArray(acousticTonePattern) && acousticTonePattern.length > 0
        ? [...acousticTonePattern]
        : null,
    baseCandidates,
  };
}
