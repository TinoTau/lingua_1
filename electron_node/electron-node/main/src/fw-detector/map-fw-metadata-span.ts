import type { FwMetadataSpanCandidate } from './fw-metadata-span-gate';
import type { FwSpanDiagnostics } from './types';

export function mapFwMetadataSpanToFwSpan(span: FwMetadataSpanCandidate): FwSpanDiagnostics {
  return {
    text: span.text,
    start: span.start,
    end: span.end,
    domain: 'general',
    riskScore: span.riskScore,
    signals: span.signals,
    candidates: [],
    applied: false,
  };
}
