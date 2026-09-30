import type { LexiconRuntimeV2 } from '../../lexicon-v2/lexicon-runtime-v2';
import { recallSpanTopKV2, type RecallSpanTopKV2Hit } from '../../lexicon-v2/recall-span-topk-v2';
import type { Length1CollectorDiagnostic, Length1WindowTrace } from '../../lexicon-v2/single-char-collector-trace';
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
import {
  captureV2Boundary,
  canonicalHash,
  isFrozenEvidenceCaptureV2Enabled,
  markCaptureV2Incomplete,
} from '../../capture-v2';

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
  /** Observation-only 1-char collector traces (one per length-1 input window). */
  length1Windows: Length1WindowTrace[];
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
  const length1Windows: Length1WindowTrace[] = [];
  const toneActive = toneState.toneEnabled && acousticSlices.length > 0 && wordTimeSpans.length > 0;
  /** Batch 1.1C: explicit caller gate for Mandatory Tone Recall readiness. */
  const toneCallerEnabled = toneState.toneEnabled;

  const captureOn = isFrozenEvidenceCaptureV2Enabled();
  const b4Windows: unknown[] = [];
  const b7Queries: unknown[] = [];
  const b8Executions: unknown[] = [];
  const b9Occurrence: unknown[] = [];

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

    if (captureOn) {
      b4Windows.push({
        windowId: window.windowId,
        rawStart: window.rawStart,
        rawEnd: window.rawEnd,
        syllableStart: window.syllableStart,
        syllableEnd: window.syllableEnd,
        windowTimeRange: windowTimeRange ?? null,
        pattern: acousticTonePattern ? [...acousticTonePattern] : null,
        missReason: mappingMissReason ?? null,
        acousticTonePattern: acousticTonePattern ? [...acousticTonePattern] : null,
        toneNorm: canonical.toneNorm,
      });
    }

    let exactHits: RecallSpanTopKV2Hit[];
    let windowQueryTonePinyinKey: string | undefined;
    let recallToneCompatibleCount = 0;
    let recallToneFallbackCount = 0;
    let toneExactHitCount = 0;
    let plainFallbackHitCount = 0;
    let length1Collector: Length1CollectorDiagnostic | undefined;

    if (utteranceRecall) {
      const lookupStart = Date.now();
      const cached = utteranceCacheGet(utteranceRecall, canonicalKey);
      utteranceRecall.stats.utteranceCacheLookupMs += Date.now() - lookupStart;
      if (cached) {
        const bindStart = Date.now();
        exactHits = exactHitsFromLexiconFacts(cached);
        utteranceRecall.stats.windowBindingMs += Date.now() - bindStart;
        const cachedDiag = utteranceRecall.length1CollectorByKey.get(canonicalKey);
        if (cachedDiag) {
          length1Collector = { ...cachedDiag, querySource: 'utterance_cache' };
          windowQueryTonePinyinKey = cachedDiag.queryTonePinyinKey ?? undefined;
        }
        if (captureOn) {
          b7Queries.push({
            canonical,
            serializedKey: canonicalKey,
            cacheHit: true,
            cacheMiss: false,
          });
          b8Executions.push({
            canonicalQueryKey: canonicalKey,
            queryStageOrMode: 'utterance_cache',
            boundParameters: { serializedKey: canonicalKey },
            toneExactOrFuzzyBranch: null,
            cacheRelationship: 'hit',
            orderedSemanticRowIdentities: exactHits.map((h) => ({
              termId: h.hotword.id,
              surface: h.hotword.word,
              pinyin: null,
              tone: h.acousticTonePattern ?? null,
              domains: h.hotword.domains ? [...h.hotword.domains] : [],
              hitKind: 'exact_term',
              sourceSemantics: h.source,
            })),
            returnedOccurrenceCount: exactHits.length,
            uniqueReturnedIdentityCount: new Set(exactHits.map((h) => h.hotword.id)).size,
            rowIdentityHash: canonicalHash(exactHits.map((h) => h.hotword.id)),
          });
        }
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
        length1Collector = recall.length1Collector;
        if (length1Collector) {
          utteranceRecall.length1CollectorByKey.set(canonicalKey, length1Collector);
        }

        const facts = lexiconFactsFromExactHits(exactHits);
        utteranceCacheSet(utteranceRecall, canonicalKey, facts);
        if (captureOn) {
          b7Queries.push({
            canonical,
            serializedKey: canonicalKey,
            cacheHit: false,
            cacheMiss: true,
          });
          const rowIdentities = exactHits.map((h) => ({
            termId: h.hotword.id,
            surface: h.hotword.word,
            pinyin: h.hotword.pinyin ?? null,
            tone: h.acousticTonePattern ?? null,
            domains: h.hotword.domains ? [...h.hotword.domains] : [],
            hitKind: 'exact_term',
            sourceSemantics: h.source,
          }));
          b8Executions.push({
            canonicalQueryKey: canonicalKey,
            queryStageOrMode: exactHits[0]?.toneLookupStage ?? 'exact',
            boundParameters: {
              syllables,
              windowText: window.windowText,
              termLength: syllables.length,
              topK: windowExactTopK,
              domainIds: windowDomainIds,
              acousticTonePattern: acousticTonePattern ?? null,
              fuzzyRecallEnabled: isSingleChar ? false : input.fuzzyRecallEnabled,
            },
            toneExactOrFuzzyBranch: exactHits[0]?.toneLookupStage ?? null,
            cacheRelationship: 'miss',
            orderedSemanticRowIdentities: rowIdentities,
            returnedOccurrenceCount: rowIdentities.length,
            uniqueReturnedIdentityCount: new Set(rowIdentities.map((r) => r.termId)).size,
            rowIdentityHash: canonicalHash(rowIdentities),
          });
        }
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
      length1Collector = recall.length1Collector;
      if (captureOn) {
        b7Queries.push({
          canonical,
          serializedKey: canonicalKey,
          cacheHit: false,
          cacheMiss: true,
        });
        const rowIdentities = exactHits.map((h) => ({
          termId: h.hotword.id,
          surface: h.hotword.word,
          pinyin: h.hotword.pinyin ?? null,
          tone: h.acousticTonePattern ?? null,
          domains: h.hotword.domains ? [...h.hotword.domains] : [],
          hitKind: 'exact_term',
          sourceSemantics: h.source,
        }));
        b8Executions.push({
          canonicalQueryKey: canonicalKey,
          queryStageOrMode: exactHits[0]?.toneLookupStage ?? 'exact',
          boundParameters: {
            syllables,
            windowText: window.windowText,
            termLength: syllables.length,
            topK: windowExactTopK,
            domainIds: windowDomainIds,
            acousticTonePattern: acousticTonePattern ?? null,
            fuzzyRecallEnabled: isSingleChar ? false : input.fuzzyRecallEnabled,
          },
          toneExactOrFuzzyBranch: exactHits[0]?.toneLookupStage ?? null,
          cacheRelationship: 'no_utterance_cache',
          orderedSemanticRowIdentities: rowIdentities,
          returnedOccurrenceCount: rowIdentities.length,
          uniqueReturnedIdentityCount: new Set(rowIdentities.map((r) => r.termId)).size,
          rowIdentityHash: canonicalHash(rowIdentities),
        });
      }
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
    if (captureOn) {
      for (const c of bound.candidates) {
        b9Occurrence.push({
          candidateId: c.candidateId,
          termId: c.termId ?? null,
          surface: c.replacement,
          pinyin: c.windowPinyinKey,
          provenance: c.retrievalProvenance ?? null,
          source: c.source,
          syllableStart: c.syllableStart,
          syllableEnd: c.syllableEnd,
          rawStart: c.rawStart,
          rawEnd: c.rawEnd,
          score: c.score,
          domains: c.domains ? [...c.domains] : [],
          hitKind: c.hitKind,
          provenance_windowId: window.windowId,
          provenance_canonicalQueryKey: canonicalKey,
        });
      }
    }
    if (isSingleChar && length1Collector) {
      length1Windows.push({
        ...length1Collector,
        windowId: window.windowId,
        rawStart: window.rawStart,
        rawEnd: window.rawEnd,
        syllableStart: window.syllableStart,
        syllableEnd: window.syllableEnd,
        windowSource: window.windowSource,
        blocked: false,
        boundCandidateCount: bound.candidates.length,
        tonePattern: acousticTonePattern ? [...acousticTonePattern] : null,
        queryTonePinyinKey: windowQueryTonePinyinKey ?? length1Collector.queryTonePinyinKey ?? null,
      });
    }
  }

  if (utteranceRecall) {
    utteranceRecall.stats.lexiconRecallTotalMs += Date.now() - recallTotalStart;
  }

  tone.exampleToneWindows = exampleWindows.length ? exampleWindows : undefined;
  // Legacy alias for experiment/trace consumers (see CoarseAssemblyToneDiagnostics).
  tone.recallToneIncompatibleCount = tone.recallToneFallbackCount;

  if (captureOn) {
    // Merge windows into B4; collector preserves acousticToneSlices (INJECTION_STATE) from orchestrator.
    const toneConsumed = b4Windows.some((w) => {
      const row = w as Record<string, unknown>;
      return (
        (Array.isArray(row.acousticTonePattern) && row.acousticTonePattern.length > 0) ||
        (typeof row.toneNorm === 'string' && row.toneNorm.length > 0) ||
        (Array.isArray(row.pattern) && row.pattern.length > 0)
      );
    });
    if (toneConsumed && acousticSlices.length === 0) {
      markCaptureV2Incomplete('TONE_REQUIRED_BUT_SLICES_MISSING', 'B4');
    }
    captureV2Boundary('B4', {
      windows: b4Windows,
      slice_role: 'INJECTION_STATE',
      // Do not overwrite slice array here — merge keeps orchestrator snapshot.
      tone_execution_status:
        acousticSlices.length > 0
          ? 'TONE_EXECUTED_AND_SLICES_CAPTURED'
          : toneConsumed
            ? 'TONE_REQUIRED_BUT_SLICES_MISSING'
            : 'TONE_LEGITIMATELY_NOT_APPLICABLE',
    });
    captureV2Boundary('B7', { queries: b7Queries });
    captureV2Boundary('B8', { executions: b8Executions });
    const uniqueKeys = [
      ...new Set(
        b9Occurrence.map((o) => {
          const r = o as Record<string, unknown>;
          return `${r.surface}|${r.termId}|${r.syllableStart}|${r.syllableEnd}`;
        })
      ),
    ].sort();
    const multiset: Record<string, number> = {};
    for (const o of b9Occurrence) {
      const r = o as Record<string, unknown>;
      const k = `${r.surface}|${r.termId}|${r.syllableStart}|${r.syllableEnd}`;
      multiset[k] = (multiset[k] ?? 0) + 1;
    }
    captureV2Boundary('B9', {
      occurrence_list: b9Occurrence,
      unique_identity_set: uniqueKeys,
      multiset_multiplicities: multiset,
      provenance_note: 'windowId+canonicalQueryKey on each occurrence',
    });
  }

  return {
    candidates,
    logicalWindowRecallCount,
    // JOBRESULT_ADAPTER_DEBT — parent-fragment recall retired (Phase 2/3); always 0.
    parentFragmentHitCount: 0,
    tone,
    physicalSqlStatementCount,
    length1Windows,
  };
}
