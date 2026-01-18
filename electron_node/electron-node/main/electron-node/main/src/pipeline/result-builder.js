"use strict";
/**
 * ResultBuilder - 统一结果构建
 * 将 JobContext 转换为 JobResult
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildJobResult = buildJobResult;
/**
 * 构建 JobResult
 */
function buildJobResult(job, ctx) {
    // 确定最终 ASR 文本（优先使用修复后的文本，然后是聚合后的文本，最后是原始 ASR 文本）
    const finalAsrText = ctx.repairedText || ctx.aggregatedText || ctx.asrText || '';
    const result = {
        text_asr: finalAsrText,
        text_translated: ctx.translatedText || '',
        tts_audio: ctx.toneAudio || ctx.ttsAudio || '',
        tts_format: ctx.toneFormat || ctx.ttsFormat || 'opus',
        extra: {
            language_probability: ctx.asrResult?.language_probability || null,
            language_probabilities: ctx.languageProbabilities || null,
            // 核销标记：如果所有结果都归并到其他job，标记为核销情况
            is_consolidated: ctx.isConsolidated || false,
            consolidated_to_job_ids: ctx.consolidatedToJobIds || undefined,
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
function calculateMaxGap(segments) {
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
function calculateAvgDuration(segments) {
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
