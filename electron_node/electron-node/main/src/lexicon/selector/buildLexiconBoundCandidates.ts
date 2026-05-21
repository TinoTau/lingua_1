import type { WindowPhoneticPreviewItem } from '../phonetic/types';
import type { LexiconBoundCandidate } from './types';

const MIN_TOKEN_LEN = 2;

function countOccurrences(text: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

function applySingleReplacement(
  originalText: string,
  start: number,
  end: number,
  to: string
): string {
  return originalText.slice(0, start) + to + originalText.slice(end);
}

function resolveUniqueSpan(
  originalText: string,
  from: string,
  spanStart?: number,
  spanEnd?: number
): { start: number; end: number } | null {
  if (
    typeof spanStart === 'number' &&
    typeof spanEnd === 'number' &&
    spanEnd > spanStart &&
    spanEnd <= originalText.length
  ) {
    const slice = originalText.slice(spanStart, spanEnd);
    if (slice === from) {
      return { start: spanStart, end: spanEnd };
    }
  }

  const occurrences = countOccurrences(originalText, from);
  if (occurrences !== 1) {
    return null;
  }

  const idx = originalText.indexOf(from);
  if (idx < 0) {
    return null;
  }
  return { start: idx, end: idx + from.length };
}

function isUnsafeReplacement(originalText: string, from: string, to: string): boolean {
  if (from.length < MIN_TOKEN_LEN || to.length < MIN_TOKEN_LEN) {
    return true;
  }
  if (from === originalText) {
    return true;
  }
  return false;
}

function buildOne(
  originalText: string,
  item: WindowPhoneticPreviewItem
): LexiconBoundCandidate | null {
  const from = item.spanText.trim();
  const to = item.candidateText.trim();
  if (isUnsafeReplacement(originalText, from, to)) {
    return null;
  }

  const span = resolveUniqueSpan(originalText, from, item.spanStart, item.spanEnd);
  if (!span) {
    return null;
  }

  const candidateText = applySingleReplacement(originalText, span.start, span.end, to);
  if (!candidateText || candidateText === originalText) {
    return null;
  }

  return {
    originalText,
    candidateText,
    replacement: {
      start: span.start,
      end: span.end,
      from,
      to,
      source: item.candidateSource || 'window_phonetic_preview',
      phoneticScore: item.phoneticScore,
    },
    sourceEvidence: {
      phonetic: item,
      ...(item.lexiconCandidate ? { lexicon: item.lexiconCandidate } : {}),
    },
  };
}

export function buildLexiconBoundCandidates(params: {
  originalText: string;
  preview: WindowPhoneticPreviewItem[];
}): LexiconBoundCandidate[] {
  const originalText = params.originalText.trim();
  if (!originalText || !params.preview.length) {
    return [];
  }

  const out: LexiconBoundCandidate[] = [];
  for (const item of params.preview) {
    const built = buildOne(originalText, item);
    if (built) {
      out.push(built);
    }
  }
  return out;
}
