import { BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD } from './pinyin-ime-v2-boundary-align';
import type { BoundaryAlignmentScore, PinyinImeV2Candidate } from './pinyin-ime-v2-types';
import { normalizeTraditionalChinese } from './normalize-for-ime-alignment';
import {
  buildCharSyllableRanges,
  type CharSyllableRange,
} from './pinyin-ime-v2-pinyin-stream';

/** V2.0 §十一 — sole span source for HintGate (raw offsets only). */
export type BoundaryCompatibleTopKSpan = {
  rawSpan: string;
  start: number;
  end: number;
  syllableStart: number;
  syllableEnd: number;
  supportCount: number;
  confidence: number;
  variants: string[];
  contributingRanks: number[];
};

export type TrustedTopKSelection = {
  trusted: PinyinImeV2Candidate[];
  trustedCount: number;
};

const MIN_TRUSTED_FOR_DIFF = 2;

function scoreByRank(scores: BoundaryAlignmentScore[], rank: number): number {
  return scores.find((s) => s.candidateRank === rank)?.compatibilityScore ?? 0;
}

/**
 * Trusted TopK: token path present + compatibility ≥ threshold; order by compat desc, rank asc.
 * Does not remove candidates from the pipeline — selection for diff only.
 */
export function selectTrustedTopKCandidates(
  candidates: PinyinImeV2Candidate[],
  alignmentScores: BoundaryAlignmentScore[],
  minCompatibility = BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD
): TrustedTopKSelection {
  const eligible = candidates.filter((c) => (c.tokens?.length ?? 0) > 0);
  const trusted = [...eligible]
    .filter((c) => scoreByRank(alignmentScores, c.rank) >= minCompatibility)
    .sort((a, b) => {
      const compatA = scoreByRank(alignmentScores, a.rank);
      const compatB = scoreByRank(alignmentScores, b.rank);
      if (compatB !== compatA) {
        return compatB - compatA;
      }
      return a.rank - b.rank;
    });

  return { trusted, trustedCount: trusted.length };
}

type SyllableInterval = { syllableStart: number; syllableEnd: number };

function collectTokenSyllableIntervals(trusted: PinyinImeV2Candidate[]): SyllableInterval[] {
  const seen = new Set<string>();
  const intervals: SyllableInterval[] = [];
  for (const candidate of trusted) {
    for (const token of candidate.tokens ?? []) {
      const key = `${token.syllableStart}:${token.syllableEnd}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      intervals.push({ syllableStart: token.syllableStart, syllableEnd: token.syllableEnd });
    }
  }
  return intervals.sort(
    (a, b) => a.syllableStart - b.syllableStart || a.syllableEnd - b.syllableEnd
  );
}

function wordForInterval(candidate: PinyinImeV2Candidate, interval: SyllableInterval): string {
  const parts: string[] = [];
  for (const token of candidate.tokens ?? []) {
    if (
      token.syllableStart < interval.syllableEnd &&
      token.syllableEnd > interval.syllableStart
    ) {
      parts.push(token.word);
    }
  }
  return normalizeTraditionalChinese(parts.join(''));
}

export function syllableRangeToRawCharRange(
  ranges: CharSyllableRange[],
  syllableStart: number,
  syllableEnd: number
): { start: number; end: number } | null {
  if (syllableEnd <= syllableStart) {
    return null;
  }
  for (const range of ranges) {
    if (syllableEnd <= range.syllableStart || syllableStart >= range.syllableEnd) {
      continue;
    }
    const ss = Math.max(syllableStart, range.syllableStart);
    const se = Math.min(syllableEnd, range.syllableEnd);
    const runLen = range.charEnd - range.charStart;
    const syllableCount = range.syllableEnd - range.syllableStart;
    if (runLen <= 0 || syllableCount <= 0) {
      return null;
    }
    const relSylStart = ss - range.syllableStart;
    const relSylEnd = se - range.syllableStart;
    const charsPerSyllable = runLen / syllableCount;
    const start = range.charStart + Math.floor(relSylStart * charsPerSyllable);
    const end = range.charStart + Math.ceil(relSylEnd * charsPerSyllable);
    return {
      start: Math.max(range.charStart, start),
      end: Math.min(range.charEnd, Math.max(start + 1, end)),
    };
  }
  return null;
}

export type BuildBoundaryCompatibleTopKDiffInput = {
  rawAsrText: string;
  candidates: PinyinImeV2Candidate[];
  alignmentScores: BoundaryAlignmentScore[];
  totalSyllables: number;
};

export type BoundaryCompatibleTopKDiffResult = {
  spans: BoundaryCompatibleTopKSpan[];
  trustedTopKCount: number;
  tokenSourceConflictDiagnosticCount: number;
};

/** Diagnostics: multiple token source types within one candidate path. */
export function countTokenSourceConflictDiagnostic(candidates: PinyinImeV2Candidate[]): number {
  let count = 0;
  for (const candidate of candidates) {
    const sources = new Set((candidate.tokens ?? []).map((t) => t.source));
    if (sources.size > 1) {
      count++;
    }
  }
  return count;
}

/**
 * Fine spans from syllable-interval word differences among trusted TopK token paths.
 */
export function buildBoundaryCompatibleTopKDiff(
  input: BuildBoundaryCompatibleTopKDiffInput
): BoundaryCompatibleTopKDiffResult {
  const { rawAsrText, candidates, alignmentScores, totalSyllables } = input;
  const tokenSourceConflictDiagnosticCount = countTokenSourceConflictDiagnostic(candidates);

  const { trusted, trustedCount } = selectTrustedTopKCandidates(candidates, alignmentScores);
  if (trustedCount < MIN_TRUSTED_FOR_DIFF || totalSyllables <= 0) {
    return { spans: [], trustedTopKCount: trustedCount, tokenSourceConflictDiagnosticCount };
  }

  const charRanges = buildCharSyllableRanges(rawAsrText);
  const intervals = collectTokenSyllableIntervals(trusted);
  const spans: BoundaryCompatibleTopKSpan[] = [];

  for (const interval of intervals) {
    const variantEntries: Array<{ word: string; ranks: number[] }> = [];
    const variantWords = new Set<string>();

    for (const candidate of trusted) {
      const word = wordForInterval(candidate, interval);
      if (!word) {
        continue;
      }
      if (!variantWords.has(word)) {
        variantWords.add(word);
        variantEntries.push({ word, ranks: [candidate.rank] });
      } else {
        const entry = variantEntries.find((e) => e.word === word);
        entry?.ranks.push(candidate.rank);
      }
    }

    if (variantEntries.length < 2) {
      continue;
    }

    const rawPos = syllableRangeToRawCharRange(
      charRanges,
      interval.syllableStart,
      interval.syllableEnd
    );
    if (!rawPos || rawPos.end <= rawPos.start) {
      continue;
    }

    const variants = variantEntries.map((e) => e.word);
    const contributingRanks = [...new Set(variantEntries.flatMap((e) => e.ranks))].sort(
      (a, b) => a - b
    );
    const supportCount = variants.length;
    const confidence = Math.min(1, supportCount / trustedCount);

    spans.push({
      rawSpan: rawAsrText.slice(rawPos.start, rawPos.end),
      start: rawPos.start,
      end: rawPos.end,
      syllableStart: interval.syllableStart,
      syllableEnd: interval.syllableEnd,
      supportCount,
      confidence,
      variants,
      contributingRanks,
    });
  }

  return {
    spans,
    trustedTopKCount: trustedCount,
    tokenSourceConflictDiagnosticCount,
  };
}
