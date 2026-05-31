/**
 * P3.2 — KenLM Span Gate: find 1~2 locally ill-formed spans via delete-span pseudo delta.
 * FW-only; does not replace kenlm-span-gate.ts weak_veto.
 */

import { spansOverlap } from '../lexicon/selector/applySpanReplacements';
import type { KenLMScorer } from './kenlm-batch-types';
import type {
  FwSpanDiagnostics,
  FwTextSpan,
  KenlmSpanGateDiagnostics,
  KenlmSpanGateSkippedReason,
} from '../fw-detector/types';

const CJK_RUN = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;

const DEFAULT_STOPWORDS = new Set([
  '可以',
  '我们',
  '你们',
  '他们',
  '一下',
  '这个',
  '那个',
  '什么',
  '怎么',
  '就是',
  '如果',
  '然后',
  '但是',
  '现在',
  '今天',
  '明天',
  '昨天',
  '需要',
  '大概',
  '应该',
]);

export type KenlmSpanGateConfig = {
  maxSpans: number;
  minSpanChars: number;
  maxSpanChars: number;
  minLocalDelta: number;
  stopwordFilterEnabled: boolean;
  preFilterMaxWindows: number;
};

export type KenlmSpanGateInput = KenlmSpanGateConfig & {
  text: string;
};

export type KenlmSpanGateSpan = FwTextSpan & {
  score: number;
  delta: number;
  reason: 'kenlm_local_low_prob';
};

export type KenlmSpanGateResult = {
  spans: KenlmSpanGateSpan[];
  diagnostics: KenlmSpanGateDiagnostics;
};

export type { KenlmSpanGateDiagnostics, KenlmSpanGateSkippedReason };

export function enumerateCjkWindows(
  text: string,
  minLen: number,
  maxLen: number
): FwTextSpan[] {
  const windows: FwTextSpan[] = [];
  let match: RegExpExecArray | null;
  CJK_RUN.lastIndex = 0;
  while ((match = CJK_RUN.exec(text)) !== null) {
    const runStart = match.index;
    const run = match[0];
    const upper = Math.min(maxLen, run.length);
    for (let len = minLen; len <= upper; len++) {
      for (let i = 0; i <= run.length - len; i++) {
        const slice = run.slice(i, i + len);
        windows.push({
          text: slice,
          start: runStart + i,
          end: runStart + i + len,
        });
      }
    }
  }
  return windows;
}

function deleteSpan(text: string, span: FwTextSpan): string {
  return text.slice(0, span.start) + text.slice(span.end);
}

function isStopword(text: string, stopwords: Set<string>): boolean {
  return stopwords.has(text);
}

function preFilterWindows(windows: FwTextSpan[], maxCount: number): FwTextSpan[] {
  if (windows.length <= maxCount) {
    return windows;
  }
  const sorted = [...windows].sort(
    (a, b) => b.text.length - a.text.length || a.start - b.start
  );
  return sorted.slice(0, maxCount);
}

function selectTopNonOverlapping(
  scored: KenlmSpanGateSpan[],
  maxSpans: number,
  minLocalDelta: number
): KenlmSpanGateSpan[] {
  const eligible = scored
    .filter((s) => s.delta >= minLocalDelta)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.text.length - b.text.length ||
        a.start - b.start
    );

  const selected: KenlmSpanGateSpan[] = [];
  for (const span of eligible) {
    if (selected.length >= maxSpans) {
      break;
    }
    if (selected.some((s) => spansOverlap(s.start, s.end, span.start, span.end))) {
      continue;
    }
    selected.push(span);
  }
  return selected;
}

export function mapKenlmGateSpanToFwSpan(span: KenlmSpanGateSpan): FwSpanDiagnostics {
  return {
    text: span.text,
    start: span.start,
    end: span.end,
    domain: 'general',
    riskScore: span.score,
    signals: ['kenlm_local_low_prob'],
    candidates: [],
    applied: false,
  };
}

function emptyDiagnostics(
  input: KenlmSpanGateInput,
  skippedReason: KenlmSpanGateSkippedReason,
  counts: Partial<KenlmSpanGateDiagnostics> = {}
): KenlmSpanGateDiagnostics {
  return {
    enabled: true,
    mode: 'kenlm_gate_filter',
    enumeratedCount: counts.enumeratedCount ?? 0,
    preFilteredCount: counts.preFilteredCount ?? 0,
    scoredCount: counts.scoredCount ?? 0,
    selectedCount: 0,
    baselineScore: counts.baselineScore ?? 0,
    baselineNorm: counts.baselineNorm ?? 0,
    kenlmSpanGateMs: counts.kenlmSpanGateMs ?? 0,
    kenlmSpanGateQueryCount: counts.kenlmSpanGateQueryCount ?? 0,
    skippedReason,
  };
}

export async function selectKenlmSuspiciousSpans(
  scorer: KenLMScorer | null,
  input: KenlmSpanGateInput
): Promise<KenlmSpanGateResult> {
  const text = input.text.trim();
  if (!text) {
    return {
      spans: [],
      diagnostics: emptyDiagnostics(input, 'empty_text'),
    };
  }

  if (!scorer) {
    return {
      spans: [],
      diagnostics: emptyDiagnostics(input, 'kenlm_unavailable'),
    };
  }

  const stopwords = input.stopwordFilterEnabled ? DEFAULT_STOPWORDS : new Set<string>();
  const enumerated = enumerateCjkWindows(text, input.minSpanChars, input.maxSpanChars);
  const afterStopword = enumerated.filter((w) => !isStopword(w.text, stopwords));
  const preFiltered = preFilterWindows(afterStopword, input.preFilterMaxWindows);

  if (preFiltered.length === 0) {
    return {
      spans: [],
      diagnostics: emptyDiagnostics(input, 'no_low_prob_span', {
        enumeratedCount: enumerated.length,
        preFilteredCount: 0,
      }),
    };
  }

  const gateStartMs = Date.now();
  const variants = preFiltered.map((w) => deleteSpan(text, w));
  const batch = await scorer.scoreBatch([text, ...variants]);
  const gateMs = Date.now() - gateStartMs;

  const baseline = batch.scores[0];
  const baselineNorm = baseline?.normalizedScore ?? 0;
  const baselineScore = baseline?.score ?? 0;

  const scored: KenlmSpanGateSpan[] = preFiltered.map((w, idx) => {
    const variant = batch.scores[idx + 1];
    const delta = (variant?.normalizedScore ?? 0) - baselineNorm;
    return {
      text: w.text,
      start: w.start,
      end: w.end,
      delta,
      score: delta,
      reason: 'kenlm_local_low_prob',
    };
  });

  const selected = selectTopNonOverlapping(scored, input.maxSpans, input.minLocalDelta);
  const skippedReason = selected.length === 0 ? ('no_low_prob_span' as const) : undefined;

  return {
    spans: selected,
    diagnostics: {
      enabled: true,
      mode: 'kenlm_gate_filter',
      enumeratedCount: enumerated.length,
      preFilteredCount: preFiltered.length,
      scoredCount: preFiltered.length,
      selectedCount: selected.length,
      baselineScore,
      baselineNorm,
      kenlmSpanGateMs: gateMs,
      kenlmSpanGateQueryCount: batch.timing?.queryCount ?? preFiltered.length + 1,
      skippedReason,
    },
  };
}
