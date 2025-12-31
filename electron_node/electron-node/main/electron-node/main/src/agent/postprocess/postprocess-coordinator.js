"use strict";
/**
 * PostProcessCoordinator - 后处理协调器
 * 职责：串联各 Stage，管理 session / trace / context，汇总最终输出
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostProcessCoordinator = void 0;
const aggregation_stage_1 = require("./aggregation-stage");
const translation_stage_1 = require("./translation-stage");
const dedup_stage_1 = require("./dedup-stage");
const tts_stage_1 = require("./tts-stage");
const logger_1 = __importDefault(require("../../logger"));
const node_config_1 = require("../../node-config");
class PostProcessCoordinator {
    constructor(aggregatorManager, taskRouter, config) {
        this.aggregatorManager = aggregatorManager;
        this.taskRouter = taskRouter;
        this.translationStage = null;
        this.ttsStage = null;
        // 读取 Feature Flag 配置
        const nodeConfig = (0, node_config_1.loadNodeConfig)();
        this.enablePostProcessTranslation = nodeConfig.features?.enablePostProcessTranslation ?? true;
        // 初始化各 Stage
        this.aggregationStage = new aggregation_stage_1.AggregationStage(aggregatorManager);
        this.dedupStage = new dedup_stage_1.DedupStage();
        // 如果启用 PostProcess 翻译，初始化 TranslationStage 和 TTSStage
        if (this.enablePostProcessTranslation && taskRouter) {
            this.translationStage = new translation_stage_1.TranslationStage(taskRouter, aggregatorManager, config?.translationConfig || {});
            this.ttsStage = new tts_stage_1.TTSStage(taskRouter);
            logger_1.default.info({}, 'PostProcessCoordinator: TranslationStage and TTSStage initialized');
        }
        else {
            logger_1.default.info({}, 'PostProcessCoordinator: TranslationStage and TTSStage disabled');
        }
        logger_1.default.info({
            enablePostProcessTranslation: this.enablePostProcessTranslation,
            hasAggregatorManager: !!aggregatorManager,
            hasTaskRouter: !!taskRouter,
        }, 'PostProcessCoordinator initialized');
    }
    /**
     * 获取 DedupStage 实例（用于在成功发送后记录job_id）
     */
    getDedupStage() {
        return this.dedupStage;
    }
    /**
     * 处理 JobResult（后处理入口）
     */
    async process(job, result) {
        // 如果未启用，直接返回原始结果
        if (!this.enablePostProcessTranslation) {
            return {
                shouldSend: true,
                aggregatedText: result.text_asr || '',
                translatedText: result.text_translated || '',
            };
        }
        // Stage 1: 文本聚合
        // 修复：如果text_asr为空，仍然需要经过DedupStage检查，避免重复发送相同的空结果
        // 但是，如果DedupStage过滤了空结果，我们仍然需要发送一个空结果给调度服务器（用于核销）
        // 这样调度服务器知道节点端已经处理完成，不会触发超时
        const asrTextTrimmed = (result.text_asr || '').trim();
        if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
            // 先经过DedupStage检查，避免重复发送相同的空结果
            const dedupResult = this.dedupStage.process(job, '', '');
            if (!dedupResult.shouldSend) {
                // DedupStage过滤了空结果，但仍然需要发送给调度服务器（用于核销）
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    reason: dedupResult.reason || 'duplicate_empty',
                    note: 'DedupStage filtered duplicate empty result, but still sending to scheduler for job cancellation',
                }, 'PostProcessCoordinator: Duplicate empty result filtered by DedupStage, but still sending to scheduler for cancellation');
            }
            else {
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    reason: 'ASR result is empty, returning empty result but shouldSend=true to prevent timeout',
                }, 'PostProcessCoordinator: ASR result is empty, returning empty result (shouldSend=true to prevent scheduler timeout)');
            }
            // 无论DedupStage是否过滤，都返回shouldSend=true，确保调度服务器能够核销job
            return {
                shouldSend: true, // 修复：返回true，确保发送空结果给调度服务器，避免超时
                aggregatedText: '',
                translatedText: '',
                ttsAudio: '',
                ttsFormat: 'opus',
                reason: 'ASR result is empty (filtered by AggregatorMiddleware or empty ASR)',
            };
        }
        const aggregationResult = this.aggregationStage.process(job, result);
        // 新逻辑：如果这个 utterance 被合并但不是最后一个，返回空结果（让调度服务器核销后过滤）
        // 例如：job 0, 1, 2 被合并到 job 3，job 0, 1, 2 返回空结果，job 3 返回聚合后的文本
        if (aggregationResult.action === 'MERGE' && !aggregationResult.isLastInMergedGroup) {
            logger_1.default.info(// 改为 info 级别，确保输出
            {
                jobId: job.job_id,
                utteranceIndex: job.utterance_index,
                action: aggregationResult.action,
                isLastInMergedGroup: aggregationResult.isLastInMergedGroup,
                aggregatedTextLength: aggregationResult.aggregatedText.length,
                aggregatedTextPreview: aggregationResult.aggregatedText.substring(0, 50),
            }, 'PostProcessCoordinator: Utterance merged but not last in group, returning empty result (will be sent to scheduler for cancellation)');
            return {
                shouldSend: true, // 仍然返回，让调度服务器核销
                aggregatedText: '',
                translatedText: '',
                ttsAudio: '',
                ttsFormat: 'opus',
                action: aggregationResult.action,
                metrics: aggregationResult.metrics,
            };
        }
        // 如果聚合后的文本为空，直接返回
        // 修复：如果聚合后的文本为空（被AggregatorMiddleware过滤或空ASR），不发送结果，避免重复输出
        if (!aggregationResult.aggregatedText || aggregationResult.aggregatedText.trim().length === 0) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'Aggregated text is empty (filtered by AggregatorMiddleware or empty ASR), skipping post-process',
                action: aggregationResult.action,
            }, 'PostProcessCoordinator: Aggregated text is empty, returning shouldSend=false to avoid duplicate output');
            return {
                shouldSend: false, // 修复：不发送空结果，避免重复输出
                aggregatedText: '',
                translatedText: '',
                ttsAudio: '',
                ttsFormat: 'opus',
                action: aggregationResult.action,
                metrics: aggregationResult.metrics,
                reason: 'Aggregated text is empty (filtered by AggregatorMiddleware or empty ASR)',
            };
        }
        // Stage 2: 翻译（唯一 NMT 入口）
        let translationResult = {
            translatedText: '',
        };
        // 如果文本被聚合，或者 Pipeline NMT 已禁用，需要翻译
        const needsTranslation = aggregationResult.aggregationChanged || !result.text_translated || result.text_translated.trim().length === 0;
        logger_1.default.info(// 改为 info 级别，确保输出
        {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            action: aggregationResult.action,
            isFirstInMergedGroup: aggregationResult.isFirstInMergedGroup,
            isLastInMergedGroup: aggregationResult.isLastInMergedGroup,
            aggregatedTextLength: aggregationResult.aggregatedText.length,
            aggregatedTextPreview: aggregationResult.aggregatedText.substring(0, 100),
            aggregationChanged: aggregationResult.aggregationChanged,
            needsTranslation,
            hasPipelineTranslation: !!result.text_translated,
        }, 'PostProcessCoordinator: Before translation stage');
        if (needsTranslation && this.translationStage) {
            // 重要：翻译时使用合并后的文本（aggregatedText），而不是原始 ASR 文本
            // 记录实际传递给TranslationStage的文本
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                aggregatedTextToTranslate: aggregationResult.aggregatedText,
                aggregatedTextToTranslateLength: aggregationResult.aggregatedText.length,
                aggregatedTextPreview: aggregationResult.aggregatedText.substring(0, 100),
                originalAsrText: result.text_asr,
                originalAsrTextLength: result.text_asr?.length || 0,
                originalAsrTextPreview: result.text_asr?.substring(0, 50),
            }, 'PostProcessCoordinator: Passing aggregated text to TranslationStage');
            const translationStartTime = Date.now();
            translationResult = await this.translationStage.process(job, aggregationResult.aggregatedText, result.quality_score, aggregationResult.metrics?.dedupCharsRemoved || 0);
            const translationDuration = Date.now() - translationStartTime;
            if (translationDuration > 30000) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    translationDurationMs: translationDuration,
                    nmtRepairApplied: translationResult.nmtRepairApplied,
                    note: 'Translation stage took longer than 30 seconds - may be blocked by NMT Repair or homophone repair',
                }, 'PostProcessCoordinator: Translation stage took too long');
            }
            logger_1.default.debug({
                jobId: job.job_id,
                utteranceIndex: job.utterance_index,
                translatedTextLength: translationResult.translatedText.length,
                translatedTextPreview: translationResult.translatedText.substring(0, 100),
                fromCache: translationResult.fromCache,
                translationDurationMs: translationDuration,
                nmtRepairApplied: translationResult.nmtRepairApplied,
            }, 'PostProcessCoordinator: Translation completed');
        }
        else if (result.text_translated) {
            // 使用 Pipeline 的翻译结果（如果存在且文本未被聚合）
            translationResult = {
                translatedText: result.text_translated,
                fromCache: false,
            };
        }
        // Stage 3: 去重检查
        const dedupResult = this.dedupStage.process(job, aggregationResult.aggregatedText, translationResult.translatedText);
        // Stage 4: TTS 音频生成（在翻译完成后，但只在去重检查通过时生成）
        let ttsResult = {
            ttsAudio: '',
            ttsFormat: 'opus', // 强制使用 opus 格式
        };
        // 生成 TTS 音频（只有在去重检查通过时才生成 TTS）
        // 如果去重检查失败，说明这是重复的文本，不应该生成 TTS 音频
        if (dedupResult.shouldSend && translationResult.translatedText && translationResult.translatedText.trim().length > 0 && this.ttsStage) {
            try {
                const ttsStartTime = Date.now();
                ttsResult = await this.ttsStage.process(job, translationResult.translatedText);
                const ttsDuration = Date.now() - ttsStartTime;
                if (ttsDuration > 30000) {
                    logger_1.default.warn({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        ttsDurationMs: ttsDuration,
                        note: 'TTS generation took longer than 30 seconds - GPU may be overloaded',
                    }, 'PostProcessCoordinator: TTS generation took too long');
                }
                // TTSStage 返回 WAV 格式，Opus 编码由 NodeAgent 统一处理
            }
            catch (ttsError) {
                // TTS 生成失败（比如 Opus 编码失败），记录错误但继续处理
                // 返回空音频，确保任务仍然返回结果
                logger_1.default.error({
                    error: ttsError,
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    translatedText: translationResult.translatedText.substring(0, 50),
                }, 'PostProcessCoordinator: TTS generation failed, continuing with empty audio');
                ttsResult = {
                    ttsAudio: '',
                    ttsFormat: 'opus',
                };
            }
        }
        else if (result.tts_audio) {
            // 如果 Pipeline 已经生成了 TTS 音频，使用 Pipeline 的结果
            ttsResult = {
                ttsAudio: result.tts_audio,
                ttsFormat: result.tts_format || 'opus', // 强制使用 opus 格式
            };
        }
        // 汇总结果
        const postProcessResult = {
            shouldSend: dedupResult.shouldSend,
            aggregatedText: aggregationResult.aggregatedText,
            translatedText: translationResult.translatedText,
            ttsAudio: ttsResult.ttsAudio,
            ttsFormat: ttsResult.ttsFormat,
            action: aggregationResult.action,
            metrics: {
                ...aggregationResult.metrics,
                translationTimeMs: translationResult.translationTimeMs,
                ttsTimeMs: ttsResult.ttsTimeMs,
                fromCache: translationResult.fromCache,
                nmtRepairApplied: translationResult.nmtRepairApplied,
            },
            reason: dedupResult.reason,
        };
        logger_1.default.debug({
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            shouldSend: postProcessResult.shouldSend,
            aggregatedTextLength: postProcessResult.aggregatedText.length,
            translatedTextLength: postProcessResult.translatedText.length,
            translatedTextPreview: postProcessResult.translatedText.substring(0, 100),
            ttsAudioLength: postProcessResult.ttsAudio?.length || 0,
            action: postProcessResult.action,
            reason: postProcessResult.reason,
        }, 'PostProcessCoordinator: Final result summary');
        return postProcessResult;
    }
    /**
     * 清理 session
     */
    removeSession(sessionId) {
        this.dedupStage.removeSession(sessionId);
        // AggregationStage 和 TranslationStage 使用 AggregatorManager，由外部管理
        logger_1.default.debug({ sessionId }, 'PostProcessCoordinator: Session removed');
    }
    /**
     * 获取最后发送的文本
     * 注意：DedupStage 不再维护 lastSentText，此方法已废弃
     * 如果需要获取最后发送的文本，应该从 AggregatorMiddleware 获取
     */
    getLastSentText(sessionId) {
        // DedupStage 不再维护 lastSentText，返回 undefined
        // 如果需要此功能，应该从 AggregatorMiddleware 获取
        return undefined;
    }
    /**
     * 设置最后发送的文本
     * 注意：DedupStage 不再维护 lastSentText，此方法已废弃
     * 如果需要设置最后发送的文本，应该通过 AggregatorMiddleware 设置
     */
    setLastSentText(sessionId, text) {
        // DedupStage 不再维护 lastSentText，此方法为空实现
        // 如果需要此功能，应该通过 AggregatorMiddleware 设置
    }
}
exports.PostProcessCoordinator = PostProcessCoordinator;
