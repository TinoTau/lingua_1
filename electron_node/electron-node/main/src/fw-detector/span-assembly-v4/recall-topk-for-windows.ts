import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { recallSpanTopKV3, type RecallSpanTopKV3Hit } from '../../lexicon-v2/recall-span-topkv3';
import type { WeakDomainRecallPlan } from '../../lexicon-v2/weak-domain-recall-resolver';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import type {
  GraphEdgeSource,
  CoarseAssemblyToneDiagnostics,
  CoarseAssemblyToneExampleWindow,
} from '../span-assembly-shared/types';
import { parentTermSyllableCount } from '../span-assembly-shared/parent-term-slice';
import { createEmptyToneDiagnostics } from '../span-assembly-shared/tone-diagnostics';
import { extractAcousticTonePatternForRecall, resolveTimestampToneState } from '../span-assembly-shared/tone-recall';
import {
  computeToneScoreResult,
  TONE_MATCH_PENALTY,
  type ToneReason,
} from '../tone-match-score';
import type { V4TraceCollector } from './v4-diagnostics-trace';
import type { RecallHitPreFilterTrace } from './v4-diagnostics-types';
import { V4_LIMITS } from './v4-limits';
import type { GlobalWindowDescriptor, WindowCandidate } from './v4-types';

const MAX_EXAMPLE_WINDOWS = 8;

function resolveGraphSource(
  hitSource: string,
  domainId: string | undefined,
  weakPlan?: WeakDomainRecallPlan
): GraphEdgeSource {
  if (domainId && weakPlan?.enabled && weakPlan.weakDomainIds.includes(domainId)) {
    return 'passive_domain_weak';
  }
  if (domainId && domainId !== 'general') {
    return 'domain_term';
  }
  return 'base_term';
}

function recallHitToneFields(
  hit: RecallSpanTopKV3Hit,
  acousticTonePattern: number[] | undefined
): { toneCompatible: boolean; tonePenalty: number; toneReason: ToneReason } {
  if (hit.toneReason !== undefined) {
    return {
      toneCompatible: hit.toneCompatible ?? true,
      tonePenalty: hit.tonePenalty ?? TONE_MATCH_PENALTY,
      toneReason: hit.toneReason,
    };
  }
  const pattern = hit.acousticTonePattern ?? acousticTonePattern;
  const toneKey =
    hit.hitKind === 'parent_fragment'
      ? hit.fragmentTonePinyinKey ?? hit.hotword.tonePinyinKey ?? ''
      : hit.hotword.tonePinyinKey ?? '';
  return computeToneScoreResult(pattern, toneKey, hit.hotword.word);
}

function resolvePreFilterStage(
  minPriorPassed: boolean,
  tonePenalty: number
): RecallHitPreFilterTrace['filterStage'] {
  if (!minPriorPassed) {
    return 'min_prior_rejected';
  }
  if (tonePenalty < TONE_MATCH_PENALTY) {
    return 'tone_penalized';
  }
  return 'accepted';
}

export type RecallTopKInput = {
  rawText: string;
  globalSyllables: string[];
  windows: GlobalWindowDescriptor[];
  runtime: LexiconRuntimeV2;
  profile: ActiveLexiconProfileSnapshot;
  domainIds: readonly string[];
  minPrior: number;
  weakDomainPlan?: WeakDomainRecallPlan;
  fuzzyRecallEnabled: boolean;
  acousticSlices?: AcousticToneSlice[];
  wordTimeSpans?: WordTimeSpan[];
  toneTimestampOnlyEnabled: boolean;
  trace?: V4TraceCollector | null;
};

export type RecallTopKResult = {
  candidates: WindowCandidate[];
  ngramQueryCount: number;
  parentFragmentHitCount: number;
  tone: CoarseAssemblyToneDiagnostics;
};

export function recallTopKForWindows(input: RecallTopKInput): RecallTopKResult {
  const acousticSlices = input.acousticSlices ?? [];
  const wordTimeSpans = input.wordTimeSpans ?? [];
  const toneState = resolveTimestampToneState(acousticSlices, input.toneTimestampOnlyEnabled);

  const tone: CoarseAssemblyToneDiagnostics = {
    ...createEmptyToneDiagnostics(acousticSlices, wordTimeSpans, input.toneTimestampOnlyEnabled),
    tonePayloadAvailable: toneState.tonePayloadAvailable,
    toneEnabled: toneState.toneEnabled,
    toneSkippedReason: toneState.toneSkippedReason,
    toneSliceCount: acousticSlices.length,
    wordTimeSpanCount: wordTimeSpans.length,
  };

  const exampleWindows: CoarseAssemblyToneExampleWindow[] = [];
  const candidates: WindowCandidate[] = [];
  let ngramQueryCount = 0;
  let parentFragmentHitCount = 0;
  let candidateSeq = 0;
  const toneActive = toneState.toneEnabled && acousticSlices.length > 0 && wordTimeSpans.length > 0;

  for (let wi = 0; wi < input.windows.length; wi += 1) {
    const window = input.windows[wi];
    if (ngramQueryCount >= V4_LIMITS.maxSqlPerUtterance) {
      if (input.trace) {
        for (let skip = wi; skip < input.windows.length; skip += 1) {
          const skipped = input.windows[skip];
          input.trace.pushSkippedRecallWindow({
            windowId: skipped.windowId,
            reason: 'sql_budget_exhausted',
            windowPinyinKey: skipped.windowPinyinKey,
          });
        }
      }
      break;
    }

    const syllables = input.globalSyllables.slice(window.syllableStart, window.syllableEnd);
    const boundaryPenalty =
      window.windowSource === 'boundary_window' ? V4_LIMITS.boundaryPenalty : 1;

    let acousticTonePattern: number[] | undefined;
    let windowTimeRange: { start: number; end: number } | undefined;

    if (toneActive) {
      tone.ngramTonePatternAttemptCount += 1;
      tone.windowTimeAttemptCount += 1;
      const extracted = extractAcousticTonePatternForRecall(
        window.rawStart,
        window.rawEnd,
        window.syllableStart,
        window.syllableEnd,
        acousticSlices,
        wordTimeSpans
      );
      if (extracted.windowTimeRange) {
        tone.windowTimeHitCount += 1;
        windowTimeRange = {
          start: extracted.windowTimeRange.start,
          end: extracted.windowTimeRange.end,
        };
      }
      if (extracted.pattern?.length) {
        tone.ngramTonePatternHitCount += 1;
        tone.toneOverlapHitCount += 1;
        acousticTonePattern = extracted.pattern;
      } else if (extracted.windowTimeRange) {
        tone.toneOverlapSyllableMismatchCount += 1;
        tone.ngramTonePatternMissCount += 1;
      } else {
        tone.toneOverlapMissCount += 1;
        tone.ngramTonePatternMissCount += 1;
      }
    }

    if (exampleWindows.length < MAX_EXAMPLE_WINDOWS) {
      exampleWindows.push({
        text: window.windowText,
        pinyinKey: window.windowPinyinKey,
        windowTimeRange,
        acousticTonePattern,
      });
    }

    const recall = recallSpanTopKV3(input.runtime, {
      syllables,
      windowText: window.windowText,
      termLength: syllables.length,
      topK: V4_LIMITS.exactTopK,
      profile: input.profile,
      domainIds: input.domainIds,
      perSpanLimit: V4_LIMITS.exactTopK,
      exactTopK: V4_LIMITS.exactTopK,
      parentFragmentTopK: V4_LIMITS.parentFragmentTopK,
      perParentTermPerWindow: V4_LIMITS.perParentTermPerWindow,
      weakDomainPlan: input.weakDomainPlan,
      fuzzyRecallEnabled: input.fuzzyRecallEnabled,
      acousticTonePattern,
    });
    ngramQueryCount += 1;
    parentFragmentHitCount += recall.parentFragmentHitCount;

    tone.recallToneCompatibleCount += recall.recallToneCompatibleCount ?? 0;
    tone.recallToneFallbackCount += recall.recallToneFallbackCount ?? 0;

    let rank = 0;
    const v3Hits = recall.hits as RecallSpanTopKV3Hit[];

    for (const hit of v3Hits) {
      const minPriorPassed = hit.hotword.priorScore >= input.minPrior;
      const toneFields = recallHitToneFields(hit, acousticTonePattern);

      if (input.trace) {
        input.trace.pushRecallHitPreFilter({
          windowId: window.windowId,
          windowPinyinKey: window.windowPinyinKey,
          replacement: hit.hotword.word,
          candidateScore: hit.candidateScore,
          toneCompatible: toneFields.toneCompatible,
          tonePenalty: toneFields.tonePenalty,
          toneReason: toneFields.toneReason,
          minPriorPassed,
          filterStage: resolvePreFilterStage(minPriorPassed, toneFields.tonePenalty),
          sqlReturned: true,
        });
      }

      if (!minPriorPassed) {
        continue;
      }

      rank += 1;
      const domainId = hit.hotword.domain ?? hit.hotword.domains?.[0];
      const graphSource = resolveGraphSource(hit.source, domainId, input.weakDomainPlan);
      const candidateScore = hit.candidateScore;
      const score = candidateScore * boundaryPenalty;
      candidateSeq += 1;

      candidates.push({
        candidateId: `${window.windowId}:${candidateSeq}`,
        windowId: window.windowId,
        windowSource: window.windowSource as 'in_span_window' | 'boundary_window',
        anchorCoarseSpanId: window.anchorCoarseSpanId,
        syllableStart: window.syllableStart,
        syllableEnd: window.syllableEnd,
        rawStart: window.rawStart,
        rawEnd: window.rawEnd,
        windowPinyinKey: window.windowPinyinKey,
        candidateScore,
        score,
        boundaryPenalty,
        candidateRank: rank,
        hitKind: hit.hitKind === 'parent_fragment' ? 'parent_fragment' : 'exact_term',
        replacement: hit.hotword.word,
        domainId,
        source: graphSource,
        recallSource: hit.source,
        repairTarget: hit.hotword.repairTarget === true,
        parentTermId: hit.parentTermId,
        parentTerm: hit.parentTerm,
        parentPinyinKey: hit.parentPinyinKey,
        parentTermSyllableCount: hit.parentPinyinKey
          ? parentTermSyllableCount(hit.parentPinyinKey)
          : undefined,
        matchedTermStart: hit.matchedTermStart,
        matchedTermEnd: hit.matchedTermEnd,
        fragmentTonePinyinKey: hit.fragmentTonePinyinKey,
        toneCompatible: toneFields.toneCompatible,
        tonePenalty: toneFields.tonePenalty,
        toneReason: toneFields.toneReason,
      });

      if (input.trace) {
        input.trace.pushRecallHit({
          windowId: window.windowId,
          windowPinyinKey: window.windowPinyinKey,
          windowSource: window.windowSource as 'in_span_window' | 'boundary_window',
          replacement: hit.hotword.word,
          hitKind: hit.hitKind === 'parent_fragment' ? 'parent_fragment' : 'exact_term',
          candidateScore,
          score,
          repairTarget: hit.hotword.repairTarget === true,
          candidateId: `${window.windowId}:${candidateSeq}`,
          tonePenalty: toneFields.tonePenalty,
          toneReason: toneFields.toneReason,
        });
      }
    }
  }

  tone.exampleToneWindows = exampleWindows.length ? exampleWindows : undefined;
  tone.recallToneIncompatibleCount = tone.recallToneFallbackCount;
  return { candidates, ngramQueryCount, parentFragmentHitCount, tone };
}
