"use strict";
/**
 * PostProcess合并处理模块
 * 负责处理文本合并相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostProcessMergeHandler = void 0;
const sequential_executor_factory_1 = require("../../sequential-executor/sequential-executor-factory");
const logger_1 = __importDefault(require("../../logger"));
class PostProcessMergeHandler {
    /**
     * 处理合并相关的逻辑
     */
    process(job, aggregationResult) {
        // 如果这个 utterance 被合并但不是最后一个，返回空结果
        if (aggregationResult.action === 'MERGE' && !aggregationResult.isLastInMergedGroup) {
            const sequentialExecutor = (0, sequential_executor_factory_1.getSequentialExecutor)();
            const sessionId = job.session_id || '';
            const utteranceIndex = job.utterance_index || 0;
            // 取消所有后续服务类型的任务（NMT、TTS、Semantic Repair）
            const serviceTypes = ['NMT', 'TTS', 'SEMANTIC_REPAIR'];
            for (const serviceType of serviceTypes) {
                sequentialExecutor.cancelTask(sessionId, utteranceIndex, 'Task merged into later utterance', serviceType);
            }
            logger_1.default.info({
                jobId: job.job_id,
                utteranceIndex: job.utterance_index,
                action: aggregationResult.action,
                isLastInMergedGroup: aggregationResult.isLastInMergedGroup,
                aggregatedTextLength: aggregationResult.aggregatedText.length,
                aggregatedTextPreview: aggregationResult.aggregatedText.substring(0, 50),
            }, 'PostProcessCoordinator: Utterance merged but not last in group, cancelled sequential executor tasks (NMT/TTS/SemanticRepair), returning empty result');
            return {
                shouldReturn: true,
                result: {
                    shouldSend: true,
                    aggregatedText: '',
                    translatedText: '',
                    ttsAudio: '',
                    ttsFormat: 'opus',
                    action: aggregationResult.action,
                    metrics: aggregationResult.metrics,
                },
            };
        }
        // 处理向前合并的结果
        if (aggregationResult.mergedFromUtteranceIndex !== undefined || aggregationResult.mergedFromPendingUtteranceIndex !== undefined) {
            const sequentialExecutor = (0, sequential_executor_factory_1.getSequentialExecutor)();
            const sessionId = job.session_id || '';
            // 取消被合并的前一个utterance的任务
            if (aggregationResult.mergedFromUtteranceIndex !== undefined) {
                const previousUtteranceIndex = aggregationResult.mergedFromUtteranceIndex;
                const serviceTypes = ['NMT', 'TTS', 'SEMANTIC_REPAIR'];
                for (const serviceType of serviceTypes) {
                    sequentialExecutor.cancelTask(sessionId, previousUtteranceIndex, `Previous utterance text merged into current utterance (${job.utterance_index})`, serviceType);
                }
                logger_1.default.info({
                    jobId: job.job_id,
                    currentUtteranceIndex: job.utterance_index,
                    previousUtteranceIndex,
                    sessionId,
                    reason: 'Previous utterance text merged into current, cancelled previous utterance GPU tasks',
                }, 'PostProcessCoordinator: Previous utterance text merged, cancelled previous utterance GPU tasks');
            }
            // 取消被合并的待合并文本的任务
            if (aggregationResult.mergedFromPendingUtteranceIndex !== undefined) {
                const pendingUtteranceIndex = aggregationResult.mergedFromPendingUtteranceIndex;
                const serviceTypes = ['NMT', 'TTS', 'SEMANTIC_REPAIR'];
                for (const serviceType of serviceTypes) {
                    sequentialExecutor.cancelTask(sessionId, pendingUtteranceIndex, `Pending utterance text merged into current utterance (${job.utterance_index})`, serviceType);
                }
                logger_1.default.info({
                    jobId: job.job_id,
                    currentUtteranceIndex: job.utterance_index,
                    pendingUtteranceIndex,
                    sessionId,
                    reason: 'Pending utterance text merged into current, cancelled pending utterance GPU tasks',
                }, 'PostProcessCoordinator: Pending utterance text merged, cancelled pending utterance GPU tasks');
            }
        }
        return { shouldReturn: false };
    }
}
exports.PostProcessMergeHandler = PostProcessMergeHandler;
