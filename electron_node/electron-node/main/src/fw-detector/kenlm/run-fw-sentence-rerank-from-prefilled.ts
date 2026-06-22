/**
 * V4 Sentence Candidate Rerank from prefilled span candidates (no second recall).
 */

import type { KenLMScorer } from '../../asr-repair/kenlm-batch-types';
import type { UtteranceAcousticTonePayload } from '../../task-router/types';
import {
  buildSentenceCandidates,
  type CoarseSpanRange,
  type SpanReplacementPick,
} from '../build-sentence-candidates';
import { rawOverlap } from '../span-assembly-v4/classify-overlap-relation';
import type { FwDetectorRuntimeConfig } from '../fw-config';
import { mapSentenceToApprovedReplacements } from '../map-sentence-to-approved';
import { getPerSpanCandidateLimit } from '../per-span-candidate-limit';
import { rerankFwSentences } from '../rerank-fw-sentences';
import { buildCandidateSentence } from '../candidate-sentence-builder';
import type {
  FwApprovedReplacement,
  FwDetectorReplacementDiag,
  FwSentenceRerankDiagnostics,
  FwSpanCandidateDiag,
  FwSpanDiagnostics,
} from '../types';

export type FwSentenceRerankFromPrefilledInput = {
  rawText: string;
  spans: FwSpanDiagnostics[];
  spanSets: SpanReplacementPick[][];
  config: Pick<
    FwDetectorRuntimeConfig,
    | 'minPrior'
    | 'maxSentenceCandidates'
    | 'minDeltaToReplace'
    | 'candidateRequireRepairTarget'
  >;
  kenlmScorer: KenLMScorer | null;
  tone?: UtteranceAcousticTonePayload | null;
};

export type FwSentenceRerankFromPrefilledResult = {
  spans: FwSpanDiagnostics[];
  approved: FwApprovedReplacement[];
  replacements: FwDetectorReplacementDiag[];
  sentenceRerank: FwSentenceRerankDiagnostics;
  kenlmQueryCount: number;
  kenlmTiming?: FwSentenceRerankDiagnostics['kenlmTiming'];
  pickedTopKWinCount: number;
};

function pickToSpanCandidate(
  rawText: string,
  hit: SpanReplacementPick,
  index: number
): FwSpanCandidateDiag {
  return {
    candidateIndex: index,
    word: hit.word,
    priorScore: hit.priorScore,
    candidateScore: hit.candidateScore,
    phoneticScore: hit.candidateScore,
    source: hit.source,
    candidateSentence: buildCandidateSentence(rawText, hit.span, hit.word),
    domains: [],
    domainMatched: false,
    domainScore: 0,
    kenlmDelta: 0,
    repairTarget: hit.repairTarget,
    finalScore: hit.candidateScore,
    vetoed: false,
    selected: false,
  };
}

function spanIntervalOverlapsCoarseSpan(
  pick: SpanReplacementPick,
  coarseStart: number,
  coarseEnd: number
): boolean {
  return rawOverlap(pick.span.start, pick.span.end, coarseStart, coarseEnd);
}

function findPickForCoarseSpan(
  replacements: SpanReplacementPick[],
  coarseStart: number,
  coarseEnd: number
): SpanReplacementPick | undefined {
  return replacements.find(
    (r) =>
      r.repairTarget &&
      spanIntervalOverlapsCoarseSpan(r, coarseStart, coarseEnd)
  );
}

function coarseSpanHasApprovedOverlap(
  coarseStart: number,
  coarseEnd: number,
  approved: FwApprovedReplacement[]
): boolean {
  return approved.some((r) => rawOverlap(r.start, r.end, coarseStart, coarseEnd));
}

function buildReplacementDiags(
  spans: FwSpanDiagnostics[],
  approved: FwApprovedReplacement[],
  maxDelta: number
): FwDetectorReplacementDiag[] {
  const approvedKeys = new Set(approved.map((r) => `${r.start}:${r.end}`));
  const diags: FwDetectorReplacementDiag[] = [];

  for (const span of spans) {
    const selected = span.candidates.find((c) => c.selected);
    if (!selected || selected.word === span.text) {
      continue;
    }
    const key = `${span.start}:${span.end}`;
    diags.push({
      before: span.text,
      after: selected.word,
      source: selected.source,
      applied: approvedKeys.has(key),
      selectedRank: selected.candidateIndex,
      finalScore: selected.finalScore,
      start: span.start,
      end: span.end,
      kenlm: {
        approved: approvedKeys.has(key),
        vetoed: false,
        mode: 'weak_veto',
        reason: 'approved_hard_gate',
        delta: maxDelta,
      },
    });
  }
  return diags;
}

export async function runFwSentenceRerankFromPrefilled(
  input: FwSentenceRerankFromPrefilledInput
): Promise<FwSentenceRerankFromPrefilledResult> {
  const perSpanLimit = getPerSpanCandidateLimit(input.spans.length);
  const updatedSpans: FwSpanDiagnostics[] = [];

  for (let i = 0; i < input.spans.length; i++) {
    const span = input.spans[i];
    const picks = input.spanSets[i] ?? [];

    const candidates = picks.map((pick, index) => pickToSpanCandidate(input.rawText, pick, index));
    updatedSpans.push({ ...span, candidates });
  }

  const coarseRanges: CoarseSpanRange[] = input.spans.map((span) => ({
    start: span.start,
    end: span.end,
  }));

  const assembly = buildSentenceCandidates(
    input.rawText,
    input.spanSets,
    input.config.maxSentenceCandidates,
    coarseRanges
  );
  const combinations = assembly.combinations;

  const rerank = await rerankFwSentences(
    input.rawText,
    combinations,
    input.kenlmScorer,
    input.config.minDeltaToReplace
  );

  const approved =
    rerank.pickedIsRaw || !rerank.picked
      ? []
      : mapSentenceToApprovedReplacements(rerank.picked, input.config.candidateRequireRepairTarget);

  if (rerank.picked && !rerank.pickedIsRaw) {
    for (const span of updatedSpans) {
      const pick = findPickForCoarseSpan(
        rerank.picked.replacements,
        span.start,
        span.end
      );
      if (pick) {
        const byWord = span.candidates.findIndex((c) => c.word === pick.word);
        if (byWord >= 0) {
          span.candidates[byWord]!.selected = true;
          span.selectedCandidateIndex = byWord;
        }
      }
      span.applied = coarseSpanHasApprovedOverlap(span.start, span.end, approved);
    }
  }

  const sentenceRerank: FwSentenceRerankDiagnostics = {
    spanCount: input.spans.length,
    perSpanLimit,
    combinationCount: combinations.length,
    kenlmQueryCount: rerank.kenlmQueryCount,
    pickedIsRaw: rerank.pickedIsRaw,
    maxDelta: rerank.maxDelta,
    minDeltaToReplace: input.config.minDeltaToReplace,
    topCandidates: rerank.topCandidates,
    kenlmTiming: rerank.kenlmTiming,
    allCombinationDeltas: rerank.allCombinationDeltas,
    picked: rerank.picked,
    ...(rerank.scoreMode ? { scoreMode: rerank.scoreMode } : {}),
    ...(rerank.baselineRawScore !== undefined ? { baselineRawScore: rerank.baselineRawScore } : {}),
    ...(rerank.pickedRawScore !== undefined ? { pickedRawScore: rerank.pickedRawScore } : {}),
    ...(rerank.maxNormalizedDelta !== undefined ? { maxNormalizedDelta: rerank.maxNormalizedDelta } : {}),
    ...(rerank.kenlmRuntime
      ? {
          kenlmSubprocessMs: rerank.kenlmRuntime.kenlmSubprocessMs,
          kenlmSubprocessCount: rerank.kenlmRuntime.kenlmSubprocessCount,
          kenlmSubprocessErrorReason: rerank.kenlmRuntime.kenlmSubprocessErrorReason,
        }
      : {}),
  };

  return {
    spans: updatedSpans,
    approved,
    replacements: buildReplacementDiags(updatedSpans, approved, rerank.maxDelta),
    sentenceRerank,
    kenlmQueryCount: rerank.kenlmQueryCount,
    kenlmTiming: rerank.kenlmTiming,
    pickedTopKWinCount: approved.length,
  };
}
