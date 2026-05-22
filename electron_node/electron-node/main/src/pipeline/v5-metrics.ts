/**
 * Recover V5 — job-level metrics for result.extra.v5_metrics
 */

import type { JobContext } from './context/job-context';
import type { WindowCandidate } from '../lexicon/hotword-types';
import { isV5SkipReason, type V5SkipReason } from '../asr-repair/recover-safety-gates';
import { getRecoverQualityConfig } from '../recover-quality/quality-config';
import type { SentenceCandidate } from '../asr-repair/sentence-expansion/types';

export type V5Metrics = {
  windows_from_nbest_diff_count: number;
  windows_enumerated: number;
  sliding_window_count: number;
  lexicon_pinyin_topk_candidate_count: number;
  out_of_bundle_candidate_count: number;
  picked_from_raw_ctc_nbest_count: number;
  modified_without_replacement_count: number;
  no_diff_span_count: number;
  skip_reason_v5: Partial<Record<V5SkipReason, number>>;
  topk_hit_rate_by_term_length: Record<string, number>;
  window_length_distribution: Record<number, number>;
  near_pinyin_attempt_count: number;
  sentence_candidate_budget: number;
  edit_distance_penalty_sum: number;
  edit_distance_penalty_samples: number;
};

const TRACE_MAX = 128;

export type LexiconRecallTraceItem = {
  windowText: string;
  windowPinyin: string;
  windowTrigger?: string;
  diffSpanId?: string;
  sourceHypothesisRank?: number;
  candidate: string;
  candidatePinyin: string;
  candidateScore: number;
  priorScore: number;
  phoneticScore: number;
  termLength: number;
  rankInTopK: number;
  source: 'lexicon_pinyin_topk';
  candidateScoreBreakdown?: {
    priorScore: number;
    phoneticSimilarity: number;
    exactLengthBonus: number;
    domainBoost: number;
    editDistancePenalty: number;
  };
  kenlmScore?: number;
  picked?: boolean;
};

export type SentenceCandidateTraceItem = {
  text: string;
  candidateSource: string;
  kenlmScore?: number;
  kenlmNormalizedScore?: number;
  kenlmBaselineDelta?: number;
  combinedScore?: number;
  replacementCount: number;
  picked?: boolean;
};

function computeModifiedWithoutReplacement(ctx: JobContext): number {
  const baseline = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  const finalText = (ctx.repairedText ?? '').trim();
  if (!finalText || finalText === baseline) {
    return 0;
  }
  const replacements =
    ctx.sentenceRepairExtra?.replacements ?? ctx.sentenceRepairDecision?.replacements ?? [];
  if (replacements.length === 0) {
    return 1;
  }
  return 0;
}

function tallyEditDistancePenalty(candidates: WindowCandidate[]): {
  sum: number;
  samples: number;
} {
  let sum = 0;
  let samples = 0;
  for (const c of candidates) {
    const p = c.candidateScoreBreakdown?.editDistancePenalty;
    if (p === undefined || !Number.isFinite(p)) {
      continue;
    }
    sum += p;
    samples += 1;
  }
  return { sum, samples };
}

export function buildV5Metrics(ctx: JobContext): V5Metrics {
  const diag = ctx.windowRecallDiagnostics;
  const candidates = ctx.windowCandidates ?? [];
  const topk = candidates.filter((c) => c.source === 'lexicon_pinyin_topk');
  const skipReason = ctx.repairSkipReason ?? ctx.recoverLifecycleSkipReason;
  const skipV5: Partial<Record<V5SkipReason, number>> = {};
  if (skipReason && isV5SkipReason(skipReason)) {
    skipV5[skipReason] = 1;
  }

  const attempts = diag?.topkAttemptsByTermLength ?? {};
  const hits = diag?.topkHitsByTermLength ?? {};
  const topkHitRate: Record<string, number> = {};
  for (const len of ['2', '3', '4', '5']) {
    const a = attempts[len] ?? 0;
    topkHitRate[len] = a > 0 ? (hits[len] ?? 0) / a : 0;
  }

  const restore = ctx.restoreMetrics;
  const penalty = tallyEditDistancePenalty(topk);
  const quality = getRecoverQualityConfig();

  return {
    windows_from_nbest_diff_count: diag?.windowsFromNbestDiffCount ?? 0,
    windows_enumerated: diag?.windowsEnumerated ?? 0,
    sliding_window_count: diag?.slidingWindowCount ?? 0,
    lexicon_pinyin_topk_candidate_count: topk.length,
    out_of_bundle_candidate_count: diag?.outOfBundleCandidateCount ?? 0,
    picked_from_raw_ctc_nbest_count: restore?.picked_from_raw_ctc_nbest_count ?? 0,
    modified_without_replacement_count: computeModifiedWithoutReplacement(ctx),
    no_diff_span_count: diag?.noDiffSpan ? 1 : 0,
    skip_reason_v5: skipV5,
    topk_hit_rate_by_term_length: topkHitRate,
    window_length_distribution: diag?.windowLengthDistribution ?? {},
    near_pinyin_attempt_count: diag?.nearPinyinAttemptCount ?? 0,
    sentence_candidate_budget: quality.maxSentenceCandidates,
    edit_distance_penalty_sum: penalty.sum,
    edit_distance_penalty_samples: penalty.samples,
  };
}

export function buildLexiconRecallTrace(
  candidates: WindowCandidate[],
  pickedReplacements?: WindowCandidate[]
): { trace: LexiconRecallTraceItem[]; trace_truncated: boolean } {
  const pickedSet = new Set(
    (pickedReplacements ?? []).map((c) => `${c.start}:${c.end}:${c.to}`)
  );
  const trace: LexiconRecallTraceItem[] = [];
  let truncated = false;
  for (const c of candidates) {
    if (c.source !== 'lexicon_pinyin_topk') {
      continue;
    }
    if (trace.length >= TRACE_MAX) {
      truncated = true;
      break;
    }
    trace.push({
      windowText: c.from,
      windowPinyin: (c.windowPinyin ?? []).join(' '),
      windowTrigger: c.windowTrigger,
      diffSpanId: c.diffSpanId,
      sourceHypothesisRank: c.sourceHypothesisRank,
      candidate: c.to,
      candidatePinyin: (c.candidatePinyin ?? []).join(' '),
      candidateScore: c.candidateScore ?? 0,
      priorScore: c.priorScore,
      phoneticScore: c.phoneticScore,
      termLength: c.termLength ?? c.from.length,
      rankInTopK: c.rankInTopK ?? 0,
      source: 'lexicon_pinyin_topk',
      candidateScoreBreakdown: c.candidateScoreBreakdown,
      picked: pickedSet.has(`${c.start}:${c.end}:${c.to}`),
    });
  }
  return { trace, trace_truncated: truncated };
}

export function buildSentenceCandidateTrace(
  candidates: SentenceCandidate[],
  picked?: SentenceCandidate,
  baselineNormalizedLm?: number
): SentenceCandidateTraceItem[] {
  const out: SentenceCandidateTraceItem[] = [];
  const limit = Math.min(candidates.length, TRACE_MAX);
  for (let i = 0; i < limit; i++) {
    const c = candidates[i];
    const norm = c.kenlmNormalizedScore;
    const kenlmBaselineDelta =
      norm !== undefined && baselineNormalizedLm !== undefined
        ? norm - baselineNormalizedLm
        : c.kenlmBaselineDelta;
    out.push({
      text: c.text,
      candidateSource: c.candidateSource,
      kenlmScore: c.kenlmScore,
      kenlmNormalizedScore: c.kenlmNormalizedScore,
      kenlmBaselineDelta,
      combinedScore: c.combinedScore,
      replacementCount: c.replacements.length,
      picked: picked ? c.text === picked.text && c.candidateSource === picked.candidateSource : false,
    });
  }
  return out;
}
