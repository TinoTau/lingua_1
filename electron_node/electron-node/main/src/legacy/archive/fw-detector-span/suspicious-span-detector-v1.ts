/**
 * FW suspicious span detector v1 — bounded CJK windows + risk signals.
 * P1.2c-fix: detector_pinyin_hint (weak); no recall / repair_target in detector.
 */

import type { SegmentInfo } from '../task-router/types';
import type { FwDetectorRuntimeConfig } from './fw-config';
import type { SpanDetectorHintFn } from './span-detector-hint';
import type {
  FwDetectorSignal,
  FwRiskScoreBreakdownItem,
  FwSpanDiagnostics,
  FwSpanDroppedDiag,
  FwSpanSelectionDiag,
  FwTextSpan,
} from './types';

const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;
const LATIN_IN_SPAN = /[A-Za-z]/;
const DROPPED_CAP = 32;

type ScoredSpan = FwSpanDiagnostics & {
  span: FwTextSpan;
};

export type DetectSuspiciousSpansResult = {
  spans: FwSpanDiagnostics[];
  spanSelection: FwSpanSelectionDiag;
};

function enumerateCjkSpans(
  text: string,
  minLen: number,
  maxLen: number
): FwTextSpan[] {
  const spans: FwTextSpan[] = [];
  let match: RegExpExecArray | null;
  while ((match = CJK_RUN.exec(text)) !== null) {
    const runStart = match.index;
    const run = match[0];
    const upper = Math.min(maxLen, run.length);
    for (let len = minLen; len <= upper; len++) {
      for (let i = 0; i <= run.length - len; i++) {
        const slice = run.slice(i, i + len);
        spans.push({
          text: slice,
          start: runStart + i,
          end: runStart + i + len,
        });
      }
    }
  }
  return spans;
}

function anchorHitsNearSpan(
  text: string,
  span: FwTextSpan,
  anchors: string[],
  windowChars: number
): boolean {
  const left = Math.max(0, span.start - windowChars);
  const right = Math.min(text.length, span.end + windowChars);
  const neighborhood = text.slice(left, right);
  return anchors.some((a) => a.length > 0 && neighborhood.includes(a));
}

function resolveDomainForSpan(
  text: string,
  span: FwTextSpan,
  domainAnchors: Record<string, string[]>,
  enabledDomains: string[]
): string {
  for (const domain of enabledDomains) {
    const anchors = domainAnchors[domain] ?? [];
    if (anchorHitsNearSpan(text, span, anchors, 8)) {
      return domain;
    }
  }
  return 'general';
}

function segmentNoSpeechProb(
  segments: SegmentInfo[] | undefined,
  span: FwTextSpan
): number | undefined {
  if (!segments?.length) {
    return undefined;
  }
  const mid = (span.start + span.end) / 2;
  for (const seg of segments) {
    const start = seg.start ?? 0;
    const end = seg.end ?? start;
    if (mid >= start && mid <= end && seg.no_speech_prob != null) {
      return seg.no_speech_prob;
    }
  }
  return segments[0]?.no_speech_prob;
}

function buildRiskScoreBreakdown(
  signals: FwDetectorSignal[],
  config: FwDetectorRuntimeConfig
): FwRiskScoreBreakdownItem[] {
  return signals.map((signal) => {
    const weight = config.signalWeights[signal] ?? 0;
    return { signal, weight, partial: weight };
  });
}

function scoreSpan(
  text: string,
  span: FwTextSpan,
  config: FwDetectorRuntimeConfig,
  segments: SegmentInfo[] | undefined,
  hintFn?: SpanDetectorHintFn
): ScoredSpan {
  const signals: FwDetectorSignal[] = [];
  const enabledAnchors = config.enabledDomains.flatMap((d) => config.domainAnchors[d] ?? []);
  const domain = resolveDomainForSpan(text, span, config.domainAnchors, config.enabledDomains);

  if (anchorHitsNearSpan(text, span, enabledAnchors, config.windowChars)) {
    signals.push('domain_anchor_nearby');
  }
  if (LATIN_IN_SPAN.test(span.text)) {
    signals.push('mixed_language_anomaly');
  }

  const noSpeech = segmentNoSpeechProb(segments, span);
  if (noSpeech != null && noSpeech > config.noSpeechProbThreshold) {
    signals.push('low_no_speech_prob');
  }

  let detectorHint: ScoredSpan['detectorHint'];
  if (hintFn) {
    const hint = hintFn(span.text);
    detectorHint = { syllables: hint.syllables, syllableCount: hint.syllableCount };
    if (hint.hasPinyinHint) {
      signals.push('detector_pinyin_hint');
    }
  }

  const riskScoreBreakdown = buildRiskScoreBreakdown(signals, config);
  const riskScore = riskScoreBreakdown.reduce((sum, item) => sum + item.partial, 0);

  return {
    span,
    text: span.text,
    start: span.start,
    end: span.end,
    domain,
    riskScore,
    signals,
    riskScoreBreakdown,
    candidates: [],
    applied: false,
    detectorHint,
  };
}

type SpanSelectionRank = {
  spanLength: number;
  riskScore: number;
  start: number;
};

function compareSpanSelectionRank(a: SpanSelectionRank, b: SpanSelectionRank): number {
  if (a.riskScore !== b.riskScore) {
    return b.riskScore - a.riskScore;
  }
  if (a.spanLength !== b.spanLength) {
    return a.spanLength - b.spanLength;
  }
  return b.start - a.start;
}

function selectionRank(scored: ScoredSpan): SpanSelectionRank {
  return {
    spanLength: scored.text.length,
    riskScore: scored.riskScore,
    start: scored.start,
  };
}

function pushDropped(
  dropped: FwSpanDroppedDiag[],
  scored: ScoredSpan,
  reason: FwSpanDroppedDiag['reason']
): void {
  if (dropped.length >= DROPPED_CAP) {
    return;
  }
  dropped.push({
    text: scored.text,
    start: scored.start,
    end: scored.end,
    riskScore: scored.riskScore,
    reason,
  });
}

function selectSpansForPipeline(
  scored: ScoredSpan[],
  budget: number,
  minRisk: number
): { kept: ScoredSpan[]; dropped: FwSpanDroppedDiag[] } {
  const dropped: FwSpanDroppedDiag[] = [];
  for (const s of scored) {
    if (s.riskScore < minRisk) {
      pushDropped(dropped, s, 'below_min_risk');
    }
  }

  const eligible = scored.filter((s) => s.riskScore >= minRisk);
  const sorted = [...eligible].sort((a, b) =>
    compareSpanSelectionRank(selectionRank(a), selectionRank(b))
  );
  const kept = sorted.slice(0, budget);
  for (const s of sorted.slice(budget)) {
    pushDropped(dropped, s, 'maxSpans');
  }

  return { kept, dropped };
}

function toSpanDiagnostics(scored: ScoredSpan): FwSpanDiagnostics {
  return {
    text: scored.text,
    start: scored.start,
    end: scored.end,
    domain: scored.domain,
    riskScore: scored.riskScore,
    signals: scored.signals,
    riskScoreBreakdown: scored.riskScoreBreakdown,
    candidates: scored.candidates,
    applied: scored.applied,
    detectorHint: scored.detectorHint,
  };
}

export function detectSuspiciousSpansV1(
  rawText: string,
  config: FwDetectorRuntimeConfig,
  segments?: SegmentInfo[],
  hintFn?: SpanDetectorHintFn
): DetectSuspiciousSpansResult {
  const text = rawText.trim();
  if (!text) {
    return {
      spans: [],
      spanSelection: { enumeratedCount: 0, keptCount: 0, dropped: [] },
    };
  }

  const candidates = enumerateCjkSpans(text, config.minSpanChars, config.maxSpanChars);
  const scored = candidates.map((span) => scoreSpan(text, span, config, segments, hintFn));
  const { kept, dropped } = selectSpansForPipeline(
    scored,
    config.spanDetectBudget,
    config.minRiskScore
  );

  return {
    spans: kept.map(toSpanDiagnostics),
    spanSelection: {
      enumeratedCount: candidates.length,
      keptCount: kept.length,
      dropped,
    },
  };
}
