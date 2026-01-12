/**
 * ResultBuilder - 统一结果构建
 * 将 JobContext 转换为 JobResult
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { JobContext } from './context/job-context';

/**
 * 构建 JobResult
 */
export function buildJobResult(job: JobAssignMessage, ctx: JobContext): JobResult {
  // 确定最终 ASR 文本（优先使用修复后的文本，然后是聚合后的文本，最后是原始 ASR 文本）
  const finalAsrText = ctx.repairedText || ctx.aggregatedText || ctx.asrText || '';

  const result: JobResult = {
    text_asr: finalAsrText,
    text_translated: ctx.translatedText || '',
    tts_audio: ctx.toneAudio || ctx.ttsAudio || '',
    tts_format: ctx.toneFormat || ctx.ttsFormat || 'opus',
    extra: {
      language_probability: ctx.asrResult?.language_probability || null,
      language_probabilities: ctx.languageProbabilities || null,
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
    semantic_repair_applied: ctx.semanticRepairApplied || false,
    semantic_repair_confidence: ctx.semanticRepairConfidence,
    text_asr_repaired: ctx.repairedText,
    should_send: ctx.shouldSend ?? true,
    dedup_reason: ctx.dedupReason,
    is_last_in_merged_group: ctx.isLastInMergedGroup,
  };

  return result;
}

/**
 * 计算最大间隔
 */
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

/**
 * 计算平均时长
 */
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
