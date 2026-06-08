import type {
  PinyinImeV2SelectedSpan,
  PinyinImeV2SelectedSpanReason,
  PinyinImeV2SpanSelectorDiagnostics,
  PinyinImeV2SpanSelectorInput,
  PinyinImeV2SpanSelectorResult,
  PinyinImeV2SpanSelectionMode,
} from './pinyin-ime-v2-types';
import { normalizePinyinImeV2Spans, type NormalizedSpan } from './pinyin-ime-v2-span-normalizer';

const SCORE_NEIGHBOR_HIT = 1000;
const SCORE_SUPPORT_UNIT = 10;
const SCORE_BOUNDARY_TOPK = 100;
const SCORE_INSTABILITY = 50;

function emptySpanSelectorDiagnostics(): PinyinImeV2SpanSelectorDiagnostics {
  return {
    inputSpanCount: 0,
    normalizerDroppedCount: 0,
    normalizerDroppedSingleChar: 0,
    normalizerDroppedSyllableRange: 0,
    normalizedSpanCount: 0,
    selectedSpanCount: 0,
    selectionMode: 'empty_after_normalizer',
    neighborHitCount: 0,
    neighborMissCount: 0,
    cappedByMaxSpansCount: 0,
  };
}

function computeConfidence(supportCount: number, topK: number, hasNeighbor: boolean): number {
  const base = Math.min(1, supportCount / Math.max(1, topK));
  return hasNeighbor ? Math.min(1, base + 0.15) : base;
}

function resolveSpanReason(span: NormalizedSpan): PinyinImeV2SelectedSpanReason {
  if (span.fromBoundaryTopKDiff) {
    return 'ime_v2_boundary_topk_diff';
  }
  if (span.fromInstability) {
    return 'ime_v2_instability';
  }
  return 'ime_v2_diff';
}

function scoreNormalizedSpan(span: NormalizedSpan, neighborHit: boolean): number {
  let score = span.supportCount * SCORE_SUPPORT_UNIT;
  if (neighborHit) {
    score += SCORE_NEIGHBOR_HIT;
  }
  if (span.fromBoundaryTopKDiff) {
    score += SCORE_BOUNDARY_TOPK;
  }
  if (span.fromInstability) {
    score += SCORE_INSTABILITY;
  }
  return score;
}

type ScoredNormalizedSpan = {
  span: NormalizedSpan;
  neighborHit: boolean;
  score: number;
};

function buildScoredSpans(
  spans: NormalizedSpan[],
  lexiconNearNeighbor: PinyinImeV2SpanSelectorInput['lexiconNearNeighbor']
): ScoredNormalizedSpan[] {
  return spans.map((span) => {
    const neighborHit = lexiconNearNeighbor(span.rawSpan);
    return {
      span,
      neighborHit,
      score: scoreNormalizedSpan(span, neighborHit),
    };
  });
}

function toSelectedSpan(entry: ScoredNormalizedSpan, topK: number): PinyinImeV2SelectedSpan {
  return {
    rawSpan: entry.span.rawSpan,
    start: entry.span.start,
    end: entry.span.end,
    confidence: computeConfidence(entry.span.supportCount, topK, entry.neighborHit),
    reason: resolveSpanReason(entry.span),
  };
}

function applyNormalizerDiagnostics(
  diagnostics: PinyinImeV2SpanSelectorDiagnostics,
  normalized: ReturnType<typeof normalizePinyinImeV2Spans>
): void {
  diagnostics.inputSpanCount = normalized.spans.length + normalized.dropped.length;
  diagnostics.normalizerDroppedCount = normalized.dropped.length;
  diagnostics.normalizedSpanCount = normalized.spans.length;
  for (const drop of normalized.dropped) {
    if (drop.reason === 'single_char') {
      diagnostics.normalizerDroppedSingleChar++;
    }
    if (drop.reason === 'syllable_out_of_range') {
      diagnostics.normalizerDroppedSyllableRange++;
    }
  }
}

function finalizeDiagnostics(
  diagnostics: PinyinImeV2SpanSelectorDiagnostics,
  selected: PinyinImeV2SelectedSpan[],
  scored: ScoredNormalizedSpan[],
  selectionMode: PinyinImeV2SpanSelectionMode,
  cappedByMaxSpansCount: number
): void {
  const selectedKeys = new Set(selected.map((s) => `${s.start}:${s.end}:${s.rawSpan}`));
  let neighborHitCount = 0;
  let neighborMissCount = 0;

  for (const entry of scored) {
    const key = `${entry.span.start}:${entry.span.end}:${entry.span.rawSpan}`;
    if (!selectedKeys.has(key)) {
      continue;
    }
    if (entry.neighborHit) {
      neighborHitCount++;
    } else {
      neighborMissCount++;
    }
  }

  diagnostics.selectionMode = selectionMode;
  diagnostics.selectedSpanCount = selected.length;
  diagnostics.neighborHitCount = neighborHitCount;
  diagnostics.neighborMissCount = neighborMissCount;
  diagnostics.cappedByMaxSpansCount = cappedByMaxSpansCount;
}

/**
 * SpanSelector — normalize, rank (when over cap), select up to maxApprovedSpans.
 * Neighbor/support are ranking signals only; no veto.
 */
export function selectPinyinImeV2Spans(
  input: PinyinImeV2SpanSelectorInput
): PinyinImeV2SpanSelectorResult {
  const diagnostics = emptySpanSelectorDiagnostics();
  const {
    rawAsrText,
    diffSpans,
    instabilityRegions,
    boundaryCompatibleTopKSpans,
    config,
    lexiconNearNeighbor,
  } = input;

  const normalized = normalizePinyinImeV2Spans(
    rawAsrText,
    diffSpans,
    instabilityRegions,
    boundaryCompatibleTopKSpans,
    config
  );
  applyNormalizerDiagnostics(diagnostics, normalized);

  if (normalized.spans.length === 0) {
    return { selected: [], diagnostics };
  }

  const scored = buildScoredSpans(normalized.spans, lexiconNearNeighbor);
  const maxSpans = config.maxApprovedSpans;

  if (normalized.spans.length <= maxSpans) {
    const selected = scored
      .slice()
      .sort((a, b) => a.span.start - b.span.start)
      .map((entry) => toSelectedSpan(entry, config.topK));
    finalizeDiagnostics(diagnostics, selected, scored, 'all_passed', 0);
    return { selected, diagnostics };
  }

  const ranked = scored.slice().sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.span.start - b.span.start;
  });
  const picked = ranked.slice(0, maxSpans);
  const selected = picked.map((entry) => toSelectedSpan(entry, config.topK));
  const cappedByMaxSpansCount = normalized.spans.length - selected.length;
  finalizeDiagnostics(diagnostics, selected, scored, 'ranked_capped', cappedByMaxSpansCount);
  return { selected, diagnostics };
}
