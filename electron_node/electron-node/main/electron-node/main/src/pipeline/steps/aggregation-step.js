"use strict";
/**
 * runAggregationStep - 聚合步骤
 * 调用 AggregationStage 进行文本聚合
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAggregationStep = runAggregationStep;
const aggregation_stage_1 = require("../../agent/postprocess/aggregation-stage");
const logger_1 = __importDefault(require("../../logger"));
async function runAggregationStep(job, ctx, services) {
    // 如果 ASR 文本为空，跳过聚合
    if (!ctx.asrText || ctx.asrText.trim().length === 0) {
        ctx.aggregatedText = '';
        return;
    }
    // 如果没有 AggregatorManager，直接使用 ASR 文本
    if (!services.aggregatorManager) {
        ctx.aggregatedText = ctx.asrText;
        ctx.aggregationChanged = false;
        return;
    }
    // 创建临时 JobResult 用于聚合
    const tempResult = {
        text_asr: ctx.asrText || '',
        text_translated: '',
        tts_audio: '',
        extra: {
            language_probability: ctx.asrResult?.language_probability || null,
            language_probabilities: ctx.languageProbabilities || null,
        },
        quality_score: ctx.qualityScore,
        segments: ctx.asrSegments,
    };
    // 双向模式：使用动态确定的源语言
    // 创建修改后的 job 对象（使用检测到的源语言）
    let sourceLang = job.src_lang;
    if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
        sourceLang = ctx.detectedSourceLang;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            originalSrcLang: job.src_lang,
            detectedSrcLang: ctx.detectedSourceLang,
        }, 'runAggregationStep: Two-way mode - using detected source language');
    }
    else if (job.src_lang === 'auto' && job.lang_a) {
        // 如果还没有检测到源语言，使用 lang_a 作为默认值
        sourceLang = job.lang_a;
    }
    const jobWithDetectedLang = {
        ...job,
        src_lang: sourceLang,
    };
    // 创建 AggregationStage
    const aggregationStage = new aggregation_stage_1.AggregationStage(services.aggregatorManager, services.aggregatorMiddleware || null, services.deduplicationHandler || null);
    // 执行聚合
    const aggregationResult = aggregationStage.process(jobWithDetectedLang, tempResult);
    // 更新 JobContext
    ctx.aggregatedText = aggregationResult.aggregatedText;
    ctx.aggregationAction = aggregationResult.action;
    ctx.aggregationChanged = aggregationResult.aggregationChanged;
    ctx.isLastInMergedGroup = aggregationResult.isLastInMergedGroup;
    ctx.aggregationMetrics = aggregationResult.metrics;
    logger_1.default.info({
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        aggregatedTextLength: ctx.aggregatedText.length,
        originalTextLength: ctx.asrText?.length || 0,
        action: ctx.aggregationAction,
        aggregationChanged: ctx.aggregationChanged,
    }, 'runAggregationStep: Aggregation completed');
}
