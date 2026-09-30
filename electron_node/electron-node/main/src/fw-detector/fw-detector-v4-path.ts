import { createKenlmBatchScorer } from '../asr-repair/sentence-rerank/kenlm-scorer';
import { getLexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2-holder';
import {
  flushRecallJobDiagnostics,
  runWithRecallV2Diagnostics,
} from '../lexicon-v2/recall-v2-diagnostics';
import { runWithLexiconRecallContext } from '../lexicon-v2/lexicon-recall-context';
import { getLexiconSessionIntentFromContext } from '../session-runtime/turn-profile-binding';
import type { JobContext } from '../pipeline/context/job-context';
import { applyFwSpanReplacements } from './apply-span-replacements';
import type { FwDetectorRuntimeConfig } from './fw-config';
import { mergeContextPriorIntoRuntimeDiag } from './fw-runtime-diag';
import type { FwDetectorRuntimeDiag, FwDetectorResult, FwSpanDiagnostics } from './types';
import { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } from './pinyin-ime-v2/pinyin-ime-v2-dict-load';
import { loadPinyinImeV2RuntimeConfig } from './pinyin-ime-v2/pinyin-ime-v2-config';
import { buildCombinationTraces } from './span-assembly-v4/v4-diagnostics-mappers';
import { resolveV4DiagnosticsConfig } from './span-assembly-v4/v4-diagnostics-config';
import { runSpanAssemblyV4Orchestrator } from './span-assembly-v4/span-assembly-v4-orchestrator';
import { runFwSentenceRerankFromPrefilled } from './kenlm/run-fw-sentence-rerank-from-prefilled';
import { createHash } from 'crypto';
import {
  captureV2Boundary,
  isFrozenEvidenceCaptureV2Enabled,
  sha256Utf8,
} from '../capture-v2';

/** Acceptance-harness only: stable fingerprint of KenLM pool texts (sorted). */
function kenlmPoolFingerprint(texts: readonly string[]): string {
  const joined = [...texts].map((t) => String(t ?? '')).sort().join('\n');
  return createHash('sha256').update(joined, 'utf8').digest('hex');
}

function emptySummary() {
  return {
    spanCount: 0,
    candidateCount: 0,
    candidateSentenceCount: 0,
    appliedCount: 0,
    kenlmApprovedCount: 0,
    kenlmVetoedCount: 0,
    pickedTopKWinCount: 0,
    kenlmQueryCount: 0,
  };
}

function buildSummary(
  spans: FwSpanDiagnostics[],
  decision: { kenlmQueryCount: number; pickedTopKWinCount: number }
) {
  const candidateCount = spans.reduce((n, s) => n + s.candidates.length, 0);
  const candidateSentenceCount = spans.reduce(
    (n, s) => n + s.candidates.filter((c) => c.candidateSentence.length > 0).length,
    0
  );
  let kenlmApprovedCount = 0;
  let kenlmVetoedCount = 0;
  for (const span of spans) {
    for (const c of span.candidates) {
      if (c.kenlm?.approved) kenlmApprovedCount += 1;
      if (c.kenlm?.vetoed) kenlmVetoedCount += 1;
    }
  }
  return {
    spanCount: spans.length,
    candidateCount,
    candidateSentenceCount,
    appliedCount: spans.filter((s) => s.applied).length,
    kenlmApprovedCount,
    kenlmVetoedCount,
    pickedTopKWinCount: decision.pickedTopKWinCount,
    kenlmQueryCount: decision.kenlmQueryCount,
  };
}

function resolveResultReason(spans: FwSpanDiagnostics[], appliedCount: number): string | undefined {
  if (appliedCount > 0) return 'applied';
  if (spans.length === 0) return 'v4_no_spans';
  const candidateCount = spans.reduce((n, s) => n + s.candidates.length, 0);
  if (candidateCount === 0) return 'no_candidates';
  return undefined;
}

function repairNormalizationDiag(
  ctx: JobContext,
  repairText: string
): NonNullable<FwDetectorResult['repairNormalization']> {
  return {
    rawAsrText: ctx.rawAsrText ?? '',
    repairText,
    scriptNormalized: ctx.fwRepairScriptNormalized === true,
  };
}

export type RunFwDetectorV4PathInput = {
  ctx: JobContext;
  rawText: string;
  config: FwDetectorRuntimeConfig;
  configSnapshot: Record<string, unknown>;
  runtimeDiagBase: FwDetectorRuntimeDiag;
  profile: import('../session-runtime/types').ActiveLexiconProfileSnapshot;
  /** Unique Recall domain SSOT (CFG-01 resolved). */
  recallDomainScope: string[];
  enableKenLMGate: boolean;
};

export async function runFwDetectorV4Path(input: RunFwDetectorV4PathInput): Promise<FwDetectorResult> {
  const { ctx, rawText, config, configSnapshot, runtimeDiagBase, profile, recallDomainScope, enableKenLMGate } =
    input;
  const fwStartMs = Date.now();
  const runtime = getLexiconRuntimeV2();
  const imeConfig = loadPinyinImeV2RuntimeConfig();

  let dict;
  try {
    dict = loadPinyinImeV2Dictionaries(resolvePinyinImeV2DictDir(imeConfig.dictDir), {
      enabledDomains: imeConfig.enabledDomains,
    });
  } catch (err) {
    ctx.segmentForJobResult = rawText;
    ctx.fwDetectorStepMs = Date.now() - fwStartMs;
    const message = err instanceof Error ? err.message : String(err);
    const result: FwDetectorResult = {
      enabled: true,
      triggered: false,
      reason: 'v4_ime_dict_unavailable',
      pipelinePath: 'v4',
      configSnapshot,
      summary: emptySummary(),
      runtime: runtimeDiagBase,
      spans: [],
      spanAssemblyV4: {
        enabled: true,
        stub: false,
        coarseSpanCount: 0,
        globalWindowGeneratedCount: 0,
        blockedWindowCount: 0,
        truncatedWindowCount: 0,
        logicalWindowRecallCount: 0,
        windowCandidatePoolCount: 0,
        activeCandidateCount: 0,
        compatibilityEdgeCount: 0,
        coverageCount: 0,
        conflictRelationCount: 0,
        compatibleCount: 0,
        utteranceDomain: 'general',
        domainVoteMs: 0,
        assemblyMs: 0,
        inSpanWindowCount: 0,
        boundaryWindowCount: 0,
        domainCandidateCount: 0,
        baseCandidateCount: 0,
        sameDomainCandidateCount: 0,
        domainFilteredSpanCount: 0,
        selectedCandidatesPerSpanAvg: 0,
        domainAssemblyMs: 0,
        mainDomainAwareSpanSetsTotal: 0,
        retainedBucketCount: 0,
        intervalAssemblyCandidateCount: 0,
        intervalRejectedOverlapCount: 0,
        boundaryImport: {
          rawSyllableCount: 0,
          imeCandidateCount: 0,
          trustedTopKCount: 0,
          imeBoundaryCount: 0,
          rawBoundaryCount: 0,
          alignedBoundaryCount: 0,
          proposalBoundaryCount: 0,
          asrWordBoundaryCount: 0,
          punctuationFallbackBoundaryCount: 0,
          finalCoarseSpanCount: 0,
          coverageOk: false,
          boundarySourceBreakdown: {
            ime_token_boundary: 0,
            raw_ime_aligned_boundary: 0,
            proposal_active_boundary: 0,
            asr_word_boundary: 0,
            punctuation_fallback: 0,
          },
          fallbackReason: `ime_dict_unavailable:${message}`,
        },
        skippedReason: 'no_coarse_spans',
      },
      kenlmVetoMs: 0,
      kenlmVetoQueryCount: 0,
      repairNormalization: repairNormalizationDiag(ctx, rawText),
    };
    ctx.fwDetectorResult = result;
    return result;
  }

  const kenlmScorer = enableKenLMGate ? createKenlmBatchScorer() : null;
  const sessionIntent = getLexiconSessionIntentFromContext(ctx);

  const wrapped = await runWithLexiconRecallContext({ sessionIntent }, () =>
    runWithRecallV2Diagnostics(async () => {
      const assemblyResult = await runSpanAssemblyV4Orchestrator({
        rawText,
        runtime,
        profile,
        recallDomainScope,
        minPrior: config.minPrior,
        imeConfig,
        dict,
        asrSegments: ctx.asrSegments,
        acousticSlices: ctx.acousticToneSlices,
        toneEvidenceProduction: ctx.toneEvidenceProduction,
        asrSegmentNodeBatchIndices: ctx.asrSegmentNodeBatchIndices,
        segmentTimeOffsetsSec: ctx.segmentTimeOffsetsSec,
        segmentCharOffsets: ctx.segmentCharOffsets,
        traceCaseId: ctx.fwDetectorTraceCaseId,
        domainPriors: ctx.domainPriors ?? [],
        userProfile: ctx.userProfileV1 ?? null,
        sessionId: ctx.sessionId,
      });
      if (!assemblyResult.fwSpans.length) {
        return {
          assembly: assemblyResult,
          decision: null,
          baselineRerank: null,
          baselineFinalText: null,
        };
      }
      const rerankDecision = await runFwSentenceRerankFromPrefilled({
        rawText,
        spans: assemblyResult.fwSpans,
        spanSets: assemblyResult.spanSets,
        config: {
          minPrior: config.minPrior,
          maxSentenceCandidates: config.maxSentenceCandidates,
          minDeltaToReplace: config.minDeltaToReplace,
          candidateRequireRepairTarget: config.candidateRequireRepairTarget,
        },
        kenlmScorer,
        prefilledCombinations: assemblyResult.kenlmSentenceCandidates?.combinations ?? [],
      });

      // Acceptance causal fork: score baseline KEEP branch with the SAME KenLM implementation.
      let baselineRerank: typeof rerankDecision | null = null;
      let baselineFinalText: string | null = null;
      if (assemblyResult.acceptanceCausal?.baselineKenlmSentenceCandidates) {
        const bPrimary = assemblyResult.acceptanceCausal.baselinePathAssemblyResults[0];
        baselineRerank = await runFwSentenceRerankFromPrefilled({
          rawText,
          spans: bPrimary?.fwSpans ?? assemblyResult.fwSpans,
          spanSets: bPrimary?.assemblyResult.spanSets ?? assemblyResult.spanSets,
          config: {
            minPrior: config.minPrior,
            maxSentenceCandidates: config.maxSentenceCandidates,
            minDeltaToReplace: config.minDeltaToReplace,
            candidateRequireRepairTarget: config.candidateRequireRepairTarget,
          },
          kenlmScorer,
          prefilledCombinations:
            assemblyResult.acceptanceCausal.baselineKenlmSentenceCandidates.combinations,
        });
        baselineFinalText = applyFwSpanReplacements(rawText, baselineRerank.approved);
      }

      return {
        assembly: assemblyResult,
        decision: rerankDecision,
        baselineRerank,
        baselineFinalText,
      };
    })
  );

  const { assembly, decision, baselineRerank, baselineFinalText } = wrapped;
  ctx.fwDetectorStepMs = Date.now() - fwStartMs;

  const v2QueryStats = runtime.getAndResetTierQueryStats();
  const kenlmQueryCount = decision?.kenlmQueryCount ?? 0;
  const recallV2Diagnostics = flushRecallJobDiagnostics({
    v2SqlQueryCount: v2QueryStats?.sqlQueries ?? 0,
    v2CacheHits: v2QueryStats?.cacheHits ?? 0,
    v2CacheMisses: v2QueryStats?.cacheMisses ?? 0,
    kenlmQueryCount,
  });
  const diagnosticsConfig = resolveV4DiagnosticsConfig(ctx.fwDetectorTraceCaseId);

  if (!decision) {
    ctx.segmentForJobResult = rawText;
    const result: FwDetectorResult = {
      enabled: true,
      triggered: false,
      reason: 'v4_no_spans',
      pipelinePath: 'v4',
      configSnapshot,
      summary: emptySummary(),
      runtime: runtimeDiagBase,
      spans: [],
      spanAssemblyV4: {
        enabled: true,
        stub: false,
        ...assembly.metrics,
        boundaryImport: assembly.boundaryImport,
        tone: assembly.tone,
        traceLevel: diagnosticsConfig.level,
        ...(assembly.trace ?? {}),
        skippedReason: assembly.metrics.coarseSpanCount === 0 ? 'no_coarse_spans' : 'no_cjk',
      },
      kenlmVetoMs: 0,
      kenlmVetoQueryCount: 0,
      repairNormalization: repairNormalizationDiag(ctx, rawText),
      ...(recallV2Diagnostics ? { recallV2Diagnostics } : {}),
    };
    ctx.fwDetectorResult = result;
    return result;
  }

  ctx.segmentForJobResult = applyFwSpanReplacements(rawText, decision.approved);
  if (decision.approved.length > 0) {
    ctx.asrRepairApplied = true;
  }

  // Capture V2 B16/B18 — OBSERVABILITY_ONLY; no-op when gate OFF.
  if (isFrozenEvidenceCaptureV2Enabled()) {
    const pool = (assembly.kenlmSentenceCandidates?.combinations ?? []).map((c) => ({
      text: c.text,
      candidateScore: c.candidateScore,
      raw: false,
    }));
    const rawTextEntry = { text: rawText, candidateScore: null, raw: true };
    captureV2Boundary('B16', {
      pool: [rawTextEntry, ...pool],
      raw_candidate_identity: rawText,
      scores_when_produced: (decision.sentenceRerank.allCombinationDeltas ?? null),
      deltaVsRaw: decision.sentenceRerank.maxDelta ?? null,
      picked: decision.sentenceRerank.picked?.text ?? null,
      pickedIsRaw: decision.sentenceRerank.pickedIsRaw === true,
      gate_inputs: {
        maxDelta: decision.sentenceRerank.maxDelta ?? null,
        minDeltaToReplace: config.minDeltaToReplace,
      },
      gate_threshold: config.minDeltaToReplace,
      explicit_gate_decision: {
        pickedIsRaw: decision.sentenceRerank.pickedIsRaw === true,
        approvedCount: decision.approved.length,
      },
      scorer_model_identity: {
        kenlmEnabled: enableKenLMGate,
      },
    });
    const finalText = ctx.segmentForJobResult ?? rawText;
    captureV2Boundary('B18', {
      finalPostprocessText: finalText,
      finalHash: sha256Utf8(String(finalText)),
    });
  }

  const summary = buildSummary(decision.spans, decision);
  const kenlmVetoMs =
    decision.sentenceRerank.kenlmSubprocessMs ?? decision.kenlmTiming?.batchMs ?? 0;
  const kenlmVetoQueryCount = decision.kenlmQueryCount;
  const allCombinations =
    diagnosticsConfig.traceActive && assembly.kenlmSentenceCandidates
      ? buildCombinationTraces({
          combinations: assembly.kenlmSentenceCandidates.combinations,
          deltas: decision.sentenceRerank.allCombinationDeltas,
          minDeltaToReplace: config.minDeltaToReplace,
          pickedIsRaw: decision.sentenceRerank.pickedIsRaw,
          candidateRequireRepairTarget: config.candidateRequireRepairTarget,
          picked: decision.sentenceRerank.pickedIsRaw ? null : decision.sentenceRerank.picked ?? null,
        })
      : undefined;

  const kenlmPool = assembly.kenlmSentenceCandidates;
  const candidateCapProbe =
    diagnosticsConfig.enabled && kenlmPool
      ? {
          perBucketAfterLocalCap: (kenlmPool.perBucketGenerated ?? []).map((list) =>
            list.map((c) => c.text)
          ),
          mergedAfterDedupBeforeCap: (kenlmPool.uniqueBeforeCap ?? []).map((c) => c.text),
          finalAfterCap16: (kenlmPool.combinations ?? []).map((c) => c.text),
          dedupReplacedCount: kenlmPool.crossPathMerge?.crossPathDuplicateCount ?? 0,
          maxSentenceCandidates: config.maxSentenceCandidates,
        }
      : undefined;

  const voteLifecycleProbe = diagnosticsConfig.enabled
    ? {
        domainScores: { ...(assembly.metrics.domainScores ?? {}) },
        retainedDomains: [...(assembly.metrics.retainedDomains ?? [])],
        retentionRatio: 0.75,
        insufficientEvidence: assembly.metrics.insufficientEvidence === true,
        activeCandidates: assembly.diagActiveCandidates ?? [],
        bucketDomains: [...(assembly.metrics.retainedDomains ?? [])],
      }
    : undefined;

  const result: FwDetectorResult = {
    enabled: true,
    triggered: summary.spanCount > 0,
    reason: resolveResultReason(decision.spans, summary.appliedCount),
    pipelinePath: 'v4',
    configSnapshot,
    summary,
    runtime: mergeContextPriorIntoRuntimeDiag(runtimeDiagBase, profile.primaryDomain, {
      applied: false,
    }),
    replacements: decision.replacements,
    spans: decision.spans,
    spanAssemblyV4: {
      enabled: true,
      stub: false,
      ...assembly.metrics,
      boundaryImport: assembly.boundaryImport,
      tone: assembly.tone,
      traceLevel: diagnosticsConfig.level,
      ...(assembly.trace ?? {}),
      ...(candidateCapProbe ? { candidateCapProbe } : {}),
      ...(voteLifecycleProbe ? { voteLifecycleProbe } : {}),
      ...(assembly.model2PathTrace
        ? {
            model2PathTrace: {
              ...assembly.model2PathTrace,
              kenlm_rerank: {
                picked_is_raw: decision.sentenceRerank.pickedIsRaw,
                picked_text: decision.sentenceRerank.picked?.text ?? null,
                top_candidates: (decision.sentenceRerank.topCandidates || []).slice(0, 16),
                kenlm_query_count: decision.sentenceRerank.kenlmQueryCount,
                kenlm_subprocess_ms: decision.sentenceRerank.kenlmSubprocessMs ?? kenlmVetoMs,
                min_delta_to_replace: decision.sentenceRerank.minDeltaToReplace,
                max_delta: decision.sentenceRerank.maxDelta,
              },
              tone_stage: assembly.tone
                ? {
                    invoked: true,
                    slice_count: (assembly.tone as { acousticSliceCount?: number }).acousticSliceCount ?? null,
                  }
                : { invoked: false, status: 'NOT_INVOKED' },
              ...(assembly.acceptanceCausal && baselineFinalText != null
                ? {
                    acceptance_causal: {
                      ...(typeof assembly.model2PathTrace.acceptance_causal === 'object' &&
                      assembly.model2PathTrace.acceptance_causal
                        ? (assembly.model2PathTrace.acceptance_causal as Record<string, unknown>)
                        : {}),
                      harness_version: assembly.acceptanceCausal.harnessVersion,
                      path_parity: assembly.acceptanceCausal.pathParity,
                      baseline_final_text: baselineFinalText,
                      s3_final_text: applyFwSpanReplacements(rawText, decision.approved),
                      baseline_kenlm_pool_size:
                        assembly.acceptanceCausal.baselineKenlmSentenceCandidates.combinations
                          .length,
                      s3_kenlm_pool_size:
                        assembly.kenlmSentenceCandidates?.combinations.length ?? 0,
                      baseline_kenlm_pool_fingerprint: kenlmPoolFingerprint(
                        assembly.acceptanceCausal.baselineKenlmSentenceCandidates.combinations.map(
                          (c) => c.text
                        )
                      ),
                      s3_kenlm_pool_fingerprint: kenlmPoolFingerprint(
                        (assembly.kenlmSentenceCandidates?.combinations ?? []).map((c) => c.text)
                      ),
                      baseline_kenlm_picked_text: baselineFinalText,
                      s3_kenlm_picked_text: applyFwSpanReplacements(rawText, decision.approved),
                      baseline_kenlm_query_count: baselineRerank?.kenlmQueryCount ?? null,
                      s3_kenlm_query_count: decision.sentenceRerank.kenlmQueryCount ?? null,
                      baseline_post_fork_ms_sum: assembly.acceptanceCausal.pathParity.reduce(
                        (s, p) => s + p.baselinePostForkMs,
                        0
                      ),
                      s3_post_fork_ms_sum: assembly.acceptanceCausal.pathParity.reduce(
                        (s, p) => s + p.s3PostForkMs,
                        0
                      ),
                      // Path-sum Model3 host-infer cost (shared upstream; once per path before fork).
                      model3_inference_ms_sum: (assembly.pathAssemblyResults ?? []).reduce(
                        (s, p) => s + (p.model3Diagnostics?.model3LatencyMs ?? 0),
                        0
                      ),
                      mutation_isolated: assembly.acceptanceCausal.pathParity.every(
                        (p) => p.mutationIsolated
                      ),
                      upstream_hashes_equal: (() => {
                        const hs = new Set(
                          assembly.acceptanceCausal!.pathParity.map((p) => p.upstreamHash)
                        );
                        // Per-path hashes differ by pathId; packed+upstream must be self-consistent.
                        return assembly.acceptanceCausal!.pathParity.every(
                          (p) => p.mutationIsolated
                        );
                      })(),
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
    kenlmVetoMs,
    kenlmVetoQueryCount,
    kenlmTiming: decision.kenlmTiming
      ? { batchMs: kenlmVetoMs, queryCount: kenlmVetoQueryCount }
      : undefined,
    repairNormalization: repairNormalizationDiag(ctx, rawText),
    ...(recallV2Diagnostics ? { recallV2Diagnostics } : {}),
    sentenceRerank: {
      ...decision.sentenceRerank,
      ...(allCombinations ? { allCombinations } : {}),
    },
  };
  ctx.fwDetectorResult = result;
  return result;
}
