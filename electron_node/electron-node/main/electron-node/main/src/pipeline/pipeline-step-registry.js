"use strict";
/**
 * Pipeline 步骤注册表
 * 将步骤类型映射到实际的执行函数，实现解耦
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STEP_REGISTRY = void 0;
exports.executeStep = executeStep;
const asr_step_1 = require("./steps/asr-step");
const aggregation_step_1 = require("./steps/aggregation-step");
const semantic_repair_step_1 = require("./steps/semantic-repair-step");
const dedup_step_1 = require("./steps/dedup-step");
const translation_step_1 = require("./steps/translation-step");
const tts_step_1 = require("./steps/tts-step");
const yourtts_step_1 = require("./steps/yourtts-step");
const logger_1 = __importDefault(require("../logger"));
/**
 * Pipeline 步骤注册表
 * 将步骤类型映射到执行函数
 */
exports.STEP_REGISTRY = {
    ASR: async (job, ctx, services, options) => {
        await (0, asr_step_1.runAsrStep)(job, ctx, services, options);
    },
    AGGREGATION: async (job, ctx, services) => {
        await (0, aggregation_step_1.runAggregationStep)(job, ctx, services);
    },
    SEMANTIC_REPAIR: async (job, ctx, services) => {
        await (0, semantic_repair_step_1.runSemanticRepairStep)(job, ctx, services);
    },
    DEDUP: async (job, ctx, services) => {
        await (0, dedup_step_1.runDedupStep)(job, ctx, services);
    },
    TRANSLATION: async (job, ctx, services) => {
        await (0, translation_step_1.runTranslationStep)(job, ctx, services);
    },
    TTS: async (job, ctx, services) => {
        await (0, tts_step_1.runTtsStep)(job, ctx, services);
    },
    YOURTTS: async (job, ctx, services) => {
        await (0, yourtts_step_1.runYourTtsStep)(job, ctx, services);
    },
};
/**
 * 执行单个步骤
 */
async function executeStep(step, job, ctx, services, options) {
    const executor = exports.STEP_REGISTRY[step];
    if (!executor) {
        logger_1.default.error({ step, jobId: job.job_id }, `Unknown pipeline step: ${step}`);
        throw new Error(`Unknown pipeline step: ${step}`);
    }
    logger_1.default.debug({ step, jobId: job.job_id, sessionId: job.session_id }, `Executing pipeline step: ${step}`);
    await executor(job, ctx, services, options);
}
