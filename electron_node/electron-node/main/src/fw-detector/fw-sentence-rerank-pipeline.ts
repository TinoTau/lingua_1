/**
 * P4 — sentence-level KenLM rerank pipeline (replaces per-span greedy pick when enabled).
 */

import type { KenLMScorer } from '../asr-repair/kenlm-batch-types';
import { recallSpanTopK } from '../lexicon/local-span-recall';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import type { UtteranceTonePayload } from '../task-router/types';
import {
  buildSentenceCandidates,
  type SpanReplacementPick,
} from './build-sentence-candidates';
import type { FwDetectorRuntimeConfig } from './fw-config';
import { mapSentenceToApprovedReplacements } from './map-sentence-to-approved';
import { getPerSpanCandidateLimit } from './per-span-candidate-limit';
import { rerankFwSentences } from './rerank-fw-sentences';
import { buildCandidateSentence } from './candidate-sentence-builder';
import {
  extractAcousticTonePattern,
  isToneAlignmentValid,
} from './tone-match-score';
import type {
  FwApprovedReplacement,
  FwDetectorReplacementDiag,
  FwSentenceRerankDiagnostics,
  FwSpanCandidateDiag,
  FwSpanDiagnostics,
  FwToneModuleDiagnostics,
} from './types';

export type FwSentenceRerankInput = {
  rawText: string;
  spans: FwSpanDiagnostics[];
  profile: ActiveLexiconProfileSnapshot;
  config: Pick<
    FwDetectorRuntimeConfig,
    | 'minPrior'
    | 'maxSentenceCandidates'
    | 'minDeltaToReplace'
    | 'candidateRequireRepairTarget'
  >;
  enabledDomains: string[];
  kenlmScorer: KenLMScorer | null;
  tone?: UtteranceTonePayload | null;
};

export type FwSentenceRerankResult = {
  spans: FwSpanDiagnostics[];
  approved: FwApprovedReplacement[];
  replacements: FwDetectorReplacementDiag[];
  sentenceRerank: FwSentenceRerankDiagnostics;
  kenlmQueryCount: number;
  kenlmTiming?: FwSentenceRerankDiagnostics['kenlmTiming'];
  pickedTopKWinCount: number;
  toneDiagnostics?: FwToneModuleDiagnostics;
};

function hitToSpanCandidate(
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

export async function runFwSentenceRerankPipeline(
  input: FwSentenceRerankInput
): Promise<FwSentenceRerankResult> {
  const perSpanLimit = getPerSpanCandidateLimit(input.spans.length);
  const spanSets: SpanReplacementPick[][] = [];
  const updatedSpans: FwSpanDiagnostics[] = [];
  const alignmentTextMatched = isToneAlignmentValid(input.rawText, input.tone);
  let recallToneCompatibleCount = 0;
  let recallToneFallbackCount = 0;
  let lastAcousticPattern: number[] | null = null;

  for (const span of input.spans) {
    const acousticTonePattern =
      extractAcousticTonePattern(input.rawText, span.start, span.end, input.tone) ?? undefined;
    if (acousticTonePattern?.length) {
      lastAcousticPattern = acousticTonePattern;
    }

    const recall = recallSpanTopK(
      span.text,
      input.profile,
      perSpanLimit,
      input.config.minPrior,
      input.enabledDomains,
      { perSpanLimit, acousticTonePattern }
    );

    recallToneCompatibleCount += recall.recallToneCompatibleCount ?? 0;
    recallToneFallbackCount += recall.recallToneFallbackCount ?? 0;

    const picks: SpanReplacementPick[] = recall.hits
      .filter((h) => h.word !== span.text)
      .map((hit) => ({
        span: { text: span.text, start: span.start, end: span.end },
        word: hit.word,
        source: hit.source,
        priorScore: hit.priorScore,
        repairTarget: hit.repairTarget,
        candidateScore: hit.candidateScore,
      }));

    spanSets.push(picks);

    const candidates = picks.map((pick, index) =>
      hitToSpanCandidate(input.rawText, pick, index)
    );
    updatedSpans.push({ ...span, candidates });
  }

  const combinations = buildSentenceCandidates(
    input.rawText,
    spanSets,
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
  };

  const toneDiagnostics: FwToneModuleDiagnostics = {
    toneEnabled: input.tone?.toneEnabled === true && alignmentTextMatched,
    alignmentTextMatched,
    acousticTonePattern: lastAcousticPattern ?? undefined,
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
