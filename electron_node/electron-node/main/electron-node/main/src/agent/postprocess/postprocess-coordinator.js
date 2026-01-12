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
const translation_stage_1 = require("./translation-stage");
const tts_stage_1 = require("./tts-stage");
const tone_stage_1 = require("./tone-stage");
const logger_1 = __importDefault(require("../../logger"));
const node_config_1 = require("../../node-config");
const aggregator_middleware_deduplication_1 = require("../aggregator-middleware-deduplication");
class PostProcessCoordinator {
    constructor(aggregatorManager, taskRouter, servicesHandler, config) {
        this.aggregatorManager = aggregatorManager;
        this.taskRouter = taskRouter;
        this.servicesHandler = servicesHandler;
        this.translationStage = null;
        this.ttsStage = null;
        this.toneStage = null;
        // 读取 Feature Flag 配置
        const nodeConfig = (0, node_config_1.loadNodeConfig)();
        this.enablePostProcessTranslation = nodeConfig.features?.enablePostProcessTranslation ?? true;
        // 注意：聚合和去重逻辑已迁移到 PipelineOrchestrator
        // 如果启用 PostProcess 翻译，初始化 TranslationStage 和 TTSStage
        if (this.enablePostProcessTranslation && taskRouter) {
            this.translationStage = new translation_stage_1.TranslationStage(taskRouter, aggregatorManager, config?.translationConfig || {});
            this.ttsStage = new tts_stage_1.TTSStage(taskRouter);
            this.toneStage = new tone_stage_1.TONEStage(taskRouter);
            logger_1.default.info({}, 'PostProcessCoordinator: TranslationStage, TTSStage, and TONEStage initialized');
        }
        else {
            logger_1.default.info({}, 'PostProcessCoordinator: TranslationStage and TTSStage disabled');
        }
        // 注意：语义修复、聚合和去重现在在 PipelineOrchestrator 中执行
        // 初始化去重处理器（维护lastSentText，记录实际发送的文本）
        this.deduplicationHandler = new aggregator_middleware_deduplication_1.DeduplicationHandler();
        logger_1.default.info({
            enablePostProcessTranslation: this.enablePostProcessTranslation,
            hasAggregatorManager: !!aggregatorManager,
            hasTaskRouter: !!taskRouter,
            hasServicesHandler: !!servicesHandler,
            note: 'Text aggregation and semantic repair are now handled in PipelineOrchestrator (bound to ASR)',
        }, 'PostProcessCoordinator initialized');
    }
    /**
     * 注意：语义修复现在在 PipelineOrchestrator 中执行（与 ASR 绑定）
     * 不再需要重新初始化语义修复Stage
     */
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
        // Stage 1: 检查是否应该处理（聚合和去重已在 PipelineOrchestrator 中处理）
        // 如果 PipelineOrchestrator 已经决定不发送（should_send=false），直接返回
        if (result.should_send === false) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: result.dedup_reason || 'filtered_by_pipeline',
            }, 'PostProcessCoordinator: Result filtered by PipelineOrchestrator, returning empty result');
            return {
                shouldSend: false,
                aggregatedText: '',
                translatedText: '',
                ttsAudio: '',
                ttsFormat: 'opus',
                reason: result.dedup_reason || 'filtered_by_pipeline',
            };
        }
        // 使用 PipelineOrchestrator 处理后的文本（已经是聚合和修复后的文本）
        let textForTranslation = result.text_asr || ''; // 已经是聚合和修复后的文本
        let semanticRepairApplied = result.semantic_repair_applied || false;
        let semanticRepairConfidence = result.semantic_repair_confidence || 0;
        // 如果文本为空，直接返回
        if (!textForTranslation || textForTranslation.trim().length === 0) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                reason: 'ASR result is empty',
            }, 'PostProcessCoordinator: ASR result is empty, returning empty result');
            return {
                shouldSend: true, // 返回true，确保发送空结果给调度服务器，避免超时
                aggregatedText: '',
                translatedText: '',
                ttsAudio: '',
                ttsFormat: 'opus',
                reason: 'ASR result is empty',
            };
        }
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            aggregatedTextLength: textForTranslation.length,
            aggregationApplied: result.aggregation_applied,
            semanticRepairApplied: semanticRepairApplied,
            action: result.aggregation_action,
            note: 'Using aggregated and semantic-repaired text from PipelineOrchestrator',
        }, 'PostProcessCoordinator: Using aggregated and semantic-repaired text from PipelineOrchestrator');
        // Stage 2: 翻译（唯一 NMT 入口）
        let translationResult = {
            translatedText: '',
        };
        // 检查是否需要翻译
        let shouldTranslate = job.pipeline?.use_nmt !== false; // 默认 true，如果明确设置为 false 则跳过
        // 支持只选择 NMT（文本翻译模式）：如果 use_asr === false，使用 job 中的输入文本
        let textToTranslate = textForTranslation;
        if (job.pipeline?.use_asr === false) {
            // 只选择 NMT 模式：使用 job 中的输入文本（如果有）
            const inputText = job.input_text || job.text || '';
            if (inputText && inputText.trim().length > 0) {
                textToTranslate = inputText.trim();
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    inputTextLength: textToTranslate.length,
                    note: 'Text translation mode: using input_text from job (ASR disabled)',
                }, 'PostProcessCoordinator: Text translation mode - using input_text from job');
            }
            else {
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    note: 'Text translation mode but no input_text provided',
                }, 'PostProcessCoordinator: Text translation mode but no input_text, skipping translation');
                shouldTranslate = false;
            }
        }
        // 如果文本被聚合，或者 Pipeline NMT 已禁用，需要翻译
        const needsTranslation = shouldTranslate && (result.aggregation_applied || // 文本被聚合
            !result.text_translated ||
            result.text_translated.trim().length === 0 ||
            job.pipeline?.use_asr === false // 只选择 NMT 模式
        );
        logger_1.default.info(// 改为 info 级别，确保输出
        {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            action: result.aggregation_action,
            isLastInMergedGroup: result.is_last_in_merged_group,
            aggregatedTextLength: textForTranslation.length,
            aggregatedTextPreview: textForTranslation.substring(0, 100),
            aggregationApplied: result.aggregation_applied,
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
                textToTranslate: textToTranslate,
                textToTranslateLength: textToTranslate.length,
                textPreview: textToTranslate.substring(0, 100),
                originalAggregatedText: textForTranslation,
                originalAggregatedTextLength: textForTranslation.length,
                semanticRepairApplied,
                semanticRepairConfidence,
                timestamp: new Date().toISOString(),
            }, 'PostProcessCoordinator: Starting translation stage (NMT request START)');
            translationResult = await this.translationStage.process(job, textToTranslate, // 使用 textToTranslate（可能是 input_text 或 textForTranslation）
            result.quality_score, result.aggregation_metrics?.dedupCharsRemoved || 0, {
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
        // Stage 2: TTS 音频生成（在翻译完成后）
        // 注意：去重检查已在 PipelineOrchestrator 中完成
        let ttsResult = {
            ttsAudio: '',
            ttsFormat: 'opus', // 强制使用 opus 格式
        };
        // 检查是否需要生成 TTS
        const shouldGenerateTTS = job.pipeline?.use_tts !== false; // 默认 true，如果明确设置为 false 则跳过
        if (shouldGenerateTTS && translationResult.translatedText && translationResult.translatedText.trim().length > 0 && this.ttsStage) {
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
        else {
            // TTS 被禁用或跳过
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                useTts: job.pipeline?.use_tts,
                shouldSend: Boolean(result.should_send ?? true),
                hasTranslatedText: !!translationResult.translatedText,
            }, 'PostProcessCoordinator: TTS disabled by pipeline config or skipped, no TTS audio generated');
        }
        // Stage 5: TONE 音色配音（在 TTS 之后，如果启用了 TONE）
        let toneResult = {
            toneAudio: undefined,
            toneFormat: undefined,
            speakerId: undefined,
        };
        // 检查是否需要生成 TONE
        const shouldGenerateTONE = job.pipeline?.use_tone === true && ttsResult.ttsAudio && ttsResult.ttsAudio.trim().length > 0;
        if (shouldGenerateTONE && this.toneStage) {
            try {
                const toneStartTime = Date.now();
                // 从 job 中提取 speaker_id
                const speakerId = job.speaker_id || job.voice_id;
                toneResult = await this.toneStage.process(job, ttsResult.ttsAudio, ttsResult.ttsFormat || 'opus', speakerId);
                const toneDuration = Date.now() - toneStartTime;
                if (toneDuration > 30000) {
                    logger_1.default.warn({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        toneDurationMs: toneDuration,
                        note: 'TONE processing took longer than 30 seconds',
                    }, 'PostProcessCoordinator: TONE processing took too long');
                }
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    speakerId: toneResult.speakerId,
                    hasToneAudio: !!toneResult.toneAudio,
                    toneDurationMs: toneDuration,
                }, 'PostProcessCoordinator: TONE processing completed');
            }
            catch (toneError) {
                // TONE 处理失败，记录错误但继续处理
                logger_1.default.error({
                    error: toneError,
                    jobId: job.job_id,
                    sessionId: job.session_id,
                }, 'PostProcessCoordinator: TONE processing failed, continuing without TONE audio');
                // 保持 toneResult 为空
            }
        }
        else {
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                useTone: job.pipeline?.use_tone,
                hasTtsAudio: !!ttsResult.ttsAudio,
            }, 'PostProcessCoordinator: TONE disabled by pipeline config or no TTS audio, skipping TONE');
        }
        // 汇总结果
        // 重要：如果进行了语义修复，使用修复后的文本作为 aggregatedText（用于返回给web端的text_asr字段）
        // 这样web端显示的就是修复后的文本，而不是原始ASR文本
        const finalAggregatedText = textForTranslation || result.text_asr || '';
        const totalProcessDuration = Date.now() - processStartTime;
        const shouldSend = Boolean(result.should_send ?? true); // 默认 true，除非明确设置为 false
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            totalProcessDurationMs: totalProcessDuration,
            shouldSend,
            aggregatedTextLength: finalAggregatedText.length,
            translatedTextLength: translationResult.translatedText.length,
            timestamp: new Date().toISOString(),
        }, 'PostProcessCoordinator: Post-process completed (EXIT)');
        // 如果使用了 TONE，优先使用 TONE 音频，否则使用 TTS 音频
        const finalAudio = toneResult.toneAudio || ttsResult.ttsAudio;
        const finalAudioFormat = toneResult.toneFormat || ttsResult.ttsFormat || 'opus';
        const postProcessResult = {
            shouldSend,
            aggregatedText: finalAggregatedText,
            translatedText: translationResult.translatedText,
            ttsAudio: finalAudio, // 使用 TONE 音频（如果存在）或 TTS 音频
            ttsFormat: finalAudioFormat, // 使用 TONE 格式（如果存在）或 TTS 格式
            toneAudio: toneResult.toneAudio, // 单独返回 TONE 音频（可选）
            toneFormat: toneResult.toneFormat,
            speakerId: toneResult.speakerId,
            action: result.aggregation_action,
            metrics: {
                ...result.aggregation_metrics,
                translationTimeMs: translationResult.translationTimeMs,
                ttsTimeMs: ttsResult.ttsTimeMs,
                toneTimeMs: toneResult.toneTimeMs,
                fromCache: translationResult.fromCache,
            },
            reason: result.dedup_reason,
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
        // 去重逻辑已迁移到 PipelineOrchestrator，这里不再需要清理
        this.deduplicationHandler.removeSession(sessionId);
        // AggregationStage 和 TranslationStage 使用 AggregatorManager，由外部管理
        logger_1.default.debug({ sessionId }, 'PostProcessCoordinator: Session removed');
    }
    /**
     * 获取最后发送的文本（用于去重）
     */
    getLastSentText(sessionId) {
        return this.deduplicationHandler.getLastSentText(sessionId);
    }
    /**
     * 设置最后发送的文本（在成功发送后调用）
     */
    setLastSentText(sessionId, text) {
        this.deduplicationHandler.setLastSentText(sessionId, text);
        logger_1.default.debug({
            sessionId,
            textLength: text.length,
            textPreview: text.substring(0, 50),
        }, 'PostProcessCoordinator: Updated lastSentText after successful send');
    }
    /**
     * 获取去重处理器（用于AggregationStage）
     */
    getDeduplicationHandler() {
        return this.deduplicationHandler;
    }
}
exports.PostProcessCoordinator = PostProcessCoordinator;
