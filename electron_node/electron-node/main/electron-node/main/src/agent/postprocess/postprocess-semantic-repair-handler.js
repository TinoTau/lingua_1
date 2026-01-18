"use strict";
/**
 * PostProcess语义修复处理模块
 * 负责处理语义修复阶段的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostProcessSemanticRepairHandler = void 0;
const logger_1 = __importDefault(require("../../logger"));
class PostProcessSemanticRepairHandler {
    constructor(aggregatorManager, semanticRepairInitializer, semanticRepairVersion) {
        this.aggregatorManager = aggregatorManager;
        this.semanticRepairInitializer = semanticRepairInitializer;
        this.semanticRepairVersion = semanticRepairVersion;
    }
    /**
     * 处理语义修复
     */
    async process(job, aggregationResult, result, currentVersion) {
        // P0-2: 初始化时序保证 - 确保语义修复Stage已初始化
        const initPromise = this.semanticRepairInitializer.getInitPromise();
        if (!this.semanticRepairInitializer.isInitialized() && initPromise) {
            await initPromise;
        }
        // P0-3: 热插拔并发安全 - 捕获当前版本号，确保使用一致的Stage实例
        const semanticRepairStage = this.semanticRepairInitializer.getSemanticRepairStage();
        // Phase 2: 语义修复Stage（在AggregationStage之后、TranslationStage之前）
        const shouldPerformSemanticRepair = aggregationResult.shouldSendToSemanticRepair !== false;
        const semanticRepairStartTime = Date.now();
        let textForTranslation = aggregationResult.aggregatedText;
        let semanticRepairApplied = false;
        let semanticRepairConfidence = 1.0;
        if (semanticRepairStage && shouldPerformSemanticRepair) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                textLength: aggregationResult.aggregatedText.length,
            }, 'PostProcessCoordinator: Starting semantic repair stage');
            try {
                // P0-3: 检查版本是否一致（如果版本已变化，说明正在重新初始化，跳过修复）
                if (currentVersion !== this.semanticRepairVersion) {
                    logger_1.default.debug({
                        jobId: job.job_id,
                        currentVersion,
                        latestVersion: this.semanticRepairVersion,
                    }, 'PostProcessCoordinator: Semantic repair stage version changed during processing, skipping repair');
                    textForTranslation = aggregationResult.aggregatedText;
                }
                else {
                    // 获取微上下文（上一句尾部，用于语义修复）
                    let microContext = undefined;
                    if (this.aggregatorManager) {
                        const lastCommittedText = this.aggregatorManager.getLastCommittedText(job.session_id, job.utterance_index);
                        if (lastCommittedText && lastCommittedText.trim().length > 0) {
                            // 限制长度：取最后150个字符（避免上下文过长）
                            const trimmedContext = lastCommittedText.trim();
                            microContext = trimmedContext.length > 150
                                ? trimmedContext.substring(trimmedContext.length - 150)
                                : trimmedContext;
                            logger_1.default.debug({
                                jobId: job.job_id,
                                sessionId: job.session_id,
                                utteranceIndex: job.utterance_index,
                                microContextLength: microContext.length,
                                microContextPreview: microContext.substring(0, 50),
                                originalLastCommittedLength: lastCommittedText.length,
                            }, 'PostProcessCoordinator: Retrieved micro_context for semantic repair');
                        }
                        else {
                            logger_1.default.debug({
                                jobId: job.job_id,
                                sessionId: job.session_id,
                                utteranceIndex: job.utterance_index,
                                reason: lastCommittedText === null ? 'no_previous_text' : 'empty_text',
                            }, 'PostProcessCoordinator: No micro_context available (deduplicated or first utterance)');
                        }
                    }
                    const repairResult = await semanticRepairStage.process(job, aggregationResult.aggregatedText, result.quality_score, {
                        segments: result.segments,
                        language_probability: result.extra?.language_probability,
                        micro_context: microContext,
                    });
                    const semanticRepairDuration = Date.now() - semanticRepairStartTime;
                    if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
                        textForTranslation = repairResult.textOut;
                        semanticRepairApplied = repairResult.semanticRepairApplied || false;
                        semanticRepairConfidence = repairResult.confidence;
                        logger_1.default.info({
                            jobId: job.job_id,
                            sessionId: job.session_id,
                            utteranceIndex: job.utterance_index,
                            decision: repairResult.decision,
                            confidence: repairResult.confidence,
                            reasonCodes: repairResult.reasonCodes,
                            originalText: aggregationResult.aggregatedText.substring(0, 100),
                            repairedText: textForTranslation.substring(0, 100),
                            originalLength: aggregationResult.aggregatedText.length,
                            repairedLength: textForTranslation.length,
                            textChanged: textForTranslation !== aggregationResult.aggregatedText,
                            semanticRepairApplied,
                            semanticRepairDurationMs: semanticRepairDuration,
                            repairTimeMs: repairResult.repairTimeMs,
                        }, 'PostProcessCoordinator: Semantic repair stage completed');
                    }
                    else if (repairResult.decision === 'REJECT') {
                        logger_1.default.warn({
                            jobId: job.job_id,
                            reasonCodes: repairResult.reasonCodes,
                        }, 'PostProcessCoordinator: Semantic repair rejected text');
                        textForTranslation = aggregationResult.aggregatedText;
                        semanticRepairApplied = false;
                    }
                }
            }
            catch (error) {
                const semanticRepairDuration = Date.now() - semanticRepairStartTime;
                logger_1.default.error({
                    error: error.message,
                    stack: error.stack,
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    semanticRepairDurationMs: semanticRepairDuration,
                }, 'PostProcessCoordinator: Semantic repair failed, using original text');
                textForTranslation = aggregationResult.aggregatedText;
                semanticRepairApplied = false;
            }
        }
        else {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'semanticRepairStage is null',
            }, 'PostProcessCoordinator: Semantic repair stage skipped (not available)');
        }
        return {
            textForTranslation,
            semanticRepairApplied,
            semanticRepairConfidence,
        };
    }
}
exports.PostProcessSemanticRepairHandler = PostProcessSemanticRepairHandler;
