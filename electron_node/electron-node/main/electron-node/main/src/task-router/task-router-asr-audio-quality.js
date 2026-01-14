"use strict";
/**
 * Task Router ASR Audio Quality Checker
 * 处理ASR音频质量检查相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAudioQuality = checkAudioQuality;
const logger_1 = __importDefault(require("../logger"));
/**
 * 最小 RMS 阈值（归一化值，0-1范围）
 * 低于此值的音频被认为是静音或极低质量噪音，应该被过滤
 * 参考：Web端 releaseThreshold 为 0.005，这里使用更高的阈值以更严格地过滤低质量音频和误识别
 * 提高阈值可以减少ASR误识别静音/噪音为语音的情况（如葡萄牙语误识别）
 */
const MIN_RMS_THRESHOLD = 0.015; // 从0.008提高到0.015，更严格地过滤低质量音频
/**
 * 检查音频输入质量
 * @returns AudioQualityInfo | null - 如果音频质量不可接受，返回 null
 */
function checkAudioQuality(task, serviceId) {
    let audioDataLength = 0;
    let audioDataPreview = '';
    try {
        if (task.audio) {
            const audioBuffer = Buffer.from(task.audio, 'base64');
            audioDataLength = audioBuffer.length;
            const estimatedDurationMs = Math.round((audioDataLength / 2) / 16);
            const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
            let sumSquares = 0;
            for (let i = 0; i < samples.length; i++) {
                sumSquares += samples[i] * samples[i];
            }
            const rms = Math.sqrt(sumSquares / samples.length);
            const rmsNormalized = rms / 32768.0;
            audioDataPreview = `length=${audioDataLength}, duration=${estimatedDurationMs}ms, rms=${rmsNormalized.toFixed(4)}`;
            // 检查 RMS 是否低于阈值
            const isQualityAcceptable = rmsNormalized >= MIN_RMS_THRESHOLD;
            const rejectionReason = !isQualityAcceptable
                ? `RMS (${rmsNormalized.toFixed(4)}) below minimum threshold (${MIN_RMS_THRESHOLD})`
                : undefined;
            if (!isQualityAcceptable) {
                logger_1.default.warn({
                    serviceId,
                    jobId: task.job_id,
                    utteranceIndex: task.utterance_index,
                    audioDataLength,
                    estimatedDurationMs,
                    rms: rmsNormalized.toFixed(4),
                    minRmsThreshold: MIN_RMS_THRESHOLD,
                    audioFormat: task.audio_format || 'opus',
                    sampleRate: task.sample_rate || 16000,
                    contextTextLength: task.context_text?.length || 0,
                    rejectionReason,
                }, 'ASR task: Audio quality too low (likely silence or noise), rejecting');
                return null;
            }
            logger_1.default.info({
                serviceId,
                jobId: task.job_id,
                utteranceIndex: task.utterance_index,
                audioDataLength,
                estimatedDurationMs,
                rms: rmsNormalized.toFixed(4),
                audioFormat: task.audio_format || 'opus',
                sampleRate: task.sample_rate || 16000,
                contextTextLength: task.context_text?.length || 0,
                contextTextPreview: task.context_text ? task.context_text.substring(0, 200) : null,
            }, 'ASR task: Audio input quality check');
            return {
                audioDataLength,
                estimatedDurationMs,
                rms,
                rmsNormalized,
                preview: audioDataPreview,
                isQualityAcceptable: true,
            };
        }
    }
    catch (error) {
        logger_1.default.warn({
            serviceId,
            jobId: task.job_id,
            utteranceIndex: task.utterance_index,
            error: error.message,
        }, 'ASR task: Failed to analyze audio input quality');
    }
    return null;
}
