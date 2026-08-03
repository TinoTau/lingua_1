import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { recallSpanTopKV2, type RecallSpanTopKV2Hit } from '../../lexicon-v2/recall-span-topk-v2';
import type { WeakDomainRecallPlan } from '../../lexicon-v2/weak-domain-recall-resolver';
import { syllablesKey } from '../../lexicon/pinyin-index';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { AcousticToneSlice, WordTimeSpan } from '../tone-time-align';
import type { ToneEvidenceProductionDiagnostic } from '../../task-router/types';
import type {
  GraphEdgeSource,
  CoarseAssemblyToneDiagnostics,
  CoarseAssemblyToneExampleWindow,
} from '../span-assembly-shared/types';
import { createEmptyToneDiagnostics } from '../span-assembly-shared/tone-diagnostics';
import { extractAcousticTonePatternForRecall, resolveTimestampToneState } from '../span-assembly-shared/tone-recall';
import {
  attributeMappingMiss,
  bumpCount,
} from '../span-assembly-shared/tone-miss-attribution';
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
  exactHitsFromLexiconFacts,
  lexiconFactsFromExactHits,
  normalizeToneNorm,
  serializeCanonicalRecallQueryKey,
  utteranceCacheGet,
  utteranceCacheSet,
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
  hit: RecallSpanTopKV2Hit,
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
  const toneKey = hit.hotword.tonePinyinKey ?? '';
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
  toneEvidenceProduction?: ToneEvidenceProductionDiagnostic[];
  toneTimestampOnlyEnabled: boolean;
  trace?: V4TraceCollector | null;
  /** Per-utterance Fact cache; omit for baseline (no cache) counterfactual. */
  utteranceRecall?: UtteranceRecallContext | null;
};

export type RecallTopKResult = {
  candidates: WindowCandidate[];
  /** Windows actually recalled in this call — equals input.windows.length (full traversal). */
  logicalWindowRecallCount: number;
  /** JOBRESULT_ADAPTER_DEBT — parent-fragment recall retired (Phase 2/3); always 0. */
  parentFragmentHitCount: number;
  tone: CoarseAssemblyToneDiagnostics;
  /** True SQLite statement executions observed via LexiconRuntimeV2 tier counters. */
  physicalSqlStatementCount: number;
};

/**
 * Bind cached lexicon Fact hits onto a window — always allocates fresh WindowCandidate objects.
 * Exact formal-term hits only (parent-fragment write-path removed in Phase 1/2/3).
 */
export function bindLexiconHitsToWindow(input: {
  window: GlobalWindowDescriptor;
  hits: readonly RecallSpanTopKV2Hit[];
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

  for (const hit of input.hits) {
    const minPriorPassed = hit.hotword.priorScore >= input.minPrior;
    const toneFields = recallHitToneFields(hit, input.acousticTonePattern);
    const hitToneLookupStage = hit.toneLookupStage;

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
    const termId =
      hit.hotword?.id != null && String(hit.hotword.id).length > 0
        ? String(hit.hotword.id)
        : undefined;
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
      hitKind: 'exact_term',
      replacement: hit.hotword.word,
      termId,
      recallCandidateKind: hit.recallCandidateKind,
      domains,
      source: graphSource,
      recallSource: hit.source,
      repairTarget: hit.hotword.repairTarget === true,
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
        hitKind: 'exact_term',
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

  return { candidates, candidateSeq, parentFragmentHitCount: 0 };
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

  const evidenceProduction = input.toneEvidenceProduction ?? [];
  for (const row of evidenceProduction) {
    tone.evidenceProductionStatusCounts = bumpCount(
      tone.evidenceProductionStatusCounts,
      row.status
    );
  }

  const exampleWindows: CoarseAssemblyToneExampleWindow[] = [];
  const candidates: WindowCandidate[] = [];
  let logicalWindowRecallCount = 0;
  let candidateSeq = 0;
  let physicalSqlStatementCount = 0;
  const toneActive = toneState.toneEnabled && acousticSlices.length > 0 && wordTimeSpans.length > 0;
  /** Batch 1.1C: explicit caller gate for Mandatory Tone Recall readiness. */
  const toneCallerEnabled = toneState.toneEnabled;

  // Frozen rule: every input recallable window is recalled — no attempt/resource gate.
  for (let wi = 0; wi < input.windows.length; wi += 1) {
    const window = input.windows[wi];

    const buildStart = Date.now();
    const syllables = input.globalSyllables.slice(window.syllableStart, window.syllableEnd);
    const boundaryPenalty =
      window.windowSource === 'boundary_window' ? V4_LIMITS.boundaryPenalty : 1;

    let acousticTonePattern: number[] | undefined;
    let windowTimeRange: { start: number; end: number } | undefined;
    let mappingMissReason: string | undefined;
    let mappingMissAttribution: string | undefined;

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
        tone.tonePatternMappingMissCount += 1;
        tone.ngramTonePatternMissCount += 1;
        if (extracted.missReason) {
          mappingMissReason = extracted.missReason;
          tone.mappingMissReasonCounts = bumpCount(
            tone.mappingMissReasonCounts,
            extracted.missReason
          );
        }
        const attribution = attributeMappingMiss({
          missReason: extracted.missReason,
          failedWordSpan: extracted.failedWordSpan,
          evidenceProduction,
        });
        mappingMissAttribution = attribution;
        tone.mappingMissAttributionCounts = bumpCount(
          tone.mappingMissAttributionCounts,
          attribution
        );
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
        mappingMissReason,
        mappingMissAttribution,
      });
    }

    const pinyinKey = window.windowPinyinKey || syllablesKey(syllables);
    const isSingleChar = syllables.length === 1;
    const windowExactTopK = isSingleChar ? 1 : V4_LIMITS.exactTopK;
    const windowDomainIds = isSingleChar ? [] : input.domainIds;
    const canonical = buildSpanV3CanonicalQuery({
      pinyinKey,
      toneNorm: normalizeToneNorm(acousticTonePattern),
      domainIds: windowDomainIds,
      exactTopK: windowExactTopK,
      lexiconVersion,
      surfaceText: window.windowText,
    });
    const canonicalKey = serializeCanonicalRecallQueryKey(canonical);
    if (utteranceRecall) {
      utteranceRecall.stats.recallRequestBuildMs += Date.now() - buildStart;
      utteranceRecall.stats.exactQueryCount += 1;
    }

    let exactHits: RecallSpanTopKV2Hit[];
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
        exactHits = exactHitsFromLexiconFacts(cached);
        utteranceRecall.stats.windowBindingMs += Date.now() - bindStart;
      } else {
        const factStart = Date.now();
        const sqlBefore = input.runtime.getPhysicalStatementStats().total;
        let recall;
        try {
          recall = recallSpanTopKV2(input.runtime, {
            syllables,
            windowText: window.windowText,
            termLength: syllables.length,
            topK: windowExactTopK,
            profile: input.profile,
            domainIds: windowDomainIds,
            perSpanLimit: windowExactTopK,
            weakDomainPlan: isSingleChar ? undefined : input.weakDomainPlan,
            fuzzyRecallEnabled: isSingleChar ? false : input.fuzzyRecallEnabled,
            acousticTonePattern,
            toneCallerEnabled,
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

        exactHits = recall.hits;
        windowQueryTonePinyinKey = recall.queryTonePinyinKey;
        recallToneCompatibleCount = recall.recallToneCompatibleCount ?? 0;
        recallToneFallbackCount = recall.recallToneFallbackCount ?? 0;
        toneExactHitCount = recall.toneExactHitCount ?? 0;
        plainFallbackHitCount = recall.plainFallbackHitCount ?? 0;

        const facts = lexiconFactsFromExactHits(exactHits);
        utteranceCacheSet(utteranceRecall, canonicalKey, facts);
      }
    } else {
      const sqlBefore = input.runtime.getPhysicalStatementStats().total;
      const recall = recallSpanTopKV2(input.runtime, {
        syllables,
        windowText: window.windowText,
        termLength: syllables.length,
        topK: windowExactTopK,
        profile: input.profile,
        domainIds: windowDomainIds,
        perSpanLimit: windowExactTopK,
        weakDomainPlan: isSingleChar ? undefined : input.weakDomainPlan,
        fuzzyRecallEnabled: isSingleChar ? false : input.fuzzyRecallEnabled,
        acousticTonePattern,
        toneCallerEnabled,
      });
      const sqlAfter = input.runtime.getPhysicalStatementStats().total;
      physicalSqlStatementCount += Math.max(0, sqlAfter - sqlBefore);
      exactHits = recall.hits;
      windowQueryTonePinyinKey = recall.queryTonePinyinKey;
      recallToneCompatibleCount = recall.recallToneCompatibleCount ?? 0;
      recallToneFallbackCount = recall.recallToneFallbackCount ?? 0;
      toneExactHitCount = recall.toneExactHitCount ?? 0;
      plainFallbackHitCount = recall.plainFallbackHitCount ?? 0;
    }

    logicalWindowRecallCount += 1;

    tone.recallToneCompatibleCount += recallToneCompatibleCount;
    tone.recallToneFallbackCount += recallToneFallbackCount;
    tone.toneExactHitCount += toneExactHitCount;
    tone.plainFallbackHitCount += plainFallbackHitCount;

    const bindStart = Date.now();
    const bound = bindLexiconHitsToWindow({
      window,
      hits: exactHits,
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
  }

  if (utteranceRecall) {
    utteranceRecall.stats.lexiconRecallTotalMs += Date.now() - recallTotalStart;
  }

  tone.exampleToneWindows = exampleWindows.length ? exampleWindows : undefined;
  // Legacy alias for experiment/trace consumers (see CoarseAssemblyToneDiagnostics).
  tone.recallToneIncompatibleCount = tone.recallToneFallbackCount;
  return {
    candidates,
    logicalWindowRecallCount,
    // JOBRESULT_ADAPTER_DEBT — parent-fragment recall retired (Phase 2/3); always 0.
    parentFragmentHitCount: 0,
    tone,
    physicalSqlStatementCount,
  };
}
