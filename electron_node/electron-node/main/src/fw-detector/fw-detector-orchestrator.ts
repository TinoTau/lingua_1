import { createKenlmBatchScorer } from '../asr-repair/sentence-rerank/kenlm-scorer';
import { ensureLexiconRuntimeLoaded, getLexiconRuntime } from '../lexicon/lexicon-runtime-holder';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import { getProfileSnapshotFromContext } from '../session-runtime/turn-profile-binding';
import type { JobContext } from '../pipeline/context/job-context';
import { applyFwSpanReplacements } from './apply-span-replacements';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import { runFwTopKDecisionPipeline } from './fw-topk-decision-pipeline';
import { detectSuspiciousSpansV1 } from './suspicious-span-detector-v1';
import { createSpanDetectorHint } from './span-detector-hint';
import { lexiconBundleFileNames, resolveLexiconBundleDir } from '../lexicon/lexicon-bundle-path';
import type {
  FwDetectorResult,
  FwDetectorRuntimeDiag,
  FwDetectorSummary,
  FwSpanDiagnostics,
  KenlmGateMode,
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
  const hintFn = createSpanDetectorHint();

  const spanDetection = detectSuspiciousSpansV1(rawText, config, segments, hintFn);
  const spanDiagnostics = spanDetection.spans;
  const kenlmScorer = enableKenLMGate ? createKenlmBatchScorer() : null;

  const decision = await runFwTopKDecisionPipeline({
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

  ctx.segmentForJobResult = applyFwSpanReplacements(rawText, decision.approved);
  if (decision.approved.length > 0) {
    ctx.asrRepairApplied = true;
  }

  const summary = buildSummary(spanDiagnostics, decision);
  const result: FwDetectorResult = {
    enabled: true,
    triggered: summary.spanCount > 0,
    reason: resolveResultReason(spanDiagnostics, summary.appliedCount),
    configSnapshot,
    summary,
    runtime: runtimeDiagBase,
    replacements: decision.replacements,
    spans: spanDiagnostics,
    spanSelection: spanDetection.spanSelection,
    kenlmTiming: decision.kenlmTiming
      ? { batchMs: decision.kenlmTiming.batchMs, queryCount: decision.kenlmQueryCount }
      : undefined,
  };
  ctx.fwDetectorResult = result;
  return result;
}
