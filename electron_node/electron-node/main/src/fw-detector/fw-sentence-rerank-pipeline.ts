/**
 * P4 — sentence-level KenLM rerank pipeline (replaces per-span greedy pick when enabled).
 */

import type { KenLMScorer } from '../asr-repair/kenlm-batch-types';
import { recallSpanTopK } from '../lexicon/local-span-recall';
import { toneDistance, textToToneSyllables, toneSyllablesKey } from '../lexicon/phonetic/tone-pinyin';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import {
  buildSentenceCandidates,
  type SpanReplacementPick,
} from './build-sentence-candidates';
import type { FwDetectorRuntimeConfig } from './fw-config';
import { mapSentenceToApprovedReplacements } from './map-sentence-to-approved';
import { getPerSpanCandidateLimit } from './per-span-candidate-limit';
import { rerankFwSentences } from './rerank-fw-sentences';
import { buildCandidateSentence } from './candidate-sentence-builder';
import type {
  FwApprovedReplacement,
  FwDetectorReplacementDiag,
  FwSentenceRerankDiagnostics,
  FwSpanCandidateDiag,
  FwSpanDiagnostics,
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
};

export type FwSentenceRerankResult = {
  spans: FwSpanDiagnostics[];
  approved: FwApprovedReplacement[];
  replacements: FwDetectorReplacementDiag[];
  sentenceRerank: FwSentenceRerankDiagnostics;
  kenlmQueryCount: number;
  kenlmTiming?: FwSentenceRerankDiagnostics['kenlmTiming'];
  pickedTopKWinCount: number;
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

  for (const span of input.spans) {
    const asrToneKey = toneSyllablesKey(textToToneSyllables(span.text));
    const recall = recallSpanTopK(
      span.text,
      input.profile,
      perSpanLimit,
      input.config.minPrior,
      input.enabledDomains,
      { perSpanLimit }
    );

    const picks: SpanReplacementPick[] = recall.hits
      .filter((h) => h.word !== span.text)
      .map((hit) => ({
        span: { text: span.text, start: span.start, end: span.end },
        word: hit.word,
        source: hit.source,
        priorScore: hit.priorScore,
        repairTarget: hit.repairTarget,
        candidateScore: hit.candidateScore,
        toneDistance: hit.tonePinyinKey
          ? toneDistance(asrToneKey, hit.tonePinyinKey)
          : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => {
        if (a.toneDistance !== b.toneDistance) {
          return a.toneDistance - b.toneDistance;
        }
        if (a.priorScore !== b.priorScore) {
          return b.priorScore - a.priorScore;
        }
        return b.candidateScore - a.candidateScore;
      })
      .map(({ toneDistance: _toneDistance, ...pick }) => pick);

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
