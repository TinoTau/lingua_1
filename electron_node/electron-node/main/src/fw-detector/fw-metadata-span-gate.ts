/**
 * P3.3 — FW Metadata Span Gate: ASR word probability / avg_logprob / alias exact hit.
 * No KenLM span scan. No lexicon recall in this module.
 */

import { scanAliasExactHitsInText } from '../lexicon/alias-span-scan';
import type { SegmentInfo } from '../task-router/types';
import type { FwMetadataSpanGateRuntimeConfig } from './fw-config';
import type { FwDetectorSignal, FwMetadataSpanGateDiagnostics, FwSpanDiagnostics } from './types';

const CJK_CHAR = /[\u4e00-\u9fff\u3400-\u4dbf]/;

export type FwMetadataSpanCandidate = {
  text: string;
  start: number;
  end: number;
  riskScore: number;
  signals: FwDetectorSignal[];
  priority: number;
};

export type FwMetadataSpanGateInput = {
  text: string;
  segments?: SegmentInfo[];
  aliasKeys: readonly string[];
  config: FwMetadataSpanGateRuntimeConfig;
  legacyFallback?: () => FwSpanDiagnostics[];
};

export type FwMetadataSpanGateResult = {
  spans: FwMetadataSpanCandidate[];
  diagnostics: FwMetadataSpanGateDiagnostics;
};

function findSegmentOffset(text: string, segmentText: string, fromIndex: number): number {
  const trimmed = segmentText.trim();
  if (!trimmed) {
    return fromIndex;
  }
  const idx = text.indexOf(trimmed, fromIndex);
  return idx >= 0 ? idx : fromIndex;
}

function spansOverlap(a: FwMetadataSpanCandidate, b: FwMetadataSpanCandidate): boolean {
  return a.end > b.start && b.end > a.start;
}

function mergeSpanSignals(
  target: FwMetadataSpanCandidate,
  extra: FwMetadataSpanCandidate
): void {
  for (const signal of extra.signals) {
    if (!target.signals.includes(signal)) {
      target.signals.push(signal);
    }
  }
  target.riskScore = Math.max(target.riskScore, extra.riskScore);
  target.priority = Math.max(target.priority, extra.priority);
}

function selectTopSpans(candidates: FwMetadataSpanCandidate[], maxSpans: number): FwMetadataSpanCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    if (a.riskScore !== b.riskScore) {
      return b.riskScore - a.riskScore;
    }
    return b.text.length - a.text.length;
  });

  const kept: FwMetadataSpanCandidate[] = [];
  for (const candidate of sorted) {
    if (kept.some((existing) => spansOverlap(existing, candidate))) {
      const overlap = kept.find((existing) => spansOverlap(existing, candidate));
      if (overlap && candidate.priority > overlap.priority) {
        mergeSpanSignals(overlap, candidate);
      }
      continue;
    }
    kept.push({ ...candidate, signals: [...candidate.signals] });
    if (kept.length >= maxSpans) {
      break;
    }
  }
  return kept;
}

function collectAliasSpans(
  text: string,
  aliasKeys: readonly string[],
  config: FwMetadataSpanGateRuntimeConfig
): FwMetadataSpanCandidate[] {
  if (!config.allowAliasExactHit) {
    return [];
  }
  return scanAliasExactHitsInText(text, aliasKeys, config.maxSpans).map((hit) => ({
    text: hit.text,
    start: hit.start,
    end: hit.end,
    riskScore: 3,
    signals: ['alias_exact_hit' as FwDetectorSignal],
    priority: 3,
  }));
}

function collectLowWordProbabilitySpans(
  text: string,
  segments: SegmentInfo[] | undefined,
  config: FwMetadataSpanGateRuntimeConfig
): { spans: FwMetadataSpanCandidate[]; wordCount: number; lowCount: number; alignmentFailures: number } {
  const spans: FwMetadataSpanCandidate[] = [];
  let wordCount = 0;
  let lowCount = 0;
  let alignmentFailures = 0;

  if (!segments?.length) {
    return { spans, wordCount, lowCount, alignmentFailures };
  }

  let segmentSearchFrom = 0;
  for (const segment of segments) {
    const words = segment.words;
    if (!words?.length) {
      continue;
    }

    const segmentOffset = findSegmentOffset(text, segment.text, segmentSearchFrom);
    const segmentText = text.slice(segmentOffset, segmentOffset + segment.text.trim().length);
    let cursor = 0;

    for (const wordInfo of words) {
      const token = (wordInfo.word ?? '').trim();
      if (!token) {
        continue;
      }
      wordCount += 1;

      const localIdx = segmentText.indexOf(token, cursor);
      if (localIdx < 0) {
        alignmentFailures += 1;
        continue;
      }

      const start = segmentOffset + localIdx;
      const end = start + token.length;
      cursor = localIdx + token.length;

      const probability = wordInfo.probability;
      if (probability == null || probability >= config.wordProbabilityThreshold) {
        continue;
      }

      if (end - start < config.minSpanChars || end - start > config.maxSpanChars) {
        if (token.length >= config.minSpanChars && token.length <= config.maxSpanChars) {
          lowCount += 1;
          spans.push({
            text: token,
            start,
            end,
            riskScore: 1 - probability,
            signals: ['low_word_probability'],
            priority: 2,
          });
        }
        continue;
      }

      if (![...token].every((ch) => CJK_CHAR.test(ch))) {
        continue;
      }

      lowCount += 1;
      spans.push({
        text: token,
        start,
        end,
        riskScore: 1 - probability,
        signals: ['low_word_probability'],
        priority: 2,
      });
    }

    segmentSearchFrom = segmentOffset + Math.max(segment.text.trim().length, 1);
  }

  return { spans, wordCount, lowCount, alignmentFailures };
}

function segmentHasLowAvgLogprob(segments: SegmentInfo[] | undefined, threshold: number): boolean {
  if (!segments?.length) {
    return false;
  }
  return segments.some(
    (seg) => seg.avg_logprob != null && seg.avg_logprob < threshold
  );
}

function segmentWordsMissing(segments: SegmentInfo[] | undefined): boolean {
  if (!segments?.length) {
    return true;
  }
  return segments.every((seg) => !seg.words?.length);
}

function mapLegacyFallbackSpans(spans: FwSpanDiagnostics[]): FwMetadataSpanCandidate[] {
  return spans
    .filter((span) => !span.signals.includes('detector_pinyin_hint'))
    .map((span) => ({
      text: span.text,
      start: span.start,
      end: span.end,
      riskScore: span.riskScore,
      signals: span.signals.filter((s) => s !== 'detector_pinyin_hint'),
      priority: 1,
    }));
}

export function selectFwMetadataSpans(input: FwMetadataSpanGateInput): FwMetadataSpanGateResult {
  const startMs = Date.now();
  const text = input.text.trim();
  const { config, segments, aliasKeys } = input;

  if (!text) {
    return {
      spans: [],
      diagnostics: {
        enabled: true,
        mode: 'fw_metadata_gate',
        wordCount: 0,
        lowConfidenceWordCount: 0,
        aliasHitCount: 0,
        selectedCount: 0,
        alignmentFailures: 0,
        fwMetadataGateMs: Date.now() - startMs,
        skippedReason: 'empty_text',
      },
    };
  }

  if (!config.enabled) {
    return {
      spans: [],
      diagnostics: {
        enabled: true,
        mode: 'fw_metadata_gate',
        wordCount: 0,
        lowConfidenceWordCount: 0,
        aliasHitCount: 0,
        selectedCount: 0,
        alignmentFailures: 0,
        fwMetadataGateMs: Date.now() - startMs,
        skippedReason: 'disabled',
      },
    };
  }

  const aliasSpans = collectAliasSpans(text, aliasKeys, config);
  const wordStats = collectLowWordProbabilitySpans(text, segments, config);
  let candidates = [...aliasSpans, ...wordStats.spans];
  let usedLegacyFallback = false;

  /**
   * Legacy fallback (NOT the main path).
   * Triggers only when ALL of:
   * - no alias / low_word_probability candidates yet
   * - allowSegmentFallbackScan === true
   * - segment avg_logprob below threshold AND (words missing OR alignment failures)
   * Then calls suspicious-span-detector-v1 via orchestrator callback; max spans =
   * fallbackLegacyMaxSpans (default 1). detector_pinyin_hint spans are stripped.
   * Primary signals remain: alias exact hit + ASR word probability metadata.
   */
  const needsFallback =
    candidates.length === 0 &&
    config.allowSegmentFallbackScan &&
    segmentHasLowAvgLogprob(segments, config.segmentAvgLogprobThreshold) &&
    (segmentWordsMissing(segments) || wordStats.alignmentFailures > 0);

  if (needsFallback && input.legacyFallback) {
    const legacySpans = mapLegacyFallbackSpans(input.legacyFallback()).slice(
      0,
      config.fallbackLegacyMaxSpans
    );
    if (legacySpans.length > 0) {
      candidates = legacySpans;
      usedLegacyFallback = true;
    }
  }

  const selected = selectTopSpans(candidates, config.maxSpans);

  let skippedReason: FwMetadataSpanGateDiagnostics['skippedReason'];
  if (selected.length === 0) {
    if (!segments?.length && aliasSpans.length === 0) {
      skippedReason = 'no_metadata';
    } else {
      skippedReason = 'all_signals_normal';
    }
  }

  return {
    spans: selected,
    diagnostics: {
      enabled: true,
      mode: 'fw_metadata_gate',
      wordCount: wordStats.wordCount,
      lowConfidenceWordCount: wordStats.lowCount,
      aliasHitCount: aliasSpans.length,
      selectedCount: selected.length,
      alignmentFailures: wordStats.alignmentFailures,
      fwMetadataGateMs: Date.now() - startMs,
      skippedReason,
      usedLegacyFallback,
    },
  };
}
