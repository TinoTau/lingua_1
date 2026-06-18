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
import type { FwDetectorRuntimeDiag, FwDetectorResult, FwSpanDiagnostics } from './types';
import { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } from './pinyin-ime-v2/pinyin-ime-v2-dict-load';
import { loadPinyinImeV2RuntimeConfig } from './pinyin-ime-v2/pinyin-ime-v2-config';
import { buildCombinationTraces } from './span-assembly-v4/v4-diagnostics-mappers';
import { resolveV4DiagnosticsConfig } from './span-assembly-v4/v4-diagnostics-config';
import { runSpanAssemblyV4Orchestrator } from './span-assembly-v4/span-assembly-v4-orchestrator';
import { runFwSentenceRerankFromPrefilled } from './kenlm/run-fw-sentence-rerank-from-prefilled';

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

export type RunFwDetectorV4PathInput = {
  ctx: JobContext;
  rawText: string;
  config: FwDetectorRuntimeConfig;
  configSnapshot: Record<string, unknown>;
  runtimeDiagBase: FwDetectorRuntimeDiag;
  profile: import('../session-runtime/types').ActiveLexiconProfileSnapshot;
  enabledDomains: string[];
  enableKenLMGate: boolean;
};

export async function runFwDetectorV4Path(input: RunFwDetectorV4PathInput): Promise<FwDetectorResult> {
  const { ctx, rawText, config, configSnapshot, runtimeDiagBase, profile, enabledDomains, enableKenLMGate } =
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
        ngramQueryCount: 0,
        windowCandidatePoolCount: 0,
        activeCandidateCount: 0,
        compatibilityEdgeCount: 0,
        droppedCandidateCount: 0,
        coverageCount: 0,
        conflictCount: 0,
        conflictRelationCount: 0,
        hardDropCount: 0,
        compatibleCount: 0,
        parentEvidenceCount: 0,
        exactEdgeCount: 0,
        candidateEdgeCount: 0,
        overlapMergeCount: 0,
        residualSpanCount: 0,
        utteranceDomain: 'general',
        domainVoteMs: 0,
        coarsePathAssemblyMs: 0,
        sentenceBeamMs: 0,
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
        shadowBeamSpanSetsTotal: 0,
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
    };
    ctx.fwDetectorResult = result;
    return result;
  }

  const kenlmScorer = enableKenLMGate ? createKenlmBatchScorer() : null;
  const sessionIntent = getLexiconSessionIntentFromContext(ctx);

  const wrapped = await runWithLexiconRecallContext({ sessionIntent }, () =>
    runWithRecallV2Diagnostics(async () => {
      const assemblyResult = runSpanAssemblyV4Orchestrator({
        rawText,
        runtime,
        profile,
        enabledDomains,
        minPrior: config.minPrior,
        imeConfig,
        dict,
        asrSegments: ctx.asrSegments,
        tonePayload: ctx.asrResult?.tone,
        acousticSlices: ctx.acousticToneSlices,
        asrSegmentNodeBatchIndices: ctx.asrSegmentNodeBatchIndices,
        segmentTimeOffsetsSec: ctx.segmentTimeOffsetsSec,
        segmentCharOffsets: ctx.segmentCharOffsets,
        traceCaseId: ctx.fwDetectorTraceCaseId,
      });
      if (!assemblyResult.fwSpans.length) {
        return { assembly: assemblyResult, decision: null };
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
        tone: ctx.asrResult?.tone,
      });
      return { assembly: assemblyResult, decision: rerankDecision };
    })
  );

  const { assembly, decision } = wrapped;
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
      ...(recallV2Diagnostics ? { recallV2Diagnostics } : {}),
    };
    ctx.fwDetectorResult = result;
    return result;
  }

  ctx.segmentForJobResult = applyFwSpanReplacements(rawText, decision.approved);
  if (decision.approved.length > 0) {
    ctx.asrRepairApplied = true;
  }

  const summary = buildSummary(decision.spans, decision);
  const kenlmVetoMs =
    decision.sentenceRerank.kenlmSubprocessMs ?? decision.kenlmTiming?.batchMs ?? 0;
  const kenlmVetoQueryCount = decision.kenlmQueryCount;
  const allCombinations =
    diagnosticsConfig.traceActive && assembly.kenlmSentenceCandidates
      ? buildCombinationTraces({
          combinations: assembly.kenlmSentenceCandidates,
          deltas: decision.sentenceRerank.allCombinationDeltas,
          minDeltaToReplace: config.minDeltaToReplace,
          pickedIsRaw: decision.sentenceRerank.pickedIsRaw,
          candidateRequireRepairTarget: config.candidateRequireRepairTarget,
          picked: decision.sentenceRerank.pickedIsRaw ? null : decision.sentenceRerank.picked ?? null,
        })
      : undefined;

  const result: FwDetectorResult = {
    enabled: true,
    triggered: summary.spanCount > 0,
    reason: resolveResultReason(decision.spans, summary.appliedCount),
    pipelinePath: 'v4',
    configSnapshot,
    summary,
    runtime: runtimeDiagBase,
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
    },
    kenlmVetoMs,
    kenlmVetoQueryCount,
    kenlmTiming: decision.kenlmTiming
      ? { batchMs: kenlmVetoMs, queryCount: kenlmVetoQueryCount }
      : undefined,
    ...(recallV2Diagnostics ? { recallV2Diagnostics } : {}),
    sentenceRerank: {
      ...decision.sentenceRerank,
      ...(allCombinations ? { allCombinations } : {}),
    },
    ...(decision.toneDiagnostics ? { toneModule: decision.toneDiagnostics } : {}),
  };
  ctx.fwDetectorResult = result;
  return result;
}
