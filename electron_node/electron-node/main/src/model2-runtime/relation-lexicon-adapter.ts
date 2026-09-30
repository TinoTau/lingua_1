/**
 * Model2 selected actions → Node LexiconRuntimeV2 recall (ONE retrieval primitive).
 * Does NOT port Python FuzzyPool.
 */

import type { LexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2';
import { recallSpanTopKV2, type RecallSpanTopKV2Hit } from '../lexicon-v2/recall-span-topk-v2';
import type { ActiveLexiconProfileSnapshot } from '../session-runtime/types';
import { V4_LIMITS } from '../fw-detector/span-assembly-v4/v4-limits';
import {
  actionIdToRelations,
  applyRelationsChain,
  hypothesizeIntendedSyllables,
} from './relation-direction';

export type ProfileQueryResult = {
  actionId: string;
  querySyllables: string[];
  pinyinKey: string;
  hits: RecallSpanTopKV2Hit[];
  /** Observation-only: readiness from recallSpanTopKV2 (no gating change). */
  toneRecallReadinessState?: string | null;
};

/**
 * Execute bounded profile retrieval queries from Model2-selected actions.
 * queryBudget caps the number of lexicon queries (not base exactTopK / sentence cap).
 */
export function executeProfileLexiconQueries(args: {
  runtime: LexiconRuntimeV2;
  selectedActions: readonly string[];
  queryBudget: number;
  spanSyllables: readonly string[];
  windowText: string;
  domainIds: readonly string[];
  profile: ActiveLexiconProfileSnapshot;
  /** Profile candidate budget (max hits kept across queries). */
  candBudget?: number;
  /**
   * Acoustic tone pattern for the FineSpan (Batch 1.1C mandatory tone recall).
   * Required for LexiconRuntimeV2 to return hits; tones apply to hypothesized
   * (tone-stripped) query syllables by position.
   */
  acousticTonePattern?: number[];
}): {
  queries: ProfileQueryResult[];
  lexiconLatencyMs: number;
  /** Observation-only aggregates (do not gate retrieval). */
  observability: {
    total_hit_count: number;
    toneRecallReadinessState: string | null;
  };
} {
  const budget = Math.max(0, Math.min(8, Math.floor(args.queryBudget || 0)));
  const candBudget = Math.max(1, Math.min(16, args.candBudget ?? 8));
  const queries: ProfileQueryResult[] = [];
  const t0 = Date.now();
  let kept = 0;
  let totalHitCount = 0;
  let toneRecallReadinessState: string | null = null;

  for (const actionId of args.selectedActions) {
    if (queries.length >= budget) break;
    if (actionId === 'identity') continue;
    const relations = actionIdToRelations(actionId);
    if (!relations.length) continue;

    let querySyllables: string[];
    if (relations.length === 1) {
      const { syllables, nChanged } = hypothesizeIntendedSyllables(
        args.spanSyllables,
        relations[0]!
      );
      if (nChanged <= 0) continue;
      querySyllables = syllables;
    } else {
      // Stage P freeze uses singles only; still support composed without exploding permutations
      querySyllables = applyRelationsChain(args.spanSyllables, relations);
      if (querySyllables.join('|') === args.spanSyllables.map((s) => s.toLowerCase()).join('|')) {
        continue;
      }
    }

    const pinyinKey = querySyllables.join('|');
    const remaining = candBudget - kept;
    if (remaining <= 0) break;

    const tonePattern =
      args.acousticTonePattern &&
      args.acousticTonePattern.length >= querySyllables.length
        ? args.acousticTonePattern.slice(0, querySyllables.length)
        : undefined;

    const result = recallSpanTopKV2(args.runtime, {
      syllables: querySyllables,
      windowText: args.windowText,
      termLength: querySyllables.length,
      topK: Math.min(V4_LIMITS.exactTopK, remaining),
      profile: args.profile,
      domainIds: args.domainIds,
      perSpanLimit: Math.min(V4_LIMITS.exactTopK, remaining),
      fuzzyRecallEnabled: false,
      acousticTonePattern: tonePattern,
    });

    const readinessState =
      result.toneRecallReadiness == null
        ? null
        : typeof result.toneRecallReadiness === 'object' &&
            'state' in result.toneRecallReadiness
          ? String((result.toneRecallReadiness as { state: string }).state)
          : String(result.toneRecallReadiness);
    if (readinessState) toneRecallReadinessState = readinessState;
    totalHitCount += result.hits.length;

    queries.push({
      actionId,
      querySyllables,
      pinyinKey,
      hits: result.hits,
      toneRecallReadinessState: readinessState,
    });
    kept += result.hits.length;
  }

  return {
    queries,
    lexiconLatencyMs: Date.now() - t0,
    observability: {
      total_hit_count: totalHitCount,
      toneRecallReadinessState,
    },
  };
}
