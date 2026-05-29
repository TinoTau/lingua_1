/**
 * KenLM span gate — single-candidate API and multi-candidate batch (FW P1.2b).
 * All KenLM veto decisions go through evaluateKenlmDecision + scoreSpanCandidateSentences.
 */

import { applySingleSpanReplacement } from '../lexicon/selector/applySpanReplacements';
import type { KenLMScorer, KenlmTimingStats } from './sentence-rerank/types';
import type {
  FwKenlmGateDiag,
  FwKenlmGateReason,
  FwTextSpan,
  KenlmGateMode,
  KenlmSpanGateOptions,
} from '../fw-detector/types';

export type KenlmDecisionInput = {
  delta: number;
  mode: KenlmGateMode;
  deltaThreshold: number;
  vetoThreshold: number;
};

export type KenlmDecisionResult = {
  approved: boolean;
  vetoed: boolean;
  reason: FwKenlmGateReason;
};

export type KenlmCandidateScore = {
  candidateIndex: number;
  delta: number;
  baselineNorm: number;
  candidateNorm: number;
  approved: boolean;
  vetoed: boolean;
  reason: FwKenlmGateReason;
};

export type SpanKenlmBatchResult = {
  baselineNorm: number;
  candidates: KenlmCandidateScore[];
  timing?: KenlmTimingStats;
  unavailable: boolean;
};

export function evaluateKenlmDecision(input: KenlmDecisionInput): KenlmDecisionResult {
  if (input.mode === 'hard_gate') {
    const approved = input.delta >= input.deltaThreshold;
    return {
      approved,
      vetoed: !approved,
      reason: approved ? 'approved_hard_gate' : 'below_delta_threshold',
    };
  }

  const vetoed = input.delta < input.vetoThreshold;
  return {
    approved: !vetoed,
    vetoed,
    reason: vetoed ? 'vetoed_worse_than_threshold' : 'not_worse_than_threshold',
  };
}

function buildDisabledDiag(options: KenlmSpanGateOptions): FwKenlmGateDiag {
  return {
    enabled: false,
    mode: options.mode,
    approved: true,
    vetoed: false,
    delta: 0,
    deltaThreshold: options.deltaThreshold,
    vetoThreshold: options.vetoThreshold,
    baselineNorm: 0,
    candidateNorm: 0,
    reason: 'kenlm_disabled',
  };
}

function buildUnavailableDiag(options: KenlmSpanGateOptions): FwKenlmGateDiag {
  return {
    enabled: true,
    mode: options.mode,
    approved: false,
    vetoed: true,
    delta: 0,
    deltaThreshold: options.deltaThreshold,
    vetoThreshold: options.vetoThreshold,
    baselineNorm: 0,
    candidateNorm: 0,
    reason: 'kenlm_unavailable',
  };
}

function disabledKenlmForIndex(
  options: KenlmSpanGateOptions,
  candidateIndex: number
): KenlmCandidateScore {
  return {
    candidateIndex,
    delta: 0,
    baselineNorm: 0,
    candidateNorm: 0,
    approved: true,
    vetoed: false,
    reason: 'kenlm_disabled',
  };
}

function unavailableKenlm(candidateIndex: number): KenlmCandidateScore {
  return {
    candidateIndex,
    delta: 0,
    baselineNorm: 0,
    candidateNorm: 0,
    approved: false,
    vetoed: true,
    reason: 'kenlm_unavailable',
  };
}

export function kenlmCandidateScoreToGateDiag(
  row: KenlmCandidateScore,
  options: KenlmSpanGateOptions
): FwKenlmGateDiag {
  return {
    enabled: options.enabled,
    mode: options.mode,
    approved: row.approved,
    vetoed: row.vetoed,
    delta: row.delta,
    deltaThreshold: options.deltaThreshold,
    vetoThreshold: options.vetoThreshold,
    baselineNorm: row.baselineNorm,
    candidateNorm: row.candidateNorm,
    reason: row.reason,
  };
}

/** Batch: scoreBatch([rawText, ...candidateSentences]) + weak_veto / hard_gate per candidate. */
export async function scoreSpanCandidateSentences(
  scorer: KenLMScorer | null,
  rawText: string,
  candidateSentences: string[],
  options: KenlmSpanGateOptions
): Promise<SpanKenlmBatchResult> {
  if (!options.enabled) {
    return {
      baselineNorm: 0,
      candidates: candidateSentences.map((_, i) => disabledKenlmForIndex(options, i)),
      unavailable: false,
    };
  }

  if (!scorer || candidateSentences.length === 0) {
    const rows =
      candidateSentences.length === 0
        ? []
        : candidateSentences.map((_, i) => unavailableKenlm(i));
    return {
      baselineNorm: 0,
      candidates: rows,
      unavailable: candidateSentences.length > 0,
    };
  }

  try {
    const sentences = [rawText, ...candidateSentences];
    const { scores, timing } = await scorer.scoreBatch(sentences);
    const baselineNorm = scores[0]?.normalizedScore ?? 0;

    const candidates: KenlmCandidateScore[] = candidateSentences.map((_, i) => {
      const candidateNorm = scores[i + 1]?.normalizedScore ?? 0;
      const delta = candidateNorm - baselineNorm;
      const decision = evaluateKenlmDecision({
        delta,
        mode: options.mode,
        deltaThreshold: options.deltaThreshold,
        vetoThreshold: options.vetoThreshold,
      });
      return {
        candidateIndex: i,
        delta,
        baselineNorm,
        candidateNorm,
        approved: decision.approved,
        vetoed: decision.vetoed,
        reason: decision.reason,
      };
    });

    return { baselineNorm, candidates, timing, unavailable: false };
  } catch {
    return {
      baselineNorm: 0,
      candidates: candidateSentences.map((_, i) => ({
        candidateIndex: i,
        delta: 0,
        baselineNorm: 0,
        candidateNorm: 0,
        approved: false,
        vetoed: true,
        reason: 'kenlm_error',
      })),
      unavailable: true,
    };
  }
}

function buildScoredDiag(
  options: KenlmSpanGateOptions,
  row: KenlmCandidateScore
): FwKenlmGateDiag {
  return kenlmCandidateScoreToGateDiag(row, options);
}

/** Single-candidate gate — thin wrapper over scoreSpanCandidateSentences. */
export async function gateSpanReplacement(
  scorer: KenLMScorer | null,
  fullText: string,
  span: FwTextSpan,
  candidateText: string,
  options: KenlmSpanGateOptions
): Promise<FwKenlmGateDiag> {
  if (!options.enabled) {
    return buildDisabledDiag(options);
  }
  if (!scorer) {
    return buildUnavailableDiag(options);
  }

  const candidateSentence = applySingleSpanReplacement(
    fullText,
    span.start,
    span.end,
    candidateText
  );
  const batch = await scoreSpanCandidateSentences(scorer, fullText, [candidateSentence], options);
  const row = batch.candidates[0];
  if (!row) {
    return buildUnavailableDiag(options);
  }
  return buildScoredDiag(options, row);
}
