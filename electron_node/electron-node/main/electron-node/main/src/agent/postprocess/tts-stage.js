"use strict";
/**
 * TTSStage - TTS 音频生成阶段
 * 职责：根据翻译文本生成 TTS 音频
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTSStage = void 0;
const text_validator_1 = require("../../utils/text-validator");
const logger_1 = __importDefault(require("../../logger"));
const sequential_executor_factory_1 = require("../../sequential-executor/sequential-executor-factory");
const gpu_arbiter_1 = require("../../gpu-arbiter");
class TTSStage {
    constructor(taskRouter) {
        this.taskRouter = taskRouter;
    }
    /**
     * 生成 TTS 音频
     */
    async process(job, translatedText) {
        const startTime = Date.now();
        // 检查是否需要生成 TTS
        if ((0, text_validator_1.isEmptyText)(translatedText)) {
            logger_1.default.debug({ jobId: job.job_id, sessionId: job.session_id }, 'TTSStage: Translated text is empty, skipping TTS');
            return {
                ttsAudio: '',
                ttsFormat: 'opus', // 强制使用 opus 格式
            };
        }
        // 检查 tgt_lang
        if (!job.tgt_lang) {
            logger_1.default.warn({ jobId: job.job_id, tgtLang: job.tgt_lang }, 'TTSStage: Missing target language, skipping TTS');
            return {
                ttsAudio: '',
                ttsFormat: 'opus', // 强制使用 opus 格式
            };
        }
        if (!this.taskRouter) {
            logger_1.default.error({ jobId: job.job_id, sessionId: job.session_id }, 'TTSStage: TaskRouter not available');
            return {
                ttsAudio: '',
                ttsFormat: 'opus', // 强制使用 opus 格式
            };
        }
        // 检查是否为无意义单词（避免生成无意义的 TTS）
        if ((0, text_validator_1.isMeaninglessWord)(translatedText)) {
            logger_1.default.warn({ jobId: job.job_id, translatedText }, 'TTSStage: Translated text is meaningless word, skipping TTS');
            return {
                ttsAudio: '',
                ttsFormat: 'opus', // 强制使用 opus 格式
            };
        }
        // 生成 TTS 音频
        try {
            const ttsTask = {
                text: translatedText.trim(),
                lang: job.tgt_lang,
                voice_id: job.voice_id,
                speaker_id: job.speaker_id,
                sample_rate: job.sample_rate || 16000,
                job_id: job.job_id,
            };
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                textLength: translatedText.length,
                tgtLang: job.tgt_lang,
            }, 'TTSStage: Starting TTS task');
            // 顺序执行：确保TTS按utterance_index顺序执行
            const sequentialExecutor = (0, sequential_executor_factory_1.getSequentialExecutor)();
            const sessionId = job.session_id || '';
            const utteranceIndex = job.utterance_index || 0;
            // 使用顺序执行管理器包装TTS调用
            const ttsResult = await sequentialExecutor.execute(sessionId, utteranceIndex, 'TTS', async () => {
                // GPU仲裁：获取GPU租约
                if (!this.taskRouter) {
                    throw new Error('TaskRouter not available');
                }
                return await (0, gpu_arbiter_1.withGpuLease)('TTS', async () => {
                    return await this.taskRouter.routeTTSTask(ttsTask);
                }, {
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    stage: 'TTS',
                });
            }, job.job_id);
            const ttsTimeMs = Date.now() - startTime;
            if (ttsTimeMs > 30000) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    ttsTimeMs,
                    textLength: translatedText.length,
                    note: 'TTS generation took longer than 30 seconds - GPU may be overloaded',
                }, 'TTSStage: TTS generation took too long');
            }
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                ttsTimeMs,
                audioLength: ttsResult.audio?.length || 0,
                audioFormat: ttsResult.audio_format, // 记录实际格式
            }, 'TTSStage: TTS task completed');
            // TTSStage 返回 TaskRouter 的原始结果（通常是 WAV 格式）
            // Opus 编码应该在 PostProcessCoordinator 或 PipelineOrchestrator 中进行
            // 这里不再检查格式，直接返回原始结果
            return {
                ttsAudio: ttsResult.audio || '',
                ttsFormat: ttsResult.audio_format || 'wav', // 返回实际格式（通常是 'wav'）
                ttsTimeMs,
            };
        }
        catch (error) {
            // Opus 编码失败或其他错误，记录错误但返回空音频，确保任务仍然返回结果
            logger_1.default.error({
                error,
                jobId: job.job_id,
                sessionId: job.session_id,
                translatedText: translatedText.substring(0, 50),
                errorMessage: error instanceof Error ? error.message : String(error),
            }, 'TTSStage: TTS task failed (Opus encoding or other error), returning empty audio');
            return {
                ttsAudio: '',
                ttsFormat: 'opus', // 强制使用 opus 格式
                ttsTimeMs: Date.now() - startTime,
            };
        }
    }
}
exports.TTSStage = TTSStage;
