import { createKenlmBatchScorer } from '../asr-repair/sentence-rerank/kenlm-scorer';
import {
  mapKenlmGateSpanToFwSpan,
  selectKenlmSuspiciousSpans,
} from '../asr-repair/kenlm-span-selector';
import { ensureLexiconRuntimeLoaded, getLexiconRuntime } from '../lexicon/lexicon-runtime-holder';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import {
  getLexiconSessionIntentFromContext,
  getProfileSnapshotFromContext,
} from '../session-runtime/turn-profile-binding';
import { runWithLexiconRecallContext } from '../lexicon-v2/lexicon-recall-context';
import {
  flushRecallJobDiagnostics,
  runWithRecallV2Diagnostics,
} from '../lexicon-v2/recall-v2-diagnostics';
import { getLexiconRuntimeV2 } from '../lexicon-v2/lexicon-runtime-v2-holder';
import { isLexiconRuntimeV2RecallEnabled } from '../lexicon-v2/lexicon-fw-recall-config';
import type { JobContext } from '../pipeline/context/job-context';
import { applyFwSpanReplacements } from './apply-span-replacements';
import { selectFwMetadataSpans } from './fw-metadata-span-gate';
import { isFwMetadataSpanGateActive, isKenlmSpanGateActive, loadFwDetectorRuntimeConfig } from './fw-config';
import { mapFwMetadataSpanToFwSpan } from './map-fw-metadata-span';
import { runFwTopKDecisionPipeline } from './fw-topk-decision-pipeline';
import { runFwSentenceRerankPipeline } from './fw-sentence-rerank-pipeline';
import { detectSuspiciousSpansV1 } from './suspicious-span-detector-v1';
import { createSpanDetectorHint } from './span-detector-hint';
import { lexiconBundleFileNames, resolveLexiconBundleDir } from '../lexicon/lexicon-bundle-path';
import type {
  FwDetectorResult,
  FwDetectorRuntimeDiag,
  FwDetectorSummary,
  FwSpanDiagnostics,
  FwMetadataSpanGateDiagnostics,
  KenlmGateMode,
  KenlmSpanGateDiagnostics,
  KenlmSpanGateOptions,
} from './types';

function emptySummary(): FwDetectorSummary {
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

function buildSummary(spans: FwSpanDiagnostics[], decision: {
  kenlmQueryCount: number;
  pickedTopKWinCount: number;
}): FwDetectorSummary {
  const candidateCount = spans.reduce((n, s) => n + s.candidates.length, 0);
  const candidateSentenceCount = spans.reduce(
    (n, s) => n + s.candidates.filter((c) => c.candidateSentence.length > 0).length,
    0
  );
  let kenlmApprovedCount = 0;
  let kenlmVetoedCount = 0;
  for (const span of spans) {
    for (const c of span.candidates) {
      if (c.kenlm?.approved) {
        kenlmApprovedCount += 1;
      }
      if (c.kenlm?.vetoed) {
        kenlmVetoedCount += 1;
      }
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

function resolveResultReason(
  spans: FwSpanDiagnostics[],
  appliedCount: number
): string | undefined {
  if (appliedCount > 0) {
    return 'applied';
  }
  if (spans.length === 0) {
    return 'no_spans';
  }
  const candidateCount = spans.reduce((n, s) => n + s.candidates.length, 0);
  if (candidateCount === 0) {
    return 'no_candidates';
  }
  if (spans.some((s) => s.candidates.some((c) => c.vetoReason === 'kenlm_unavailable'))) {
    return 'kenlm_unavailable';
  }
  return undefined;
}

function resolveKenlmRuntime(ctx: JobContext, config: ReturnType<typeof loadFwDetectorRuntimeConfig>) {
  const enableKenLMGate =
    typeof ctx.fwDetectorEnableKenLMGateOverride === 'boolean'
      ? ctx.fwDetectorEnableKenLMGateOverride
      : config.enableKenLMGate;
  const kenlmGateMode: KenlmGateMode =
    ctx.fwDetectorKenlmGateModeOverride ?? config.kenlmGateMode;
  const kenlmVetoThreshold =
    typeof ctx.fwDetectorKenlmVetoThresholdOverride === 'number'
      ? ctx.fwDetectorKenlmVetoThresholdOverride
      : config.kenlmVetoThreshold;

  const gateOptions: KenlmSpanGateOptions = {
    enabled: enableKenLMGate,
    mode: kenlmGateMode,
    deltaThreshold: config.kenlmDeltaThreshold,
    vetoThreshold: kenlmVetoThreshold,
  };

  return { enableKenLMGate, kenlmGateMode, kenlmVetoThreshold, gateOptions };
}

type SpanResolution = {
  spans: FwSpanDiagnostics[];
  kenlmSpanGate?: KenlmSpanGateDiagnostics;
  fwMetadataSpanGate?: FwMetadataSpanGateDiagnostics;
  spanSelection?: FwDetectorResult['spanSelection'];
};

function resolveFwSpans(
  rawText: string,
  config: ReturnType<typeof loadFwDetectorRuntimeConfig>,
  segments: JobContext['asrSegments'],
  aliasKeys: readonly string[],
  kenlmScorer: ReturnType<typeof createKenlmBatchScorer>
): Promise<SpanResolution> {
  if (isFwMetadataSpanGateActive(config)) {
    const gateConfig = config.fwMetadataSpanGate;
    const gateResult = selectFwMetadataSpans({
      text: rawText,
      segments: segments as JobContext['asrSegments'],
      aliasKeys,
      config: gateConfig,
      legacyFallback: gateConfig.allowSegmentFallbackScan
        ? () => {
            const legacyConfig = {
              ...config,
              spanDetectBudget: gateConfig.fallbackLegacyMaxSpans,
            };
            const hintFn = createSpanDetectorHint();
            return detectSuspiciousSpansV1(rawText, legacyConfig, segments, hintFn).spans;
          }
        : undefined,
    });
    return Promise.resolve({
      spans: gateResult.spans.map(mapFwMetadataSpanToFwSpan),
      fwMetadataSpanGate: gateResult.diagnostics,
    });
  }

  if (isKenlmSpanGateActive(config)) {
    const gate = config.kenlmSpanGate;
    return selectKenlmSuspiciousSpans(kenlmScorer, {
      text: rawText,
      maxSpans: gate.maxSpans,
      minSpanChars: gate.minSpanChars,
      maxSpanChars: gate.maxSpanChars,
      minLocalDelta: gate.minLocalDelta,
      stopwordFilterEnabled: gate.stopwordFilterEnabled,
      preFilterMaxWindows: gate.preFilterMaxWindows,
    }).then((gateResult) => ({
      spans: gateResult.spans.map(mapKenlmGateSpanToFwSpan),
      kenlmSpanGate: gateResult.diagnostics,
    }));
  }

  const hintFn = createSpanDetectorHint();
  const spanDetection = detectSuspiciousSpansV1(rawText, config, segments, hintFn);
  return Promise.resolve({
    spans: spanDetection.spans,
    spanSelection: spanDetection.spanSelection,
  });
}

function buildEarlyExitResult(
  configSnapshot: Record<string, unknown>,
  runtimeDiagBase: FwDetectorRuntimeDiag,
  spanResolution: SpanResolution
): FwDetectorResult {
  return {
    enabled: true,
    triggered: false,
    reason: 'no_spans',
    configSnapshot,
    summary: emptySummary(),
    runtime: runtimeDiagBase,
    spans: [],
    spanSelection: spanResolution.spanSelection,
    kenlmSpanGate: spanResolution.kenlmSpanGate,
    fwMetadataSpanGate: spanResolution.fwMetadataSpanGate,
    kenlmVetoMs: 0,
    kenlmVetoQueryCount: 0,
  };
}

export async function runFwDetectorOrchestrator(ctx: JobContext): Promise<FwDetectorResult> {
  const config = loadFwDetectorRuntimeConfig();
  const enabledDomains =
    Array.isArray(ctx.fwDetectorEnabledDomainsOverride) && ctx.fwDetectorEnabledDomainsOverride.length > 0
      ? ctx.fwDetectorEnabledDomainsOverride
      : config.enabledDomains;
  const { enableKenLMGate, kenlmGateMode, kenlmVetoThreshold, gateOptions } = resolveKenlmRuntime(
    ctx,
    config
  );
  const rawText = (ctx.rawAsrText ?? '').trim();
  const configSnapshot: Record<string, unknown> = {
    spanGateMode: config.spanGateMode,
    kenlmSpanGate: config.kenlmSpanGate,
    fwMetadataSpanGate: config.fwMetadataSpanGate,
    maxSpans: config.maxSpans,
    spanDetectBudget: config.spanDetectBudget,
    topK: config.topK,
    minPrior: config.minPrior,
    minRiskScore: config.minRiskScore,
    enableKenLMGate,
    kenlmGateMode,
    kenlmDeltaThreshold: config.kenlmDeltaThreshold,
    kenlmVetoThreshold,
    finalScoreWeights: config.finalScoreWeights,
    enabledDomains,
    candidateRequireRepairTarget: config.candidateRequireRepairTarget,
    repairTargetScoreBoost: config.repairTargetScoreBoost,
    useSentenceLevelRerank: config.useSentenceLevelRerank,
    maxSentenceCandidates: config.maxSentenceCandidates,
    minDeltaToReplace: config.minDeltaToReplace,
  };

  const bundleDir = resolveLexiconBundleDir();
  const bundleFiles = bundleDir ? lexiconBundleFileNames(bundleDir) : null;

  if (!rawText) {
    return {
      enabled: true,
      triggered: false,
      reason: 'empty_raw',
      configSnapshot,
      summary: emptySummary(),
      runtime: {
        loaded: false,
        status: 'empty_raw',
        bundleDir: bundleDir ?? null,
        sqlitePath: bundleFiles?.sqlitePath ?? null,
        manifestVersion: null,
        lexiconRows: null,
        scoredRows: null,
        pinyinIndexSize: null,
        exactIndexSize: null,
        profilePrimary: null,
        enabledDomains,
      },
      spans: [],
    };
  }

  const runtimeState = ensureLexiconRuntimeLoaded();
  const runtimeDiagBase: FwDetectorRuntimeDiag = {
    loaded: runtimeState.status === 'ok',
    status: runtimeState.status,
    bundleDir: bundleDir ?? null,
    sqlitePath: bundleFiles?.sqlitePath ?? null,
    manifestVersion: runtimeState.manifestVersion ?? null,
    lexiconRows: runtimeState.lexiconCount ?? null,
    scoredRows: runtimeState.scoredCount ?? null,
    pinyinIndexSize: null,
    exactIndexSize: null,
    profilePrimary: null,
    enabledDomains,
  };
  if (runtimeState.status !== 'ok') {
    return {
      enabled: true,
      triggered: false,
      reason: 'lexicon_unavailable',
      configSnapshot,
      summary: emptySummary(),
      runtime: runtimeDiagBase,
      spans: [],
    };
  }

  const runtime = getLexiconRuntime();
  const profile = getProfileSnapshotFromContext(ctx) ?? defaultGeneralProfile();
  runtimeDiagBase.pinyinIndexSize = runtime.getPinyinIndexSize?.() ?? null;
  runtimeDiagBase.exactIndexSize = runtime.getExactIndexSize?.() ?? null;
  runtimeDiagBase.profilePrimary = profile.primaryDomain ?? null;
  const segments = ctx.asrSegments ?? ctx.asrResult?.segments;
  const aliasKeys = runtime.listAliasExactKeys();

  const kenlmScorer = enableKenLMGate ? createKenlmBatchScorer() : null;
  const fwStartMs = Date.now();
  const spanResolution = await resolveFwSpans(
    rawText,
    config,
    segments,
    aliasKeys,
    kenlmScorer
  );
  const spanDiagnostics = spanResolution.spans;

  if (spanDiagnostics.length === 0) {
    ctx.segmentForJobResult = rawText;
    ctx.fwDetectorStepMs = Date.now() - fwStartMs;
    const result = buildEarlyExitResult(configSnapshot, runtimeDiagBase, spanResolution);
    ctx.fwDetectorResult = result;
    return result;
  }

  const sessionIntent = getLexiconSessionIntentFromContext(ctx);
  const decision = await runWithLexiconRecallContext({ sessionIntent }, () =>
    runWithRecallV2Diagnostics(async () => {
      if (config.useSentenceLevelRerank) {
        return runFwSentenceRerankPipeline({
          rawText,
          spans: spanDiagnostics,
          runtime,
          profile,
          config: {
            minPrior: config.minPrior,
            maxSentenceCandidates: config.maxSentenceCandidates,
            minDeltaToReplace: config.minDeltaToReplace,
            candidateRequireRepairTarget: config.candidateRequireRepairTarget,
          },
          enabledDomains,
          kenlmScorer,
        });
      }
      return runFwTopKDecisionPipeline({
        rawText,
        spans: spanDiagnostics,
        runtime,
        profile,
        config: {
          topK: config.topK,
          minPrior: config.minPrior,
          finalScoreWeights: config.finalScoreWeights,
          candidateRequireRepairTarget: config.candidateRequireRepairTarget,
          repairTargetScoreBoost: config.repairTargetScoreBoost,
        },
        enabledDomains,
        kenlmScorer,
        gateOptions,
      });
    })
  );
  ctx.fwDetectorStepMs = Date.now() - fwStartMs;

  ctx.segmentForJobResult = applyFwSpanReplacements(rawText, decision.approved);
  if (decision.approved.length > 0) {
    ctx.asrRepairApplied = true;
  }

  const summary = buildSummary(decision.spans, decision);
  const v2QueryStats =
    isLexiconRuntimeV2RecallEnabled() ? getLexiconRuntimeV2().getAndResetTierQueryStats() : null;
  const recallV2Diagnostics = flushRecallJobDiagnostics({
    v2SqlQueryCount: v2QueryStats?.sqlQueries ?? 0,
    v2CacheHits: v2QueryStats?.cacheHits ?? 0,
    v2CacheMisses: v2QueryStats?.cacheMisses ?? 0,
    kenlmQueryCount: summary.kenlmQueryCount,
  });
  const kenlmVetoMs = decision.kenlmTiming?.batchMs ?? 0;
  const kenlmVetoQueryCount = decision.kenlmQueryCount;
  const result: FwDetectorResult = {
    enabled: true,
    triggered: summary.spanCount > 0,
    reason: resolveResultReason(decision.spans, summary.appliedCount),
    configSnapshot,
    summary,
    runtime: runtimeDiagBase,
    replacements: decision.replacements,
    spans: decision.spans,
    spanSelection: spanResolution.spanSelection,
    kenlmSpanGate: spanResolution.kenlmSpanGate,
    fwMetadataSpanGate: spanResolution.fwMetadataSpanGate,
    kenlmVetoMs,
    kenlmVetoQueryCount,
    kenlmTiming: decision.kenlmTiming
      ? { batchMs: kenlmVetoMs, queryCount: kenlmVetoQueryCount }
      : undefined,
    ...(recallV2Diagnostics ? { recallV2Diagnostics } : {}),
    ...('sentenceRerank' in decision && decision.sentenceRerank
      ? { sentenceRerank: decision.sentenceRerank }
      : {}),
  };
  ctx.fwDetectorResult = result;
  return result;
}
