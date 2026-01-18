"use strict";
/**
 * TranslationStage - 翻译阶段（唯一 NMT 入口）
 * 职责：TranslationCache 查询、NMT 调用
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TranslationStage = void 0;
const lru_cache_1 = require("lru-cache");
const cache_key_generator_1 = require("../../aggregator/cache-key-generator");
const candidate_scorer_1 = require("../../aggregator/candidate-scorer");
const homophone_detector_1 = require("../../aggregator/homophone-detector");
const logger_1 = __importDefault(require("../../logger"));
const sequential_executor_factory_1 = require("../../sequential-executor/sequential-executor-factory");
const gpu_arbiter_1 = require("../../gpu-arbiter");
class TranslationStage {
    constructor(taskRouter, aggregatorManager, config) {
        this.taskRouter = taskRouter;
        this.aggregatorManager = aggregatorManager;
        this.config = config;
        this.pendingAsyncTranslations = new Map();
        this.ASYNC_TRANSLATION_TIMEOUT_MS = 30 * 1000; // 30 秒超时
        // 初始化翻译缓存
        this.translationCache = new lru_cache_1.LRUCache({
            max: config.translationCacheSize || 200,
            ttl: config.translationCacheTtlMs || 10 * 60 * 1000,
        });
        // 定期清理过期的 pendingAsyncTranslations
        setInterval(() => this.cleanupExpiredPendingTranslations(), 60000); // 每分钟清理一次
    }
    /**
     * 清理过期的 pendingAsyncTranslations
     */
    cleanupExpiredPendingTranslations() {
        // 注意：由于 Promise 没有时间戳，这里只清理已完成的 Promise
        // 实际清理应该在 Promise 完成或超时时进行
        // 这里只记录统计信息
        const count = this.pendingAsyncTranslations.size;
        if (count > 0) {
            logger_1.default.debug({
                pendingCount: count,
            }, 'TranslationStage: Pending async translations count');
        }
    }
    /**
     * 执行翻译
     * @param job 原始 job 请求
     * @param aggregatedText 聚合后的文本（可能已经过语义修复）
     * @param qualityScore ASR 质量分数
     * @param dedupCharsRemoved 去重移除的字符数
     * @param semanticRepairContext 语义修复上下文（保留用于兼容性，但不再使用）
     */
    async process(job, aggregatedText, qualityScore, dedupCharsRemoved = 0, semanticRepairContext) {
        const startTime = Date.now();
        // 检查是否需要翻译
        if (!aggregatedText || aggregatedText.trim().length === 0) {
            return {
                translatedText: '',
                translationTimeMs: Date.now() - startTime,
            };
        }
        // 检查 src_lang 和 tgt_lang
        if (!job.src_lang || !job.tgt_lang) {
            logger_1.default.warn({ jobId: job.job_id, srcLang: job.src_lang, tgtLang: job.tgt_lang }, 'TranslationStage: Missing language info, skipping translation');
            return {
                translatedText: '',
                translationTimeMs: Date.now() - startTime,
            };
        }
        // 获取上下文文本（用于NMT服务的context_text）
        // 重要：应该使用上一个utterance的原文（ASR文本，中文），而不是翻译文本（英文）
        // 因为NMT服务会将context_text和text拼接，如果context_text是英文翻译，会导致混合语言输入
        // 修复：只按utteranceIndex顺序选择最近一条已提交的完整文本，不再基于文本内容匹配
        let contextText = this.aggregatorManager?.getLastCommittedText(job.session_id, job.utterance_index) || undefined;
        // 额外检查：如果contextText和当前文本相同或非常相似，清空contextText
        // 优化：同时检查contextText是否是不完整句子，如果是则不使用
        if (contextText && aggregatedText) {
            const contextTrimmed = contextText.trim().replace(/\s+/g, ' ');
            const currentTrimmed = aggregatedText.trim().replace(/\s+/g, ' ');
            // 检查1：是否完全相同
            if (contextTrimmed === currentTrimmed) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    note: 'contextText is same as current text, using null instead',
                }, 'TranslationStage: contextText is same as current text, ignoring');
                contextText = undefined;
            }
            // 检查2：是否非常相似（子串关系且长度差异小于20%）
            else if (contextTrimmed.includes(currentTrimmed) || currentTrimmed.includes(contextTrimmed)) {
                const lengthDiff = Math.abs(contextTrimmed.length - currentTrimmed.length);
                const avgLength = (contextTrimmed.length + currentTrimmed.length) / 2;
                if (lengthDiff / avgLength < 0.2) {
                    logger_1.default.warn({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        contextTextLength: contextTrimmed.length,
                        currentTextLength: currentTrimmed.length,
                        lengthDiffRatio: lengthDiff / avgLength,
                        note: 'contextText is very similar to current text, using null instead',
                    }, 'TranslationStage: contextText is very similar to current text, ignoring');
                    contextText = undefined;
                }
            }
            // 检查3：contextText是否是不完整句子（不以标点符号结尾且较短）
            else if (this.isIncompleteSentence(contextTrimmed)) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    contextText: contextTrimmed.substring(0, 100),
                    note: 'contextText appears to be incomplete sentence, using null instead to avoid confusion',
                }, 'TranslationStage: contextText is incomplete sentence, ignoring');
                contextText = undefined;
            }
        }
        if (contextText && contextText.length > 200) {
            contextText = contextText.substring(contextText.length - 200);
        }
        // 生成缓存键
        const cacheKey = (0, cache_key_generator_1.generateCacheKey)(job.src_lang, job.tgt_lang, aggregatedText, contextText);
        // 检查是否应该缓存
        const shouldCacheThis = (0, cache_key_generator_1.shouldCache)(aggregatedText);
        // 检查缓存
        const cachedTranslation = shouldCacheThis ? this.translationCache.get(cacheKey) : undefined;
        if (cachedTranslation) {
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                cacheHit: true,
            }, 'TranslationStage: Translation from cache');
            return {
                translatedText: cachedTranslation,
                translationTimeMs: Date.now() - startTime,
                fromCache: true,
            };
        }
        // 缓存未命中，调用 NMT 服务
        if (!this.taskRouter) {
            logger_1.default.error({ jobId: job.job_id, sessionId: job.session_id }, 'TranslationStage: TaskRouter not available');
            return {
                translatedText: '',
                translationTimeMs: Date.now() - startTime,
            };
        }
        // 顺序执行：确保NMT按utterance_index顺序执行
        const sequentialExecutor = (0, sequential_executor_factory_1.getSequentialExecutor)();
        const sessionId = job.session_id || '';
        const utteranceIndex = job.utterance_index || 0;
        // 使用顺序执行管理器包装NMT调用
        return await sequentialExecutor.execute(sessionId, utteranceIndex, 'NMT', async () => {
            return await this.executeNMT(job, aggregatedText, contextText, startTime);
        }, job.job_id);
    }
    /**
     * 执行NMT翻译（内部方法，由顺序执行管理器调用）
     */
    async executeNMT(job, aggregatedText, contextText, startTime) {
        // 生成缓存键
        const cacheKey = (0, cache_key_generator_1.generateCacheKey)(job.src_lang, job.tgt_lang, aggregatedText, contextText);
        // 检查是否应该缓存
        const shouldCacheThis = (0, cache_key_generator_1.shouldCache)(aggregatedText);
        // 检查是否可能包含同音字错误
        const hasHomophoneErrors = (0, homophone_detector_1.hasPossibleHomophoneErrors)(aggregatedText);
        // 如果可能包含同音字错误，生成原文候选
        let sourceCandidates = [aggregatedText];
        if (hasHomophoneErrors) {
            sourceCandidates = (0, homophone_detector_1.detectHomophoneErrors)(aggregatedText);
            logger_1.default.debug({
                jobId: job.job_id,
                sessionId: job.session_id,
                numSourceCandidates: sourceCandidates.length,
            }, 'TranslationStage: Detected possible homophone errors');
        }
        let translatedText = '';
        if (sourceCandidates.length > 1) {
            // 有多个原文候选（同音字修复），对每个候选进行 NMT 翻译并打分
            const homophoneRepairStartTime = Date.now();
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                numSourceCandidates: sourceCandidates.length,
                note: 'Homophone repair triggered - multiple NMT calls may take longer if GPU is overloaded',
            }, 'TranslationStage: Starting homophone repair (may block if GPU is overloaded)');
            const MAX_CONCURRENT_CANDIDATES = 2;
            const translatedCandidates = [];
            for (let i = 0; i < sourceCandidates.length; i += MAX_CONCURRENT_CANDIDATES) {
                const chunk = sourceCandidates.slice(i, i + MAX_CONCURRENT_CANDIDATES);
                const chunkStartTime = Date.now();
                logger_1.default.debug({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    chunkIndex: i,
                    chunkSize: chunk.length,
                    totalCandidates: sourceCandidates.length,
                }, 'TranslationStage: Processing homophone repair chunk');
                const translationPromises = chunk.map(async (sourceCandidate) => {
                    const nmtTask = {
                        text: sourceCandidate,
                        src_lang: job.src_lang,
                        tgt_lang: job.tgt_lang,
                        context_text: contextText, // 使用上一个utterance的原文（中文），用于NMT纠错
                        job_id: job.job_id,
                    }; // 添加session_id和utterance_index用于日志
                    nmtTask.session_id = job.session_id;
                    nmtTask.utterance_index = job.utterance_index;
                    // GPU仲裁：获取GPU租约
                    const nmtResult = await (0, gpu_arbiter_1.withGpuLease)('NMT', async () => {
                        return await this.taskRouter.routeNMTTask(nmtTask);
                    }, {
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        stage: 'NMT',
                    });
                    return {
                        candidate: sourceCandidate,
                        translation: nmtResult.text,
                    };
                });
                const chunkResults = await Promise.all(translationPromises);
                translatedCandidates.push(...chunkResults);
                const chunkDuration = Date.now() - chunkStartTime;
                if (chunkDuration > 30000) {
                    logger_1.default.warn({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        chunkDurationMs: chunkDuration,
                        chunkSize: chunk.length,
                        note: 'Homophone repair chunk took longer than 30 seconds - GPU may be overloaded',
                    }, 'TranslationStage: Homophone repair chunk took too long');
                }
            }
            const homophoneRepairDuration = Date.now() - homophoneRepairStartTime;
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                homophoneRepairDurationMs: homophoneRepairDuration,
                numCandidates: sourceCandidates.length,
                numTranslated: translatedCandidates.length,
            }, 'TranslationStage: Homophone repair completed');
            // 获取上一个翻译作为上下文（用于打分）
            const previousTranslation = this.aggregatorManager ? (this.aggregatorManager.getLastTranslatedText(job.session_id) || undefined) : undefined;
            // 对候选进行打分
            const scoredCandidates = (0, candidate_scorer_1.scoreCandidates)(translatedCandidates, aggregatedText, translatedCandidates[0]?.translation || '', previousTranslation);
            // 选择最佳候选（使用固定阈值 0.05）
            const bestCandidate = (0, candidate_scorer_1.selectBestCandidate)(scoredCandidates, translatedCandidates[0]?.translation || '', 0.05);
            if (bestCandidate) {
                translatedText = bestCandidate.translation;
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    bestScore: bestCandidate.score,
                }, 'TranslationStage: Homophone repair applied, best candidate selected');
            }
            else {
                translatedText = translatedCandidates[0]?.translation || '';
            }
        }
        else {
            // 直接翻译
            const nmtTask = {
                text: aggregatedText,
                src_lang: job.src_lang,
                tgt_lang: job.tgt_lang,
                context_text: contextText, // 使用上一个utterance的原文（中文），用于NMT纠错
                job_id: job.job_id,
            }; // 添加session_id和utterance_index用于日志
            nmtTask.session_id = job.session_id;
            nmtTask.utterance_index = job.utterance_index;
            // 记录实际发送给NMT的文本
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                textToTranslate: aggregatedText,
                textToTranslateLength: aggregatedText.length,
                contextText: contextText,
                contextTextLength: contextText?.length || 0,
                contextTextPreview: contextText?.substring(0, 50),
                srcLang: job.src_lang,
                tgtLang: job.tgt_lang,
            }, 'TranslationStage: Sending text to NMT service (with context_text as previous ASR text for error correction)');
            // GPU仲裁：获取GPU租约
            if (!this.taskRouter) {
                throw new Error('TaskRouter not available');
            }
            const nmtResult = await (0, gpu_arbiter_1.withGpuLease)('NMT', async () => {
                return await this.taskRouter.routeNMTTask(nmtTask);
            }, {
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                stage: 'NMT',
            });
            translatedText = nmtResult.text;
            // 记录NMT返回的结果
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                nmtResultText: nmtResult.text,
                nmtResultTextLength: nmtResult.text?.length || 0,
                nmtResultPreview: nmtResult.text?.substring(0, 100),
            }, 'TranslationStage: NMT service returned result');
        }
        const translationTimeMs = Date.now() - startTime;
        // 存入缓存
        if (shouldCacheThis && translatedText) {
            this.translationCache.set(cacheKey, translatedText);
        }
        // 保存当前翻译文本，供下一个 utterance 使用
        if (translatedText && this.aggregatorManager) {
            this.aggregatorManager.setLastTranslatedText(job.session_id, translatedText);
        }
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            translationTimeMs,
            fromCache: false,
            translatedTextLength: translatedText.length,
            translatedTextPreview: translatedText.substring(0, 100),
        }, 'TranslationStage: Translation completed');
        return {
            translatedText,
            translationTimeMs,
            fromCache: false,
        };
    }
    /**
     * 检测不完整句子
     * 如果文本不以标点符号结尾，且长度较短，可能是被切分的句子
     */
    isIncompleteSentence(text) {
        if (!text || text.trim().length === 0) {
            return false;
        }
        const trimmed = text.trim();
        // 检查是否以标点符号结尾（中文和英文标点）
        const endsWithPunctuation = /[。，！？、；：.!?,;:]$/.test(trimmed);
        // 如果以标点符号结尾，认为是完整句子
        if (endsWithPunctuation) {
            return false;
        }
        // 如果文本较短（少于20个字符），且不以标点符号结尾，可能是不完整句子（统一使用20字符标准）
        if (trimmed.length < 20) {
            // 检查是否包含常见的不完整句子模式
            const incompletePatterns = [
                /的$/, /了$/, /在$/, /是$/, /有$/, /会$/, /能$/, /要$/, /我们$/, /这个$/, /那个$/,
                /问题$/, /方法$/, /系统$/, /服务$/, /结果$/, /原因$/, /效果$/, /处理$/, /解决$/
            ];
            for (const pattern of incompletePatterns) {
                if (pattern.test(trimmed)) {
                    return true;
                }
            }
        }
        return false;
    }
}
exports.TranslationStage = TranslationStage;
