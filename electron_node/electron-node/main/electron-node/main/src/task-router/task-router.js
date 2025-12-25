"use strict";
// 任务路由器 - 根据任务类型路由到对应的服务
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouter = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../logger"));
const messages_1 = require("../../../../shared/protocols/messages");
// Opus 编码支持（使用 WebAssembly 实现，不会影响其他服务）
const opus_encoder_1 = require("../utils/opus-encoder");
class TaskRouter {
    constructor(pythonServiceManager, rustServiceManager, serviceRegistryManager) {
        this.pythonServiceManager = pythonServiceManager;
        this.rustServiceManager = rustServiceManager;
        this.serviceRegistryManager = serviceRegistryManager;
        this.serviceEndpoints = new Map();
        this.serviceConnections = new Map(); // 服务连接数统计
        this.selectionStrategy = 'round_robin';
        this.roundRobinIndex = new Map();
        // best-effort cancel 支持：HTTP AbortController（用于中断 HTTP 请求）
        this.jobAbortControllers = new Map();
    }
    /**
     * 初始化服务端点列表
     */
    async initialize() {
        await this.refreshServiceEndpoints();
    }
    /**
     * 刷新服务端点列表
     */
    async refreshServiceEndpoints() {
        const endpoints = new Map();
        // 初始化每个服务类型的列表
        [messages_1.ServiceType.ASR, messages_1.ServiceType.NMT, messages_1.ServiceType.TTS, messages_1.ServiceType.TONE].forEach((type) => {
            endpoints.set(type, []);
        });
        // 从服务管理器获取运行中的服务
        const installedServices = await this.getInstalledServices();
        logger_1.default.debug({
            installedServicesCount: installedServices.length,
            installedServices: installedServices.map(s => ({
                service_id: s.service_id,
                type: s.type,
                status: s.status,
            })),
        }, 'Refreshing service endpoints');
        for (const service of installedServices) {
            if (service.status !== 'running') {
                logger_1.default.debug({ serviceId: service.service_id, status: service.status }, 'Skipping non-running service');
                continue;
            }
            const endpoint = await this.createServiceEndpoint(service);
            if (endpoint) {
                const existing = endpoints.get(service.type) || [];
                existing.push(endpoint);
                endpoints.set(service.type, existing);
                logger_1.default.debug({
                    serviceId: endpoint.serviceId,
                    baseUrl: endpoint.baseUrl,
                    port: endpoint.port,
                    serviceType: endpoint.serviceType,
                }, 'Created service endpoint');
            }
            else {
                logger_1.default.warn({
                    serviceId: service.service_id,
                    serviceType: service.type,
                }, 'Failed to create service endpoint (port not available)');
            }
        }
        this.serviceEndpoints = endpoints;
        logger_1.default.info({
            asr: endpoints.get(messages_1.ServiceType.ASR)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
            nmt: endpoints.get(messages_1.ServiceType.NMT)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
            tts: endpoints.get(messages_1.ServiceType.TTS)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
            tone: endpoints.get(messages_1.ServiceType.TONE)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        }, 'Service endpoints refreshed');
    }
    /**
     * 创建服务端点
     */
    async createServiceEndpoint(service) {
        const port = await this.getServicePort(service.service_id);
        if (!port) {
            logger_1.default.warn({
                serviceId: service.service_id,
                serviceType: service.type,
                status: service.status,
            }, 'Cannot create service endpoint: port not available');
            return null;
        }
        const endpoint = {
            serviceId: service.service_id,
            serviceType: service.type,
            baseUrl: `http://127.0.0.1:${port}`,
            port,
            status: service.status,
        };
        logger_1.default.debug({
            serviceId: endpoint.serviceId,
            baseUrl: endpoint.baseUrl,
            port: endpoint.port,
            serviceType: endpoint.serviceType,
            status: endpoint.status,
        }, 'Created service endpoint');
        return endpoint;
    }
    /**
     * 获取服务端口
     */
    async getServicePort(serviceId) {
        // 服务ID到端口的映射
        const portMap = {
            'faster-whisper-vad': 6007,
            'node-inference': 5009,
            'nmt-m2m100': 5008,
            'piper-tts': 5006,
            'your-tts': 5004,
            'speaker-embedding': 5003,
        };
        // 首先尝试从映射表获取
        if (portMap[serviceId]) {
            logger_1.default.debug({ serviceId, port: portMap[serviceId], source: 'portMap' }, 'Got service port from portMap');
            return portMap[serviceId];
        }
        // 尝试从服务管理器获取
        if (serviceId === 'node-inference' && this.rustServiceManager) {
            const status = this.rustServiceManager.getStatus();
            if (status?.port) {
                return status.port;
            }
        }
        // 尝试从Python服务管理器获取
        const pythonServiceNameMap = {
            'nmt-m2m100': 'nmt',
            'piper-tts': 'tts',
            'your-tts': 'yourtts',
            'speaker-embedding': 'speaker_embedding',
            'faster-whisper-vad': 'faster_whisper_vad',
        };
        const pythonServiceName = pythonServiceNameMap[serviceId];
        if (pythonServiceName && this.pythonServiceManager) {
            const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
            if (status?.port) {
                return status.port;
            }
        }
        return null;
    }
    /**
     * 获取已安装的服务列表
     */
    async getInstalledServices() {
        const result = [];
        // 从服务注册表获取
        if (this.serviceRegistryManager) {
            try {
                await this.serviceRegistryManager.loadRegistry();
                const installed = this.serviceRegistryManager.listInstalled();
                for (const service of installed) {
                    const running = this.isServiceRunning(service.service_id);
                    result.push({
                        service_id: service.service_id,
                        type: this.getServiceType(service.service_id),
                        device: 'gpu',
                        status: running ? 'running' : 'stopped',
                        version: service.version || '2.0.0',
                    });
                }
            }
            catch (error) {
                logger_1.default.error({ error }, 'Failed to get installed services from registry');
            }
        }
        // 补充Python服务
        if (this.pythonServiceManager) {
            const pythonServices = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];
            for (const serviceName of pythonServices) {
                const serviceId = this.getServiceIdFromPythonName(serviceName);
                const status = this.pythonServiceManager.getServiceStatus(serviceName);
                if (status?.running) {
                    result.push({
                        service_id: serviceId,
                        type: this.getServiceType(serviceId),
                        device: 'gpu',
                        status: 'running',
                        version: '2.0.0',
                    });
                }
            }
        }
        // 补充Rust服务
        if (this.rustServiceManager) {
            const status = this.rustServiceManager.getStatus();
            if (status?.running) {
                result.push({
                    service_id: 'node-inference',
                    type: messages_1.ServiceType.ASR, // node-inference 可以作为 ASR 服务
                    device: 'gpu',
                    status: 'running',
                    version: '2.0.0',
                });
            }
        }
        return result;
    }
    /**
     * 检查服务是否运行
     */
    isServiceRunning(serviceId) {
        if (serviceId === 'node-inference' && this.rustServiceManager) {
            const status = this.rustServiceManager.getStatus();
            return status?.running === true;
        }
        const pythonServiceNameMap = {
            'nmt-m2m100': 'nmt',
            'piper-tts': 'tts',
            'your-tts': 'yourtts',
            'speaker-embedding': 'speaker_embedding',
            'faster-whisper-vad': 'faster_whisper_vad',
        };
        const pythonServiceName = pythonServiceNameMap[serviceId];
        if (pythonServiceName && this.pythonServiceManager) {
            const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
            return status?.running === true;
        }
        return false;
    }
    /**
     * 获取服务类型
     */
    getServiceType(serviceId) {
        const typeMap = {
            'faster-whisper-vad': messages_1.ServiceType.ASR,
            'node-inference': messages_1.ServiceType.ASR,
            'nmt-m2m100': messages_1.ServiceType.NMT,
            'piper-tts': messages_1.ServiceType.TTS,
            'your-tts': messages_1.ServiceType.TTS,
            'speaker-embedding': messages_1.ServiceType.TONE,
        };
        return typeMap[serviceId] || messages_1.ServiceType.ASR;
    }
    /**
     * 从Python服务名获取服务ID
     */
    getServiceIdFromPythonName(serviceName) {
        const map = {
            nmt: 'nmt-m2m100',
            tts: 'piper-tts',
            yourtts: 'your-tts',
            speaker_embedding: 'speaker-embedding',
            faster_whisper_vad: 'faster-whisper-vad',
        };
        return map[serviceName] || serviceName;
    }
    /**
     * 选择服务端点
     */
    selectServiceEndpoint(serviceType) {
        const endpoints = this.serviceEndpoints.get(serviceType) || [];
        if (endpoints.length === 0) {
            logger_1.default.warn({ serviceType, endpointCount: 0 }, 'No endpoints available for service type');
            return null;
        }
        // 过滤出运行中的服务
        const runningEndpoints = endpoints.filter((e) => e.status === 'running');
        if (runningEndpoints.length === 0) {
            logger_1.default.warn({
                serviceType,
                totalEndpoints: endpoints.length,
                endpointStatuses: endpoints.map(e => ({ serviceId: e.serviceId, status: e.status })),
            }, 'No running endpoints available for service type');
            return null;
        }
        logger_1.default.debug({
            serviceType,
            availableEndpoints: runningEndpoints.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })),
        }, 'Selecting service endpoint');
        switch (this.selectionStrategy) {
            case 'round_robin': {
                const index = this.roundRobinIndex.get(serviceType) || 0;
                const selected = runningEndpoints[index % runningEndpoints.length];
                this.roundRobinIndex.set(serviceType, (index + 1) % runningEndpoints.length);
                return selected;
            }
            case 'least_connections': {
                let minConnections = Infinity;
                let selected = null;
                for (const endpoint of runningEndpoints) {
                    const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
                    if (connections < minConnections) {
                        minConnections = connections;
                        selected = endpoint;
                    }
                }
                return selected;
            }
            case 'random': {
                const index = Math.floor(Math.random() * runningEndpoints.length);
                return runningEndpoints[index];
            }
            case 'first_available':
            default:
                return runningEndpoints[0];
        }
    }
    /**
     * 路由 ASR 任务
     */
    async routeASRTask(task) {
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.ASR);
        if (!endpoint) {
            throw new Error('No available ASR service');
        }
        // 增加连接计数
        const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
        this.serviceConnections.set(endpoint.serviceId, connections + 1);
        try {
            // 创建 AbortController 用于支持任务取消
            // 注意：job_id 是调度服务器发送的，用于任务管理和取消
            // trace_id 用于全链路追踪，不用于任务管理
            if (!task.job_id) {
                logger_1.default.warn({}, 'ASR task missing job_id, cannot support cancellation');
            }
            const abortController = new AbortController();
            if (task.job_id) {
                this.jobAbortControllers.set(task.job_id, abortController);
            }
            const httpClient = axios_1.default.create({
                baseURL: endpoint.baseUrl,
                timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
            });
            // 根据服务类型选择接口
            let response;
            if (endpoint.serviceId === 'node-inference') {
                // node-inference 使用旧的 /v1/inference 接口
                response = await httpClient.post('/v1/inference', {
                    job_id: task.job_id || `asr_${Date.now()}`,
                    src_lang: task.src_lang,
                    tgt_lang: task.src_lang, // ASR 不需要目标语言
                    audio: task.audio,
                    audio_format: task.audio_format,
                    sample_rate: task.sample_rate,
                    enable_streaming_asr: task.enable_streaming || false,
                }, {
                    signal: abortController.signal, // 支持任务取消
                });
                return {
                    text: response.data.transcript || '',
                    confidence: response.data.confidence,
                    language: response.data.language,
                    is_final: true,
                };
            }
            else if (endpoint.serviceId === 'faster-whisper-vad') {
                // faster-whisper-vad 使用 /utterance 接口
                // 注意：需要提供所有必需字段，包括 task、beam_size 等
                // 使用调度服务器发送的 audio_format（默认值 pcm16）
                const audioFormat = task.audio_format || 'pcm16';
                const requestUrl = `${endpoint.baseUrl}/utterance`;
                logger_1.default.info({
                    serviceId: endpoint.serviceId,
                    baseUrl: endpoint.baseUrl,
                    requestUrl,
                    audioFormat,
                    originalFormat: task.audio_format,
                    jobId: task.job_id,
                }, 'Routing ASR task to faster-whisper-vad');
                const requestBody = {
                    job_id: task.job_id || `asr_${Date.now()}`,
                    src_lang: task.src_lang,
                    tgt_lang: task.src_lang, // ASR 不需要目标语言
                    audio: task.audio,
                    audio_format: audioFormat,
                    sample_rate: task.sample_rate || 16000,
                    task: 'transcribe', // 必需字段
                    beam_size: 5, // 必需字段
                    condition_on_previous_text: false, // 修复：改为 false，避免重复识别（当上下文文本和当前音频内容相同时，会导致重复输出）
                    use_context_buffer: false, // 修复：禁用音频上下文，避免重复识别和增加处理时间（utterance已经是完整的，不需要音频上下文）
                    use_text_context: true, // 保留文本上下文（initial_prompt），这是Faster Whisper的标准功能
                    enable_streaming_asr: task.enable_streaming || false,
                    context_text: task.context_text,
                };
                try {
                    response = await httpClient.post('/utterance', requestBody, {
                        signal: abortController.signal, // 支持任务取消
                    });
                    logger_1.default.info({
                        serviceId: endpoint.serviceId,
                        requestUrl,
                        status: response.status,
                        jobId: task.job_id,
                    }, 'faster-whisper-vad request succeeded');
                }
                catch (axiosError) {
                    logger_1.default.error({
                        serviceId: endpoint.serviceId,
                        requestUrl,
                        baseUrl: endpoint.baseUrl,
                        status: axiosError.response?.status,
                        statusText: axiosError.response?.statusText,
                        errorMessage: axiosError.message,
                        errorCode: axiosError.code,
                        jobId: task.job_id,
                        responseData: axiosError.response?.data,
                    }, 'faster-whisper-vad request failed');
                    throw axiosError;
                }
                // UtteranceResponse 返回的字段是 text，不是 transcript
                return {
                    text: response.data.text || '',
                    confidence: 1.0, // faster-whisper-vad 不返回 confidence
                    language: response.data.language || task.src_lang,
                    is_final: true,
                };
            }
            else {
                // 标准 ASR 接口（其他服务）
                response = await httpClient.post('/v1/asr/transcribe', {
                    audio: task.audio,
                    audio_format: task.audio_format,
                    sample_rate: task.sample_rate,
                    src_lang: task.src_lang,
                    enable_streaming: task.enable_streaming || false,
                    context_text: task.context_text,
                }, {
                    signal: abortController.signal, // 支持任务取消
                });
                return {
                    text: response.data.text || '',
                    confidence: response.data.confidence,
                    language: response.data.language,
                    is_final: response.data.is_final !== false,
                };
            }
        }
        catch (error) {
            // 增强错误日志，特别是对于Axios错误
            const errorDetails = {
                serviceId: endpoint.serviceId,
                baseUrl: endpoint.baseUrl,
                jobId: task.job_id,
                errorMessage: error.message,
            };
            if (error.response) {
                // Axios错误响应
                errorDetails.status = error.response.status;
                errorDetails.statusText = error.response.statusText;
                errorDetails.responseData = error.response.data;
                errorDetails.requestUrl = error.config?.url || 'unknown';
                errorDetails.requestMethod = error.config?.method || 'unknown';
            }
            else if (error.request) {
                // 请求已发送但没有收到响应
                errorDetails.requestError = true;
                errorDetails.requestUrl = error.config?.url || 'unknown';
            }
            else {
                // 其他错误
                errorDetails.errorCode = error.code;
                errorDetails.errorStack = error.stack;
            }
            logger_1.default.error(errorDetails, 'ASR task failed');
            throw error;
        }
        finally {
            // 清理 AbortController
            if (task.job_id) {
                this.jobAbortControllers.delete(task.job_id);
            }
            // 减少连接计数
            const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
            this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
        }
    }
    /**
     * 取消任务（best-effort cancel：尝试中断 HTTP 请求）
     * 注意：取消不保证推理服务一定立刻停止（取决于下游实现）
     */
    cancelJob(jobId) {
        const controller = this.jobAbortControllers.get(jobId);
        if (controller) {
            controller.abort();
            this.jobAbortControllers.delete(jobId);
            logger_1.default.info({ jobId }, 'Task cancelled via AbortController');
            return true;
        }
        return false;
    }
    /**
     * 路由 NMT 任务
     */
    async routeNMTTask(task) {
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.NMT);
        if (!endpoint) {
            throw new Error('No available NMT service');
        }
        const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
        this.serviceConnections.set(endpoint.serviceId, connections + 1);
        try {
            // 创建 AbortController 用于支持任务取消
            // 注意：job_id 是调度服务器发送的，用于任务管理和取消
            // trace_id 用于全链路追踪，不用于任务管理
            if (!task.job_id) {
                logger_1.default.warn({}, 'ASR task missing job_id, cannot support cancellation');
            }
            const abortController = new AbortController();
            if (task.job_id) {
                this.jobAbortControllers.set(task.job_id, abortController);
            }
            const httpClient = axios_1.default.create({
                baseURL: endpoint.baseUrl,
                timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
            });
            const response = await httpClient.post('/v1/translate', {
                text: task.text,
                src_lang: task.src_lang,
                tgt_lang: task.tgt_lang,
                context_text: task.context_text,
            }, {
                signal: abortController.signal, // 支持任务取消
            });
            return {
                text: response.data.text || '',
                confidence: response.data.confidence,
            };
        }
        catch (error) {
            logger_1.default.error({ error, serviceId: endpoint.serviceId }, 'NMT task failed');
            throw error;
        }
        finally {
            // 清理 AbortController
            if (task.job_id) {
                this.jobAbortControllers.delete(task.job_id);
            }
            const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
            this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
        }
    }
    /**
     * 路由 TTS 任务
     */
    async routeTTSTask(task) {
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.TTS);
        if (!endpoint) {
            throw new Error('No available TTS service');
        }
        const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
        this.serviceConnections.set(endpoint.serviceId, connections + 1);
        try {
            // 创建 AbortController 用于支持任务取消
            // 注意：job_id 是调度服务器发送的，用于任务管理和取消
            // trace_id 用于全链路追踪，不用于任务管理
            if (!task.job_id) {
                logger_1.default.warn({}, 'ASR task missing job_id, cannot support cancellation');
            }
            const abortController = new AbortController();
            if (task.job_id) {
                this.jobAbortControllers.set(task.job_id, abortController);
            }
            const httpClient = axios_1.default.create({
                baseURL: endpoint.baseUrl,
                timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
            });
            // TTS服务端点：/tts
            // 请求格式：{ text: string, voice: string, language?: string }
            // 响应：WAV格式的音频数据（二进制）
            // 根据目标语言自动选择语音（如果没有指定 voice_id）
            const targetLang = (task.lang || 'zh').toLowerCase();
            let defaultVoice = 'zh_CN-huayan-medium'; // 默认使用中文语音
            if (targetLang.startsWith('en')) {
                defaultVoice = 'en_US-lessac-medium'; // 英语使用英语语音
            }
            else if (targetLang.startsWith('zh')) {
                defaultVoice = 'zh_CN-huayan-medium'; // 中文使用中文语音
            }
            const response = await httpClient.post('/tts', {
                text: task.text,
                voice: task.voice_id || defaultVoice, // 使用根据语言选择的默认语音
                language: task.lang || 'zh', // 将lang映射到language
            }, {
                signal: abortController.signal, // 支持任务取消
                responseType: 'arraybuffer', // TTS服务返回WAV音频数据（二进制）
            });
            // 将WAV音频数据转换为Buffer
            const wavBuffer = Buffer.from(response.data);
            // 尝试使用 Opus 编码（如果可用），否则使用 PCM16
            let audioBase64;
            let audioFormat;
            if ((0, opus_encoder_1.isOpusEncoderAvailable)()) {
                try {
                    // 解析 WAV 文件，提取 PCM16 数据和元信息
                    const { pcm16Data, sampleRate, channels } = (0, opus_encoder_1.parseWavFile)(wavBuffer);
                    // 编码为 Opus
                    const opusData = await (0, opus_encoder_1.encodePcm16ToOpus)(pcm16Data, sampleRate, channels);
                    // 转换为 base64
                    audioBase64 = opusData.toString('base64');
                    audioFormat = 'opus';
                    logger_1.default.debug(`TTS audio encoded to Opus: ${wavBuffer.length} bytes (WAV) -> ${opusData.length} bytes (Opus), ` +
                        `compression: ${(wavBuffer.length / opusData.length).toFixed(2)}x`);
                }
                catch (opusError) {
                    // Opus 编码失败，回退到 PCM16
                    logger_1.default.warn({ error: opusError }, 'Opus encoding failed, falling back to PCM16');
                    audioBase64 = wavBuffer.toString('base64');
                    audioFormat = 'pcm16';
                }
            }
            else {
                // Opus 编码器不可用，使用 PCM16
                audioBase64 = wavBuffer.toString('base64');
                audioFormat = 'pcm16';
            }
            return {
                audio: audioBase64,
                audio_format: audioFormat,
                sample_rate: task.sample_rate || 16000, // 使用目标采样率
            };
        }
        catch (error) {
            logger_1.default.error({ error, serviceId: endpoint.serviceId }, 'TTS task failed');
            throw error;
        }
        finally {
            // 清理 AbortController
            if (task.job_id) {
                this.jobAbortControllers.delete(task.job_id);
            }
            const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
            this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
        }
    }
    /**
     * 路由 TONE 任务
     */
    async routeTONETask(task) {
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.TONE);
        if (!endpoint) {
            throw new Error('No available TONE service');
        }
        const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
        this.serviceConnections.set(endpoint.serviceId, connections + 1);
        try {
            // 创建 AbortController 用于支持任务取消
            // 注意：job_id 是调度服务器发送的，用于任务管理和取消
            // trace_id 用于全链路追踪，不用于任务管理
            if (!task.job_id) {
                logger_1.default.warn({}, 'ASR task missing job_id, cannot support cancellation');
            }
            const abortController = new AbortController();
            if (task.job_id) {
                this.jobAbortControllers.set(task.job_id, abortController);
            }
            const httpClient = axios_1.default.create({
                baseURL: endpoint.baseUrl,
                timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
            });
            const endpointPath = task.action === 'embed' ? '/v1/tone/embed' : '/v1/tone/clone';
            const response = await httpClient.post(endpointPath, {
                audio: task.audio,
                audio_format: task.audio_format,
                sample_rate: task.sample_rate,
                speaker_id: task.speaker_id,
            }, {
                signal: abortController.signal, // 支持任务取消
            });
            return {
                embedding: response.data.embedding,
                speaker_id: response.data.speaker_id,
                audio: response.data.audio,
            };
        }
        catch (error) {
            logger_1.default.error({ error, serviceId: endpoint.serviceId }, 'TONE task failed');
            throw error;
        }
        finally {
            // 清理 AbortController
            if (task.job_id) {
                this.jobAbortControllers.delete(task.job_id);
            }
            const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
            this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
        }
    }
    /**
     * 设置服务选择策略
     */
    setSelectionStrategy(strategy) {
        this.selectionStrategy = strategy;
    }
}
exports.TaskRouter = TaskRouter;
