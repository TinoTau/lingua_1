/**
 * @deprecated Legacy Recover-only module.
 * Not part of FW frozen main chain.
 * Do not import from FW pipeline, FW Detector, Aggregation, Dedup, Translation, or Result Builder (FW path).
 * See docs/RECOVER.md and legacy/recover/README.md.
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../../pipeline/context/job-context';
import {
  getLexiconRecallSkipReason,
  isLexiconRecallEnabled,
  isLexiconRecallLanguage,
} from '../../node-config';
import type { RestoreMetrics } from './asr-repair/restore-metrics';
import type { SentenceRepairExtra } from './asr-repair/sentence-rerank/sentence-repair-observability';
import { loadNodeConfig } from '../../node-config';
import { markLexiconDisabled } from '../../lexicon/lexicon-runtime';
import type { LexiconRuntimeStatus } from '../../lexicon/lexicon-types';
import type { RecoverLifecycle } from './legacy-recover-contract-types';
import type { V5Metrics } from './legacy-v5-metrics';
import { resolveLexiconRuntimeContract } from '../../pipeline/lexicon-runtime-contract';

export type { RecoverLifecycle } from './legacy-recover-contract-types';
export { resolveLexiconRuntimeContract };
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

  const baseline = (ctx.segmentForJobResult ?? ctx.asrText ?? '').trim();
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

/** @deprecated Legacy Recover-only. Not used by FW frozen main chain. */
export function buildLegacyRecoverContractExtra(
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
