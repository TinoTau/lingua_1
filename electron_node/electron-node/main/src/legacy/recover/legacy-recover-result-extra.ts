/**
 * @deprecated Legacy Recover-only module.
 * Not part of FW frozen main chain.
 * Do not import from FW pipeline, FW Detector, Aggregation, Dedup, Translation, or Result Builder (FW path).
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { AsrKenlmMeta } from '../../task-router/asr-evidence-types';
import { JobContext } from '../../pipeline/context/job-context';
import { buildRecoverQualityConfigSnapshot } from '../../recover-quality/quality-config';
import {
  buildLegacyRecoverContractExtra,
  RECOVER_CONTRACT_VERSION_V5,
  resolveRecoverContractVersion,
} from './legacy-recover-contract';
import { buildLexiconRecallTrace } from './legacy-v5-metrics';

function hasKenlmMetaForExtra(meta: AsrKenlmMeta): boolean {
  return (
    meta.kenlm_available !== undefined ||
    meta.kenlm_called_count !== undefined ||
    meta.kenlm_veto_count !== undefined ||
    meta.kenlm_vote_boost_count !== undefined ||
    meta.kenlm_decision !== undefined ||
    meta.lm_score_raw !== undefined ||
    meta.lm_score_candidate !== undefined
  );
}

/** @deprecated Legacy Recover-only. Not used by FW frozen main chain. */
export function buildLegacyRecoverResultExtra(
  job: JobAssignMessage,
  ctx: JobContext,
  coreExtra: Record<string, unknown>
): Record<string, unknown> {
  const recoverContract = buildLegacyRecoverContractExtra(job, ctx);
  return {
    ...coreExtra,
    ...(ctx.asrNbest && ctx.asrNbest.length > 0
      ? { asr_nbest: ctx.asrNbest, asr_nbest_count: ctx.asrNbest.length }
      : {}),
    ...(ctx.asrHypotheses && ctx.asrHypotheses.length > 0
      ? {
          asr_hypotheses: ctx.asrHypotheses,
          recall_hypothesis_text: ctx.asrHypotheses[0]?.text,
        }
      : {}),
    lexicon_runtime_status: recoverContract.lexicon_runtime_status,
    lexicon_manifest_version: recoverContract.lexicon_manifest_version,
    ...(recoverContract.lexicon_runtime_error
      ? { lexicon_runtime_error: recoverContract.lexicon_runtime_error }
      : {}),
    ...(recoverContract.lexicon_disabled_reason
      ? { lexicon_disabled_reason: recoverContract.lexicon_disabled_reason }
      : {}),
    recover_contract_version: recoverContract.recover_contract_version,
    recover_lifecycle: recoverContract.recover_lifecycle,
    nbest_synthetic: recoverContract.nbest_synthetic,
    segment_synthetic: recoverContract.segment_synthetic,
    ctc_nbest_preserved: recoverContract.ctc_nbest_preserved,
    aggregation_resync_reason: recoverContract.aggregation_resync_reason,
    sentence_repair: recoverContract.sentence_repair,
    ...(recoverContract.restore_metrics
      ? { restore_metrics: recoverContract.restore_metrics }
      : {}),
    ...(recoverContract.recover_skipped === true ? { recover_skipped: true } : {}),
    ...(recoverContract.repair_skip_reason != null
      ? { repair_skip_reason: recoverContract.repair_skip_reason }
      : {}),
    ...(ctx.asrKenlmMeta && hasKenlmMetaForExtra(ctx.asrKenlmMeta)
      ? { asr_kenlm_meta: ctx.asrKenlmMeta }
      : {}),
    ...(ctx.lexiconRecallTruncated === true ? { lexicon_recall_truncated: true } : {}),
    ...(ctx.windowCandidates && ctx.windowCandidates.length > 0
      ? { window_candidates: ctx.windowCandidates }
      : {}),
    ...(ctx.windowRecallDiagnostics
      ? { window_recall_diagnostics: ctx.windowRecallDiagnostics }
      : {}),
    ...(ctx.segmentAlignmentDiagnostics
      ? { segment_alignment_diagnostics: ctx.segmentAlignmentDiagnostics }
      : {}),
    ...(ctx.crossBoundaryRiskReport
      ? { cross_boundary_risk: ctx.crossBoundaryRiskReport }
      : {}),
    ...(ctx.windowRecallDiagnostics?.nbestAugment
      ? { nbest_augment_diagnostics: ctx.windowRecallDiagnostics.nbestAugment }
      : {}),
    ...(ctx.recallCoverageDiagnostics
      ? { recall_coverage_diagnostics: ctx.recallCoverageDiagnostics }
      : {}),
    ...(ctx.expansionDiagnostics
      ? {
          expansion_funnel: ctx.expansionDiagnostics.expansionFunnel,
          expansion_selector_reject: ctx.expansionDiagnostics.selectorRejectByMaxReplacements,
        }
      : {}),
    qualityConfig: buildRecoverQualityConfigSnapshot(),
    ...(resolveRecoverContractVersion() === RECOVER_CONTRACT_VERSION_V5 && ctx.v5Metrics
      ? { v5_metrics: ctx.v5Metrics }
      : {}),
    ...(resolveRecoverContractVersion() === RECOVER_CONTRACT_VERSION_V5 &&
    ctx.windowCandidates?.length
      ? (() => {
          const { trace, trace_truncated } = buildLexiconRecallTrace(
            ctx.windowCandidates!,
            ctx.sentenceRepairDecision?.replacements
          );
          return {
            lexicon_recall_trace: trace,
            ...(trace_truncated ? { lexicon_recall_trace_truncated: true } : {}),
          };
        })()
      : {}),
    ...(ctx.sentenceCandidates && ctx.sentenceCandidates.length > 0
      ? { sentence_candidates: ctx.sentenceCandidates }
      : {}),
    ...(ctx.sentenceCandidateTrace && ctx.sentenceCandidateTrace.length > 0
      ? { sentence_candidate_trace: ctx.sentenceCandidateTrace }
      : {}),
  };
}
