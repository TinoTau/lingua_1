/**
 * ResultBuilder - 统一结果构建
 * 将 JobContext 转换为 JobResult
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { AsrKenlmMeta } from '../task-router/asr-evidence-types';
import { JobContext } from './context/job-context';
import { buildRecoverContractExtra } from './recover-contract';
import { RECOVER_CONTRACT_VERSION_V5, resolveRecoverContractVersion } from './recover-contract';
import { buildRecoverQualityConfigSnapshot } from '../recover-quality/quality-config';
import { buildLexiconRecallTrace } from './v5-metrics';
import { buildSessionResultExtra } from '../session-runtime/session-result-extra';
import logger from '../logger';

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

/**
 * 构建 JobResult
 */
export function buildJobResult(job: JobAssignMessage, ctx: JobContext): JobResult {
  const finalAsrText = (ctx.repairedText ?? '').trim();
  if (!finalAsrText && (ctx.segmentForJobResult ?? '').trim().length > 0) {
    logger.warn(
      { note: 'buildJobResult' },
      'ctx.repairedText empty but segmentForJobResult set, aggregation/semantic-repair should set repairedText'
    );
  }

  const recoverContract = buildRecoverContractExtra(job, ctx);

  const result: JobResult = {
    text_asr: finalAsrText,
    text_translated: ctx.translatedText || '',
    tts_audio: ctx.toneAudio || ctx.ttsAudio || '',
    tts_format: ctx.toneFormat || ctx.ttsFormat || 'opus',
    extra: {
      language_probability: ctx.asrResult?.language_probability || null,
      language_probabilities: ctx.languageProbabilities || null,
      detected_src_lang: ctx.detectedSourceLang || undefined,
      audioBuffered: (ctx as any).audioBuffered || false,
      pendingEmptyJobs: (ctx as any).pendingEmptyJobs || undefined,
      lid: ctx.lidMeta || undefined,
      router: ctx.routerMeta || undefined,
      ...(ctx.asrServiceId ? { asr_service_id: ctx.asrServiceId } : {}),
      ...(ctx.rawAsrText ? { raw_asr_text: ctx.rawAsrText } : {}),
      ...(ctx.asrDiagnostics ? { asr_diagnostics: ctx.asrDiagnostics } : {}),
      ...(ctx.fwDetectorResult ? { fw_detector: ctx.fwDetectorResult } : {}),
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
      ...(recoverContract.recover_skipped === true
        ? { recover_skipped: true }
        : {}),
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
      ...buildSessionResultExtra(job, ctx),
      ...(ctx.lexiconManifestReady ? { lexicon_manifest_ready: ctx.lexiconManifestReady } : {}),
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
    },
    asr_quality_level: ctx.asrResult?.badSegmentDetection?.isBad ? 'bad' : 'good',
    quality_score: ctx.qualityScore || ctx.asrResult?.badSegmentDetection?.qualityScore,
    reason_codes: ctx.asrResult?.badSegmentDetection?.reasonCodes,
    rerun_count: ctx.rerunCount || 0,
    segments: ctx.asrSegments || ctx.asrResult?.segments,
    segments_meta: ctx.asrResult?.segments
      ? {
        count: ctx.asrResult.segments.length,
        max_gap: calculateMaxGap(ctx.asrResult.segments),
        avg_duration: calculateAvgDuration(ctx.asrResult.segments),
      }
      : undefined,
    aggregation_applied: ctx.aggregationChanged || false,
    aggregation_action: ctx.aggregationAction,
    aggregation_metrics: ctx.aggregationMetrics,
    semantic_repair_applied: ctx.semanticRepairHttpApplied === true,
    semantic_repair_confidence: ctx.semanticRepairConfidence,
    semantic_repair_http_called: ctx.semanticRepairHttpCalled === true,
    semantic_repair_http_applied: ctx.semanticRepairHttpApplied === true,
    semantic_repair_skipped: ctx.semanticRepairSkipped === true,
    semantic_repair_skip_reason: ctx.semanticRepairSkipReason,
    semantic_repair_degraded: ctx.semanticRepairDegraded === true,
    en_normalize_applied: ctx.enNormalizeApplied === true,
    phonetic_correction_skipped: ctx.phoneticCorrectionSkipped === true,
    phonetic_correction_skip_reason: ctx.phoneticCorrectionSkipReason,
    phonetic_correction_degraded: ctx.phoneticCorrectionDegraded === true,
    phonetic_correction_http_called: ctx.phoneticCorrectionHttpCalled === true,
    phonetic_correction_applied: ctx.phoneticCorrectionApplied === true,
    phonetic_correction_step_ms: ctx.phoneticCorrectionStepMs,
    phonetic_correction_http_ms: ctx.phoneticCorrectionHttpMs,
    punctuation_restore_skipped: ctx.punctuationRestoreSkipped === true,
    punctuation_restore_skip_reason: ctx.punctuationRestoreSkipReason,
    punctuation_restore_degraded: ctx.punctuationRestoreDegraded === true,
    punctuation_restore_http_called: ctx.punctuationRestoreHttpCalled === true,
    punctuation_restore_applied: ctx.punctuationRestoreApplied === true,
    punctuation_restore_calls: ctx.punctuationRestoreCalls,
    punctuation_restore_step_ms: ctx.punctuationRestoreStepMs,
    punctuation_restore_http_ms: ctx.punctuationRestoreHttpMs,
    text_asr_repaired: ctx.repairedText,
    should_send: ctx.shouldSend ?? true,
    dedup_reason: ctx.dedupReason,
    is_last_in_merged_group: ctx.isLastInMergedGroup,
  };

  return result;
}

function calculateMaxGap(segments: Array<{ start?: number; end?: number }>): number {
  if (!segments || segments.length < 2) {
    return 0;
  }

  let maxGap = 0;
  for (let i = 1; i < segments.length; i++) {
    const prevEnd = segments[i - 1].end || 0;
    const currStart = segments[i].start || 0;
    const gap = currStart - prevEnd;
    if (gap > maxGap) {
      maxGap = gap;
    }
  }

  return maxGap;
}

function calculateAvgDuration(segments: Array<{ start?: number; end?: number }>): number {
  if (!segments || segments.length === 0) {
    return 0;
  }

  let totalDuration = 0;
  for (const segment of segments) {
    const start = segment.start || 0;
    const end = segment.end || 0;
    totalDuration += end - start;
  }

  return totalDuration / segments.length;
}
