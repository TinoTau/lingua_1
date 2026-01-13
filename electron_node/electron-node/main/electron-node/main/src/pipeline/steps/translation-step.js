"use strict";
/**
 * runTranslationStep - 翻译步骤
 * 调用 TranslationStage 进行翻译
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTranslationStep = runTranslationStep;
const translation_stage_1 = require("../../agent/postprocess/translation-stage");
const logger_1 = __importDefault(require("../../logger"));
async function runTranslationStep(job, ctx, services) {
    // 如果去重检查失败，跳过翻译
    if (ctx.shouldSend === false) {
        return;
    }
    // 获取要翻译的文本（优先使用修复后的文本，然后是聚合后的文本）
    const textToTranslate = ctx.repairedText || ctx.aggregatedText || ctx.asrText || '';
    // 如果文本为空，跳过翻译
    if (!textToTranslate || textToTranslate.trim().length === 0) {
        ctx.translatedText = '';
        return;
    }
    // 如果没有 TaskRouter，跳过翻译
    if (!services.taskRouter) {
        logger_1.default.error({ jobId: job.job_id }, 'runTranslationStep: TaskRouter not available');
        ctx.translatedText = '';
        return;
    }
    // 双向模式：使用动态确定的源语言和目标语言（如果已确定）
    // 如果 src_lang 是 "auto"，使用检测到的源语言
    let sourceLang = job.src_lang;
    if (job.src_lang === 'auto' && ctx.detectedSourceLang) {
        sourceLang = ctx.detectedSourceLang;
    }
    // 使用动态确定的目标语言
    let targetLang = ctx.detectedTargetLang || job.tgt_lang;
    if (ctx.detectedSourceLang || ctx.detectedTargetLang) {
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            originalSrcLang: job.src_lang,
            originalTgtLang: job.tgt_lang,
            detectedSrcLang: ctx.detectedSourceLang,
            detectedTgtLang: ctx.detectedTargetLang,
            finalSrcLang: sourceLang,
            finalTgtLang: targetLang,
        }, 'runTranslationStep: Two-way mode - using detected source and target language');
    }
    // 创建修改后的 job 对象（使用动态源语言和目标语言）
    const jobWithDetectedLang = {
        ...job,
        src_lang: sourceLang,
        tgt_lang: targetLang,
    };
    // 创建 TranslationStage
    const translationStage = new translation_stage_1.TranslationStage(services.taskRouter, services.aggregatorManager || null, {});
    // 执行翻译
    try {
        const translationResult = await translationStage.process(jobWithDetectedLang, textToTranslate, ctx.qualityScore, 0, // dedupCharsRemoved
        {
            semanticRepairApplied: ctx.semanticRepairApplied || false,
            semanticRepairConfidence: ctx.semanticRepairConfidence,
        });
        // 更新 JobContext
        ctx.translatedText = translationResult.translatedText;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            translatedTextLength: ctx.translatedText.length,
            fromCache: translationResult.fromCache,
        }, 'runTranslationStep: Translation completed');
    }
    catch (error) {
        logger_1.default.error({
            error: error.message,
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
        }, 'runTranslationStep: Translation failed');
        ctx.translatedText = '';
    }
}
