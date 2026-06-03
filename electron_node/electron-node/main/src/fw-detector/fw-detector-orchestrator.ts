import { createKenlmBatchScorer } from '../asr-repair/sentence-rerank/kenlm-scorer';
import { ensureLexiconRuntimeV2Loaded } from '../lexicon-v2/lexicon-runtime-v2-holder';
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
import type { JobContext } from '../pipeline/context/job-context';
import { applyFwSpanReplacements } from './apply-span-replacements';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import { runFwSentenceRerankPipeline } from './fw-sentence-rerank-pipeline';
import { buildFwRuntimeDiag } from './fw-runtime-diag';
import { loadPinyinImeV2RuntimeConfig } from './pinyin-ime-v2/pinyin-ime-v2-config';
import { resolvePinyinImeV2Spans } from './pinyin-ime-v2/resolve-pinyin-ime-v2-spans';
import type {
  FwDetectorResult,
  FwDetectorRuntimeDiag,
  FwDetectorSummary,
  FwSpanDiagnostics,
  KenlmGateMode,
  PinyinImeV2ActiveDiagnostics,
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

  return { enableKenLMGate, kenlmGateMode, kenlmVetoThreshold };
}

function buildEarlyExitResult(
  configSnapshot: Record<string, unknown>,
  runtimeDiagBase: FwDetectorRuntimeDiag,
  pinyinImeV2: PinyinImeV2ActiveDiagnostics
): FwDetectorResult {
  return {
    enabled: true,
    triggered: false,
    reason: 'no_spans',
    configSnapshot,
    summary: emptySummary(),
    runtime: runtimeDiagBase,
    spans: [],
    pinyinImeV2,
    kenlmVetoMs: 0,
    kenlmVetoQueryCount: 0,
  };
}

export async function runFwDetectorOrchestrator(ctx: JobContext): Promise<FwDetectorResult> {
  const config = loadFwDetectorRuntimeConfig();
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const enabledDomains =
    Array.isArray(ctx.fwDetectorEnabledDomainsOverride) && ctx.fwDetectorEnabledDomainsOverride.length > 0
      ? ctx.fwDetectorEnabledDomainsOverride
      : config.enabledDomains;
  const { enableKenLMGate, kenlmGateMode, kenlmVetoThreshold } = resolveKenlmRuntime(ctx, config);
  const rawText = (ctx.rawAsrText ?? '').trim();
  const configSnapshot: Record<string, unknown> = {
    pinyinImeV2: {
      enabled: imeConfig.enabled,
      topK: imeConfig.topK,
      maxApprovedSpans: imeConfig.maxApprovedSpans,
    },
    minPrior: config.minPrior,
    enableKenLMGate,
    kenlmGateMode,
    kenlmDeltaThreshold: config.kenlmDeltaThreshold,
    kenlmVetoThreshold,
    enabledDomains,
    candidateRequireRepairTarget: config.candidateRequireRepairTarget,
    maxSentenceCandidates: config.maxSentenceCandidates,
    minDeltaToReplace: config.minDeltaToReplace,
  };

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
        bundleDir: null,
        sqlitePath: null,
        manifestVersion: null,
        lexiconRows: null,
        profilePrimary: null,
        enabledDomains,
      },
      spans: [],
    };
  }

  const v2State = ensureLexiconRuntimeV2Loaded();
  const profile = getProfileSnapshotFromContext(ctx) ?? defaultGeneralProfile();
  const runtimeDiagBase = buildFwRuntimeDiag(v2State, profile.primaryDomain ?? null, enabledDomains);

  if (v2State.status !== 'ok') {
    return {
      enabled: true,
      triggered: false,
      reason: 'lexicon_v2_unavailable',
      configSnapshot,
      summary: emptySummary(),
      runtime: runtimeDiagBase,
      spans: [],
    };
  }

  const kenlmScorer = enableKenLMGate ? createKenlmBatchScorer() : null;
  const fwStartMs = Date.now();

  const spanResolution = resolvePinyinImeV2Spans({
    rawText,
    profile,
    enabledDomains,
    minPrior: config.minPrior,
    imeConfig,
  });
  const spanDiagnostics = spanResolution.spans;
  const pinyinImeV2 = spanResolution.pinyinImeV2;

  if (spanDiagnostics.length === 0) {
    ctx.segmentForJobResult = rawText;
    ctx.fwDetectorStepMs = Date.now() - fwStartMs;
    const result = buildEarlyExitResult(configSnapshot, runtimeDiagBase, pinyinImeV2);
    ctx.fwDetectorResult = result;
    return result;
  }

  const sessionIntent = getLexiconSessionIntentFromContext(ctx);
  const decision = await runWithLexiconRecallContext({ sessionIntent }, () =>
    runWithRecallV2Diagnostics(async () =>
      runFwSentenceRerankPipeline({
        rawText,
        spans: spanDiagnostics,
        profile,
        config: {
          minPrior: config.minPrior,
          maxSentenceCandidates: config.maxSentenceCandidates,
          minDeltaToReplace: config.minDeltaToReplace,
          candidateRequireRepairTarget: config.candidateRequireRepairTarget,
        },
        enabledDomains,
        kenlmScorer,
      })
    )
  );
  ctx.fwDetectorStepMs = Date.now() - fwStartMs;

  ctx.segmentForJobResult = applyFwSpanReplacements(rawText, decision.approved);
  if (decision.approved.length > 0) {
    ctx.asrRepairApplied = true;
  }

  const summary = buildSummary(decision.spans, decision);
  const v2QueryStats = getLexiconRuntimeV2().getAndResetTierQueryStats();
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
    pinyinImeV2,
    kenlmVetoMs,
    kenlmVetoQueryCount,
    kenlmTiming: decision.kenlmTiming
      ? { batchMs: kenlmVetoMs, queryCount: kenlmVetoQueryCount }
      : undefined,
    ...(recallV2Diagnostics ? { recallV2Diagnostics } : {}),
    sentenceRerank: decision.sentenceRerank,
  };
  ctx.fwDetectorResult = result;
  return result;
}
