/**
 * V4 Sentence Candidate Rerank from prefilled span candidates (no second recall).
 */

import type { KenLMScorer } from '../../asr-repair/kenlm-batch-types';
import type { UtteranceAcousticTonePayload } from '../../task-router/types';
import {
  buildSentenceCandidates,
  type SpanReplacementPick,
} from '../build-sentence-candidates';
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
  FwToneModuleDiagnostics,
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
  toneDiagnostics?: FwToneModuleDiagnostics;
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
  let recallToneCompatibleCount = 0;
  let recallToneFallbackCount = 0;

  for (let i = 0; i < input.spans.length; i++) {
    const span = input.spans[i];
    const picks = input.spanSets[i] ?? [];

    const candidates = picks.map((pick, index) => pickToSpanCandidate(input.rawText, pick, index));
    updatedSpans.push({ ...span, candidates });
  }

  const combinations = buildSentenceCandidates(
    input.rawText,
    input.spanSets,
    input.config.maxSentenceCandidates
  );

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
    const approvedKeys = new Set(approved.map((r) => `${r.start}:${r.end}`));
    for (const span of updatedSpans) {
      const pick = rerank.picked.replacements.find(
        (r) => r.span.start === span.start && r.span.end === span.end
      );
      if (pick) {
        const idx = span.candidates.findIndex((c) => c.word === pick.word);
        if (idx >= 0) {
          span.candidates[idx].selected = true;
          span.selectedCandidateIndex = idx;
        }
      }
      span.applied = approvedKeys.has(`${span.start}:${span.end}`);
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
  };

  const toneDiagnostics: FwToneModuleDiagnostics = {
    toneEnabled: false,
    alignmentTextMatched: false,
    recallToneCompatibleCount,
    recallToneFallbackCount,
  };

  return {
    spans: updatedSpans,
    approved,
    replacements: buildReplacementDiags(updatedSpans, approved, rerank.maxDelta),
    sentenceRerank,
    kenlmQueryCount: rerank.kenlmQueryCount,
    kenlmTiming: rerank.kenlmTiming,
    pickedTopKWinCount: approved.length,
    toneDiagnostics,
  };
}
