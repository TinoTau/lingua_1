"use strict";
/**
 * runSemanticRepairStep - 语义修复步骤
 * 调用 SemanticRepairStage 进行语义修复
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSemanticRepairStep = runSemanticRepairStep;
const postprocess_semantic_repair_initializer_1 = require("../../agent/postprocess/postprocess-semantic-repair-initializer");
const logger_1 = __importDefault(require("../../logger"));
async function runSemanticRepairStep(job, ctx, services) {
    // 如果文本为空，跳过语义修复
    const textToRepair = ctx.aggregatedText || ctx.asrText || '';
    if (!textToRepair || textToRepair.trim().length === 0) {
        ctx.repairedText = '';
        return;
    }
    // 如果没有 SemanticRepairInitializer，跳过语义修复
    if (!services.servicesHandler) {
        ctx.repairedText = textToRepair;
        return;
    }
    // 初始化语义修复（如果尚未初始化）
    let semanticRepairInitializer = null;
    try {
        semanticRepairInitializer = new postprocess_semantic_repair_initializer_1.SemanticRepairInitializer(services.servicesHandler, services.taskRouter);
        const initPromise = semanticRepairInitializer.initialize();
        if (!semanticRepairInitializer.isInitialized()) {
            await initPromise;
        }
    }
    catch (error) {
        logger_1.default.error({ error: error.message, jobId: job.job_id }, 'runSemanticRepairStep: Failed to initialize semantic repair, using original text');
        ctx.repairedText = textToRepair;
        return;
    }
    // 获取语义修复 Stage
    const semanticRepairStage = semanticRepairInitializer.getSemanticRepairStage();
    if (!semanticRepairStage) {
        logger_1.default.warn({ jobId: job.job_id }, 'runSemanticRepairStep: Semantic repair stage not available, using original text');
        ctx.repairedText = textToRepair;
        return;
    }
    // 获取微上下文（上一句尾部）
    let microContext = undefined;
    if (services.aggregatorManager) {
        const lastCommittedText = services.aggregatorManager.getLastCommittedText(job.session_id, textToRepair);
        if (lastCommittedText && lastCommittedText.trim().length > 0) {
            const trimmedContext = lastCommittedText.trim();
            microContext =
                trimmedContext.length > 150
                    ? trimmedContext.substring(trimmedContext.length - 150)
                    : trimmedContext;
        }
    }
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
        }, 'runSemanticRepairStep: Two-way mode - using detected source language');
    }
    const jobWithDetectedLang = {
        ...job,
        src_lang: sourceLang,
    };
    // 执行语义修复
    try {
        const repairResult = await semanticRepairStage.process(jobWithDetectedLang, textToRepair, ctx.qualityScore, {
            segments: ctx.asrSegments,
            language_probability: ctx.asrResult?.language_probability,
            micro_context: microContext,
        });
        if (repairResult.decision === 'REPAIR' || repairResult.decision === 'PASS') {
            ctx.repairedText = repairResult.textOut;
            ctx.semanticDecision = repairResult.decision;
            ctx.semanticRepairApplied = repairResult.semanticRepairApplied || false;
            ctx.semanticRepairConfidence = repairResult.confidence;
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                decision: repairResult.decision,
                confidence: repairResult.confidence,
                originalText: textToRepair.substring(0, 100),
                repairedText: ctx.repairedText.substring(0, 100),
                textChanged: ctx.repairedText !== textToRepair,
            }, 'runSemanticRepairStep: Semantic repair completed');
        }
        else if (repairResult.decision === 'REJECT') {
            logger_1.default.warn({ jobId: job.job_id, reasonCodes: repairResult.reasonCodes }, 'runSemanticRepairStep: Semantic repair rejected text');
            ctx.repairedText = textToRepair;
            ctx.semanticDecision = 'REJECT';
        }
        else {
            ctx.repairedText = textToRepair;
        }
    }
    catch (error) {
        logger_1.default.error({
            error: error.message,
            stack: error.stack,
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
        }, 'runSemanticRepairStep: Semantic repair failed, using original text');
        ctx.repairedText = textToRepair;
    }
}
