import { ensureLexiconRuntimeV2Loaded } from '../lexicon-v2/lexicon-runtime-v2-holder';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import { getProfileSnapshotFromContext } from '../session-runtime/turn-profile-binding';
import type { JobContext } from '../pipeline/context/job-context';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import { runFwDetectorV4Path } from './fw-detector-v4-path';
import { buildFwRuntimeDiag } from './fw-runtime-diag';
import { loadPinyinImeV2RuntimeConfig } from './pinyin-ime-v2/pinyin-ime-v2-config';
import type { FwDetectorResult, FwDetectorSummary, KenlmGateMode } from './types';

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

function buildConfigSnapshot(
  config: ReturnType<typeof loadFwDetectorRuntimeConfig>,
  imeConfig: ReturnType<typeof loadPinyinImeV2RuntimeConfig>,
  enabledDomains: string[],
  enableKenLMGate: boolean,
  kenlmGateMode: KenlmGateMode,
  kenlmVetoThreshold: number
): Record<string, unknown> {
  return {
    pipelinePath: 'v4' as const,
    spanAssemblyV4Enabled: true,
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
    scoreMode: 'raw_log_delta' as const,
    toneTimestampOnlyEnabled: config.toneTimestampOnlyEnabled,
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
  const configSnapshot = buildConfigSnapshot(
    config,
    imeConfig,
    enabledDomains,
    enableKenLMGate,
    kenlmGateMode,
    kenlmVetoThreshold
  );

  if (!rawText) {
    return {
      enabled: true,
      triggered: false,
      reason: 'empty_raw',
      pipelinePath: 'v4',
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
      pipelinePath: 'v4',
      configSnapshot,
      summary: emptySummary(),
      runtime: runtimeDiagBase,
      spans: [],
    };
  }

  return runFwDetectorV4Path({
    ctx,
    rawText,
    config,
    configSnapshot,
    runtimeDiagBase,
    profile,
    enabledDomains,
    enableKenLMGate,
  });
}
