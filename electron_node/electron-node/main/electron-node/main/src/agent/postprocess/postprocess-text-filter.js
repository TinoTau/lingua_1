"use strict";
/**
 * PostProcess文本过滤模块
 * 负责处理文本长度过滤、空文本处理等逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostProcessTextFilter = void 0;
const logger_1 = __importDefault(require("../../logger"));
class PostProcessTextFilter {
    /**
     * 处理文本过滤逻辑
     */
    process(job, aggregationResult) {
        if (aggregationResult.shouldDiscard) {
            // < 6字符：直接丢弃
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                aggregatedTextLength: aggregationResult.aggregatedText.length,
                reason: 'Text too short (< 6 chars), discarding (>= 20 chars will be sent to semantic repair)',
            }, 'PostProcessCoordinator: Text too short, discarding');
            return {
                shouldReturn: true,
                result: {
                    shouldSend: false,
                    aggregatedText: '',
                    translatedText: '',
                    ttsAudio: '',
                    ttsFormat: 'opus',
                    action: aggregationResult.action,
                    metrics: aggregationResult.metrics,
                    reason: 'Text too short (< 6 chars), discarded (>= 20 chars will be sent to semantic repair)',
                },
            };
        }
        if (aggregationResult.shouldWaitForMerge) {
            // 6-20字符：等待与下一句合并
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                aggregatedTextLength: aggregationResult.aggregatedText.length,
                reason: 'Text length 6-20 chars, waiting for merge with next utterance',
            }, 'PostProcessCoordinator: Text length 6-20 chars, waiting for merge');
            return {
                shouldReturn: true,
                result: {
                    shouldSend: false,
                    aggregatedText: '',
                    translatedText: '',
                    ttsAudio: '',
                    ttsFormat: 'opus',
                    action: aggregationResult.action,
                    metrics: aggregationResult.metrics,
                    reason: 'Text length 6-20 chars, waiting for merge',
                },
            };
        }
        // 如果聚合后的文本为空，直接返回
        if (!aggregationResult.aggregatedText || aggregationResult.aggregatedText.trim().length === 0) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'Aggregated text is empty (filtered by AggregatorMiddleware or empty ASR), skipping post-process',
                action: aggregationResult.action,
            }, 'PostProcessCoordinator: Aggregated text is empty, returning shouldSend=false to avoid duplicate output');
            return {
                shouldReturn: true,
                result: {
                    shouldSend: false,
                    aggregatedText: '',
                    translatedText: '',
                    ttsAudio: '',
                    ttsFormat: 'opus',
                    action: aggregationResult.action,
                    metrics: aggregationResult.metrics,
                    reason: 'Aggregated text is empty (filtered by AggregatorMiddleware or empty ASR)',
                },
            };
        }
        return { shouldReturn: false };
    }
}
exports.PostProcessTextFilter = PostProcessTextFilter;
