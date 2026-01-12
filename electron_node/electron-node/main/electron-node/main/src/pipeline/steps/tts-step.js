"use strict";
/**
 * runTtsStep - TTS 步骤
 * 调用 TTSStage 生成 TTS 音频
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTtsStep = runTtsStep;
const tts_stage_1 = require("../../agent/postprocess/tts-stage");
const logger_1 = __importDefault(require("../../logger"));
async function runTtsStep(job, ctx, services) {
    // 如果去重检查失败，跳过 TTS
    if (ctx.shouldSend === false) {
        return;
    }
    // 如果翻译文本为空，跳过 TTS
    const textToTts = ctx.translatedText || '';
    if (!textToTts || textToTts.trim().length === 0) {
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
        return;
    }
    // 检查是否需要生成 TTS
    if (job.pipeline?.use_tts === false) {
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
        return;
    }
    // 如果没有 TaskRouter，跳过 TTS
    if (!services.taskRouter) {
        logger_1.default.error({ jobId: job.job_id }, 'runTtsStep: TaskRouter not available');
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
        return;
    }
    // 创建 TTSStage
    const ttsStage = new tts_stage_1.TTSStage(services.taskRouter);
    // 执行 TTS
    try {
        const ttsResult = await ttsStage.process(job, textToTts);
        // 更新 JobContext
        ctx.ttsAudio = ttsResult.ttsAudio;
        ctx.ttsFormat = ttsResult.ttsFormat;
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            ttsAudioLength: ctx.ttsAudio?.length || 0,
            ttsFormat: ctx.ttsFormat,
        }, 'runTtsStep: TTS completed');
    }
    catch (error) {
        logger_1.default.error({
            error: error.message,
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
        }, 'runTtsStep: TTS failed');
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
    }
}
