"use strict";
/**
 * Aggregator Middleware: 作为中间件处理 ASR 结果
 * 在 NodeAgent 中集成，不依赖 PipelineOrchestrator 的具体实现
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorMiddleware = void 0;
const aggregator_1 = require("../aggregator");
const logger_1 = __importDefault(require("../logger"));
const lru_cache_1 = require("lru-cache");
const prompt_builder_1 = require("../asr/prompt-builder");
const need_rescore_1 = require("../asr/need-rescore");
const rescorer_1 = require("../asr/rescorer");
const candidate_provider_1 = require("../asr/candidate-provider");
const aggregator_middleware_translation_1 = require("./aggregator-middleware-translation");
const aggregator_middleware_audio_1 = require("./aggregator-middleware-audio");
const aggregator_middleware_deduplication_1 = require("./aggregator-middleware-deduplication");
class AggregatorMiddleware {
    constructor(config, taskRouter) {
        this.manager = null;
        this.taskRouter = null;
        // S1/S2: 短句准确率提升组件
        this.promptBuilder = null;
        this.needRescoreDetector = null;
        this.rescorer = null;
        this.candidateProvider = null;
        // S2-6: 二次解码 worker
        this.secondaryDecodeWorker = null;
        this.config = config;
        this.taskRouter = taskRouter || null;
        // 初始化翻译缓存：默认 200 条，10 分钟过期（提高缓存命中率）
        this.translationCache = new lru_cache_1.LRUCache({
            max: config.translationCacheSize || 200,
            ttl: config.translationCacheTtlMs || 10 * 60 * 1000,
        });
        // 初始化模块化处理器
        this.audioHandler = new aggregator_middleware_audio_1.AudioHandler();
        this.deduplicationHandler = new aggregator_middleware_deduplication_1.DeduplicationHandler();
        if (config.enabled) {
            this.manager = new aggregator_1.AggregatorManager({
                ttlMs: config.ttlMs || 5 * 60 * 1000,
                maxSessions: config.maxSessions || 1000,
            });
            // 初始化翻译处理器
            this.translationHandler = new aggregator_middleware_translation_1.TranslationHandler(this.taskRouter, this.translationCache, this.manager);
            // S1/S2: 初始化短句准确率提升组件
            const mode = config.mode || 'offline';
            // PromptBuilder 只支持 'offline' 和 'room'，将 'two_way' 映射到 'room'
            const promptBuilderMode = mode === 'two_way' ? 'room' : (mode === 'room' ? 'room' : 'offline');
            this.promptBuilder = new prompt_builder_1.PromptBuilder(promptBuilderMode);
            this.needRescoreDetector = new need_rescore_1.NeedRescoreDetector();
            this.rescorer = new rescorer_1.Rescorer();
            this.candidateProvider = new candidate_provider_1.CandidateProvider();
            // S2-6: 二次解码已禁用（GPU占用过高）
            this.secondaryDecodeWorker = null;
            logger_1.default.info({}, 'S2-6: Secondary decode worker disabled (GPU optimization)');
            logger_1.default.info({
                mode: config.mode,
                hasTaskRouter: !!taskRouter,
                cacheSize: config.translationCacheSize || 200,
                cacheTtlMs: config.translationCacheTtlMs || 10 * 60 * 1000,
                s1S2Enabled: true,
                s2SecondaryDecodeEnabled: !!this.secondaryDecodeWorker,
            }, 'Aggregator middleware initialized with S1/S2 support');
        }
        else {
            // 即使未启用，也需要初始化处理器（用于兼容）
            this.translationHandler = new aggregator_middleware_translation_1.TranslationHandler(this.taskRouter, this.translationCache, null);
        }
    }
    /**
     * 处理 ASR 结果（在 NMT 之前调用）
     * @param job 原始 job 请求
     * @param asrResult ASR 结果
     * @returns 聚合后的文本和是否应该处理（shouldProcess）
     */
    processASRResult(job, asrResult) {
        // 验证 session_id 是否存在（关键：确保 session 隔离）
        if (!job.session_id || job.session_id.trim() === '') {
            logger_1.default.error({ jobId: job.job_id, traceId: job.trace_id }, 'Job missing session_id, cannot process with Aggregator. Falling back to original ASR text.');
            // 降级：返回原始结果
            return {
                aggregatedText: asrResult.text || '',
                shouldProcess: true,
            };
        }
        // 如果未启用，直接返回原始结果
        if (!this.config.enabled || !this.manager) {
            return {
                aggregatedText: asrResult.text || '',
                shouldProcess: true,
            };
        }
        // 检查 ASR 结果是否为空
        const asrTextTrimmed = (asrResult.text || '').trim();
        if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
            // 空结果直接返回
            return {
                aggregatedText: '',
                shouldProcess: false, // 空文本不需要处理
            };
        }
        // 提取 segments
        const segments = asrResult.segments;
        // 提取语言概率信息
        const langProbs = {
            top1: asrResult.language_probabilities
                ? Object.keys(asrResult.language_probabilities)[0] || job.src_lang
                : job.src_lang,
            p1: asrResult.language_probability || 0.9,
            top2: asrResult.language_probabilities
                ? Object.keys(asrResult.language_probabilities).find((lang) => {
                    const keys = Object.keys(asrResult.language_probabilities);
                    return lang !== (keys[0] || job.src_lang);
                })
                : undefined,
            p2: asrResult.language_probabilities
                ? (() => {
                    const keys = Object.keys(asrResult.language_probabilities);
                    const top1Key = keys[0] || job.src_lang;
                    const top2Key = keys.find((lang) => lang !== top1Key);
                    return top2Key ? asrResult.language_probabilities[top2Key] : undefined;
                })()
                : undefined,
        };
        // 确定模式
        // 始终使用双向互译模式
        const mode = 'two_way';
        // 处理 utterance
        const aggregatorResult = this.manager.processUtterance(job.session_id, asrTextTrimmed, segments, langProbs, asrResult.badSegmentDetection?.qualityScore, true, // isFinal: P0 只处理 final 结果
        job.is_manual_cut || job.isManualCut || false, // 从 job 中提取
        mode);
        // 记录聚合决策结果（详细日志在 PipelineOrchestrator 中输出）
        if (aggregatorResult.metrics) {
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                action: aggregatorResult.action,
                deduped: aggregatorResult.metrics.dedupCount ? true : false,
                dedupChars: aggregatorResult.metrics.dedupCharsRemoved || 0,
            }, 'AggregatorMiddleware: Utterance processing completed');
        }
        // 如果 Aggregator 决定提交，返回聚合后的文本
        let aggregatedText = asrTextTrimmed;
        let shouldProcess = true;
        if (aggregatorResult.shouldCommit && aggregatorResult.text) {
            // Aggregator 决定提交，使用聚合后的文本
            aggregatedText = aggregatorResult.text;
            shouldProcess = true;
            // 详细日志在 PipelineOrchestrator 中输出
        }
        else if (aggregatorResult.action === 'MERGE') {
            // Merge 操作：文本已累积到 pending，但还没有提交
            // 如果是 final，应该已经提交了 pending 文本（在 processUtterance 中）
            // 如果 shouldCommit=false，说明 pending 文本还没有达到提交条件
            // 但因为是 final，我们需要强制提交 pending 文本
            if (!aggregatorResult.shouldCommit) {
                // 强制 flush pending 文本（因为是 final）
                const flushedText = this.manager?.flush(job.session_id) || '';
                if (flushedText && flushedText.trim().length > 0) {
                    aggregatedText = flushedText;
                    shouldProcess = true;
                    // 详细日志在 PipelineOrchestrator 中输出
                }
                else {
                    // 如果没有 pending 文本，使用当前文本
                    aggregatedText = asrTextTrimmed;
                    shouldProcess = true;
                    // 详细日志在 PipelineOrchestrator 中输出
                }
            }
            else {
                // shouldCommit=true，但 action=MERGE，使用当前文本
                aggregatedText = asrTextTrimmed;
                shouldProcess = true;
                // 详细日志在 PipelineOrchestrator 中输出
            }
        }
        else {
            // NEW_STREAM: 使用原始文本
            aggregatedText = asrTextTrimmed;
            shouldProcess = true;
        }
        // 检查是否与上次发送的文本完全相同（防止重复处理）
        const duplicateCheck = this.deduplicationHandler.isDuplicate(job.session_id, aggregatedText, job.job_id, job.utterance_index);
        if (duplicateCheck.isDuplicate) {
            return {
                aggregatedText: '',
                shouldProcess: false,
                action: aggregatorResult.action,
                metrics: aggregatorResult.metrics,
            };
        }
        // 如果检测到重叠并已去重，使用去重后的文本
        let finalText = aggregatedText;
        if (duplicateCheck.deduplicatedText) {
            finalText = duplicateCheck.deduplicatedText;
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                originalText: aggregatedText,
                deduplicatedText: finalText,
                reason: duplicateCheck.reason,
            }, 'AggregatorMiddleware: Using deduplicated text (overlap removed)');
        }
        return {
            aggregatedText: finalText,
            shouldProcess: finalText.trim().length > 0,
            action: aggregatorResult.action,
            metrics: aggregatorResult.metrics,
        };
    }
    /**
     * 处理 JobResult（中间件入口）- 已废弃，保留用于兼容
     * @param job 原始 job 请求
     * @param result 推理服务返回的结果
     * @returns 处理后的结果和是否应该发送
     * @deprecated 使用 processASRResult 代替，在 NMT 之前处理
     */
    async process(job, result) {
        // 已废弃：直接使用 processASRResult 的逻辑
        const asrResult = {
            text: result.text_asr || '',
            segments: result.segments,
            language_probability: result.extra?.language_probability ?? undefined,
            language_probabilities: result.extra?.language_probabilities ?? undefined,
            badSegmentDetection: { qualityScore: result.quality_score },
        };
        const processResult = this.processASRResult(job, asrResult);
        return {
            shouldSend: processResult.shouldProcess,
            aggregatedText: processResult.aggregatedText,
            action: processResult.action,
            metrics: processResult.metrics,
        };
    }
    /**
     * 强制 flush session（stop/leave 时调用）
     */
    flush(sessionId) {
        if (!this.config.enabled || !this.manager) {
            return '';
        }
        return this.manager.flush(sessionId);
    }
    /**
     * 获取最后发送的文本
     */
    getLastSentText(sessionId) {
        return this.deduplicationHandler.getLastSentText(sessionId);
    }
    /**
     * 设置最后发送的文本（在成功发送后调用）
     */
    setLastSentText(sessionId, text) {
        this.deduplicationHandler.setLastSentText(sessionId, text);
    }
    /**
     * 清理 session（显式关闭）
     */
    removeSession(sessionId) {
        if (!this.config.enabled || !this.manager) {
            return;
        }
        this.manager.removeSession(sessionId);
        // 清理最后发送的文本记录
        this.deduplicationHandler.removeSession(sessionId);
        // S2-5: 清理音频缓存
        this.audioHandler.clearAudio(sessionId);
    }
    /**
     * 判断是否应该触发修复（已移除NMT Repair，保留方法用于兼容性）
     * 注意：现在只依赖语义修复服务，不再使用NMT Repair
     */
    shouldRepair(text, qualityScore, dedupCharsRemoved) {
        // NMT Repair 已移除，现在只依赖语义修复服务
        return false;
    }
    /**
     * 获取 session 指标
     */
    getMetrics(sessionId) {
        if (!this.config.enabled || !this.manager) {
            return null;
        }
        return this.manager.getMetrics(sessionId);
    }
    /**
     * 检查是否启用
     */
    isEnabled() {
        return this.config.enabled;
    }
}
exports.AggregatorMiddleware = AggregatorMiddleware;
