"use strict";
/**
 * JobPipeline - 唯一编排器
 * 所有逻辑"平铺"在一条直线上，不使用 Stage/Orchestrator/Coordinator
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runJobPipeline = runJobPipeline;
const job_context_1 = require("./context/job-context");
const asr_step_1 = require("./steps/asr-step");
const aggregation_step_1 = require("./steps/aggregation-step");
const semantic_repair_step_1 = require("./steps/semantic-repair-step");
const dedup_step_1 = require("./steps/dedup-step");
const translation_step_1 = require("./steps/translation-step");
const tts_step_1 = require("./steps/tts-step");
const tone_step_1 = require("./steps/tone-step");
const result_builder_1 = require("./result-builder");
/**
 * 运行 JobPipeline（唯一编排器）
 */
async function runJobPipeline(options) {
    const { job, partialCallback, asrCompletedCallback, services, callbacks } = options;
    const ctx = (0, job_context_1.initJobContext)(job);
    // 任务开始回调
    callbacks?.onTaskStart?.();
    try {
        // ASR 步骤
        if (job.pipeline?.use_asr !== false) {
            await (0, asr_step_1.runAsrStep)(job, ctx, services, {
                partialCallback,
                asrCompletedCallback,
            });
            callbacks?.onTaskProcessed?.('ASR');
        }
        // 聚合步骤
        await (0, aggregation_step_1.runAggregationStep)(job, ctx, services);
        callbacks?.onTaskProcessed?.('AGGREGATION');
        // 语义修复步骤
        await (0, semantic_repair_step_1.runSemanticRepairStep)(job, ctx, services);
        callbacks?.onTaskProcessed?.('SEMANTIC_REPAIR');
        // 去重步骤
        await (0, dedup_step_1.runDedupStep)(job, ctx, services);
        // 翻译步骤
        if (job.pipeline?.use_nmt !== false) {
            await (0, translation_step_1.runTranslationStep)(job, ctx, services);
            callbacks?.onTaskProcessed?.('NMT');
        }
        // TTS 步骤
        if (job.pipeline?.use_tts !== false) {
            await (0, tts_step_1.runTtsStep)(job, ctx, services);
            callbacks?.onTaskProcessed?.('TTS');
        }
        // TONE 步骤
        if (job.pipeline?.use_tone === true) {
            await (0, tone_step_1.runToneStep)(job, ctx, services);
            callbacks?.onTaskProcessed?.('TONE');
        }
    }
    finally {
        // 任务结束回调
        callbacks?.onTaskEnd?.();
    }
    return (0, result_builder_1.buildJobResult)(job, ctx);
}
