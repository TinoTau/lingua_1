import { buildBoundedReplacements } from '../bounded-replacement';
import type { LexiconRecallEvidence } from '../lexicon-types';
import { textToSyllables } from './pinyin';
import {
  BuildWindowPhoneticPreviewOptions,
  DEFAULT_WINDOW_PHONETIC_OPTIONS,
  WindowPhoneticPreviewItem,
} from './types';

function boundedToPreviewItem(b: ReturnType<typeof buildBoundedReplacements>[number]): WindowPhoneticPreviewItem {
  const best = b.bestEvidence;
  return {
    spanText: b.from,
    spanStart: b.start,
    spanEnd: b.end,
    candidateText: b.to,
    candidateSource: b.source,
    phoneticScore: b.phoneticScore,
    spanPinyin: best.windowPinyin,
    candidatePinyin: textToSyllables(b.to),
    lexiconCandidate: {
      ...best,
      start: b.start,
      end: b.end,
      windowStart: b.start,
      windowEnd: b.end,
      raw: { evidences: b.evidences, best: best.raw },
    },
  };
}

/**
 * P2: evidence → bounded replacement → phonetic preview (no writeback).
 */
export function buildWindowPhoneticPreview(params: {
  top1Text: string;
  candidates: LexiconRecallEvidence[];
  options?: BuildWindowPhoneticPreviewOptions;
}): { items: WindowPhoneticPreviewItem[]; truncated: boolean } {
  const opts = { ...DEFAULT_WINDOW_PHONETIC_OPTIONS, ...params.options };

  if (!params.candidates.length) {
    return { items: [], truncated: false };
  }

  const bounded = buildBoundedReplacements(params.candidates, {
    minPhoneticScore: opts.minScore,
  });

  const sorted = [...bounded].sort((a, b) => {
    if (b.phoneticScore !== a.phoneticScore) {
      return b.phoneticScore - a.phoneticScore;
    }
    return b.priority - a.priority;
  });

  const truncated = sorted.length > opts.maxItems;
  const items = sorted.slice(0, opts.maxItems).map(boundedToPreviewItem);

  return { items, truncated };
}
