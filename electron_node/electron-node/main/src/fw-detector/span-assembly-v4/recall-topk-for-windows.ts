import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { recallSpanTopKV3, type RecallSpanTopKV3Hit } from '../../lexicon-v2/recall-span-topkv3';
import type { WeakDomainRecallPlan } from '../../lexicon-v2/weak-domain-recall-resolver';
import { syllablesKey } from '../../lexicon/pinyin-index';
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
import {
  buildSpanV3CanonicalQuery,
  lexiconFactsFromV3Hits,
  normalizeToneNorm,
  serializeCanonicalRecallQueryKey,
  utteranceCacheGet,
  utteranceCacheSet,
  v3HitsFromLexiconFacts,
  type UtteranceRecallContext,
} from './utterance-recall-cache';

const MAX_EXAMPLE_WINDOWS = 8;

function resolveGraphSource(
  hitSource: string,
  domains: readonly string[] | undefined,
  weakPlan?: WeakDomainRecallPlan
): GraphEdgeSource {
  const fine = (domains ?? []).filter((d) => d && d !== 'general' && d !== 'base_term');
  if (!fine.length) {
    return 'base_term';
  }
  if (weakPlan?.enabled) {
    const strong = fine.filter((d) => !weakPlan.weakDomainIds.includes(d));
    if (!strong.length) {
      return 'passive_domain_weak';
    }
  }
  return 'domain_term';
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
  /** Per-utterance Fact cache; omit for baseline (no cache) counterfactual. */
  utteranceRecall?: UtteranceRecallContext | null;
};

export type RecallTopKResult = {
  candidates: WindowCandidate[];
  ngramQueryCount: number;
  parentFragmentHitCount: number;
  tone: CoarseAssemblyToneDiagnostics;
  /** True SQLite statement executions observed via LexiconRuntimeV2 tier counters. */
  physicalSqlStatementCount: number;
};

/**
 * Bind cached lexicon Fact hits onto a window — always allocates fresh WindowCandidate objects.
 */
export function bindLexiconHitsToWindow(input: {
  window: GlobalWindowDescriptor;
  hits: readonly RecallSpanTopKV3Hit[];
  minPrior: number;
  weakDomainPlan?: WeakDomainRecallPlan;
  boundaryPenalty: number;
  candidateSeqStart: number;
  acousticTonePattern?: number[];
  windowQueryTonePinyinKey?: string;
  trace?: V4TraceCollector | null;
}): { candidates: WindowCandidate[]; candidateSeq: number; parentFragmentHitCount: number } {
  const candidates: WindowCandidate[] = [];
  let candidateSeq = input.candidateSeqStart;
  let rank = 0;
  let parentFragmentHitCount = 0;

  for (const hit of input.hits) {
    if (hit.hitKind === 'parent_fragment') {
      parentFragmentHitCount += 1;
    }
    const minPriorPassed = hit.hotword.priorScore >= input.minPrior;
    const toneFields = recallHitToneFields(hit, input.acousticTonePattern);
    const hitToneLookupStage =
      hit.hitKind === 'exact_term' ? hit.toneLookupStage : undefined;

    if (input.trace) {
      input.trace.pushRecallHitPreFilter({
        windowId: input.window.windowId,
        windowPinyinKey: input.window.windowPinyinKey,
        replacement: hit.hotword.word,
        candidateScore: hit.candidateScore,
        toneCompatible: toneFields.toneCompatible,
        tonePenalty: toneFields.tonePenalty,
        toneReason: toneFields.toneReason,
        minPriorPassed,
        filterStage: resolvePreFilterStage(minPriorPassed, toneFields.tonePenalty),
        sqlReturned: true,
        toneLookupStage: hitToneLookupStage,
        queryTonePinyinKey: input.windowQueryTonePinyinKey,
      });
    }

    if (!minPriorPassed) {
      continue;
    }

    rank += 1;
    const domains =
      hit.hotword.domains && hit.hotword.domains.length
        ? Object.freeze([...hit.hotword.domains])
        : undefined;
    const graphSource = resolveGraphSource(hit.source, domains, input.weakDomainPlan);
    const candidateScore = hit.candidateScore;
    const score = candidateScore * input.boundaryPenalty;
    candidateSeq += 1;

    const candidateId = `${input.window.windowId}:${candidateSeq}`;
    candidates.push({
      candidateId,
      windowId: input.window.windowId,
      windowSource: input.window.windowSource as 'in_span_window' | 'boundary_window',
      anchorCoarseSpanId: input.window.anchorCoarseSpanId,
      syllableStart: input.window.syllableStart,
      syllableEnd: input.window.syllableEnd,
      rawStart: input.window.rawStart,
      rawEnd: input.window.rawEnd,
      windowPinyinKey: input.window.windowPinyinKey,
      candidateScore,
      score,
      boundaryPenalty: input.boundaryPenalty,
      candidateRank: rank,
      hitKind: hit.hitKind === 'parent_fragment' ? 'parent_fragment' : 'exact_term',
      replacement: hit.hotword.word,
      domains,
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
      toneLookupStage: hitToneLookupStage,
    });

    if (input.trace) {
      input.trace.pushRecallHit({
        windowId: input.window.windowId,
        windowPinyinKey: input.window.windowPinyinKey,
        windowSource: input.window.windowSource as 'in_span_window' | 'boundary_window',
        replacement: hit.hotword.word,
        hitKind: hit.hitKind === 'parent_fragment' ? 'parent_fragment' : 'exact_term',
        candidateScore,
        score,
        repairTarget: hit.hotword.repairTarget === true,
        candidateId,
        tonePenalty: toneFields.tonePenalty,
        toneReason: toneFields.toneReason,
        toneLookupStage: hitToneLookupStage,
        queryTonePinyinKey: input.windowQueryTonePinyinKey,
      });
    }
  }

  return { candidates, candidateSeq, parentFragmentHitCount };
}

export function recallTopKForWindows(input: RecallTopKInput): RecallTopKResult {
  const recallTotalStart = Date.now();
  const acousticSlices = input.acousticSlices ?? [];
  const wordTimeSpans = input.wordTimeSpans ?? [];
  const toneState = resolveTimestampToneState(acousticSlices, input.toneTimestampOnlyEnabled);
  const utteranceRecall = input.utteranceRecall ?? null;
  const lexiconVersion =
    utteranceRecall?.lexiconVersion ??
    input.runtime.getManifestVersion() ??
    'unknown';

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
  let physicalSqlStatementCount = 0;
  const toneActive = toneState.toneEnabled && acousticSlices.length > 0 && wordTimeSpans.length > 0;

  for (let wi = 0; wi < input.windows.length; wi += 1) {
    const window = input.windows[wi];
    if (ngramQueryCount >= V4_LIMITS.maxSqlPerUtterance) {
      // Budget skipped — do NOT write utterance cache.
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

    const buildStart = Date.now();
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

    const pinyinKey = window.windowPinyinKey || syllablesKey(syllables);
    const canonical = buildSpanV3CanonicalQuery({
      pinyinKey,
      toneNorm: normalizeToneNorm(acousticTonePattern),
      domainIds: input.domainIds,
      exactTopK: V4_LIMITS.exactTopK,
      parentFragmentTopK: V4_LIMITS.parentFragmentTopK,
      lexiconVersion,
      surfaceText: window.windowText,
    });
    const canonicalKey = serializeCanonicalRecallQueryKey(canonical);
    if (utteranceRecall) {
      utteranceRecall.stats.recallRequestBuildMs += Date.now() - buildStart;
      utteranceRecall.stats.exactQueryCount += 1;
      utteranceRecall.stats.parentQueryCount += 1;
    }

    let v3Hits: RecallSpanTopKV3Hit[];
    let windowQueryTonePinyinKey: string | undefined;
    let recallToneCompatibleCount = 0;
    let recallToneFallbackCount = 0;
    let toneExactHitCount = 0;
    let plainFallbackHitCount = 0;

    if (utteranceRecall) {
      const lookupStart = Date.now();
      const cached = utteranceCacheGet(utteranceRecall, canonicalKey);
      utteranceRecall.stats.utteranceCacheLookupMs += Date.now() - lookupStart;
      if (cached) {
        const bindStart = Date.now();
        v3Hits = v3HitsFromLexiconFacts(cached);
        utteranceRecall.stats.windowBindingMs += Date.now() - bindStart;
      } else {
        const factStart = Date.now();
        const sqlBefore = input.runtime.getPhysicalStatementStats().total;
        let recall;
        try {
          recall = recallSpanTopKV3(input.runtime, {
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
        } catch (err) {
          // SQL / recall throw — do NOT cache.
          utteranceRecall.stats.lexiconFactLookupMs += Date.now() - factStart;
          throw err;
        }
        const sqlAfter = input.runtime.getPhysicalStatementStats().total;
        const sqlDelta = Math.max(0, sqlAfter - sqlBefore);
        physicalSqlStatementCount += sqlDelta;
        utteranceRecall.stats.physicalSqlStatementCount += sqlDelta;
        utteranceRecall.stats.lexiconFactLookupMs += Date.now() - factStart;

        v3Hits = recall.hits as RecallSpanTopKV3Hit[];
        windowQueryTonePinyinKey = recall.queryTonePinyinKey;
        recallToneCompatibleCount = recall.recallToneCompatibleCount ?? 0;
        recallToneFallbackCount = recall.recallToneFallbackCount ?? 0;
        toneExactHitCount = recall.toneExactHitCount ?? 0;
        plainFallbackHitCount = recall.plainFallbackHitCount ?? 0;

        const facts = lexiconFactsFromV3Hits(v3Hits);
        utteranceCacheSet(utteranceRecall, canonicalKey, facts);
      }
    } else {
      const sqlBefore = input.runtime.getPhysicalStatementStats().total;
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
      const sqlAfter = input.runtime.getPhysicalStatementStats().total;
      physicalSqlStatementCount += Math.max(0, sqlAfter - sqlBefore);
      v3Hits = recall.hits as RecallSpanTopKV3Hit[];
      windowQueryTonePinyinKey = recall.queryTonePinyinKey;
      recallToneCompatibleCount = recall.recallToneCompatibleCount ?? 0;
      recallToneFallbackCount = recall.recallToneFallbackCount ?? 0;
      toneExactHitCount = recall.toneExactHitCount ?? 0;
      plainFallbackHitCount = recall.plainFallbackHitCount ?? 0;
    }

    // Logical window recall attempt (SQL budget gate) — unchanged semantics.
    ngramQueryCount += 1;

    tone.recallToneCompatibleCount += recallToneCompatibleCount;
    tone.recallToneFallbackCount += recallToneFallbackCount;
    tone.toneExactHitCount += toneExactHitCount;
    tone.plainFallbackHitCount += plainFallbackHitCount;

    const bindStart = Date.now();
    const bound = bindLexiconHitsToWindow({
      window,
      hits: v3Hits,
      minPrior: input.minPrior,
      weakDomainPlan: input.weakDomainPlan,
      boundaryPenalty,
      candidateSeqStart: candidateSeq,
      acousticTonePattern,
      windowQueryTonePinyinKey,
      trace: input.trace,
    });
    if (utteranceRecall) {
      utteranceRecall.stats.windowBindingMs += Date.now() - bindStart;
    }
    candidateSeq = bound.candidateSeq;
    candidates.push(...bound.candidates);
    parentFragmentHitCount += v3Hits.filter((h) => h.hitKind === 'parent_fragment').length;
  }

  if (utteranceRecall) {
    utteranceRecall.stats.lexiconRecallTotalMs += Date.now() - recallTotalStart;
  }

  tone.exampleToneWindows = exampleWindows.length ? exampleWindows : undefined;
  // Legacy alias for experiment/trace consumers (see CoarseAssemblyToneDiagnostics).
  tone.recallToneIncompatibleCount = tone.recallToneFallbackCount;
  return { candidates, ngramQueryCount, parentFragmentHitCount, tone, physicalSqlStatementCount };
}
