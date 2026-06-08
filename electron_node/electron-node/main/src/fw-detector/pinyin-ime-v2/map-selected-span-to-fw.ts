import type { FwSpanDiagnostics } from '../types';
import type { PinyinImeV2SelectedSpan } from './pinyin-ime-v2-types';

/**
 * Map SelectedSpan to FwSpanDiagnostics for downstream Recall / KenLM / Apply.
 */
export function mapSelectedSpanToFwSpan(span: PinyinImeV2SelectedSpan): FwSpanDiagnostics {
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

export function mapSelectedSpansToFwSpans(spans: PinyinImeV2SelectedSpan[]): FwSpanDiagnostics[] {
  return spans.map(mapSelectedSpanToFwSpan);
}
