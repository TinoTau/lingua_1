/**
 * @deprecated Legacy ASR repair-only module.
 * Not part of FW frozen main chain.
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { AsrKenlmMeta } from '../../task-router/asr-evidence-types';
import { JobContext } from '../../pipeline/context/job-context';
import { buildAsrRepairQualityConfigSnapshot } from '../../asr-repair-quality/quality-config';
import {
  buildLegacyAsrRepairContractExtra,
  LEGACY_ASR_REPAIR_CONTRACT_V5,
  resolveLegacyAsrRepairContractVersion,
} from './legacy-asr-repair-contract';
import { buildLexiconRecallTrace } from './legacy-v5-metrics';
import { syncJobContextLegacyPartition } from '../../pipeline/context/job-context-legacy-sync';

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

/** Legacy ASR repair result.extra — non-FW engine only. */
export function buildLegacyAsrRepairResultExtra(
  job: JobAssignMessage,
  ctx: JobContext,
  coreExtra: Record<string, unknown>
): Record<string, unknown> {
  syncJobContextLegacyPartition(ctx);
  const asrRepairContract = buildLegacyAsrRepairContractExtra(job, ctx);
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
    lexicon_runtime_status: asrRepairContract.lexicon_runtime_status,
    lexicon_manifest_version: asrRepairContract.lexicon_manifest_version,
    ...(asrRepairContract.lexicon_runtime_error
      ? { lexicon_runtime_error: asrRepairContract.lexicon_runtime_error }
      : {}),
    ...(asrRepairContract.lexicon_disabled_reason
      ? { lexicon_disabled_reason: asrRepairContract.lexicon_disabled_reason }
      : {}),
    asr_repair_contract_version: asrRepairContract.asr_repair_contract_version,
    asr_repair_lifecycle: asrRepairContract.asr_repair_lifecycle,
    nbest_synthetic: asrRepairContract.nbest_synthetic,
    segment_synthetic: asrRepairContract.segment_synthetic,
    ctc_nbest_preserved: asrRepairContract.ctc_nbest_preserved,
    aggregation_resync_reason: asrRepairContract.aggregation_resync_reason,
    sentence_repair: asrRepairContract.sentence_repair,
    ...(asrRepairContract.restore_metrics
      ? { restore_metrics: asrRepairContract.restore_metrics }
      : {}),
    ...(asrRepairContract.asr_repair_skipped === true ? { asr_repair_skipped: true } : {}),
    ...(asrRepairContract.repair_skip_reason != null
      ? { repair_skip_reason: asrRepairContract.repair_skip_reason }
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
    qualityConfig: buildAsrRepairQualityConfigSnapshot(),
    ...(resolveLegacyAsrRepairContractVersion() === LEGACY_ASR_REPAIR_CONTRACT_V5 && ctx.v5Metrics
      ? { v5_metrics: ctx.v5Metrics }
      : {}),
    ...(resolveLegacyAsrRepairContractVersion() === LEGACY_ASR_REPAIR_CONTRACT_V5 &&
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
