import type {
  PinyinImeV2ApprovedSpan,
  PinyinImeV2HintGateDiagnostics,
  PinyinImeV2HintGateInput,
  PinyinImeV2HintGateResult,
} from './pinyin-ime-v2-types';
import { normalizePinyinImeV2Spans } from './pinyin-ime-v2-span-normalizer';

function emptyHintGateDiagnostics(): PinyinImeV2HintGateDiagnostics {
  return {
    inputSpanCount: 0,
    normalizerDroppedCount: 0,
    normalizerDroppedSingleChar: 0,
    normalizerDroppedSyllableRange: 0,
    gateDroppedSupport: 0,
    gateDroppedNoNeighbor: 0,
    gateDroppedMaxSpans: 0,
    approvedSpanCount: 0,
  };
}

function computeConfidence(supportCount: number, topK: number, hasNeighbor: boolean): number {
  const base = Math.min(1, supportCount / Math.max(1, topK));
  return hasNeighbor ? Math.min(1, base + 0.15) : base;
}

/**
 * ImeHintGate — sole span gate for pinyin-ime-v2 unique mainline.
 * Outputs raw-span ApprovedSpan only; never replacement text or apply actions.
 */
export function runPinyinImeV2HintGate(input: PinyinImeV2HintGateInput): PinyinImeV2HintGateResult {
  const diagnostics = emptyHintGateDiagnostics();
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
  diagnostics.inputSpanCount = normalized.spans.length + normalized.dropped.length;
  diagnostics.normalizerDroppedCount = normalized.dropped.length;
  for (const drop of normalized.dropped) {
    if (drop.reason === 'single_char') {
      diagnostics.normalizerDroppedSingleChar++;
    }
    if (drop.reason === 'syllable_out_of_range') {
      diagnostics.normalizerDroppedSyllableRange++;
    }
  }

  const approved: PinyinImeV2ApprovedSpan[] = [];

  const sorted = [...normalized.spans].sort((a, b) => {
    if (b.supportCount !== a.supportCount) {
      return b.supportCount - a.supportCount;
    }
    return a.start - b.start;
  });

  for (const span of sorted) {
    if (approved.length >= config.maxApprovedSpans) {
      diagnostics.gateDroppedMaxSpans++;
      continue;
    }
    if (span.supportCount < config.minSupportCount) {
      diagnostics.gateDroppedSupport++;
      continue;
    }
    const hasNeighbor = lexiconNearNeighbor(span.rawSpan);
    if (!hasNeighbor) {
      diagnostics.gateDroppedNoNeighbor++;
      continue;
    }

    approved.push({
      rawSpan: span.rawSpan,
      start: span.start,
      end: span.end,
      confidence: computeConfidence(span.supportCount, config.topK, hasNeighbor),
      reason: span.fromBoundaryTopKDiff
        ? 'ime_v2_boundary_topk_diff'
        : span.fromInstability
          ? 'ime_v2_instability'
          : 'ime_v2_diff',
    });
  }

  diagnostics.approvedSpanCount = approved.length;
  return { approved, diagnostics };
}
