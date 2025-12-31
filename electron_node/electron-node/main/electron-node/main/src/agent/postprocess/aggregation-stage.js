"use strict";
/**
 * AggregationStage - 文本聚合阶段
 * 职责：调用 AggregatorManager.processUtterance()，决定 MERGE / NEW_STREAM / COMMIT
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregationStage = void 0;
const logger_1 = __importDefault(require("../../logger"));
class AggregationStage {
    constructor(aggregatorManager) {
        this.aggregatorManager = aggregatorManager;
    }
    /**
     * 执行文本聚合
     */
    process(job, result) {
        // 如果未启用 Aggregator，直接返回原始文本
        if (!this.aggregatorManager) {
            return {
                aggregatedText: result.text_asr || '',
                aggregationChanged: false,
            };
        }
        // 检查 session_id
        if (!job.session_id || job.session_id.trim() === '') {
            logger_1.default.error({ jobId: job.job_id, traceId: job.trace_id }, 'AggregationStage: Job missing session_id, using original text');
            return {
                aggregatedText: result.text_asr || '',
                aggregationChanged: false,
            };
        }
        // 检查 ASR 结果是否为空
        // 修复：如果text_asr为空，直接返回空结果，不调用aggregatorManager.processUtterance()
        // 避免从pending text中返回之前缓存的文本，导致重复输出
        const asrTextTrimmed = (result.text_asr || '').trim();
        if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'ASR result is empty, skipping aggregator processing to avoid duplicate output',
            }, 'AggregationStage: ASR result is empty, returning empty aggregated text (skipping aggregator)');
            return {
                aggregatedText: '',
                aggregationChanged: false,
            };
        }
        // 提取 segments
        const segments = result.segments;
        // 提取语言概率信息
        const langProbs = {
            top1: result.extra?.language_probabilities
                ? Object.keys(result.extra.language_probabilities)[0] || job.src_lang
                : job.src_lang,
            p1: result.extra?.language_probability || 0.9,
            top2: result.extra?.language_probabilities
                ? Object.keys(result.extra.language_probabilities).find((lang) => {
                    const keys = Object.keys(result.extra.language_probabilities);
                    return lang !== (keys[0] || job.src_lang);
                })
                : undefined,
            p2: result.extra?.language_probabilities
                ? (() => {
                    const keys = Object.keys(result.extra.language_probabilities);
                    const top1Key = keys[0] || job.src_lang;
                    const top2Key = keys.find((lang) => lang !== top1Key);
                    return top2Key ? result.extra.language_probabilities[top2Key] : undefined;
                })()
                : undefined,
        };
        // 确定模式
        const mode = (job.mode === 'two_way_auto' || job.room_mode) ? 'room' : 'offline';
        // 处理 utterance
        // 从 job 中提取标识（如果调度服务器传递了该参数）
        const isManualCut = job.is_manual_cut || job.isManualCut || false;
        const isPauseTriggered = job.is_pause_triggered || job.isPauseTriggered || false;
        const isTimeoutTriggered = job.is_timeout_triggered || job.isTimeoutTriggered || false;
        const aggregatorResult = this.aggregatorManager.processUtterance(job.session_id, asrTextTrimmed, segments, langProbs, result.quality_score, true, // isFinal: P0 只处理 final 结果
        isManualCut, // 从 job 中提取
        mode, isPauseTriggered, // 从 job 中提取
        isTimeoutTriggered // 从 job 中提取
        );
        // 获取聚合后的文本
        let aggregatedText = asrTextTrimmed;
        let isFirstInMergedGroup = false; // 保留用于兼容
        let isLastInMergedGroup = false; // 新逻辑：是否是合并组中的最后一个
        // 新逻辑：只有合并组中的最后一个 utterance 才返回聚合后的文本
        // 其他被合并的 utterance（job 0, 1, 2）返回空文本，直接提交给调度服务器核销
        if (aggregatorResult.action === 'MERGE') {
            // MERGE 操作：检查是否是合并组中的最后一个
            if (aggregatorResult.isLastInMergedGroup === true && aggregatorResult.shouldCommit && aggregatorResult.text) {
                // 这是合并组中的最后一个 utterance（例如 job3），且触发了提交，返回聚合后的文本
                aggregatedText = aggregatorResult.text;
                isLastInMergedGroup = true;
                logger_1.default.info(// 改为 info 级别，确保输出
                {
                    jobId: job.job_id,
                    utteranceIndex: job.utterance_index,
                    action: aggregatorResult.action,
                    isLastInMergedGroup: true,
                    aggregatedTextLength: aggregatedText.length,
                    aggregatedTextPreview: aggregatedText.substring(0, 100),
                    originalTextLength: asrTextTrimmed.length,
                    originalTextPreview: asrTextTrimmed.substring(0, 50),
                    shouldCommit: aggregatorResult.shouldCommit,
                    hasText: !!aggregatorResult.text,
                }, 'AggregationStage: MERGE action, last in merged group, returning aggregated text');
            }
            else {
                // 这不是合并组中的最后一个 utterance（例如 job 0, 1, 2），返回空文本
                aggregatedText = '';
                isLastInMergedGroup = false;
                logger_1.default.info(// 改为 info 级别，便于调试
                {
                    jobId: job.job_id,
                    utteranceIndex: job.utterance_index,
                    action: aggregatorResult.action,
                    isLastInMergedGroup: aggregatorResult.isLastInMergedGroup,
                    shouldCommit: aggregatorResult.shouldCommit,
                    hasText: !!aggregatorResult.text,
                    originalTextLength: asrTextTrimmed.length,
                    originalTextPreview: asrTextTrimmed.substring(0, 50),
                    textPreview: aggregatorResult.text?.substring(0, 50),
                }, 'AggregationStage: MERGE action, not last in merged group, returning empty text (will be sent to scheduler for cancellation)');
            }
        }
        else if (aggregatorResult.shouldCommit && aggregatorResult.text) {
            // NEW_STREAM 且触发了提交：返回原始 ASR 文本，而不是聚合后的文本
            // 因为 NEW_STREAM 表示新的流，不应该包含之前被合并的文本
            // 如果 aggregatorResult.text 与 asrTextTrimmed 不同，说明可能有问题
            if (aggregatorResult.text !== asrTextTrimmed) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    utteranceIndex: job.utterance_index,
                    action: aggregatorResult.action,
                    originalText: asrTextTrimmed.substring(0, 50),
                    aggregatorText: aggregatorResult.text.substring(0, 50),
                }, 'AggregationStage: NEW_STREAM but aggregatorResult.text differs from original ASR text, using original');
            }
            aggregatedText = asrTextTrimmed; // 修复：NEW_STREAM 应该返回原始 ASR 文本，而不是聚合后的文本
            isFirstInMergedGroup = false;
            isLastInMergedGroup = false;
        }
        else {
            // NEW_STREAM 但未提交：正常情况，使用原始文本
            aggregatedText = asrTextTrimmed;
            isFirstInMergedGroup = false;
            isLastInMergedGroup = false;
        }
        const aggregationChanged = aggregatedText.trim() !== asrTextTrimmed.trim();
        // 记录指标（始终记录，包含关键信息）- 在 aggregatedText 确定之后
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            action: aggregatorResult.action,
            shouldCommit: aggregatorResult.shouldCommit,
            isLastInMergedGroup: aggregatorResult.isLastInMergedGroup,
            hasText: !!aggregatorResult.text,
            textLength: aggregatorResult.text?.length || 0,
            aggregatedTextLength: aggregatedText.length,
            originalTextLength: asrTextTrimmed.length,
            originalTextPreview: asrTextTrimmed.substring(0, 50),
            aggregatedTextPreview: aggregatedText.substring(0, 50),
            aggregatorTextPreview: aggregatorResult.text?.substring(0, 50),
            deduped: aggregatorResult.metrics?.dedupCount ? aggregatorResult.metrics.dedupCount > 0 : false,
            dedupChars: aggregatorResult.metrics?.dedupCharsRemoved || 0,
        }, 'AggregationStage: Processing completed');
        return {
            aggregatedText,
            aggregationChanged,
            action: aggregatorResult.action,
            metrics: aggregatorResult.metrics,
            isFirstInMergedGroup, // 保留用于兼容
            isLastInMergedGroup, // 新逻辑：标识是否是合并组中的最后一个
        };
    }
}
exports.AggregationStage = AggregationStage;
