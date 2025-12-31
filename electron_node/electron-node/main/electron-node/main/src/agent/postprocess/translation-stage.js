"use strict";
/**
 * TranslationStage - 翻译阶段（唯一 NMT 入口）
 * 职责：TranslationCache 查询、NMT 调用、可选 NMT Repair
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
     * @param aggregatedText 聚合后的文本
     * @param qualityScore ASR 质量分数
     * @param dedupCharsRemoved 去重移除的字符数
     */
    async process(job, aggregatedText, qualityScore, dedupCharsRemoved = 0) {
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
        // 传入 currentText 参数，确保不会返回当前句
        let contextText = this.aggregatorManager?.getLastCommittedText(job.session_id, aggregatedText) || undefined;
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
        // 检查是否应该使用 NMT Repair
        const shouldRepair = this.shouldRepair(aggregatedText, qualityScore, dedupCharsRemoved);
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
        let nmtRepairApplied = false;
        // 如果只有一个原文候选且启用了 NMT Repair，使用 NMT 候选生成
        if (sourceCandidates.length === 1 && shouldRepair) {
            const nmtTask = {
                text: aggregatedText,
                src_lang: job.src_lang,
                tgt_lang: job.tgt_lang,
                context_text: contextText, // 使用上一个utterance的原文（中文），用于NMT纠错
                job_id: job.job_id,
                num_candidates: this.config.nmtRepairNumCandidates || 5,
            };
            const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
            // 构建候选列表
            const candidates = [
                { candidate: aggregatedText, translation: nmtResult.text },
                ...(nmtResult.candidates || []).map(candidate => ({
                    candidate: aggregatedText,
                    translation: candidate,
                })),
            ];
            // 获取上一个翻译作为上下文（用于打分）
            const previousTranslation = this.aggregatorManager ? (this.aggregatorManager.getLastTranslatedText(job.session_id) || undefined) : undefined;
            // 对候选进行打分
            const scoredCandidates = (0, candidate_scorer_1.scoreCandidates)(candidates, aggregatedText, nmtResult.text, previousTranslation);
            // 选择最佳候选
            const bestCandidate = (0, candidate_scorer_1.selectBestCandidate)(scoredCandidates, nmtResult.text, this.config.nmtRepairThreshold ? 1 - this.config.nmtRepairThreshold : 0.05);
            if (bestCandidate) {
                translatedText = bestCandidate.translation;
                nmtRepairApplied = true;
                logger_1.default.info({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    bestScore: bestCandidate.score,
                }, 'TranslationStage: NMT Repair applied, best candidate selected');
            }
            else {
                translatedText = nmtResult.text;
            }
        }
        else if (sourceCandidates.length > 1) {
            // 有多个原文候选（同音字修复），对每个候选进行 NMT 翻译并打分
            const MAX_CONCURRENT_CANDIDATES = 2;
            const translatedCandidates = [];
            for (let i = 0; i < sourceCandidates.length; i += MAX_CONCURRENT_CANDIDATES) {
                const chunk = sourceCandidates.slice(i, i + MAX_CONCURRENT_CANDIDATES);
                const translationPromises = chunk.map(async (sourceCandidate) => {
                    const nmtTask = {
                        text: sourceCandidate,
                        src_lang: job.src_lang,
                        tgt_lang: job.tgt_lang,
                        context_text: contextText, // 使用上一个utterance的原文（中文），用于NMT纠错
                        job_id: job.job_id,
                    };
                    const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
                    return {
                        candidate: sourceCandidate,
                        translation: nmtResult.text,
                    };
                });
                const chunkResults = await Promise.all(translationPromises);
                translatedCandidates.push(...chunkResults);
            }
            // 获取上一个翻译作为上下文（用于打分）
            const previousTranslation = this.aggregatorManager ? (this.aggregatorManager.getLastTranslatedText(job.session_id) || undefined) : undefined;
            // 对候选进行打分
            const scoredCandidates = (0, candidate_scorer_1.scoreCandidates)(translatedCandidates, aggregatedText, translatedCandidates[0]?.translation || '', previousTranslation);
            // 选择最佳候选
            const bestCandidate = (0, candidate_scorer_1.selectBestCandidate)(scoredCandidates, translatedCandidates[0]?.translation || '', this.config.nmtRepairThreshold ? 1 - this.config.nmtRepairThreshold : 0.05);
            if (bestCandidate) {
                translatedText = bestCandidate.translation;
                nmtRepairApplied = true;
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
            };
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
            const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
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
            nmtRepairApplied,
            translatedTextLength: translatedText.length,
            translatedTextPreview: translatedText.substring(0, 100),
        }, 'TranslationStage: Translation completed');
        return {
            translatedText,
            translationTimeMs,
            fromCache: false,
            nmtRepairApplied,
        };
    }
    /**
     * 判断是否应该触发 NMT Repair
     * 注意：NMT Repair 会生成多个候选并打分，导致延迟增加
     * 应该只在确实需要时才触发（质量很差或明显重复）
     */
    shouldRepair(text, qualityScore, dedupCharsRemoved) {
        if (!this.config.nmtRepairEnabled) {
            return false;
        }
        // 文本太短或太长，不修复（可能是错误）
        if (text.length < 3 || text.length > 500) {
            return false;
        }
        // 质量分数很低（阈值降低，避免过度触发）
        if (qualityScore !== undefined && qualityScore < (this.config.nmtRepairThreshold || 0.5)) {
            return true;
        }
        // 明显重复（Dedup 裁剪量大，阈值提高，避免过度触发）
        if (dedupCharsRemoved > 20) {
            return true;
        }
        return false;
    }
}
exports.TranslationStage = TranslationStage;
