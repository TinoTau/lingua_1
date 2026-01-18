"use strict";
/**
 * JobPipeline - 唯一编排器
 * 使用配置驱动的方式，根据 Pipeline 模式动态执行步骤，避免硬编码 if/else
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runJobPipeline = runJobPipeline;
const job_context_1 = require("./context/job-context");
const logger_1 = __importDefault(require("../logger"));
const result_builder_1 = require("./result-builder");
const pipeline_mode_config_1 = require("./pipeline-mode-config");
const pipeline_step_registry_1 = require("./pipeline-step-registry");
/**
 * 运行 JobPipeline（唯一编排器）
 * 使用配置驱动的方式，根据 Pipeline 模式动态执行步骤
 */
async function runJobPipeline(options) {
    const { job, partialCallback, asrCompletedCallback, services, ctx: providedCtx, callbacks } = options;
    // 如果提供了预初始化的 JobContext，使用它；否则创建新的
    const ctx = providedCtx || (0, job_context_1.initJobContext)(job);
    // 任务开始回调
    callbacks?.onTaskStart?.();
    try {
        // 1. 根据 job.pipeline 配置推断 Pipeline 模式
        const mode = (0, pipeline_mode_config_1.inferPipelineMode)(job);
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            modeName: mode.name,
            steps: mode.steps,
            pipeline: job.pipeline,
        }, `Pipeline mode inferred: ${mode.name}`);
        // 2. 按模式配置的步骤序列执行
        // 如果 ctx 已经包含 ASR 结果（providedCtx），则跳过 ASR 步骤
        const skipASR = providedCtx !== undefined && providedCtx.asrText !== undefined;
        for (const step of mode.steps) {
            // 如果已经提供了 ASR 结果，跳过 ASR 步骤
            if (skipASR && step === 'ASR') {
                logger_1.default.debug({
                    jobId: job.job_id,
                    step,
                    note: 'ASR result already provided, skipping ASR step',
                }, `Skipping step ${step} (ASR result already provided)`);
                continue;
            }
            // 检查步骤是否应该执行（支持动态条件判断）
            // 对于 SEMANTIC_REPAIR 步骤，需要检查 ctx.shouldSendToSemanticRepair 标志
            if (!(0, pipeline_mode_config_1.shouldExecuteStep)(step, mode, job, ctx)) {
                logger_1.default.debug({
                    jobId: job.job_id,
                    step,
                    modeName: mode.name,
                    shouldSendToSemanticRepair: step === 'SEMANTIC_REPAIR' ? ctx.shouldSendToSemanticRepair : undefined,
                }, `Skipping step ${step} (condition not met)`);
                continue;
            }
            try {
                // 准备步骤特定的选项
                const stepOptions = step === 'ASR' ? {
                    partialCallback,
                    asrCompletedCallback,
                } : undefined;
                // 执行步骤
                await (0, pipeline_step_registry_1.executeStep)(step, job, ctx, services, stepOptions);
                // 触发步骤完成回调
                callbacks?.onTaskProcessed?.(step);
                logger_1.default.debug({
                    jobId: job.job_id,
                    step,
                    modeName: mode.name,
                }, `Step ${step} completed`);
            }
            catch (error) {
                logger_1.default.error({
                    error: error?.message || error || 'Unknown error',
                    stack: error?.stack,
                    errorType: error?.constructor?.name,
                    jobId: job.job_id,
                    step,
                    modeName: mode.name,
                }, `Step ${step} failed`);
                // 根据步骤的重要性决定是否继续
                if (step === 'ASR' || step === 'TRANSLATION') {
                    // 关键步骤失败，抛出错误
                    throw error;
                }
                else {
                    // 非关键步骤失败，记录错误但继续执行
                    logger_1.default.warn({
                        jobId: job.job_id,
                        step,
                    }, `Step ${step} failed, continuing with next step`);
                }
            }
        }
    }
    finally {
        // 任务结束回调
        callbacks?.onTaskEnd?.();
    }
    return (0, result_builder_1.buildJobResult)(job, ctx);
}
