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
const postprocess_semantic_repair_initializer_1 = require("./postprocess-semantic-repair-initializer");
const aggregation_stage_1 = require("./aggregation-stage");
const translation_stage_1 = require("./translation-stage");
const dedup_stage_1 = require("./dedup-stage");
const tts_stage_1 = require("./tts-stage");
const dedup_1 = require("../../aggregator/dedup");
const logger_1 = __importDefault(require("../../logger"));
const node_config_1 = require("../../node-config");
const postprocess_semantic_repair_handler_1 = require("./postprocess-semantic-repair-handler");
const postprocess_merge_handler_1 = require("./postprocess-merge-handler");
const postprocess_text_filter_1 = require("./postprocess-text-filter");
class PostProcessCoordinator {
    constructor(aggregatorManager, taskRouter, servicesHandler, config) {
        this.aggregatorManager = aggregatorManager;
        this.taskRouter = taskRouter;
        this.servicesHandler = servicesHandler;
        this.translationStage = null;
        this.ttsStage = null;
        // P0-3: 热插拔并发安全 - 使用版本号确保并发安全
        this.semanticRepairVersion = 0;
        this.reinitLock = { locked: false };
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
        // 初始化语义修复Stage初始化器
        this.semanticRepairInitializer = new postprocess_semantic_repair_initializer_1.SemanticRepairInitializer(servicesHandler, taskRouter);
        // 初始化模块化处理器
        this.mergeHandler = new postprocess_merge_handler_1.PostProcessMergeHandler();
        this.textFilter = new postprocess_text_filter_1.PostProcessTextFilter();
        logger_1.default.info({
            enablePostProcessTranslation: this.enablePostProcessTranslation,
            hasAggregatorManager: !!aggregatorManager,
            hasTaskRouter: !!taskRouter,
            hasServicesHandler: !!servicesHandler,
        }, 'PostProcessCoordinator initialized');
        // P0-2: 初始化时序保证 - 异步初始化，但不阻塞构造函数
        // 在首次process调用时会等待初始化完成
        this.semanticRepairInitializer.initialize().catch((error) => {
            logger_1.default.error({ error: error.message }, 'PostProcessCoordinator: Failed to initialize semantic repair stage in constructor');
        });
    }
    /**
     * 重新初始化语义修复Stage（用于热插拔）
     * P0-3: 热插拔并发安全 - 使用锁机制避免并发重新初始化
     */
    async reinitializeSemanticRepairStage() {
        // 如果已经在重新初始化，等待完成
        if (this.reinitLock.locked && this.reinitLock.promise) {
            await this.reinitLock.promise;
            return;
        }
        // 获取锁
        this.reinitLock.locked = true;
        this.reinitLock.promise = (async () => {
            try {
                // 增加版本号，使正在进行的任务使用旧版本
                this.semanticRepairVersion++;
                logger_1.default.info({ version: this.semanticRepairVersion }, 'PostProcessCoordinator: Starting semantic repair stage reinitialization');
                await this.semanticRepairInitializer.reinitialize();
                logger_1.default.info({ version: this.semanticRepairVersion }, 'PostProcessCoordinator: Semantic repair stage reinitialization completed');
            }
            catch (error) {
                logger_1.default.error({ error: error.message, version: this.semanticRepairVersion }, 'PostProcessCoordinator: Failed to reinitialize semantic repair stage');
            }
            finally {
                this.reinitLock.locked = false;
                this.reinitLock.promise = undefined;
            }
        })();
        await this.reinitLock.promise;
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
        const processStartTime = Date.now();
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            asrTextLength: result.text_asr?.length || 0,
            hasTranslatedText: !!result.text_translated,
            timestamp: new Date().toISOString(),
        }, 'PostProcessCoordinator: Starting post-process (ENTRY)');
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
        const aggregationStartTime = Date.now();
        const aggregationResult = this.aggregationStage.process(job, result);
        const aggregationDuration = Date.now() - aggregationStartTime;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            aggregationDurationMs: aggregationDuration,
            aggregatedTextLength: aggregationResult.aggregatedText.length,
            action: aggregationResult.action,
        }, 'PostProcessCoordinator: Aggregation stage completed');
        // 修复：在语义修复之前检测并移除文本内部重复（叠字叠词）
        // 如果ASR文本本身就有重复（如"再提高了一点速度 再提高了一点速度"），
        // 应该在进入NMT之前就去除重复，而不是让NMT翻译后再提取
        let textAfterDedup = aggregationResult.aggregatedText;
        if (textAfterDedup && textAfterDedup.trim().length > 0) {
            const originalText = textAfterDedup;
            textAfterDedup = (0, dedup_1.detectInternalRepetition)(textAfterDedup);
            if (textAfterDedup !== originalText) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    originalText: originalText.substring(0, 100),
                    dedupedText: textAfterDedup.substring(0, 100),
                    originalLength: originalText.length,
                    dedupedLength: textAfterDedup.length,
                    removedChars: originalText.length - textAfterDedup.length,
                    note: 'Detected and removed internal repetition (duplicate words/phrases) before semantic repair',
                }, 'PostProcessCoordinator: Detected and removed internal repetition before semantic repair');
                // 更新aggregationResult中的文本
                aggregationResult.aggregatedText = textAfterDedup;
            }
        }
        // Phase 2: 语义修复Stage（在AggregationStage之后、TranslationStage之前）
        // 注意：textAfterDedup已经移除了内部重复，这里使用去重后的文本
        // P0-3: 热插拔并发安全 - 捕获当前版本号，确保使用一致的Stage实例
        const currentVersion = this.semanticRepairVersion;
        const semanticRepairHandler = new postprocess_semantic_repair_handler_1.PostProcessSemanticRepairHandler(this.aggregatorManager, this.semanticRepairInitializer, this.semanticRepairVersion);
        const semanticRepairResult = await semanticRepairHandler.process(job, aggregationResult, result, currentVersion);
        const textForTranslation = semanticRepairResult.textForTranslation;
        const semanticRepairApplied = semanticRepairResult.semanticRepairApplied;
        const semanticRepairConfidence = semanticRepairResult.semanticRepairConfidence;
        // 处理合并逻辑
        const mergeResult = this.mergeHandler.process(job, aggregationResult);
        if (mergeResult.shouldReturn && mergeResult.result) {
            return mergeResult.result;
        }
        // 处理文本过滤逻辑
        const filterResult = this.textFilter.process(job, aggregationResult);
        if (filterResult.shouldReturn && filterResult.result) {
            return filterResult.result;
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
            // 重要：翻译时使用语义修复后的文本（textForTranslation），而不是原始聚合文本
            // 记录实际传递给TranslationStage的文本
            const translationStartTime = Date.now();
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                textToTranslate: textForTranslation,
                textToTranslateLength: textForTranslation.length,
                textPreview: textForTranslation.substring(0, 100),
                originalAggregatedText: aggregationResult.aggregatedText,
                originalAggregatedTextLength: aggregationResult.aggregatedText.length,
                semanticRepairApplied,
                semanticRepairConfidence,
                timestamp: new Date().toISOString(),
            }, 'PostProcessCoordinator: Starting translation stage (NMT request START)');
            translationResult = await this.translationStage.process(job, textForTranslation, result.quality_score, aggregationResult.metrics?.dedupCharsRemoved || 0, {
                semanticRepairApplied,
                semanticRepairConfidence,
            });
            const translationDuration = Date.now() - translationStartTime;
            if (translationDuration > 30000) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    translationDurationMs: translationDuration,
                    note: 'Translation stage took longer than 30 seconds - may be blocked by homophone repair',
                }, 'PostProcessCoordinator: Translation stage took too long');
            }
            logger_1.default.debug({
                jobId: job.job_id,
                utteranceIndex: job.utterance_index,
                translatedTextLength: translationResult.translatedText.length,
                translatedTextPreview: translationResult.translatedText.substring(0, 100),
                fromCache: translationResult.fromCache,
                translationDurationMs: translationDuration,
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
        // 重要：如果进行了语义修复，使用修复后的文本作为 aggregatedText（用于返回给web端的text_asr字段）
        // 这样web端显示的就是修复后的文本，而不是原始ASR文本
        const finalAggregatedText = textForTranslation || aggregationResult.aggregatedText;
        const totalProcessDuration = Date.now() - processStartTime;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            totalProcessDurationMs: totalProcessDuration,
            shouldSend: dedupResult.shouldSend,
            aggregatedTextLength: finalAggregatedText.length,
            translatedTextLength: translationResult.translatedText.length,
            timestamp: new Date().toISOString(),
        }, 'PostProcessCoordinator: Post-process completed (EXIT)');
        const postProcessResult = {
            shouldSend: dedupResult.shouldSend,
            aggregatedText: finalAggregatedText,
            translatedText: translationResult.translatedText,
            ttsAudio: ttsResult.ttsAudio,
            ttsFormat: ttsResult.ttsFormat,
            action: aggregationResult.action,
            metrics: {
                ...aggregationResult.metrics,
                translationTimeMs: translationResult.translationTimeMs,
                ttsTimeMs: ttsResult.ttsTimeMs,
                fromCache: translationResult.fromCache,
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
