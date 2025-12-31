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
// S1/S2: 短句准确率提升
const prompt_builder_1 = require("../asr/prompt-builder");
const need_rescore_1 = require("../asr/need-rescore");
const rescorer_1 = require("../asr/rescorer");
const candidate_provider_1 = require("../asr/candidate-provider");
const audio_ring_buffer_1 = require("../asr/audio-ring-buffer");
class AggregatorMiddleware {
    constructor(config, taskRouter) {
        this.manager = null;
        this.taskRouter = null; // TaskRouter 用于重新触发 NMT
        this.lastSentText = new Map(); // 记录每个 session 最后发送的文本（防止重复发送）
        this.lastSentTextAccessTime = new Map(); // 记录最后访问时间，用于清理过期记录
        this.LAST_SENT_TEXT_TTL_MS = 10 * 60 * 1000; // 10 分钟 TTL
        this.LAST_SENT_TEXT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟清理一次
        // S1/S2: 短句准确率提升组件
        this.promptBuilder = null;
        this.needRescoreDetector = null;
        this.rescorer = null;
        this.candidateProvider = null;
        // S2-5: 音频 ring buffer（按 session 管理）
        this.audioBuffers = new Map();
        // S2-6: 二次解码 worker
        this.secondaryDecodeWorker = null;
        // 批量处理队列
        this.batchQueue = [];
        this.batchTimer = null;
        this.BATCH_WINDOW_MS = 500; // 批量处理窗口：500ms（增加以减少GPU峰值）
        this.MAX_BATCH_SIZE = 5; // 最大批量大小：5个（减少以降低GPU占用）
        this.MAX_CONCURRENT_NMT = 2; // 批量翻译最大并发数：2个（限制GPU占用）
        // 异步处理：存储待更新的翻译
        this.pendingAsyncTranslations = new Map(); // cacheKey -> Promise<translation>
        this.config = config;
        this.taskRouter = taskRouter || null;
        // 初始化翻译缓存：默认 200 条，10 分钟过期（提高缓存命中率）
        this.translationCache = new lru_cache_1.LRUCache({
            max: config.translationCacheSize || 200, // 提高：从 100 提高到 200
            ttl: config.translationCacheTtlMs || 10 * 60 * 1000, // 提高：从 5 分钟提高到 10 分钟
        });
        if (config.enabled) {
            this.manager = new aggregator_1.AggregatorManager({
                ttlMs: config.ttlMs || 5 * 60 * 1000,
                maxSessions: config.maxSessions || 1000,
            });
            // S1/S2: 初始化短句准确率提升组件
            const mode = config.mode || 'offline';
            this.promptBuilder = new prompt_builder_1.PromptBuilder(mode);
            this.needRescoreDetector = new need_rescore_1.NeedRescoreDetector();
            this.rescorer = new rescorer_1.Rescorer();
            this.candidateProvider = new candidate_provider_1.CandidateProvider();
            // S2-6: 二次解码已禁用（GPU占用过高）
            // 不再初始化SecondaryDecodeWorker
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
        const mode = (job.mode === 'two_way_auto' || job.room_mode) ? 'room' : 'offline';
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
        const lastSent = this.lastSentText.get(job.session_id);
        if (lastSent) {
            const normalizeText = (text) => {
                return text.replace(/\s+/g, ' ').trim();
            };
            const normalizedAggregated = normalizeText(aggregatedText);
            const normalizedLastSent = normalizeText(lastSent);
            if (normalizedAggregated === normalizedLastSent && normalizedAggregated.length > 0) {
                // 完全相同的文本，不处理（防止重复）
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    originalASRText: asrTextTrimmed,
                    aggregatedText: aggregatedText,
                    normalizedText: normalizedAggregated,
                    lastSentText: lastSent,
                    reason: 'Duplicate text detected (same as last sent)',
                }, 'AggregatorMiddleware: Filtering duplicate text, returning empty result (no NMT/TTS)');
                return {
                    aggregatedText: '',
                    shouldProcess: false,
                    action: aggregatorResult.action,
                    metrics: aggregatorResult.metrics,
                };
            }
            // 修复：如果当前文本是前一个utterance的子串，也应该过滤掉
            // 避免ASR服务对短音频识别出前一个utterance的部分内容，导致重复输出
            if (normalizedLastSent.length > 0 && normalizedAggregated.length > 0) {
                // 检查当前文本是否是前一个utterance的子串（至少3个字符，避免误判）
                if (normalizedAggregated.length >= 3 && normalizedLastSent.includes(normalizedAggregated)) {
                    logger_1.default.info({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        originalASRText: asrTextTrimmed,
                        aggregatedText: aggregatedText,
                        normalizedText: normalizedAggregated,
                        lastSentText: lastSent,
                        normalizedLastSent: normalizedLastSent,
                        reason: 'Current text is a substring of last sent text, filtering to avoid duplicate output',
                    }, 'AggregatorMiddleware: Filtering substring duplicate text, returning empty result (no NMT/TTS)');
                    return {
                        aggregatedText: '',
                        shouldProcess: false,
                        action: aggregatorResult.action,
                        metrics: aggregatorResult.metrics,
                    };
                }
                // 检查前一个utterance是否是当前文本的子串（至少3个字符，避免误判）
                // 这种情况不应该发生，但为了安全起见，也检查一下
                if (normalizedLastSent.length >= 3 && normalizedAggregated.includes(normalizedLastSent)) {
                    logger_1.default.info({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        originalASRText: asrTextTrimmed,
                        aggregatedText: aggregatedText,
                        normalizedText: normalizedAggregated,
                        lastSentText: lastSent,
                        normalizedLastSent: normalizedLastSent,
                        reason: 'Last sent text is a substring of current text, this should not happen, but filtering to avoid duplicate output',
                    }, 'AggregatorMiddleware: Filtering reverse substring duplicate text, returning empty result (no NMT/TTS)');
                    return {
                        aggregatedText: '',
                        shouldProcess: false,
                        action: aggregatorResult.action,
                        metrics: aggregatorResult.metrics,
                    };
                }
            }
        }
        return {
            aggregatedText,
            shouldProcess,
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
        // 检查是否是第一次任务（通过session状态判断，避免第一次任务时触发S2导致GPU过载）
        const isFirstJob = !this.manager?.getMetrics(job.session_id);
        // S2-5: 音频缓存已禁用（不再需要，因为二次解码已禁用）
        // 不再缓存音频，节省内存
        // 验证 session_id 是否存在（关键：确保 session 隔离）
        if (!job.session_id || job.session_id.trim() === '') {
            logger_1.default.error({ jobId: job.job_id, traceId: job.trace_id }, 'Job missing session_id, cannot process with Aggregator. Falling back to original result.');
            // 降级：返回原始结果
            return {
                shouldSend: true,
                aggregatedText: result.text_asr,
            };
        }
        // 如果未启用，直接返回原始结果
        if (!this.config.enabled || !this.manager) {
            return {
                shouldSend: true,
                aggregatedText: result.text_asr,
            };
        }
        // 检查 ASR 结果是否为空
        const asrTextTrimmed = (result.text_asr || '').trim();
        if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
            // 空结果直接发送
            return {
                shouldSend: true,
                aggregatedText: '',
            };
        }
        // 提取 segments（从 result.segments 中获取）
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
        const aggregatorResult = this.manager.processUtterance(job.session_id, asrTextTrimmed, segments, langProbs, result.quality_score, true, // isFinal: P0 只处理 final 结果
        false, // isManualCut: 从 job 中提取（如果有）
        mode);
        // 记录指标
        if (aggregatorResult.metrics) {
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                action: aggregatorResult.action,
                deduped: aggregatorResult.metrics.dedupCount ? true : false,
                dedupChars: aggregatorResult.metrics.dedupCharsRemoved || 0,
            }, 'Aggregator middleware processing completed');
        }
        // 定期输出完整指标
        const metrics = this.manager.getMetrics(job.session_id);
        if (metrics && metrics.commitCount > 0 && metrics.commitCount % 10 === 0) {
            logger_1.default.info({
                sessionId: job.session_id,
                metrics: {
                    commitCount: metrics.commitCount,
                    mergeCount: metrics.mergeCount,
                    newStreamCount: metrics.newStreamCount,
                    dedupCount: metrics.dedupCount,
                    dedupCharsRemoved: metrics.dedupCharsRemoved,
                    tailCarryUsage: metrics.tailCarryUsage,
                    commitLatencyMs: metrics.commitLatencyMs,
                    missingGapCount: metrics.missingGapCount,
                },
            }, 'Aggregator middleware metrics summary');
        }
        // P0: 只处理 final 结果，所以总是提交
        // 如果 Aggregator 决定不提交（shouldCommit=false），说明是 merge 操作，文本已累积到 pending
        // 但因为是 final，我们仍然需要提交当前结果
        let aggregatedText = asrTextTrimmed;
        if (aggregatorResult.shouldCommit && aggregatorResult.text) {
            // Aggregator 决定提交，使用聚合后的文本
            aggregatedText = aggregatorResult.text;
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                action: aggregatorResult.action,
                originalLength: asrTextTrimmed.length,
                aggregatedLength: aggregatedText.length,
            }, 'Aggregator middleware: Using aggregated text');
        }
        else if (aggregatorResult.action === 'MERGE') {
            // Merge 操作：文本已累积到 pending
            // 如果是 final，应该已经提交了 pending 文本（在 processUtterance 中）
            // 如果 shouldCommit=false，说明 pending 文本还没有达到提交条件
            // 但因为是 final，我们需要强制提交 pending 文本
            if (!aggregatorResult.shouldCommit) {
                // 强制 flush pending 文本（因为是 final）
                const flushedText = this.manager?.flush(job.session_id) || '';
                if (flushedText && flushedText.trim().length > 0) {
                    // 检查是否与上次发送的文本相同（防止重复发送）
                    const lastSent = this.lastSentText.get(job.session_id);
                    if (lastSent) {
                        const normalizeText = (text) => {
                            return text.replace(/\s+/g, ' ').trim();
                        };
                        const normalizedFlushed = normalizeText(flushedText);
                        const normalizedLastSent = normalizeText(lastSent);
                        if (normalizedFlushed === normalizedLastSent) {
                            logger_1.default.warn({
                                jobId: job.job_id,
                                sessionId: job.session_id,
                                utteranceIndex: job.utterance_index,
                                flushedText: flushedText.substring(0, 50),
                            }, 'Skipping duplicate flushed text (same as last sent)');
                            return {
                                shouldSend: false,
                                aggregatedText: flushedText,
                                action: aggregatorResult.action,
                                metrics: aggregatorResult.metrics,
                            };
                        }
                    }
                    aggregatedText = flushedText;
                    logger_1.default.debug({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        action: aggregatorResult.action,
                        flushedLength: flushedText.length,
                    }, 'Aggregator middleware: Flushed pending text for final utterance');
                }
                else {
                    // 如果没有 pending 文本，使用当前文本
                    aggregatedText = asrTextTrimmed;
                    logger_1.default.debug({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        action: aggregatorResult.action,
                    }, 'Aggregator middleware: Merge action, no pending text, using current text');
                }
            }
            else {
                // shouldCommit=true，但 action=MERGE，使用当前文本
                aggregatedText = asrTextTrimmed;
                logger_1.default.debug({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    action: aggregatorResult.action,
                }, 'Aggregator middleware: Merge action, using current text');
            }
        }
        // S2: Rescoring已禁用（依赖二次解码，GPU占用过高）
        // 不再进行rescoring，直接使用aggregatedText
        let finalText = aggregatedText;
        let rescoreApplied = false;
        let rescoreReasons = [];
        let rescoreAddedLatencyMs = 0;
        // 使用finalText（可能经过rescoring）
        aggregatedText = finalText;
        // 注意：已废弃的方法，不再重新触发 NMT 翻译
        // 现在 AggregatorMiddleware 在 NMT 之前调用（通过 processASRResult），
        // 所以这里只返回聚合后的文本，不进行重新翻译
        // 保留原始翻译文本（从 result 中获取）
        let translatedText = result.text_translated;
        let nmtRetranslationTimeMs = undefined;
        // 不再重新触发 NMT，因为已经在 NMT 之前处理了
        logger_1.default.debug({
            jobId: job.job_id,
            sessionId: job.session_id,
            note: 'Deprecated process() method: NMT retranslation skipped (already processed in processASRResult)',
        }, 'Aggregator middleware: Using original translation (no retranslation in deprecated method)');
        // 保存当前翻译文本，供下一个 utterance 使用（1分钟过期）
        if (translatedText && this.manager) {
            this.manager.setLastTranslatedText(job.session_id, translatedText);
        }
        // 移除所有重新翻译逻辑，因为已经在 NMT 之前处理了
        // 以下代码已注释，保留用于参考
        /*
        if (aggregatedText.trim() !== asrTextTrimmed.trim() && this.taskRouter) {
          const nmtStartTime = Date.now();
          
          // 获取上下文文本（用于缓存键生成）
          let contextText = this.manager?.getLastTranslatedText(job.session_id) || undefined;
          if (contextText && contextText.length > 200) {
            contextText = contextText.substring(contextText.length - 200);
          }
          
          // 生成缓存键（使用优化的缓存键生成器）
          const cacheKey = generateCacheKey(
            job.src_lang,
            job.tgt_lang,
            aggregatedText,
            contextText
          );
          
          // 检查是否应该缓存（太短或太长的文本可能不值得缓存）
          const shouldCacheThis = shouldCache(aggregatedText);
          
          // 检查缓存
          const cachedTranslation = shouldCacheThis ? this.translationCache.get(cacheKey) : undefined;
          if (cachedTranslation) {
            translatedText = cachedTranslation;
            nmtRetranslationTimeMs = Date.now() - nmtStartTime;
            
            logger.debug(
              {
                jobId: job.job_id,
                sessionId: job.session_id,
                cacheHit: true,
                translationTimeMs: nmtRetranslationTimeMs,
              },
              'Re-triggered NMT for aggregated text (from cache)'
            );
          } else {
            // 缓存未命中，调用 NMT 服务
            // 检查是否应该异步处理（长文本）
            const shouldAsync = this.config.enableAsyncRetranslation &&
                                aggregatedText.length > (this.config.asyncRetranslationThreshold || 50);
            
            if (shouldAsync) {
              // 异步处理：先返回原始翻译，后台更新
              translatedText = result.text_translated || '';
              nmtRetranslationTimeMs = Date.now() - nmtStartTime;  // 异步处理延迟接近 0
              
              // 后台异步处理翻译
              this.processAsyncRetranslation(job, aggregatedText, contextText, cacheKey, shouldCacheThis, result);
              
              logger.debug(
                {
                  jobId: job.job_id,
                  sessionId: job.session_id,
                  textLength: aggregatedText.length,
                  async: true,
                },
                'Re-triggered NMT for aggregated text (async processing)'
              );
            } else {
              // 同步处理：等待翻译完成
              try {
                // 获取上一个 utterance 的翻译文本作为上下文（1分钟过期）
                let contextText = this.manager?.getLastTranslatedText(job.session_id) || undefined;
                
                // 限制上下文文本长度（避免过长导致问题）
                if (contextText && contextText.length > 200) {
                  contextText = contextText.substring(contextText.length - 200);
                }
                
                // 检查是否应该使用 NMT Repair
                const shouldRepair = this.shouldRepair(
                  aggregatedText,
                  result.quality_score,
                  aggregatorResult.metrics?.dedupCharsRemoved || 0
                );
                
                // 检查是否可能包含同音字错误
                const hasHomophoneErrors = hasPossibleHomophoneErrors(aggregatedText);
                
                // 如果可能包含同音字错误，生成原文候选（包括原文和修复后的原文）
                let sourceCandidates: string[] = [aggregatedText];
                if (hasHomophoneErrors) {
                  sourceCandidates = detectHomophoneErrors(aggregatedText);
                  logger.debug(
                    {
                      jobId: job.job_id,
                      sessionId: job.session_id,
                      originalText: aggregatedText.substring(0, 50),
                      numSourceCandidates: sourceCandidates.length,
                      sourceCandidates: sourceCandidates.map(c => c.substring(0, 30)),
                    },
                    'NMT Repair: Detected possible homophone errors, generating source candidates'
                  );
                }
                
                // 如果只有一个原文候选且启用了 NMT Repair，使用 NMT 候选生成
                if (sourceCandidates.length === 1 && shouldRepair) {
                  const nmtTask: NMTTask = {
                    text: aggregatedText,
                    src_lang: job.src_lang,
                    tgt_lang: job.tgt_lang,
                    context_text: contextText,
                    job_id: job.job_id,
                    num_candidates: this.config.nmtRepairNumCandidates || 5,
                  };
                  
                  const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
                  
                  // 构建候选列表（包含原始翻译）
                  const candidates = [
                    { candidate: aggregatedText, translation: result.text_translated || '' },
                    ...(nmtResult.candidates || []).map(candidate => ({
                      candidate: aggregatedText,
                      translation: candidate,
                    })),
                  ];
                  
                  // 获取上一个翻译作为上下文（用于打分）
                  const previousTranslation = this.manager?.getLastTranslatedText(job.session_id) || undefined;
                  
                  // 对候选进行打分
                  const scoredCandidates = scoreCandidates(
                    candidates,
                    aggregatedText,
                    result.text_translated || '',
                    previousTranslation
                  );
                  
                  // 选择最佳候选
                  const bestCandidate = selectBestCandidate(
                    scoredCandidates,
                    result.text_translated || '',
                    this.config.nmtRepairThreshold ? 1 - this.config.nmtRepairThreshold : 0.05
                  );
                  
                  if (bestCandidate) {
                    translatedText = bestCandidate.translation;
                    logger.info(
                      {
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        originalTranslation: result.text_translated?.substring(0, 50),
                        bestTranslation: bestCandidate.translation.substring(0, 50),
                        bestScore: bestCandidate.score,
                        numCandidates: scoredCandidates.length,
                      },
                      'NMT Repair: Selected best candidate'
                    );
                  } else {
                    translatedText = nmtResult.text;
                    logger.debug(
                      {
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        reason: 'No significant improvement',
                      },
                      'NMT Repair: Using original translation (no significant improvement)'
                    );
                  }
                } else if (sourceCandidates.length > 1) {
                  // 有多个原文候选（同音字修复），对每个候选进行 NMT 翻译并打分
                  logger.debug(
                    {
                      jobId: job.job_id,
                      sessionId: job.session_id,
                      numSourceCandidates: sourceCandidates.length,
                    },
                    'NMT Repair: Translating multiple source candidates for homophone repair'
                  );
                  
                  // 对每个原文候选进行 NMT 翻译
                  if (!this.taskRouter) {
                    logger.error(
                      { jobId: job.job_id, sessionId: job.session_id },
                      'NMT Repair: TaskRouter not available, cannot translate source candidates'
                    );
                    translatedText = result.text_translated || '';
                  } else {
                    // 限制并发数，分批处理（避免GPU过载）
                    const MAX_CONCURRENT_CANDIDATES = 2;  // 最多同时翻译2个候选
                    const translatedCandidates: Array<{ candidate: string; translation: string }> = [];
                    
                    for (let i = 0; i < sourceCandidates.length; i += MAX_CONCURRENT_CANDIDATES) {
                      const chunk = sourceCandidates.slice(i, i + MAX_CONCURRENT_CANDIDATES);
                      const translationPromises = chunk.map(async (sourceCandidate) => {
                        const nmtTask: NMTTask = {
                          text: sourceCandidate,
                          src_lang: job.src_lang,
                          tgt_lang: job.tgt_lang,
                          context_text: contextText,
                          job_id: job.job_id,
                        };
                        
                        const nmtResult = await this.taskRouter!.routeNMTTask(nmtTask);
                        return {
                          candidate: sourceCandidate,
                          translation: nmtResult.text,
                        };
                      });
                      
                      const chunkResults = await Promise.all(translationPromises);
                      translatedCandidates.push(...chunkResults);
                    }
                    
                    // 获取上一个翻译作为上下文（用于打分）
                    const previousTranslation = this.manager?.getLastTranslatedText(job.session_id) || undefined;
                    
                    // 对候选进行打分
                    const scoredCandidates = scoreCandidates(
                      translatedCandidates,
                      aggregatedText,
                      result.text_translated || '',
                      previousTranslation
                    );
                    
                    // 选择最佳候选
                    const bestCandidate = selectBestCandidate(
                      scoredCandidates,
                      result.text_translated || '',
                      this.config.nmtRepairThreshold ? 1 - this.config.nmtRepairThreshold : 0.05
                    );
                    
                    if (bestCandidate) {
                      // 更新 aggregatedText 为修复后的原文
                      const originalAggregatedText = aggregatedText;
                      aggregatedText = bestCandidate.candidate;
                      translatedText = bestCandidate.translation;
                      
                      // 计算分数提升（用于自动学习）
                      const originalScore = scoredCandidates.find(c => c.candidate === originalAggregatedText)?.score || 0;
                      const scoreImprovement = bestCandidate.score - originalScore;
                      
                      // 如果修复后的文本与原文不同，且分数有明显提升，进行自动学习
                      if (bestCandidate.candidate !== originalAggregatedText && scoreImprovement > 0.1) {
                        learnHomophonePattern(originalAggregatedText, bestCandidate.candidate, scoreImprovement);
                      }
                      
                      logger.info(
                        {
                          jobId: job.job_id,
                          sessionId: job.session_id,
                          originalText: originalAggregatedText.substring(0, 50),
                          fixedText: bestCandidate.candidate.substring(0, 50),
                          originalTranslation: result.text_translated?.substring(0, 50),
                          bestTranslation: bestCandidate.translation.substring(0, 50),
                          bestScore: bestCandidate.score,
                          scoreImprovement: scoreImprovement.toFixed(3),
                          numCandidates: scoredCandidates.length,
                        },
                        'NMT Repair: Selected best candidate (homophone repair)'
                      );
                    } else {
                      // 没有明显更好的候选，使用原始翻译
                      translatedText = result.text_translated || '';
                      logger.debug(
                        {
                          jobId: job.job_id,
                          sessionId: job.session_id,
                          reason: 'No significant improvement',
                        },
                        'NMT Repair: Using original translation (no significant improvement)'
                      );
                    }
                  }
                } else {
                  // 没有同音字错误，也没有启用 NMT Repair，直接翻译
                  // 检查是否应该使用批量处理
                  const shouldBatch = this.batchQueue.length > 0 ||
                                     (this.config.enableAsyncRetranslation && aggregatedText.length <= (this.config.asyncRetranslationThreshold || 50));
                  
                  if (shouldBatch && this.batchQueue.length < this.MAX_BATCH_SIZE) {
                    // 使用批量处理
                    translatedText = await new Promise<string>((resolve, reject) => {
                      this.batchQueue.push({
                        job,
                        aggregatedText,
                        contextText,
                        resolve,
                        reject,
                        timestamp: Date.now(),
                      });
                      
                      // 调度批量处理
                      this.scheduleBatchProcessing();
                    });
                  } else {
                    // 直接翻译
                    const nmtTask: NMTTask = {
                      text: aggregatedText,
                      src_lang: job.src_lang,
                      tgt_lang: job.tgt_lang,
                      context_text: contextText,
                      job_id: job.job_id,
                    };
                    
                    const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
                    translatedText = nmtResult.text;
                  }
                }
              
              nmtRetranslationTimeMs = Date.now() - nmtStartTime;
              
              // 存入缓存（只有适合缓存的文本才缓存）
              if (shouldCacheThis && translatedText) {
                this.translationCache.set(cacheKey, translatedText);
              }
              
              // 保存当前翻译文本，供下一个 utterance 使用（1分钟过期）
              if (translatedText && this.manager) {
                this.manager.setLastTranslatedText(job.session_id, translatedText);
              }
              
              logger.info(
                {
                  jobId: job.job_id,
                  sessionId: job.session_id,
                  originalText: asrTextTrimmed.substring(0, 50),
                  aggregatedText: aggregatedText.substring(0, 50),
                  originalTranslation: result.text_translated?.substring(0, 50),
                  newTranslation: translatedText?.substring(0, 50),
                  translationTimeMs: nmtRetranslationTimeMs,
                  cacheHit: false,
                  hasContext: !!contextText,
                  contextText: contextText?.substring(0, 30),
                },
                'Re-triggered NMT for aggregated text'
              );
            } catch (error) {
              // 降级：使用原始翻译
              logger.error(
                {
                  error,
                  jobId: job.job_id,
                  sessionId: job.session_id,
                  aggregatedText: aggregatedText.substring(0, 50),
                },
                'Failed to re-trigger NMT, using original translation'
              );
              // translatedText 保持 undefined，使用原始翻译
              nmtRetranslationTimeMs = Date.now() - nmtStartTime;
            }
            }
          }
        }
        */
        // 重新翻译逻辑结束（已注释）
        // 如果是 NEW_STREAM，清理上下文（可选，但保留1分钟过期机制）
        // 注意：我们使用1分钟过期机制，所以不需要手动清理
        // 检查是否与上次发送的文本完全相同（防止重复发送）
        // 优化：使用更严格的文本比较（去除所有空白字符，包括换行符、多个空格等）
        const lastSent = this.lastSentText.get(job.session_id);
        if (lastSent) {
            // 规范化文本：去除所有空白字符，只保留实际内容
            const normalizeText = (text) => {
                return text.replace(/\s+/g, ' ').trim();
            };
            const normalizedAggregated = normalizeText(aggregatedText);
            const normalizedLastSent = normalizeText(lastSent);
            if (normalizedAggregated === normalizedLastSent && normalizedAggregated.length > 0) {
                // 完全相同的文本，不发送（防止停止后重复返回）
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    text: aggregatedText.substring(0, 50),
                    normalizedText: normalizedAggregated.substring(0, 50),
                    lastSentText: lastSent.substring(0, 50),
                }, 'Skipping duplicate text (same as last sent after normalization)');
                return {
                    shouldSend: false,
                    aggregatedText,
                    translatedText,
                    action: aggregatorResult.action,
                    metrics: {
                        ...aggregatorResult.metrics,
                        nmtRetranslationTimeMs,
                    },
                };
            }
            // 额外检查：如果文本非常相似（相似度>95%），也视为重复
            if (normalizedAggregated.length > 0 && normalizedLastSent.length > 0) {
                const similarity = this.calculateTextSimilarity(normalizedAggregated, normalizedLastSent);
                if (similarity > 0.95) {
                    logger_1.default.warn({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        text: aggregatedText.substring(0, 50),
                        lastSentText: lastSent.substring(0, 50),
                        similarity,
                    }, 'Skipping duplicate text (high similarity with last sent)');
                    return {
                        shouldSend: false,
                        aggregatedText,
                        translatedText,
                        action: aggregatorResult.action,
                        metrics: {
                            ...aggregatorResult.metrics,
                            nmtRetranslationTimeMs,
                        },
                    };
                }
            }
        }
        // 在返回前立即更新lastSentText（防止并发请求导致的重复发送）
        // 注意：这里只是标记，实际发送在NodeAgent中
        if (aggregatedText && aggregatedText.length > 0) {
            const normalizeText = (text) => {
                return text.replace(/\s+/g, ' ').trim();
            };
            this.lastSentText.set(job.session_id, normalizeText(aggregatedText));
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                text: aggregatedText.substring(0, 50),
            }, 'Updated lastSentText (pre-send) to prevent duplicate');
        }
        // 注意：lastSentText 的更新应该在 NodeAgent 发送成功后进行
        // 这里只返回结果，不更新 lastSentText（由 NodeAgent 负责更新）
        return {
            shouldSend: true, // P0 总是发送（因为是 final）
            aggregatedText,
            translatedText, // 新增：重新翻译的文本
            action: aggregatorResult.action,
            metrics: {
                ...aggregatorResult.metrics,
                nmtRetranslationTimeMs, // 新增：重新翻译耗时
                // S2: Rescoring trace信息
                rescoreApplied,
                rescoreReasons: rescoreReasons.length > 0 ? rescoreReasons : undefined,
                rescoreAddedLatencyMs: rescoreAddedLatencyMs > 0 ? rescoreAddedLatencyMs : undefined,
            },
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
        return this.lastSentText.get(sessionId);
    }
    /**
     * 设置最后发送的文本（在成功发送后调用）
     */
    setLastSentText(sessionId, text) {
        // 规范化存储：去除所有空白字符
        const normalizeText = (t) => {
            return t.replace(/\s+/g, ' ').trim();
        };
        this.lastSentText.set(sessionId, normalizeText(text));
        this.lastSentTextAccessTime.set(sessionId, Date.now());
    }
    /**
     * 计算文本相似度（简单的字符重叠度）
     */
    calculateTextSimilarity(text1, text2) {
        if (text1.length === 0 && text2.length === 0)
            return 1.0;
        if (text1.length === 0 || text2.length === 0)
            return 0.0;
        // 使用较短的文本作为基准
        const shorter = text1.length < text2.length ? text1 : text2;
        const longer = text1.length >= text2.length ? text1 : text2;
        // 检查较短文本是否完全包含在较长文本中
        if (longer.includes(shorter)) {
            return shorter.length / longer.length;
        }
        // 计算字符重叠度（简化版）
        let matches = 0;
        const minLen = Math.min(text1.length, text2.length);
        for (let i = 0; i < minLen; i++) {
            if (text1[i] === text2[i]) {
                matches++;
            }
        }
        return matches / Math.max(text1.length, text2.length);
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
        this.lastSentText.delete(sessionId);
        this.lastSentTextAccessTime.delete(sessionId);
        // S2-5: 清理音频缓存
        this.audioBuffers.delete(sessionId);
        // 清理 pendingAsyncTranslations（如果存在）
        // 注意：这里只清理与 sessionId 相关的，但 pendingAsyncTranslations 的 key 是 cacheKey，不是 sessionId
        // 所以这里无法直接清理，需要在其他地方清理
    }
    /**
     * 清理过期的 lastSentText 记录
     */
    cleanupExpiredLastSentText() {
        const now = Date.now();
        const expiredSessions = [];
        for (const [sessionId, lastAccess] of this.lastSentTextAccessTime.entries()) {
            if (now - lastAccess > this.LAST_SENT_TEXT_TTL_MS) {
                expiredSessions.push(sessionId);
            }
        }
        for (const sessionId of expiredSessions) {
            this.lastSentText.delete(sessionId);
            this.lastSentTextAccessTime.delete(sessionId);
        }
        if (expiredSessions.length > 0) {
            logger_1.default.info({
                count: expiredSessions.length,
                remainingCount: this.lastSentText.size,
            }, 'AggregatorMiddleware: Cleaned up expired lastSentText entries');
        }
    }
    /**
     * S2-5: 缓存音频
     */
    cacheAudio(sessionId, audio, audioFormat = 'pcm16', sampleRate = 16000) {
        try {
            // 获取或创建音频缓冲区
            let buffer = this.audioBuffers.get(sessionId);
            if (!buffer) {
                buffer = new audio_ring_buffer_1.AudioRingBuffer(15000, 10000); // 15秒缓存，10秒TTL
                this.audioBuffers.set(sessionId, buffer);
            }
            // 估算音频时长（简化：假设是PCM16格式）
            // 实际应该根据音频格式和长度计算
            let durationMs = 0;
            if (audioFormat === 'pcm16' && audio.length > 0) {
                // base64解码后的字节数
                const decodedLength = Buffer.from(audio, 'base64').length;
                // PCM16: 2字节/样本，单声道
                const samples = decodedLength / 2;
                durationMs = (samples / sampleRate) * 1000;
            }
            else {
                // 其他格式：使用估算值（100ms）
                durationMs = 100;
            }
            // 添加音频块
            buffer.addChunk(audio, durationMs, sampleRate, audioFormat);
        }
        catch (error) {
            logger_1.default.warn({
                error,
                sessionId,
                audioLength: audio?.length || 0,
            }, 'S2-5: Failed to cache audio');
        }
    }
    /**
     * S2-5: 获取音频引用（用于二次解码）
     */
    getAudioRef(sessionId) {
        const buffer = this.audioBuffers.get(sessionId);
        if (!buffer) {
            return null;
        }
        // 获取最近5秒的音频（用于二次解码）
        return buffer.getRecentAudioRef(5);
    }
    /**
     * 异步处理重新翻译（后台更新）
     */
    async processAsyncRetranslation(job, aggregatedText, contextText, cacheKey, shouldCacheThis, result) {
        // 检查是否已经有正在进行的异步翻译
        if (this.pendingAsyncTranslations.has(cacheKey)) {
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                cacheKey: cacheKey.substring(0, 50),
            }, 'Async retranslation already in progress, skipping');
            return;
        }
        // 创建异步翻译 Promise
        const translationPromise = (async () => {
            try {
                if (!this.taskRouter) {
                    logger_1.default.error({ jobId: job.job_id, sessionId: job.session_id }, 'Async retranslation: TaskRouter not available');
                    return '';
                }
                const nmtTask = {
                    text: aggregatedText,
                    src_lang: job.src_lang,
                    tgt_lang: job.tgt_lang,
                    context_text: contextText,
                    job_id: job.job_id,
                };
                const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
                const translatedText = nmtResult.text;
                // 存入缓存
                if (shouldCacheThis && translatedText) {
                    this.translationCache.set(cacheKey, translatedText);
                }
                // 保存当前翻译文本，供下一个 utterance 使用
                if (translatedText && this.manager) {
                    this.manager.setLastTranslatedText(job.session_id, translatedText);
                }
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    aggregatedText: aggregatedText.substring(0, 50),
                    newTranslation: translatedText?.substring(0, 50),
                    async: true,
                }, 'Async retranslation completed');
                return translatedText;
            }
            catch (error) {
                logger_1.default.error({
                    error,
                    jobId: job.job_id,
                    sessionId: job.session_id,
                }, 'Async retranslation failed');
                return '';
            }
            finally {
                // 清理待处理的异步翻译
                this.pendingAsyncTranslations.delete(cacheKey);
            }
        })();
        // 存储 Promise
        this.pendingAsyncTranslations.set(cacheKey, translationPromise);
        // 不等待完成，直接返回
        translationPromise.catch(() => {
            // 错误已在 Promise 内部处理
        });
    }
    /**
     * 批量处理重新翻译
     */
    async processBatchRetranslation() {
        if (this.batchQueue.length === 0) {
            return;
        }
        // 取出当前批次（最多 MAX_BATCH_SIZE 个）
        const batch = this.batchQueue.splice(0, this.MAX_BATCH_SIZE);
        if (batch.length === 0) {
            return;
        }
        logger_1.default.debug({
            batchSize: batch.length,
        }, 'Processing batch retranslation');
        // 限制并发数，分批处理（避免GPU过载）
        const MAX_CONCURRENT = this.MAX_CONCURRENT_NMT;
        for (let i = 0; i < batch.length; i += MAX_CONCURRENT) {
            const chunk = batch.slice(i, i + MAX_CONCURRENT);
            const promises = chunk.map(async (item) => {
                try {
                    if (!this.taskRouter) {
                        item.reject(new Error('TaskRouter not available'));
                        return;
                    }
                    const nmtTask = {
                        text: item.aggregatedText,
                        src_lang: item.job.src_lang,
                        tgt_lang: item.job.tgt_lang,
                        context_text: item.contextText,
                        job_id: item.job.job_id,
                    };
                    const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
                    item.resolve(nmtResult.text);
                }
                catch (error) {
                    item.reject(error);
                }
            });
            // 等待当前批次完成后再处理下一批
            await Promise.allSettled(promises);
        }
        // 如果还有待处理的任务，继续处理
        if (this.batchQueue.length > 0) {
            this.scheduleBatchProcessing();
        }
    }
    /**
     * 调度批量处理
     */
    scheduleBatchProcessing() {
        // 清除现有定时器
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
        // 如果队列已满，立即处理
        if (this.batchQueue.length >= this.MAX_BATCH_SIZE) {
            this.processBatchRetranslation();
            return;
        }
        // 否则，设置定时器
        this.batchTimer = setTimeout(() => {
            this.batchTimer = null;
            this.processBatchRetranslation();
        }, this.BATCH_WINDOW_MS);
    }
    /**
     * 判断是否应该触发 NMT Repair
     */
    shouldRepair(text, qualityScore, dedupCharsRemoved) {
        // 如果未启用 NMT Repair，直接返回 false
        if (!this.config.nmtRepairEnabled) {
            return false;
        }
        // 质量分数低
        if (qualityScore !== undefined && qualityScore < (this.config.nmtRepairThreshold || 0.7)) {
            return true;
        }
        // 明显重复（Dedup 裁剪量大）
        if (dedupCharsRemoved > 10) {
            return true;
        }
        // 文本过短或过长（可能是错误）
        if (text.length < 3 || text.length > 500) {
            return false; // 过短或过长不修复
        }
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
