/**
 * P1.2b 唯一决策链：recall topK → candidateSentence → KenLM batch weak veto → finalScore → D-greedy pick.
 * orchestrator 只负责 detect / runtime / apply，不得在此文件之外再做 topK 决策。
 */

import type { KenLMScorer, KenlmTimingStats } from '../asr-repair/sentence-rerank/types';
import {
  kenlmCandidateScoreToGateDiag,
  scoreSpanCandidateSentences,
} from '../asr-repair/kenlm-span-gate';
import type { LexiconRuntime } from '../lexicon/lexicon-runtime';
import { recallSpanTopK } from '../lexicon/local-span-recall';
import type { LocalSpanRecallHit } from '../lexicon/local-span-recall';
import { matchEnabledDomain } from '../lexicon/domain-filter';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { buildCandidateSentencesForSpan } from './candidate-sentence-builder';
import { computeCandidateFinalScore } from './candidate-scorer';
import type { FinalScoreWeights, FwDetectorRuntimeConfig } from './fw-config';
import {
  markSelectedCandidates,
  pickApprovedReplacementsGreedy,
  pickBestCandidatePerSpan,
} from './pick-approved-replacements';
import type {
  FwApprovedReplacement,
  FwCandidateVetoReason,
  FwDetectorReplacementDiag,
  FwSpanCandidateDiag,
  FwSpanDiagnostics,
  KenlmSpanGateOptions,
} from './types';

export type FwTopKDecisionInput = {
  rawText: string;
  spans: FwSpanDiagnostics[];
  runtime: LexiconRuntime;
  profile: ActiveLexiconProfileSnapshot;
  config: Pick<
    FwDetectorRuntimeConfig,
    'topK' | 'minPrior' | 'finalScoreWeights' | 'candidateRequireRepairTarget' | 'repairTargetScoreBoost'
  >;
  enabledDomains: string[];
  kenlmScorer: KenLMScorer | null;
  gateOptions: KenlmSpanGateOptions;
};

export type FwTopKDecisionResult = {
  spans: FwSpanDiagnostics[];
  approved: FwApprovedReplacement[];
  replacements: FwDetectorReplacementDiag[];
  kenlmTiming?: KenlmTimingStats;
  kenlmQueryCount: number;
  pickedTopKWinCount: number;
};

function vetoReasonFromKenlm(
  kenlmEnabled: boolean,
  reason: string | undefined
): FwCandidateVetoReason | undefined {
  if (!kenlmEnabled || !reason) {
    return undefined;
  }
  if (reason === 'kenlm_unavailable' || reason === 'kenlm_error' || reason === 'kenlm_veto') {
    return reason === 'kenlm_veto' ? 'kenlm_veto' : reason;
  }
  if (reason === 'vetoed_worse_than_threshold' || reason === 'below_delta_threshold') {
    return 'kenlm_veto';
  }
  return undefined;
}

function scoreRecallHits(
  rawText: string,
  span: FwSpanDiagnostics,
  hits: LocalSpanRecallHit[],
  enabledDomains: string[],
  weights: FinalScoreWeights,
  repairTargetScoreBoost: number,
  kenlmScorer: KenLMScorer | null,
  gateOptions: KenlmSpanGateOptions
): Promise<{
  candidates: FwSpanCandidateDiag[];
  kenlmQueryCount: number;
  timing?: KenlmTimingStats;
}> {
  const recallHits = hits.filter((h) => h.word !== span.text);
  if (recallHits.length === 0) {
    return Promise.resolve({ candidates: [], kenlmQueryCount: 0 });
  }

  const words = recallHits.map((h) => h.word);
  const textSpan = { text: span.text, start: span.start, end: span.end };
  const sentences = buildCandidateSentencesForSpan(rawText, textSpan, words);

  return scoreSpanCandidateSentences(kenlmScorer, rawText, sentences, gateOptions).then(
    (kenlmBatch) => {
      const kenlmEnabled = gateOptions.enabled;
      const candidates: FwSpanCandidateDiag[] = recallHits.map((hit, index) => {
        const domains = hit.domains ?? [];
        const domainMatched = matchEnabledDomain(domains, enabledDomains);
        const kenlmRow = kenlmBatch.candidates[index];
        const vetoed = kenlmEnabled && (kenlmRow?.vetoed ?? true);
        const kenlmReason = kenlmRow?.reason as FwCandidateVetoReason | undefined;
        const scoreBreakdown = computeCandidateFinalScore(
          {
            phoneticScore: hit.phoneticScore,
            priorScore: hit.priorScore,
            domainMatched,
            kenlmDelta: kenlmRow?.delta ?? 0,
            kenlmEnabled,
          },
          weights
        );
        const repairBoost =
          hit.repairTarget === true && repairTargetScoreBoost > 0 ? repairTargetScoreBoost : 0;
        const baseFinalScore = scoreBreakdown.finalScore + repairBoost;

        return {
          candidateIndex: index,
          word: hit.word,
          priorScore: hit.priorScore,
          candidateScore: hit.candidateScore,
          phoneticScore: hit.phoneticScore,
          source: hit.source,
          candidateSentence: sentences[index] ?? '',
          domains,
          domainMatched,
          domainScore: scoreBreakdown.domainScore,
          kenlmDelta: kenlmRow?.delta ?? 0,
          repairTarget: hit.repairTarget,
          finalScoreBreakdown: {
            ...scoreBreakdown,
            repairTargetBoost: repairBoost > 0 ? repairBoost : undefined,
            finalScore: vetoed ? 0 : baseFinalScore,
          },
          finalScore: vetoed ? 0 : baseFinalScore,
          vetoed,
          vetoReason: vetoReasonFromKenlm(kenlmEnabled, kenlmReason),
          kenlm: kenlmRow ? kenlmCandidateScoreToGateDiag(kenlmRow, gateOptions) : undefined,
          selected: false,
        };
      });

      return {
        candidates,
        kenlmQueryCount: kenlmBatch.timing?.queryCount ?? 0,
        timing: kenlmBatch.timing,
      };
    }
  );
}

function mergeKenlmTiming(
  acc: KenlmTimingStats | undefined,
  partial: KenlmTimingStats | undefined
): KenlmTimingStats | undefined {
  if (!partial) {
    return acc;
  }
  if (!acc) {
    return { ...partial };
  }
  return {
    batchMs: acc.batchMs + partial.batchMs,
    queryCount: acc.queryCount + partial.queryCount,
    avgMs: 0,
    p50Ms: Math.max(acc.p50Ms, partial.p50Ms),
    p95Ms: Math.max(acc.p95Ms, partial.p95Ms),
    maxMs: Math.max(acc.maxMs, partial.maxMs),
  };
}

function countPickedTopKWins(spans: FwSpanDiagnostics[], approved: FwApprovedReplacement[]): number {
  let wins = 0;
  for (const repl of approved) {
    const span = spans.find((s) => s.start === repl.start && s.end === repl.end);
    if (!span || span.selectedCandidateIndex == null || span.selectedCandidateIndex === 0) {
      continue;
    }
    wins += 1;
  }
  return wins;
}

function buildReplacementDiags(
  spans: FwSpanDiagnostics[],
  approved: FwApprovedReplacement[]
): FwDetectorReplacementDiag[] {
  const approvedKeys = new Set(approved.map((r) => `${r.start}:${r.end}`));
  const diags: FwDetectorReplacementDiag[] = [];

  for (const span of spans) {
    const selected = span.candidates.find((c) => c.selected);
    if (!selected || selected.word === span.text) {
      continue;
    }
    const key = `${span.start}:${span.end}`;
    const applied = approvedKeys.has(key);
    diags.push({
      before: span.text,
      after: selected.word,
      source: selected.source,
      applied,
      applyBlockedReason: !applied && selected.kenlm?.approved ? 'overlap' : undefined,
      selectedRank: selected.candidateIndex,
      finalScore: selected.finalScore,
      start: span.start,
      end: span.end,
      kenlm: selected.kenlm
        ? {
            approved: selected.kenlm.approved,
            vetoed: selected.kenlm.vetoed,
            mode: selected.kenlm.mode,
            reason: selected.kenlm.reason,
            delta: selected.kenlm.delta,
          }
        : undefined,
    });
  }

  return diags;
}

export async function runFwTopKDecisionPipeline(
  input: FwTopKDecisionInput
): Promise<FwTopKDecisionResult> {
  const spanPicks: ReturnType<typeof pickBestCandidatePerSpan>[] = [];
  let kenlmTiming: KenlmTimingStats | undefined;
  let kenlmQueryCount = 0;

  for (const span of input.spans) {
    const recall = recallSpanTopK(
      input.runtime,
      span.text,
      input.profile,
      input.config.topK,
      input.config.minPrior,
      input.enabledDomains
    );
    const scored = await scoreRecallHits(
      input.rawText,
      span,
      recall.hits,
      input.enabledDomains,
      input.config.finalScoreWeights,
      input.config.repairTargetScoreBoost,
      input.kenlmScorer,
      input.gateOptions
    );

    span.candidates = scored.candidates;
    kenlmTiming = mergeKenlmTiming(kenlmTiming, scored.timing);
    kenlmQueryCount += scored.kenlmQueryCount;

    const pickPool = input.config.candidateRequireRepairTarget
      ? scored.candidates.filter((c) => c.repairTarget === true)
      : scored.candidates;
    const pick = pickBestCandidatePerSpan(
      { text: span.text, start: span.start, end: span.end },
      { domain: span.domain, riskScore: span.riskScore, signals: span.signals },
      pickPool
    );
    if (pick) {
      spanPicks.push(pick);
    }
  }

  const approved = pickApprovedReplacementsGreedy(
    spanPicks.filter((p): p is NonNullable<typeof p> => p != null)
  );
  const approvedKeys = new Set(approved.map((r) => `${r.start}:${r.end}`));

  for (const span of input.spans) {
    const key = `${span.start}:${span.end}`;
    const pick = spanPicks.find(
      (p) => p && p.span.start === span.start && p.span.end === span.end
    );
    const selected = pick?.candidate;
    markSelectedCandidates(span.candidates, selected);
    span.selectedCandidateIndex = selected?.candidateIndex;
    span.applied = approvedKeys.has(key);
  }

  return {
    spans: input.spans,
    approved,
    replacements: buildReplacementDiags(input.spans, approved),
    kenlmTiming,
    kenlmQueryCount,
    pickedTopKWinCount: countPickedTopKWins(input.spans, approved),
  };
}
