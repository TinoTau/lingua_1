import { textToSyllables } from '../../lexicon/phonetic/pinyin';
import { DEFAULT_PINYIN_IME_V2 } from './pinyin-ime-v2-config';
import {
  selectTrustedTopKCandidates,
  syllableRangeToRawCharRange,
} from './pinyin-ime-v2-boundary-compatible-topk-diff';
import { normalizeTraditionalChinese } from './normalize-for-ime-alignment';
import { buildCharSyllableRanges } from './pinyin-ime-v2-pinyin-stream';
import type {
  BoundaryAlignmentScore,
  LocalRawImeDiffExampleSpan,
  LocalRawImeDiffBuildDiagnostics,
  PinyinImeV2Candidate,
  PinyinImeV2DiffSpan,
} from './pinyin-ime-v2-types';

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/;
const EXAMPLE_SPAN_LIMIT = 3;

export type LocalRawImeDiffInput = {
  rawAsrText: string;
  candidates: PinyinImeV2Candidate[];
  alignmentScores: BoundaryAlignmentScore[];
};

export type LocalRawImeDiffBuildResult = {
  spans: PinyinImeV2DiffSpan[];
  diagnostics: LocalRawImeDiffBuildDiagnostics;
};

type IntervalAccumulator = {
  rawSpan: string;
  start: number;
  end: number;
  ranks: Set<number>;
  example: LocalRawImeDiffExampleSpan;
};

function emptyBuildDiagnostics(): LocalRawImeDiffBuildDiagnostics {
  return {
    localRawImeDiffSpanCount: 0,
    localRawImeDiffCandidateCount: 0,
    localRawImeDiffTrustedCandidateCount: 0,
    localRawImeDiffDroppedCount: 0,
    localRawImeDiffSingleCharCount: 0,
    localRawImeDiffExampleSpans: [],
  };
}

function spanGateConfig() {
  return {
    minSpanChars: DEFAULT_PINYIN_IME_V2.minSpanChars,
    maxSpanChars: DEFAULT_PINYIN_IME_V2.maxSpanChars,
    minSyllables: DEFAULT_PINYIN_IME_V2.minSyllables,
    maxSyllables: DEFAULT_PINYIN_IME_V2.maxSyllables,
  };
}

function isAllCjk(text: string): boolean {
  if (!text) {
    return false;
  }
  for (const ch of text) {
    if (!CJK_RE.test(ch)) {
      return false;
    }
  }
  return true;
}

function syllableCountInRange(count: number, min: number, max: number): boolean {
  return count >= min && count <= max;
}

export function shouldActivateLocalRawImeDiffFallback(
  alignFailedCount: number,
  candidateCount: number,
  topK: number
): boolean {
  const evaluatedCount = Math.min(topK, candidateCount);
  return evaluatedCount > 0 && alignFailedCount === evaluatedCount;
}

/**
 * Token-level raw ASR slice vs IME word diff among trusted TopK paths.
 * Output spans use existing PinyinImeV2DiffSpan only (no replacement text).
 */
export function buildLocalRawImeDiffSpans(input: LocalRawImeDiffInput): LocalRawImeDiffBuildResult {
  const rawAsrText = input.rawAsrText ?? '';
  const diagnostics = emptyBuildDiagnostics();

  if (!rawAsrText) {
    return { spans: [], diagnostics };
  }

  const gates = spanGateConfig();
  const { trusted, trustedCount } = selectTrustedTopKCandidates(
    input.candidates,
    input.alignmentScores
  );
  diagnostics.localRawImeDiffTrustedCandidateCount = trustedCount;
  diagnostics.localRawImeDiffCandidateCount = input.candidates.length;

  if (trustedCount === 0) {
    return { spans: [], diagnostics };
  }

  const charRanges = buildCharSyllableRanges(rawAsrText);
  const byInterval = new Map<string, IntervalAccumulator>();

  for (const candidate of trusted) {
    for (const token of candidate.tokens ?? []) {
      const intervalSyllables = token.syllableEnd - token.syllableStart;
      if (!syllableCountInRange(intervalSyllables, gates.minSyllables, gates.maxSyllables)) {
        diagnostics.localRawImeDiffDroppedCount++;
        continue;
      }

      const rawPos = syllableRangeToRawCharRange(
        charRanges,
        token.syllableStart,
        token.syllableEnd
      );
      if (!rawPos || rawPos.end <= rawPos.start) {
        diagnostics.localRawImeDiffDroppedCount++;
        continue;
      }

      const rawSlice = rawAsrText.slice(rawPos.start, rawPos.end);
      const imeWord = token.word;
      if (!rawSlice || !imeWord) {
        diagnostics.localRawImeDiffDroppedCount++;
        continue;
      }

      if (normalizeTraditionalChinese(rawSlice) === normalizeTraditionalChinese(imeWord)) {
        continue;
      }

      if (!isAllCjk(rawSlice)) {
        diagnostics.localRawImeDiffDroppedCount++;
        continue;
      }

      const rawSliceSyllables = textToSyllables(rawSlice.trim()).length;
      if (!syllableCountInRange(rawSliceSyllables, gates.minSyllables, gates.maxSyllables)) {
        diagnostics.localRawImeDiffDroppedCount++;
        continue;
      }

      const charLen = rawSlice.length;
      if (charLen < gates.minSpanChars) {
        diagnostics.localRawImeDiffSingleCharCount++;
        diagnostics.localRawImeDiffDroppedCount++;
        continue;
      }
      if (charLen > gates.maxSpanChars) {
        diagnostics.localRawImeDiffDroppedCount++;
        continue;
      }

      const key = `${rawPos.start}:${rawPos.end}`;
      const example: LocalRawImeDiffExampleSpan = {
        rawSlice,
        imeWord,
        syllableStart: token.syllableStart,
        syllableEnd: token.syllableEnd,
        rawStart: rawPos.start,
        rawEnd: rawPos.end,
        source: 'local_raw_ime_diff',
      };

      const existing = byInterval.get(key);
      if (!existing) {
        byInterval.set(key, {
          rawSpan: rawSlice,
          start: rawPos.start,
          end: rawPos.end,
          ranks: new Set([candidate.rank]),
          example,
        });
        continue;
      }

      existing.ranks.add(candidate.rank);
    }
  }

  const spans: PinyinImeV2DiffSpan[] = [...byInterval.values()]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((entry) => ({
      rawSpan: entry.rawSpan,
      start: entry.start,
      end: entry.end,
      candidateRank: Math.min(...entry.ranks),
      supportCount: entry.ranks.size,
    }));

  diagnostics.localRawImeDiffSpanCount = spans.length;
  diagnostics.localRawImeDiffExampleSpans = spans
    .slice(0, EXAMPLE_SPAN_LIMIT)
    .map((span) => {
      const entry = byInterval.get(`${span.start}:${span.end}`);
      return entry?.example ?? {
        rawSlice: span.rawSpan,
        imeWord: '',
        syllableStart: 0,
        syllableEnd: 0,
        rawStart: span.start,
        rawEnd: span.end,
        source: 'local_raw_ime_diff' as const,
      };
    });

  return { spans, diagnostics };
}
