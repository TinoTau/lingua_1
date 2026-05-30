import type { ASRHypothesis } from '../../../../asr/types';
import type { JobContext } from '../../../../pipeline/context/job-context';
import { computeScoreBreakdown } from './score-breakdown';
import { computeHistoricalPickedReason, resolveTop1HypothesisIndex } from './picked-reason';
import { DEFAULT_RERANK_WEIGHTS, type KenlmTimingStats, type SentenceRerankResult } from './types';
import type { RestoreMetrics } from '../restore-metrics';
import type { SentenceCandidate } from '../sentence-expansion/types';

export type SentenceRepairExtra = {
  executed: boolean;
  modified: boolean;
  candidateSource: string;
  restore_metrics: RestoreMetrics;
  selectedText: string;
  baselineText: string;
  hypothesisIndex: number;
  top1HypothesisIndex: number;
  pickedReason: string;
  skipReason?: string | null;
  replacements: Array<{
    from: string;
    to: string;
    start: number;
    end: number;
    phoneticScore?: number;
    hotwordId?: string;
  }>;
  combinedScore?: number;
  kenlmScore?: number;
  kenlmTiming?: KenlmTimingStats;
  rerankMs?: number;
  nearTieDiagnostics?: SentenceRerankResult['nearTieDiagnostics'];
};

export function buildSentenceRepairExtra(input: {
  ctx: JobContext;
  rerank: SentenceRerankResult;
  baselineText: string;
  executed: boolean;
  hypotheses?: ASRHypothesis[];
  restoreMetrics?: RestoreMetrics;
}): SentenceRepairExtra | undefined {
  const picked = input.rerank.picked;
  if (!picked) {
    return undefined;
  }

  const top1HypothesisIndex = resolveTop1HypothesisIndex(input.hypotheses ?? input.ctx.asrHypotheses);
  const modified = picked.text.trim() !== input.baselineText.trim();
  const pickedReason = computeHistoricalPickedReason(picked);

  const restore_metrics =
    input.restoreMetrics ?? input.ctx.restoreMetrics ?? {
      phonetic_expanded_sentence_candidates_count: 0,
      picked_from_phonetic_expansion_count: 0,
      picked_from_raw_ctc_nbest_count: 0,
      candidate_source_distribution: {
        raw_ctc_baseline: 0,
        window_single: 0,
        window_pair: 0,
        window_multi: 0,
      },
    };

  return {
    executed: input.executed,
    modified,
    candidateSource: picked.candidateSource,
    restore_metrics,
    selectedText: picked.text,
    baselineText: input.baselineText,
    hypothesisIndex: picked.hypothesisIndex,
    top1HypothesisIndex,
    pickedReason,
    skipReason: null,
    replacements: picked.replacements.map((r) => ({
      from: r.from,
      to: r.to,
      start: r.start,
      end: r.end,
      phoneticScore: r.phoneticScore,
      hotwordId: r.hotwordId,
    })),
    combinedScore: picked.combinedScore ?? computeScoreBreakdown(picked, DEFAULT_RERANK_WEIGHTS).combined,
    kenlmScore: picked.kenlmScore,
    kenlmTiming: input.rerank.kenlmTiming,
    rerankMs: input.rerank.rerankMs,
    nearTieDiagnostics: input.rerank.nearTieDiagnostics,
  };
}
