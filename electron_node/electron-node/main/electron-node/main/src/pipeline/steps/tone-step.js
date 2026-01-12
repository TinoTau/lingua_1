"use strict";
/**
 * runToneStep - TONE 步骤
 * 调用 TONEStage 生成音色配音
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runToneStep = runToneStep;
const tone_stage_1 = require("../../agent/postprocess/tone-stage");
const logger_1 = __importDefault(require("../../logger"));
async function runToneStep(job, ctx, services) {
    // 如果去重检查失败，跳过 TONE
    if (ctx.shouldSend === false) {
        return;
    }
    // 如果 TTS 音频为空，跳过 TONE
    if (!ctx.ttsAudio || ctx.ttsAudio.trim().length === 0) {
        return;
    }
    // 检查是否需要生成 TONE
    if (job.pipeline?.use_tone !== true) {
        return;
    }
    // 如果没有 TaskRouter，跳过 TONE
    if (!services.taskRouter) {
        logger_1.default.error({ jobId: job.job_id }, 'runToneStep: TaskRouter not available');
        return;
    }
    // 创建 TONEStage
    const toneStage = new tone_stage_1.TONEStage(services.taskRouter);
    // 从 job 中提取 speaker_id
    const speakerId = job.speaker_id || job.voice_id;
    // 执行 TONE
    try {
        const toneResult = await toneStage.process(job, ctx.ttsAudio, ctx.ttsFormat || 'opus', speakerId);
        // 更新 JobContext
        ctx.toneAudio = toneResult.toneAudio;
        ctx.toneFormat = toneResult.toneFormat;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            toneAudioLength: ctx.toneAudio?.length || 0,
            toneFormat: ctx.toneFormat,
        }, 'runToneStep: TONE completed');
    }
    catch (error) {
        logger_1.default.error({
            error: error.message,
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
        }, 'runToneStep: TONE failed');
    }
}
