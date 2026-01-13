"use strict";
/**
 * runYourTtsStep - YourTTS 步骤
 * 使用 YourTTS 服务进行音色克隆，使用 job_id 作为 speaker_id
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runYourTtsStep = runYourTtsStep;
const messages_1 = require("@shared/protocols/messages");
const logger_1 = __importDefault(require("../../logger"));
const axios_1 = __importDefault(require("axios"));
/**
 * 执行 YourTTS 步骤
 * 使用 job_id 作为 speaker_id 进行音色克隆
 */
async function runYourTtsStep(job, ctx, services) {
    // 如果去重检查失败，跳过 YourTTS
    if (ctx.shouldSend === false) {
        return;
    }
    // 如果翻译文本为空，跳过 YourTTS
    const textToTts = ctx.translatedText || '';
    if (!textToTts || textToTts.trim().length === 0) {
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
        return;
    }
    // 检查是否需要生成 YourTTS
    if (job.pipeline?.use_tone !== true) {
        logger_1.default.debug({ jobId: job.job_id, sessionId: job.session_id }, 'runYourTtsStep: TONE disabled, skipping YourTTS');
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
        return;
    }
    // 如果没有 TaskRouter，跳过 YourTTS
    if (!services.taskRouter) {
        logger_1.default.error({ jobId: job.job_id }, 'runYourTtsStep: TaskRouter not available');
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
        return;
    }
    try {
        // 1. 选择 YourTTS 服务端点
        const endpoint = services.taskRouter.selectServiceEndpoint(messages_1.ServiceType.TTS);
        if (!endpoint) {
            logger_1.default.warn({ jobId: job.job_id }, 'runYourTtsStep: No YourTTS service available, skipping');
            ctx.ttsAudio = '';
            ctx.ttsFormat = 'opus';
            return;
        }
        // 2. 检查是否是 YourTTS 服务（serviceId 应该是 'your-tts'）
        // 注意：如果 TaskRouter 选择了其他 TTS 服务，这里应该跳过或降级
        // 但为了简化，我们假设如果启用了 use_tone，TaskRouter 应该选择 YourTTS
        if (endpoint.serviceId !== 'your-tts') {
            logger_1.default.warn({
                jobId: job.job_id,
                selectedServiceId: endpoint.serviceId,
            }, 'runYourTtsStep: Selected service is not YourTTS, falling back to standard TTS');
            // 降级到普通 TTS（可选）
            ctx.ttsAudio = '';
            ctx.ttsFormat = 'opus';
            return;
        }
        // 3. 获取原始音频（从 JobContext 中获取，ASR 步骤已解码为 PCM16）
        // 使用方案2：直接传递 reference_audio，不使用 speaker_id
        if (!ctx.audio || ctx.audio.length === 0) {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
            }, 'runYourTtsStep: No audio data available, cannot perform voice cloning');
            ctx.ttsAudio = '';
            ctx.ttsFormat = 'opus';
            return;
        }
        // 验证音频格式（应该是 PCM16）
        if (ctx.audioFormat !== 'pcm16') {
            logger_1.default.warn({
                jobId: job.job_id,
                sessionId: job.session_id,
                audioFormat: ctx.audioFormat,
            }, 'runYourTtsStep: Audio format is not PCM16, cannot perform voice cloning');
            ctx.ttsAudio = '';
            ctx.ttsFormat = 'opus';
            return;
        }
        // 4. 将 PCM16 音频转换为 f32 格式（YourTTS 服务需要 f32 数组）
        const audioF32 = convertPcm16ToF32(ctx.audio);
        // 5. 调用 YourTTS 服务进行音色克隆
        // 使用方案2：直接传递 reference_audio，不使用 speaker_id
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            textLength: textToTts.length,
            audioSamples: audioF32.length,
            endpoint: endpoint.baseUrl,
        }, 'runYourTtsStep: Calling YourTTS for voice cloning (using reference_audio)');
        const response = await axios_1.default.post(`${endpoint.baseUrl}/synthesize`, {
            text: textToTts,
            language: job.tgt_lang || 'zh',
            reference_audio: audioF32, // 直接传递原始音频（f32 格式）
            reference_sample_rate: job.sample_rate || 16000,
        }, {
            timeout: 30000, // 30 秒超时
            responseType: 'json', // YourTTS 返回 JSON，包含 audio 数组
        });
        // 5. YourTTS 返回格式：{ audio: number[], sample_rate: 22050 }
        // 需要将 f32 数组转换为 WAV 格式
        const audioData = response.data.audio;
        const sampleRate = response.data.sample_rate || 22050;
        // 将 f32 数组转换为 WAV Buffer
        const wavBuffer = convertFloat32ArrayToWav(audioData, sampleRate);
        const wavBase64 = wavBuffer.toString('base64');
        // 6. 更新 JobContext
        ctx.ttsAudio = wavBase64;
        ctx.ttsFormat = 'wav'; // YourTTS 返回 WAV 格式
        logger_1.default.info({
            jobId: job.job_id,
            sessionId: job.session_id,
            speakerId: job.job_id, // 使用 job_id 作为 speaker_id
            audioLength: wavBuffer.length,
            audioBase64Length: wavBase64.length,
        }, 'runYourTtsStep: YourTTS voice cloning completed');
    }
    catch (error) {
        logger_1.default.error({
            error: error.message,
            jobId: job.job_id,
            sessionId: job.session_id,
            stack: error.stack,
        }, 'runYourTtsStep: YourTTS voice cloning failed');
        // YourTTS 失败，返回空音频
        ctx.ttsAudio = '';
        ctx.ttsFormat = 'opus';
    }
}
/**
 * 将 PCM16 Buffer 转换为 f32 数组
 */
function convertPcm16ToF32(pcm16Buffer) {
    const samples = new Int16Array(pcm16Buffer.buffer, pcm16Buffer.byteOffset, pcm16Buffer.length / 2);
    const f32Samples = [];
    for (let i = 0; i < samples.length; i++) {
        // 将 16-bit signed integer 转换为 [-1.0, 1.0] 范围的 float
        f32Samples.push(samples[i] / 32768.0);
    }
    return f32Samples;
}
/**
 * 将 f32 数组转换为 WAV Buffer
 */
function convertFloat32ArrayToWav(audioData, sampleRate) {
    // 将 f32 数组转换为 int16
    const int16Data = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
        const sample = Math.max(-1, Math.min(1, audioData[i]));
        int16Data[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    // 创建 WAV 文件头
    const numChannels = 1; // 单声道
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = int16Data.length * 2;
    const fileSize = 36 + dataSize;
    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;
    // WAV 文件头
    buffer.write('RIFF', offset);
    offset += 4;
    buffer.writeUInt32LE(fileSize, offset);
    offset += 4;
    buffer.write('WAVE', offset);
    offset += 4;
    buffer.write('fmt ', offset);
    offset += 4;
    buffer.writeUInt32LE(16, offset);
    offset += 4; // fmt chunk size
    buffer.writeUInt16LE(1, offset);
    offset += 2; // audio format (PCM)
    buffer.writeUInt16LE(numChannels, offset);
    offset += 2;
    buffer.writeUInt32LE(sampleRate, offset);
    offset += 4;
    buffer.writeUInt32LE(byteRate, offset);
    offset += 4;
    buffer.writeUInt16LE(blockAlign, offset);
    offset += 2;
    buffer.writeUInt16LE(bitsPerSample, offset);
    offset += 2;
    buffer.write('data', offset);
    offset += 4;
    buffer.writeUInt32LE(dataSize, offset);
    offset += 4;
    // 写入音频数据
    for (let i = 0; i < int16Data.length; i++) {
        buffer.writeInt16LE(int16Data[i], offset);
        offset += 2;
    }
    return buffer;
}
