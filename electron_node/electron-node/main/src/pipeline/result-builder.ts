/**
 * ResultBuilder - 统一结果构建
 * 将 JobContext 转换为 JobResult
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { JobContext } from './context/job-context';
import { buildSessionResultExtra } from '../session-runtime/session-result-extra';
import { resolveBusinessAsrText } from './post-asr-routing';
import { resolveLexiconRuntimeContract } from './lexicon-runtime-contract';
import { buildLegacyRecoverResultExtra } from './recover-result-bridge';
import { isFwDetectorEngineEnabled } from '../fw-detector/fw-mode';

function buildCoreResultExtra(job: JobAssignMessage, ctx: JobContext): Record<string, unknown> {
  return {
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
    ...(ctx.fwDetectorStepMs != null ? { fw_detector_step_ms: ctx.fwDetectorStepMs } : {}),
    ...(ctx.fwDetectorResult ? { fw_detector: ctx.fwDetectorResult } : {}),
    ...buildSessionResultExtra(job, ctx),
    ...(ctx.lexiconManifestReady ? { lexicon_manifest_ready: ctx.lexiconManifestReady } : {}),
  };
}

/** FW 冻结主链：最小 extra，不打包 Recover 观测结构 */
function buildFwResultExtra(job: JobAssignMessage, ctx: JobContext): Record<string, unknown> {
  const lexicon = resolveLexiconRuntimeContract(job, ctx);
  return {
    ...buildCoreResultExtra(job, ctx),
    lexicon_runtime_status: lexicon.lexicon_runtime_status,
    lexicon_manifest_version: lexicon.lexicon_manifest_version,
    ...(lexicon.lexicon_runtime_error
      ? { lexicon_runtime_error: lexicon.lexicon_runtime_error }
      : {}),
    ...(lexicon.lexicon_disabled_reason
      ? { lexicon_disabled_reason: lexicon.lexicon_disabled_reason }
      : {}),
  };
}

/**
 * 构建 JobResult
 */
export function buildJobResult(job: JobAssignMessage, ctx: JobContext): JobResult {
  const finalAsrText = resolveBusinessAsrText(ctx);
  const coreExtra = buildCoreResultExtra(job, ctx);

  const extra = isFwDetectorEngineEnabled()
    ? buildFwResultExtra(job, ctx)
    : buildLegacyRecoverResultExtra(job, ctx, coreExtra);

  const result: JobResult = {
    text_asr: finalAsrText,
    text_translated: ctx.translatedText || '',
    tts_audio: ctx.toneAudio || ctx.ttsAudio || '',
    tts_format: ctx.toneFormat || ctx.ttsFormat || 'opus',
    extra,
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
