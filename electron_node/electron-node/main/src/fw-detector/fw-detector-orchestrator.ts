import { ensureLexiconRuntimeV2Loaded } from '../lexicon-v2/lexicon-runtime-v2-holder';
import { defaultGeneralProfile } from '../lexicon-v2/profile-registry';
import { getProfileSnapshotFromContext } from '../session-runtime/turn-profile-binding';
import type { JobContext } from '../pipeline/context/job-context';
import { loadFwDetectorRuntimeConfig } from './fw-config';
import { runFwDetectorV4Path } from './fw-detector-v4-path';
import { buildFwRuntimeDiag } from './fw-runtime-diag';
import { loadPinyinImeV2RuntimeConfig } from './pinyin-ime-v2/pinyin-ime-v2-config';
import { resolveRecallScope } from '../lexicon-v2/resolve-recall-enabled-fine-domains';
import type { FwDetectorResult, FwDetectorSummary, KenlmGateMode } from './types';
import { normalizeForFwRepairInput } from './normalize-for-fw-repair';
import {
  beginCaptureV2Case,
  captureV2Boundary,
  captureV2Identity,
  canonicalHash,
  isFrozenEvidenceCaptureV2Enabled,
} from '../capture-v2';

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
  configuredEnabledDomains: string[],
  recallDomainScope: string[],
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
    enabledDomains: configuredEnabledDomains,
    recallDomainScope,
    candidateRequireRepairTarget: config.candidateRequireRepairTarget,
    maxSentenceCandidates: config.maxSentenceCandidates,
    minDeltaToReplace: config.minDeltaToReplace,
    scoreMode: 'raw_log_delta' as const,
    toneTimestampOnlyEnabled: config.toneTimestampOnlyEnabled,
  };
}

export async function runFwDetectorOrchestrator(ctx: JobContext): Promise<FwDetectorResult> {
  if (isFrozenEvidenceCaptureV2Enabled()) {
    beginCaptureV2Case(ctx.sessionId ?? null);
    captureV2Identity({
      schema_gate: 'FROZEN_EVIDENCE_CAPTURE_V2=1',
      session_id: ctx.sessionId ?? null,
    });
  }
  const config = loadFwDetectorRuntimeConfig();
  const imeConfig = loadPinyinImeV2RuntimeConfig();
  const configuredEnabledDomains =
    Array.isArray(ctx.fwDetectorEnabledDomainsOverride) && ctx.fwDetectorEnabledDomainsOverride.length > 0
      ? ctx.fwDetectorEnabledDomainsOverride
      : config.enabledDomains;
  const { enableKenLMGate, kenlmGateMode, kenlmVetoThreshold } = resolveKenlmRuntime(ctx, config);
  const rawAsrText = (ctx.rawAsrText ?? '').trim();

  if (!rawAsrText) {
    return {
      enabled: true,
      triggered: false,
      reason: 'empty_raw',
      pipelinePath: 'v4',
      configSnapshot: buildConfigSnapshot(
        config,
        imeConfig,
        configuredEnabledDomains,
        [],
        enableKenLMGate,
        kenlmGateMode,
        kenlmVetoThreshold
      ),
      summary: emptySummary(),
      runtime: {
        loaded: false,
        status: 'empty_raw',
        bundleDir: null,
        sqlitePath: null,
        manifestVersion: null,
        lexiconRows: null,
        profilePrimary: null,
        enabledDomains: configuredEnabledDomains,
      },
      spans: [],
    };
  }

  const v2State = ensureLexiconRuntimeV2Loaded();
  const profile = getProfileSnapshotFromContext(ctx) ?? defaultGeneralProfile();
  const recallScope =
    v2State.status === 'ok'
      ? resolveRecallScope({
          jobOverride: ctx.fwDetectorEnabledDomainsOverride,
          configEnabledDomains: configuredEnabledDomains,
        })
      : undefined;
  const recallDomainScope = recallScope?.domainIds ?? [];
  const runtimeDiagBase = buildFwRuntimeDiag(
    v2State,
    profile.primaryDomain ?? null,
    configuredEnabledDomains,
    recallScope
  );
  const configSnapshot = buildConfigSnapshot(
    config,
    imeConfig,
    configuredEnabledDomains,
    recallDomainScope,
    enableKenLMGate,
    kenlmGateMode,
    kenlmVetoThreshold
  );

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

  if (!recallDomainScope.length) {
    return {
      enabled: true,
      triggered: false,
      reason: 'recall_domain_scope_empty',
      pipelinePath: 'v4',
      configSnapshot,
      summary: emptySummary(),
      runtime: runtimeDiagBase,
      spans: [],
    };
  }

  const normalized = normalizeForFwRepairInput(rawAsrText);
  ctx.fwRepairNormalizedText = normalized.repairText;
  ctx.fwRepairScriptNormalized = normalized.scriptNormalized;

  // Capture V2 B1 — OBSERVABILITY_ONLY (FROZEN_EVIDENCE_CAPTURE_V2=1); no-op when OFF.
  if (isFrozenEvidenceCaptureV2Enabled()) {
    const segments = ctx.asrSegments ?? [];
    captureV2Boundary('B1', {
      rawAsrText: normalized.rawAsrText,
      repairText: normalized.repairText,
      scriptNormalized: normalized.scriptNormalized,
      segments,
      rawAsrHash: canonicalHash(normalized.rawAsrText),
      repairTextHash: canonicalHash(normalized.repairText),
      segmentEvidenceHash: canonicalHash(segments),
    });
  }

  return runFwDetectorV4Path({
    ctx,
    rawText: normalized.repairText,
    config,
    configSnapshot,
    runtimeDiagBase,
    profile,
    recallDomainScope,
    enableKenLMGate,
  });
}
