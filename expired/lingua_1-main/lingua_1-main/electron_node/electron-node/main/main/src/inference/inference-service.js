"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InferenceService = void 0;
const axios_1 = __importDefault(require("axios"));
const ws_1 = __importDefault(require("ws"));
class InferenceService {
    constructor(modelManager) {
        this.currentJobs = new Set();
        this.wsClient = null;
        // best-effort cancel 支持：HTTP AbortController / 流式 WebSocket close
        this.jobAbortControllers = new Map();
        this.jobStreamSockets = new Map();
        this.modelManager = modelManager;
        this.inferenceServiceUrl = process.env.INFERENCE_SERVICE_URL || 'http://localhost:5009';
        this.httpClient = axios_1.default.create({
            baseURL: this.inferenceServiceUrl,
            timeout: 300000, // 5 分钟超时（推理可能需要较长时间）
        });
    }
    async processJob(job, partialCallback) {
        this.currentJobs.add(job.job_id);
        const abortController = new AbortController();
        this.jobAbortControllers.set(job.job_id, abortController);
        try {
            // 如果启用了流式 ASR，使用 WebSocket
            if (job.enable_streaming_asr && partialCallback) {
                return await this.processJobStreaming(job, partialCallback);
            }
            // 否则使用 HTTP 同步请求
            const request = {
                job_id: job.job_id,
                src_lang: job.src_lang,
                tgt_lang: job.tgt_lang,
                audio: job.audio,
                audio_format: job.audio_format,
                sample_rate: job.sample_rate,
                features: job.features ? {
                    emotion_detection: job.features.emotion_detection || false,
                    voice_style_detection: job.features.voice_style_detection || false,
                    speech_rate_detection: job.features.speech_rate_detection || false,
                    speech_rate_control: job.features.speech_rate_control || false,
                    speaker_identification: job.features.speaker_identification || false,
                    persona_adaptation: job.features.persona_adaptation || false,
                } : undefined,
                mode: job.mode,
                lang_a: job.lang_a,
                lang_b: job.lang_b,
                auto_langs: job.auto_langs,
                enable_streaming_asr: false,
            };
            const response = await this.httpClient.post('/v1/inference', request, { signal: abortController.signal });
            if (!response.data.success) {
                throw new Error(response.data.error?.message || '推理失败');
            }
            return {
                text_asr: response.data.transcript || '',
                text_translated: response.data.translation || '',
                tts_audio: response.data.audio || '',
                tts_format: response.data.audio_format || job.audio_format || 'pcm16',
                extra: response.data.extra,
            };
        }
        catch (error) {
            console.error('推理服务调用失败:', error);
            throw error;
        }
        finally {
            this.currentJobs.delete(job.job_id);
            this.jobAbortControllers.delete(job.job_id);
            this.jobStreamSockets.delete(job.job_id);
        }
    }
    async processJobStreaming(job, partialCallback) {
        return new Promise((resolve, reject) => {
            const wsUrl = this.inferenceServiceUrl.replace('http://', 'ws://').replace('https://', 'wss://');
            const ws = new ws_1.default(`${wsUrl}/v1/inference/stream`);
            this.jobStreamSockets.set(job.job_id, ws);
            let finalResult = null;
            ws.on('open', () => {
                const request = {
                    job_id: job.job_id,
                    src_lang: job.src_lang,
                    tgt_lang: job.tgt_lang,
                    audio: job.audio,
                    audio_format: job.audio_format,
                    sample_rate: job.sample_rate,
                    features: job.features ? {
                        emotion_detection: job.features.emotion_detection || false,
                        voice_style_detection: job.features.voice_style_detection || false,
                        speech_rate_detection: job.features.speech_rate_detection || false,
                        speech_rate_control: job.features.speech_rate_control || false,
                        speaker_identification: job.features.speaker_identification || false,
                        persona_adaptation: job.features.persona_adaptation || false,
                    } : undefined,
                    mode: job.mode,
                    lang_a: job.lang_a,
                    lang_b: job.lang_b,
                    auto_langs: job.auto_langs,
                    enable_streaming_asr: true,
                    partial_update_interval_ms: job.partial_update_interval_ms || 1000,
                };
                ws.send(JSON.stringify(request));
            });
            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'asr_partial') {
                        // 调用部分结果回调
                        partialCallback({
                            text: message.text,
                            is_final: message.is_final,
                            confidence: message.confidence || 0,
                        });
                    }
                    else if (message.type === 'result') {
                        // 最终结果
                        finalResult = {
                            text_asr: message.transcript || '',
                            text_translated: message.translation || '',
                            tts_audio: message.audio || '',
                            tts_format: message.audio_format || job.audio_format || 'pcm16',
                            extra: message.extra,
                        };
                        ws.close();
                        resolve(finalResult);
                    }
                    else if (message.type === 'error') {
                        ws.close();
                        reject(new Error(message.message || '推理失败'));
                    }
                }
                catch (error) {
                    console.error('解析 WebSocket 消息失败:', error);
                }
            });
            ws.on('error', (error) => {
                ws.close();
                reject(error);
            });
            ws.on('close', () => {
                this.jobStreamSockets.delete(job.job_id);
                if (!finalResult) {
                    reject(new Error('WebSocket 连接关闭，未收到结果'));
                }
            });
        });
    }
    getCurrentJobCount() {
        return this.currentJobs.size;
    }
    cancelJob(jobId) {
        const controller = this.jobAbortControllers.get(jobId);
        if (controller) {
            controller.abort();
            this.jobAbortControllers.delete(jobId);
            return true;
        }
        const ws = this.jobStreamSockets.get(jobId);
        if (ws) {
            try {
                ws.close();
            }
            catch { }
            this.jobStreamSockets.delete(jobId);
            return true;
        }
        return false;
    }
    getInstalledModels() {
        // 从 ModelManager 获取已安装的模型，转换为协议格式
        const installed = this.modelManager.getInstalledModels();
        // TODO: 需要从 ModelManager 获取完整的模型元数据（包括 kind, src_lang, tgt_lang, dialect）
        // 目前返回基本结构，实际应该从 ModelMetadata 中获取完整信息
        return installed.map(m => {
            // 从 model_id 推断模型类型（临时方案，实际应该从元数据获取）
            let kind = 'other';
            if (m.model_id.includes('asr') || m.model_id.includes('whisper')) {
                kind = 'asr';
            }
            else if (m.model_id.includes('nmt') || m.model_id.includes('m2m')) {
                kind = 'nmt';
            }
            else if (m.model_id.includes('tts') || m.model_id.includes('piper')) {
                kind = 'tts';
            }
            else if (m.model_id.includes('emotion')) {
                kind = 'emotion';
            }
            return {
                model_id: m.model_id,
                kind: kind,
                src_lang: null, // TODO: 从元数据获取
                tgt_lang: null, // TODO: 从元数据获取
                dialect: null, // TODO: 从元数据获取
                version: m.version || '1.0.0',
                enabled: true, // TODO: 从配置获取
            };
        });
    }
    getFeaturesSupported() {
        // TODO: 根据实际安装的模型和启用的模块返回支持的功能
        // 这里返回一个示例，实际应该根据模型和模块状态动态生成
        return {
            emotion_detection: false,
            voice_style_detection: false,
            speech_rate_detection: false,
            speech_rate_control: false,
            speaker_identification: false,
            persona_adaptation: false,
        };
    }
    async getModuleStatus() {
        // TODO: 从推理服务获取实际模块状态
        // 当前返回默认状态，实际应该通过 HTTP 调用推理服务获取
        return {
            emotion_detection: false,
            voice_style_detection: false,
            speech_rate_detection: false,
            speech_rate_control: false,
            speaker_identification: false,
            persona_adaptation: false,
        };
    }
    async enableModule(moduleName) {
        // TODO: 通过 HTTP 调用推理服务启用模块
        // 当前仅记录日志，实际应该调用推理服务的 API
        console.log(`启用模块: ${moduleName}`);
    }
    async disableModule(moduleName) {
        // TODO: 通过 HTTP 调用推理服务禁用模块
        // 当前仅记录日志，实际应该调用推理服务的 API
        console.log(`禁用模块: ${moduleName}`);
    }
}
exports.InferenceService = InferenceService;
