"use strict";
/**
 * Audio Aggregator - Audio Decoder Helper
 * 音频解码辅助方法
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeAudioChunk = decodeAudioChunk;
const logger_1 = __importDefault(require("../logger"));
const opus_codec_1 = require("../utils/opus-codec");
/**
 * 解码音频块
 */
async function decodeAudioChunk(job, sampleRate, bytesPerSample) {
    const sessionId = job.session_id;
    // 解码当前音频块（从Opus base64字符串解码为PCM16 Buffer）
    let currentAudio;
    try {
        if (job.audio_format === 'opus') {
            // Opus格式：需要解码
            currentAudio = await (0, opus_codec_1.decodeOpusToPcm16)(job.audio, sampleRate);
        }
        else if (job.audio_format === 'pcm16') {
            // PCM16格式：直接解码base64
            currentAudio = Buffer.from(job.audio, 'base64');
        }
        else {
            logger_1.default.error({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                audioFormat: job.audio_format,
            }, 'AudioAggregator: Unsupported audio format');
            throw new Error(`Unsupported audio format: ${job.audio_format}`);
        }
        // 验证解码后的音频长度是否为2的倍数（PCM16要求）
        if (currentAudio.length % 2 !== 0) {
            logger_1.default.error({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                audioFormat: job.audio_format,
                audioLength: currentAudio.length,
                isOdd: currentAudio.length % 2 !== 0,
                audioBase64Length: job.audio.length,
            }, '🚨 CRITICAL: Decoded audio chunk length is not a multiple of 2! This will cause ASR service to fail.');
            // 修复：截断最后一个字节，确保长度是2的倍数
            const fixedLength = currentAudio.length - (currentAudio.length % 2);
            const fixedAudio = currentAudio.slice(0, fixedLength);
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                originalLength: currentAudio.length,
                fixedLength: fixedAudio.length,
                bytesRemoved: currentAudio.length - fixedAudio.length,
            }, 'Fixed audio chunk length by truncating last byte(s)');
            currentAudio = fixedAudio;
        }
        logger_1.default.debug({
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            audioFormat: job.audio_format,
            audioLength: currentAudio.length,
            isLengthValid: currentAudio.length % 2 === 0,
            audioBase64Length: job.audio.length,
        }, 'AudioAggregator: Audio chunk decoded and validated');
    }
    catch (error) {
        logger_1.default.error({
            error,
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            audioFormat: job.audio_format,
            audioBase64Length: job.audio?.length || 0,
        }, 'AudioAggregator: Failed to decode audio chunk');
        throw error;
    }
    const currentDurationMs = (currentAudio.length / bytesPerSample / sampleRate) * 1000;
    return {
        audio: currentAudio,
        durationMs: currentDurationMs,
    };
}
