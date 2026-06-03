import type { FwSpanDiagnostics } from '../types';
import type { PinyinImeV2ApprovedSpan } from './pinyin-ime-v2-types';

/**
 * Map ApprovedSpan to FwSpanDiagnostics for downstream Recall / KenLM / Apply.
 * Downstream must not consume IME internal types directly.
 */
export function mapApprovedSpanToFwSpan(span: PinyinImeV2ApprovedSpan): FwSpanDiagnostics {
  const signal =
    span.reason === 'ime_v2_boundary_topk_diff'
      ? 'ime_v2_boundary_topk_diff_hint'
      : span.reason === 'ime_v2_instability'
        ? 'ime_v2_instability_hint'
        : 'ime_v2_diff_hint';

  return {
    text: span.rawSpan,
    start: span.start,
    end: span.end,
    domain: 'general',
    riskScore: span.confidence,
    signals: [signal],
    candidates: [],
    applied: false,
  };
}

export function mapApprovedSpansToFwSpans(spans: PinyinImeV2ApprovedSpan[]): FwSpanDiagnostics[] {
  return spans.map(mapApprovedSpanToFwSpan);
}
