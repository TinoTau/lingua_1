import type { SegmentInfo } from '../../task-router/types';
import { extractRawCoarseBoundaries } from '../pinyin-ime-v2/extract-raw-coarse-boundaries';
import {
  BOUNDARY_SYLLABLE_MATCH_TOLERANCE,
  collectRawBoundarySyllableSplits,
  computeBoundaryAlignmentDiagnostics,
} from '../pinyin-ime-v2/pinyin-ime-v2-boundary-align';
import { selectTrustedTopKCandidates } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import { decodeRawTextTopK } from '../pinyin-ime-v2/pinyin-ime-v2-decoder';
import { normalizePinyinImeV2Spans } from '../pinyin-ime-v2/pinyin-ime-v2-span-normalizer';
import {
  buildCharSyllableRanges,
  textToPinyinStream,
  type CharSyllableRange,
} from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { runPinyinImeV2SpanProposal } from '../pinyin-ime-v2/run-pinyin-ime-v2-span-proposal';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from '../pinyin-ime-v2/pinyin-ime-v2-types';
import type { PinyinImeV2Candidate } from '../pinyin-ime-v2/pinyin-ime-v2-types';
import type { CoarseBoundarySource, CoarseSpan } from './types';

export type CoarseBoundaryImportDiagnostics = {
  rawSyllableCount: number;
  imeCandidateCount: number;
  trustedTopKCount: number;
  imeBoundaryCount: number;
  rawBoundaryCount: number;
  alignedBoundaryCount: number;
  proposalBoundaryCount: number;
  asrWordBoundaryCount: number;
  punctuationFallbackBoundaryCount: number;
  finalCoarseSpanCount: number;
  coverageOk: boolean;
  boundarySourceBreakdown: Record<CoarseBoundarySource, number>;
  fallbackReason?: string;
};

export type BuildCoarseSpansFromRawImeBoundaryInput = {
  rawText: string;
  imeConfig: PinyinImeV2RuntimeConfig;
  dict: PinyinImeV2Dict;
  asrSegments?: SegmentInfo[];
  proposalSpans?: Array<{ start: number; end: number; rawSpan: string }>;
};

export type BuildCoarseSpansFromRawImeBoundaryResult = {
  coarseSpans: CoarseSpan[];
  diagnostics: CoarseBoundaryImportDiagnostics;
};

const SOURCE_PRIORITY: Record<CoarseBoundarySource, number> = {
  ime_token_boundary: 1,
  raw_ime_aligned_boundary: 2,
  proposal_active_boundary: 3,
  asr_word_boundary: 4,
  punctuation_fallback: 5,
};

type BoundarySplit = {
  syllableIndex: number;
  source: CoarseBoundarySource;
  confidence: number;
  locked: boolean;
};

function emptyBreakdown(): Record<CoarseBoundarySource, number> {
  return {
    ime_token_boundary: 0,
    raw_ime_aligned_boundary: 0,
    proposal_active_boundary: 0,
    asr_word_boundary: 0,
    punctuation_fallback: 0,
  };
}

function charRangeToSyllableRange(
  ranges: CharSyllableRange[],
  charStart: number,
  charEnd: number
): { syllableStart: number; syllableEnd: number } | null {
  let syllableStart: number | null = null;
  let syllableEnd: number | null = null;
  for (const range of ranges) {
    if (charEnd <= range.charStart || charStart >= range.charEnd) {
      continue;
    }
    const overlapStart = Math.max(charStart, range.charStart);
    const overlapEnd = Math.min(charEnd, range.charEnd);
    const runLen = range.charEnd - range.charStart;
    const syllableCount = range.syllableEnd - range.syllableStart;
    if (runLen <= 0 || syllableCount <= 0) {
      return null;
    }
    const relStart = overlapStart - range.charStart;
    const relEnd = overlapEnd - range.charStart;
    const sylStart = range.syllableStart + Math.floor((relStart / runLen) * syllableCount);
    const sylEnd = range.syllableStart + Math.ceil((relEnd / runLen) * syllableCount);
    syllableStart = syllableStart === null ? sylStart : Math.min(syllableStart, sylStart);
    syllableEnd = syllableEnd === null ? sylEnd : Math.max(syllableEnd, sylEnd);
  }
  if (syllableStart === null || syllableEnd === null || syllableEnd <= syllableStart) {
    return null;
  }
  return { syllableStart, syllableEnd };
}

function minDistanceToSplits(point: number, splits: number[]): number {
  if (!splits.length) {
    return Number.POSITIVE_INFINITY;
  }
  let min = Number.POSITIVE_INFINITY;
  for (const split of splits) {
    min = Math.min(min, Math.abs(split - point));
  }
  return min;
}

function addSplit(splits: Map<number, BoundarySplit>, split: BoundarySplit): void {
  const existing = splits.get(split.syllableIndex);
  if (!existing) {
    splits.set(split.syllableIndex, split);
    return;
  }
  if (split.locked && !existing.locked) {
    splits.set(split.syllableIndex, split);
    return;
  }
  if (SOURCE_PRIORITY[split.source] < SOURCE_PRIORITY[existing.source]) {
    splits.set(split.syllableIndex, { ...split, locked: split.locked || existing.locked });
    return;
  }
  if (split.source === existing.source) {
    existing.confidence = Math.max(existing.confidence, split.confidence);
    existing.locked = existing.locked || split.locked;
  }
}

function collectImeTokenEndIndices(
  trusted: PinyinImeV2Candidate[],
  totalSyllables: number
): number[] {
  const ends = new Set<number>();
  for (const candidate of trusted) {
    for (const token of candidate.tokens ?? []) {
      if (token.syllableEnd > 0 && token.syllableEnd < totalSyllables) {
        ends.add(token.syllableEnd);
      }
    }
  }
  return [...ends];
}

function collectImeTokenSplits(
  trusted: PinyinImeV2Candidate[],
  trustedCount: number,
  totalSyllables: number
): BoundarySplit[] {
  const support = new Map<number, number>();
  for (const candidate of trusted) {
    const seen = new Set<number>();
    for (const token of candidate.tokens ?? []) {
      if (token.syllableEnd <= 0 || token.syllableEnd >= totalSyllables || seen.has(token.syllableEnd)) {
        continue;
      }
      seen.add(token.syllableEnd);
      support.set(token.syllableEnd, (support.get(token.syllableEnd) ?? 0) + 1);
    }
  }
  const minSupport = Math.max(1, Math.ceil(trustedCount * 0.4));
  const splits: BoundarySplit[] = [];
  for (const [syllableIndex, count] of support) {
    if (count >= minSupport) {
      splits.push({
        syllableIndex,
        source: 'ime_token_boundary',
        confidence: trustedCount > 0 ? count / trustedCount : 0,
        locked: false,
      });
    }
  }
  return splits;
}

function collectAlignedRawSplits(
  rawBoundaries: ReturnType<typeof extractRawCoarseBoundaries>,
  imeEndIndices: number[],
  totalSyllables: number
): BoundarySplit[] {
  const rawSplits = collectRawBoundarySyllableSplits(rawBoundaries, totalSyllables);
  const splits: BoundarySplit[] = [];
  for (const rawPoint of rawSplits) {
    if (minDistanceToSplits(rawPoint, imeEndIndices) <= BOUNDARY_SYLLABLE_MATCH_TOLERANCE) {
      splits.push({
        syllableIndex: rawPoint,
        source: 'raw_ime_aligned_boundary',
        confidence: 0.8,
        locked: false,
      });
    }
  }
  return splits;
}

function collectProposalSplits(
  proposalSpans: Array<{ start: number; end: number; rawSpan: string }>,
  charRanges: CharSyllableRange[],
  totalSyllables: number
): BoundarySplit[] {
  const splits: BoundarySplit[] = [];
  for (const span of proposalSpans) {
    const syl = charRangeToSyllableRange(charRanges, span.start, span.end);
    if (!syl) {
      continue;
    }
    if (syl.syllableStart > 0 && syl.syllableStart < totalSyllables) {
      splits.push({
        syllableIndex: syl.syllableStart,
        source: 'proposal_active_boundary',
        confidence: 1,
        locked: true,
      });
    }
    if (syl.syllableEnd > 0 && syl.syllableEnd < totalSyllables) {
      splits.push({
        syllableIndex: syl.syllableEnd,
        source: 'proposal_active_boundary',
        confidence: 1,
        locked: true,
      });
    }
  }
  return splits;
}

function collectAsrWordSplits(
  rawText: string,
  asrSegments: SegmentInfo[] | undefined,
  charRanges: CharSyllableRange[],
  totalSyllables: number
): BoundarySplit[] {
  if (!asrSegments?.length) {
    return [];
  }
  const splits: BoundarySplit[] = [];
  let searchFrom = 0;
  for (const segment of asrSegments) {
    for (const word of segment.words ?? []) {
      const token = word.word?.trim();
      if (!token) {
        continue;
      }
      const idx = rawText.indexOf(token, searchFrom);
      if (idx < 0) {
        continue;
      }
      searchFrom = idx + token.length;
      const syl = charRangeToSyllableRange(charRanges, idx, idx + token.length);
      if (syl && syl.syllableEnd > 0 && syl.syllableEnd < totalSyllables) {
        splits.push({
          syllableIndex: syl.syllableEnd,
          source: 'asr_word_boundary',
          confidence: typeof word.probability === 'number' ? word.probability : 0.5,
          locked: false,
        });
      }
    }
  }
  return splits;
}

function collectPunctuationFallbackSplits(
  rawText: string,
  totalSyllables: number
): BoundarySplit[] {
  const rawBoundaries = extractRawCoarseBoundaries(rawText);
  const splits: BoundarySplit[] = [];
  for (const boundary of rawBoundaries) {
    if (boundary.kind !== 'punctuation' && boundary.kind !== 'space') {
      continue;
    }
    if (boundary.syllableStart > 0 && boundary.syllableStart < totalSyllables) {
      splits.push({
        syllableIndex: boundary.syllableStart,
        source: 'punctuation_fallback',
        confidence: 0.3,
        locked: false,
      });
    }
    if (boundary.syllableEnd > 0 && boundary.syllableEnd < totalSyllables) {
      splits.push({
        syllableIndex: boundary.syllableEnd,
        source: 'punctuation_fallback',
        confidence: 0.3,
        locked: false,
      });
    }
  }
  return splits;
}

function buildSpansFromSplitMap(
  rawText: string,
  charRanges: CharSyllableRange[],
  splitMap: Map<number, BoundarySplit>,
  totalSyllables: number
): CoarseSpan[] {
  const indices = [...new Set([0, ...splitMap.keys(), totalSyllables])].sort((a, b) => a - b);
  const spans: CoarseSpan[] = [];
  for (let i = 0; i < indices.length - 1; i++) {
    const syllableStart = indices[i];
    const syllableEnd = indices[i + 1];
    if (syllableEnd <= syllableStart) {
      continue;
    }
    const charRange = syllableRangeToRawCharRange(charRanges, syllableStart, syllableEnd);
    if (!charRange || charRange.end <= charRange.start) {
      continue;
    }
    const startSplit = syllableStart > 0 ? splitMap.get(syllableStart) : undefined;
    const endSplit = splitMap.get(syllableEnd);
    const source = startSplit?.source ?? endSplit?.source ?? 'ime_token_boundary';
    const boundaryConfidence = startSplit?.confidence ?? endSplit?.confidence ?? 0.5;
    spans.push({
      id: `c${spans.length}`,
      rawStart: charRange.start,
      rawEnd: charRange.end,
      syllableStart,
      syllableEnd,
      text: rawText.slice(charRange.start, charRange.end),
      source,
      boundaryConfidence,
    });
  }
  return spans;
}

function mergeSingleSyllableSpans(rawText: string, spans: CoarseSpan[]): CoarseSpan[] {
  if (spans.length <= 1) {
    return spans;
  }
  const merged: CoarseSpan[] = [];
  let pending: CoarseSpan | null = null;

  for (const span of spans) {
    const syllableCount = span.syllableEnd - span.syllableStart;
    const isProposalLocked = span.source === 'proposal_active_boundary';

    if (syllableCount === 1 && !isProposalLocked) {
      if (merged.length > 0) {
        const prev = merged[merged.length - 1];
        if (prev.source !== 'proposal_active_boundary') {
          merged[merged.length - 1] = {
            ...prev,
            rawEnd: span.rawEnd,
            syllableEnd: span.syllableEnd,
            text: rawText.slice(prev.rawStart, span.rawEnd),
            boundaryConfidence: Math.max(prev.boundaryConfidence, span.boundaryConfidence),
          };
          continue;
        }
      }
      pending = pending ? mergeAdjacentSpans(rawText, pending, span) : span;
      continue;
    }

    if (pending) {
      merged.push(mergeAdjacentSpans(rawText, pending, span));
      pending = null;
    } else {
      merged.push(span);
    }
  }

  if (pending) {
    merged.push(pending);
  }

  return merged.map((span, idx) => ({ ...span, id: `c${idx}` }));
}

function mergeAdjacentSpans(rawText: string, left: CoarseSpan, right: CoarseSpan): CoarseSpan {
  return {
    ...left,
    rawEnd: right.rawEnd,
    syllableEnd: right.syllableEnd,
    text: rawText.slice(left.rawStart, right.rawEnd),
    source: SOURCE_PRIORITY[left.source] <= SOURCE_PRIORITY[right.source] ? left.source : right.source,
    boundaryConfidence: Math.max(left.boundaryConfidence, right.boundaryConfidence),
  };
}

function verifyCoverage(totalSyllables: number, spans: CoarseSpan[]): boolean {
  if (totalSyllables === 0) {
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
  for (let i = 0; i < totalSyllables; i++) {
    if (!covered.has(i)) {
      return false;
    }
  }
  return true;
}

function countBreakdown(spans: CoarseSpan[]): Record<CoarseBoundarySource, number> {
  const breakdown = emptyBreakdown();
  for (const span of spans) {
    breakdown[span.source] = (breakdown[span.source] ?? 0) + 1;
  }
  return breakdown;
}

export function resolveProposalActiveSpansReadOnly(
  rawText: string,
  dict: PinyinImeV2Dict,
  imeConfig: PinyinImeV2RuntimeConfig
): Array<{ start: number; end: number; rawSpan: string }> {
  const proposal = runPinyinImeV2SpanProposal({
    rawAsrText: rawText,
    dict,
    config: { topK: imeConfig.topK },
  });
  const normalized = normalizePinyinImeV2Spans(
    rawText,
    proposal.diffSpans,
    proposal.instabilityRegions,
    proposal.boundaryCompatibleTopKSpans,
    imeConfig
  );
  return normalized.spans.map((span) => ({
    start: span.start,
    end: span.end,
    rawSpan: span.rawSpan,
  }));
}

export function buildCoarseSpansFromRawImeBoundary(
  input: BuildCoarseSpansFromRawImeBoundaryInput
): BuildCoarseSpansFromRawImeBoundaryResult {
  const rawText = (input.rawText ?? '').trim();
  const { syllables, hasCjk } = textToPinyinStream(rawText);
  const totalSyllables = syllables.length;

  const baseDiagnostics: CoarseBoundaryImportDiagnostics = {
    rawSyllableCount: totalSyllables,
    imeCandidateCount: 0,
    trustedTopKCount: 0,
    imeBoundaryCount: 0,
    rawBoundaryCount: 0,
    alignedBoundaryCount: 0,
    proposalBoundaryCount: 0,
    asrWordBoundaryCount: 0,
    punctuationFallbackBoundaryCount: 0,
    finalCoarseSpanCount: 0,
    coverageOk: false,
    boundarySourceBreakdown: emptyBreakdown(),
  };

  if (!hasCjk || totalSyllables === 0) {
    return { coarseSpans: [], diagnostics: { ...baseDiagnostics, fallbackReason: 'no_cjk' } };
  }

  const charRanges = buildCharSyllableRanges(rawText);
  const rawBoundaries = extractRawCoarseBoundaries(rawText);
  baseDiagnostics.rawBoundaryCount = rawBoundaries.length;

  const { candidates } = decodeRawTextTopK(syllables, input.dict, input.imeConfig.topK);
  baseDiagnostics.imeCandidateCount = candidates.length;

  const alignment = computeBoundaryAlignmentDiagnostics(rawBoundaries, candidates, totalSyllables);
  const { trusted, trustedCount } = selectTrustedTopKCandidates(candidates, alignment.scores);
  baseDiagnostics.trustedTopKCount = trustedCount;

  const proposalSpans =
    input.proposalSpans ??
    resolveProposalActiveSpansReadOnly(rawText, input.dict, input.imeConfig);

  const splitMap = new Map<number, BoundarySplit>();
  let fallbackReason: string | undefined;

  if (trustedCount === 0 || candidates.length === 0) {
    fallbackReason = 'no_trusted_topk';
    for (const split of collectPunctuationFallbackSplits(rawText, totalSyllables)) {
      addSplit(splitMap, split);
    }
  } else {
    const imeEndIndices = collectImeTokenEndIndices(trusted, totalSyllables);
    const imeSplits = collectImeTokenSplits(trusted, trustedCount, totalSyllables);
    baseDiagnostics.imeBoundaryCount = imeSplits.length;
    for (const split of imeSplits) {
      addSplit(splitMap, split);
    }

    const alignedSplits = collectAlignedRawSplits(rawBoundaries, imeEndIndices, totalSyllables);
    baseDiagnostics.alignedBoundaryCount = alignedSplits.length;
    for (const split of alignedSplits) {
      addSplit(splitMap, split);
    }

    const proposalSplits = collectProposalSplits(proposalSpans, charRanges, totalSyllables);
    baseDiagnostics.proposalBoundaryCount = proposalSplits.length;
    for (const split of proposalSplits) {
      addSplit(splitMap, split);
    }

    const asrSplits = collectAsrWordSplits(rawText, input.asrSegments, charRanges, totalSyllables);
    baseDiagnostics.asrWordBoundaryCount = asrSplits.length;
    for (const split of asrSplits) {
      addSplit(splitMap, split);
    }
  }

  let coarseSpans = buildSpansFromSplitMap(rawText, charRanges, splitMap, totalSyllables);

  if (coarseSpans.length <= 1) {
    fallbackReason = fallbackReason ?? 'single_span_after_ime';
    for (const split of collectPunctuationFallbackSplits(rawText, totalSyllables)) {
      addSplit(splitMap, split);
    }
    coarseSpans = buildSpansFromSplitMap(rawText, charRanges, splitMap, totalSyllables);
  }

  if (!verifyCoverage(totalSyllables, coarseSpans)) {
    fallbackReason = fallbackReason ?? 'coverage_gap';
    for (const split of collectPunctuationFallbackSplits(rawText, totalSyllables)) {
      addSplit(splitMap, split);
    }
    coarseSpans = buildSpansFromSplitMap(rawText, charRanges, splitMap, totalSyllables);
  }

  coarseSpans = mergeSingleSyllableSpans(rawText, coarseSpans);

  const punctCount = coarseSpans.filter((s) => s.source === 'punctuation_fallback').length;
  baseDiagnostics.punctuationFallbackBoundaryCount = punctCount;
  baseDiagnostics.finalCoarseSpanCount = coarseSpans.length;
  baseDiagnostics.coverageOk = verifyCoverage(totalSyllables, coarseSpans);
  baseDiagnostics.boundarySourceBreakdown = countBreakdown(coarseSpans);
  if (fallbackReason) {
    baseDiagnostics.fallbackReason = fallbackReason;
  }

  return { coarseSpans, diagnostics: baseDiagnostics };
}
