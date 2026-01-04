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
const logger_1 = __importDefault(require("../../logger"));
const node_config_1 = require("../../node-config");
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
        // P0-2: 初始化时序保证 - 确保语义修复Stage已初始化
        const initPromise = this.semanticRepairInitializer.getInitPromise();
        if (!this.semanticRepairInitializer.isInitialized() && initPromise) {
            await initPromise;
        }
        // P0-3: 热插拔并发安全 - 捕获当前版本号，确保使用一致的Stage实例
        const currentVersion = this.semanticRepairVersion;
        const semanticRepairStage = this.semanticRepairInitializer.getSemanticRepairStage();
        // Phase 2: 语义修复Stage（在AggregationStage之后、TranslationStage之前）
        const semanticRepairStartTime = Date.now();
        let textForTranslation = aggregationResult.aggregatedText;
        let semanticRepairApplied = false;
        let semanticRepairConfidence = 1.0;
        if (semanticRepairStage) {
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
                    // 注意：getLastCommittedText 已经内置去重逻辑，如果上一句和当前句相同会返回 null
                    let microContext = undefined;
                    if (this.aggregatorManager) {
                        const lastCommittedText = this.aggregatorManager.getLastCommittedText(job.session_id, aggregationResult.aggregatedText);
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
                        // 提高日志级别为info，确保能看到修复结果
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
                        // REJECT时使用原文，但标记为已处理
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
                // 错误时使用原文
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
