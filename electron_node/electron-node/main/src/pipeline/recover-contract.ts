/**
 * Recover — 契约说明见 electron_node/electron-node/docs/RECOVER.md。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';
import {
  getLexiconRecallSkipReason,
  isLexiconRecallEnabled,
  isLexiconRecallLanguage,
  isFwDetectorFeatureEnabled,
  resolveJobUseLexicon,
} from '../node-config';
import { ensureLexiconRuntimeLoaded } from '../lexicon/lexicon-runtime-holder';
import { markLexiconDisabled } from '../lexicon/lexicon-runtime';
import type { LexiconRuntimeStatus } from '../lexicon/lexicon-types';
import type { RestoreMetrics } from '../asr-repair/restore-metrics';
import type { SentenceRepairExtra } from '../asr-repair/sentence-rerank/sentence-repair-observability';
import { loadNodeConfig } from '../node-config';
import type { RecoverLifecycle } from './recover-contract-types';
import type { V5Metrics } from './v5-metrics';

export type { RecoverLifecycle } from './recover-contract-types';
export const RECOVER_CONTRACT_VERSION = 'historical-restore-v1';
export const RECOVER_CONTRACT_VERSION_V5 = 'v5-scored-lexicon-topk';

export function resolveRecoverContractVersion(): string {
  const v = loadNodeConfig().features?.lexiconRecall?.contractVersion;
  if (v === 'historical-restore-v1') {
    return RECOVER_CONTRACT_VERSION;
  }
  return RECOVER_CONTRACT_VERSION_V5;
}

export type SentenceRepairContract = {
  executed: boolean;
  modified: boolean;
  candidateSource: string | null;
  selectedText: string;
  pickedHypothesisRank: number;
  replacements: SentenceRepairExtra['replacements'];
  skipReason?: string | null;
  combinedScore?: number;
  kenlmScore?: number;
  kenlmTiming?: SentenceRepairExtra['kenlmTiming'];
  rerankMs?: number;
};

export type RecoverContractExtra = {
  lexicon_runtime_status: LexiconRuntimeStatus;
  lexicon_manifest_version: string | null;
  lexicon_runtime_error?: string;
  lexicon_disabled_reason?: string;
  recover_contract_version: string;
  recover_lifecycle: RecoverLifecycle;
  recover_skipped?: boolean;
  repair_skip_reason?: string | null;
  restore_metrics?: RestoreMetrics;
  ctc_nbest_preserved: boolean;
  segment_synthetic: boolean;
  aggregation_resync_reason: string | null;
  nbest_synthetic: boolean;
  sentence_repair: SentenceRepairContract;
  v5_metrics?: V5Metrics;
};

export function stampRecoverPipelineSkip(
  job: JobAssignMessage,
  ctx: JobContext,
  reason: string
): void {
  if (!ctx.lexiconRuntimeStatus) {
    const disabled = markLexiconDisabled();
    ctx.lexiconRuntimeStatus = disabled.status;
    if (disabled.errorMessage) {
      ctx.lexiconRuntimeError = disabled.errorMessage;
    }
  }
  ctx.recoverLifecycle = buildRecoverLifecycleFromCtx(job, ctx, reason);
}

export function resolveLexiconRuntimeContract(
  job: JobAssignMessage,
  ctx: JobContext
): Pick<
  RecoverContractExtra,
  | 'lexicon_runtime_status'
  | 'lexicon_manifest_version'
  | 'lexicon_runtime_error'
  | 'lexicon_disabled_reason'
> {
  if (ctx.lexiconRuntimeStatus) {
    return {
      lexicon_runtime_status: ctx.lexiconRuntimeStatus,
      lexicon_manifest_version: ctx.lexiconManifestVersion ?? null,
      ...(ctx.lexiconRuntimeError ? { lexicon_runtime_error: ctx.lexiconRuntimeError } : {}),
      ...(ctx.lexiconDisabledReason ? { lexicon_disabled_reason: ctx.lexiconDisabledReason } : {}),
    };
  }

  const skipReason = getLexiconRecallSkipReason(job, ctx);
  if (skipReason) {
    /**
     * FW Detector 需要 lexicon runtime 作为 span recall 数据源，但它不等价于 LEXICON_RECALL(step)。
     * 因此在 FW 模式下，即使 lexiconRecall feature 被关闭，也允许加载 sqlite runtime 并报告真实状态。
     *
     * 注意：这里不改变 recover lifecycle（仍保持 LEXICON_RECALL step 被跳过）。
     */
    const fwWantsRuntime =
      skipReason === 'feature_lexicon_recall_disabled' &&
      isFwDetectorFeatureEnabled() &&
      resolveJobUseLexicon(job);
    if (fwWantsRuntime) {
      const runtimeState = ensureLexiconRuntimeLoaded();
      return {
        lexicon_runtime_status: runtimeState.status as LexiconRuntimeStatus,
        lexicon_manifest_version: runtimeState.manifestVersion ?? null,
        lexicon_disabled_reason: skipReason,
        ...(runtimeState.errorMessage ? { lexicon_runtime_error: runtimeState.errorMessage } : {}),
      };
    }
    const disabled = markLexiconDisabled();
    return {
      lexicon_runtime_status: disabled.status,
      lexicon_manifest_version: null,
      lexicon_disabled_reason: skipReason,
      ...(disabled.errorMessage ? { lexicon_runtime_error: disabled.errorMessage } : {}),
    };
  }

  if (!isLexiconRecallLanguage(job, ctx)) {
    return {
      lexicon_runtime_status: 'disabled',
      lexicon_manifest_version: null,
      lexicon_disabled_reason: 'unsupported_source_language',
    };
  }

  const runtimeState = ensureLexiconRuntimeLoaded();
  return {
    lexicon_runtime_status: runtimeState.status,
    lexicon_manifest_version: runtimeState.manifestVersion ?? null,
    ...(runtimeState.errorMessage ? { lexicon_runtime_error: runtimeState.errorMessage } : {}),
  };
}

export function buildRecoverLifecycleFromCtx(
  job: JobAssignMessage,
  ctx: JobContext,
  pipelineSkipReason?: string
): RecoverLifecycle {
  if (ctx.recoverLifecycle) {
    return ctx.recoverLifecycle;
  }

  const gateReason = pipelineSkipReason ?? getLexiconRecallSkipReason(job, ctx);
  if (gateReason) {
    const gated =
      gateReason === 'job_use_lexicon_false' ||
      gateReason === 'feature_lexicon_recall_disabled';
    return {
      executed: false,
      gated,
      skipped: true,
      skipReason: gateReason,
    };
  }

  if (ctx.sentenceRepairExtra?.executed === true) {
    return {
      executed: true,
      gated: false,
      skipped: false,
      skipReason: null,
    };
  }

  if (ctx.recoverLifecycleSkipReason) {
    return {
      executed: false,
      gated: false,
      skipped: true,
      skipReason: ctx.recoverLifecycleSkipReason,
    };
  }

  const lexiconStatus = ctx.lexiconRuntimeStatus;
  if (lexiconStatus === 'error') {
    return {
      executed: false,
      gated: false,
      skipped: true,
      skipReason: ctx.lexiconRuntimeError ?? 'lexicon_runtime_error',
    };
  }

  if (lexiconStatus === 'ok' && isLexiconRecallEnabled(job)) {
    return {
      executed: true,
      gated: false,
      skipped: false,
      skipReason: null,
    };
  }

  return {
    executed: false,
    gated: false,
    skipped: true,
    skipReason: 'recover_not_run',
  };
}

export function buildCtcContract(ctx: JobContext): Pick<
  RecoverContractExtra,
  'ctc_nbest_preserved' | 'segment_synthetic' | 'aggregation_resync_reason' | 'nbest_synthetic'
> {
  const nbestCount = ctx.asrNbest?.length ?? 0;
  const nbestSynthetic = ctx.nbestSynthetic ?? nbestCount <= 1;
  const ctcNbestPreserved =
    ctx.ctcNbestPreserved ?? (nbestCount > 1 && nbestSynthetic !== true);
  return {
    nbest_synthetic: nbestSynthetic,
    ctc_nbest_preserved: ctcNbestPreserved,
    segment_synthetic: ctx.segmentSynthetic ?? false,
    aggregation_resync_reason: ctx.aggregationResyncReason ?? null,
  };
}

function mapSentenceRepairExtra(extra: SentenceRepairExtra): SentenceRepairContract {
  return {
    executed: extra.executed,
    modified: extra.modified,
    candidateSource: extra.candidateSource,
    selectedText: extra.selectedText,
    pickedHypothesisRank: extra.hypothesisIndex ?? 0,
    replacements: extra.replacements,
    skipReason: extra.skipReason ?? null,
    combinedScore: extra.combinedScore,
    kenlmScore: extra.kenlmScore,
    kenlmTiming: extra.kenlmTiming,
    rerankMs: extra.rerankMs,
  };
}

export function buildSentenceRepairContract(
  job: JobAssignMessage,
  ctx: JobContext,
  lifecycle: RecoverLifecycle
): SentenceRepairContract {
  if (ctx.sentenceRepairExtra) {
    return mapSentenceRepairExtra(ctx.sentenceRepairExtra);
  }

  const baseline = (ctx.repairedText ?? ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
  const skipReason = lifecycle.skipReason;

  if (ctx.sentenceRepairDecision) {
    const picked = ctx.sentenceRepairDecision;
    const modified = ctx.asrRepairApplied === true;
    return {
      executed: true,
      modified,
      candidateSource: picked.candidateSource,
      selectedText: picked.text,
      pickedHypothesisRank: picked.hypothesisIndex ?? 0,
      replacements: picked.replacements.map((r) => ({
        from: r.from,
        to: r.to,
        start: r.start,
        end: r.end,
        phoneticScore: r.phoneticScore,
        hotwordId: r.hotwordId,
      })),
      skipReason,
    };
  }

  return {
    executed: lifecycle.executed,
    modified: false,
    candidateSource: null,
    selectedText: baseline,
    pickedHypothesisRank: 0,
    replacements: [],
    skipReason,
  };
}

export function buildRecoverContractExtra(
  job: JobAssignMessage,
  ctx: JobContext,
  pipelineSkipReason?: string
): RecoverContractExtra {
  const lexicon = resolveLexiconRuntimeContract(job, ctx);
  const lifecycle = buildRecoverLifecycleFromCtx(job, ctx, pipelineSkipReason);
  const ctc = buildCtcContract(ctx);
  const sentence_repair = buildSentenceRepairContract(job, ctx, lifecycle);

  const version = resolveRecoverContractVersion();
  return {
    ...lexicon,
    recover_contract_version: version,
    recover_lifecycle: lifecycle,
    ...(version === RECOVER_CONTRACT_VERSION_V5 && ctx.v5Metrics
      ? { v5_metrics: ctx.v5Metrics }
      : {}),
    ...(ctx.recoverSkipped === true ? { recover_skipped: true } : {}),
    ...(ctx.repairSkipReason != null ? { repair_skip_reason: ctx.repairSkipReason } : {}),
    ...(ctx.restoreMetrics ? { restore_metrics: ctx.restoreMetrics } : {}),
    ...ctc,
    sentence_repair,
  };
}
