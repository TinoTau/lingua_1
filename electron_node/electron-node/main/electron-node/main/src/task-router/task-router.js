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
const opus_encoder_1 = require("../utils/opus-encoder");
const task_router_asr_1 = require("./task-router-asr");
class TaskRouter {
    /**
     * Gate-A: 重置指定 session 的连续低质量计数
     * @param sessionId 会话 ID
     */
    resetConsecutiveLowQualityCount(sessionId) {
        this.asrHandler.resetConsecutiveLowQualityCount(sessionId);
    }
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
        // OBS-1: 处理效率观测指标统计（按心跳周期，按服务ID分组）
        // 每个服务ID对应一个处理效率列表（用于NMT、TTS等非ASR服务）
        this.currentCycleServiceEfficiencies = new Map(); // serviceId -> efficiency[]
        // 初始化 ASR 路由处理器
        this.asrHandler = new task_router_asr_1.TaskRouterASRHandler((serviceType) => this.selectServiceEndpoint(serviceType), (serviceId) => this.startGpuTrackingForService(serviceId), this.serviceConnections, (serviceId, delta) => {
            const connections = this.serviceConnections.get(serviceId) || 0;
            this.serviceConnections.set(serviceId, Math.max(0, connections + delta));
        });
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
     * Gate-A: 获取 ASR 服务端点列表（用于上下文重置）
     */
    getASREndpoints() {
        const endpoints = this.serviceEndpoints.get(messages_1.ServiceType.ASR) || [];
        return endpoints
            .filter(e => e.status === 'running')
            .map(e => e.baseUrl);
    }
    /**
     * Gate-B: 获取 Rerun 指标（用于上报）
     */
    getRerunMetrics() {
        return this.asrHandler.getRerunMetrics();
    }
    /**
     * OBS-1: 获取 ASR 观测指标（用于上报）
     */
    /**
     * OBS-1: 获取当前心跳周期的处理效率指标（按服务ID分组）
     * 返回每个服务ID的平均处理效率
     */
    getProcessingMetrics() {
        // 合并 ASR handler 的指标和其他服务的指标
        const asrMetrics = this.asrHandler.getProcessingMetrics();
        const result = { ...asrMetrics };
        // 计算其他服务（NMT、TTS等）的平均处理效率
        for (const [serviceId, efficiencies] of this.currentCycleServiceEfficiencies.entries()) {
            if (efficiencies.length > 0 && !result[serviceId]) {
                const sum = efficiencies.reduce((a, b) => a + b, 0);
                const average = sum / efficiencies.length;
                result[serviceId] = average;
            }
        }
        return result;
    }
    /**
     * OBS-1: 获取指定服务ID的处理效率
     * @param serviceId 服务ID
     * @returns 处理效率，如果该服务在心跳周期内没有任务则为 null
     */
    getServiceEfficiency(serviceId) {
        const efficiencies = this.currentCycleServiceEfficiencies.get(serviceId);
        if (!efficiencies || efficiencies.length === 0) {
            return null;
        }
        const sum = efficiencies.reduce((a, b) => a + b, 0);
        return sum / efficiencies.length;
    }
    /**
     * OBS-1: 获取当前心跳周期的 ASR 指标（向后兼容）
     * @deprecated 使用 getProcessingMetrics() 或 getServiceEfficiency() 代替
     */
    getASRMetrics() {
        // 向后兼容：查找 faster-whisper-vad 的处理效率
        const asrEfficiency = this.getServiceEfficiency('faster-whisper-vad');
        return {
            processingEfficiency: asrEfficiency,
        };
    }
    /**
     * OBS-1: 重置当前心跳周期的统计数据
     * 在每次心跳发送后调用，清空当前周期的数据
     */
    resetCycleMetrics() {
        this.asrHandler.resetCycleMetrics();
        this.currentCycleServiceEfficiencies.clear();
    }
    /**
     * GPU 跟踪：为指定服务启动 GPU 跟踪
     * 根据 serviceId 自动判断是 Python 服务还是 Rust 服务
     */
    startGpuTrackingForService(serviceId) {
        try {
            // 映射 serviceId 到 Python 服务名称
            const serviceIdToPythonName = {
                'faster-whisper-vad': 'faster_whisper_vad',
                'nmt-m2m100': 'nmt',
                'piper-tts': 'tts',
                'your-tts': 'yourtts',
                'speaker-embedding': 'speaker_embedding',
            };
            const pythonServiceName = serviceIdToPythonName[serviceId];
            if (pythonServiceName && this.pythonServiceManager) {
                // Python 服务：启动 GPU 跟踪
                this.pythonServiceManager.startGpuTracking(pythonServiceName);
                logger_1.default.debug({ serviceId, pythonServiceName }, 'Started GPU tracking for Python service');
            }
            else if (serviceId === 'node-inference' && this.rustServiceManager) {
                // Rust 服务：启动 GPU 跟踪
                this.rustServiceManager.startGpuTracking();
                logger_1.default.debug({ serviceId }, 'Started GPU tracking for Rust service');
            }
            else {
                logger_1.default.debug({ serviceId }, 'No GPU tracking available for service (service may not use GPU)');
            }
        }
        catch (error) {
            logger_1.default.warn({ error, serviceId }, 'Failed to start GPU tracking for service');
        }
    }
    /**
     * OBS-1: 记录服务处理效率（按心跳周期，按服务ID分组）
     * @param serviceId 服务ID（如 'faster-whisper-vad', 'nmt-m2m100', 'piper-tts' 等）
     * @param efficiency 处理效率值
     */
    recordServiceEfficiency(serviceId, efficiency) {
        if (!serviceId || !isFinite(efficiency) || efficiency <= 0) {
            return;
        }
        // 获取或创建该服务ID的效率列表
        let efficiencies = this.currentCycleServiceEfficiencies.get(serviceId);
        if (!efficiencies) {
            efficiencies = [];
            this.currentCycleServiceEfficiencies.set(serviceId, efficiencies);
        }
        efficiencies.push(efficiency);
        logger_1.default.debug({ serviceId, efficiency }, 'OBS-1: Recorded service processing efficiency');
    }
    /**
     * OBS-1: 记录 NMT 处理效率（按心跳周期）
     * @param serviceId 服务ID（如 'nmt-m2m100'）
     * @param textLength 文本长度（字符数）
     * @param processingTimeMs NMT 处理时间（毫秒）
     */
    recordNMTEfficiency(serviceId, textLength, processingTimeMs) {
        // 如果文本长度无效，跳过记录
        if (!textLength || textLength <= 0 || processingTimeMs <= 0) {
            return;
        }
        // 计算处理效率 = 文本长度(字符) / 处理时间(ms) * 1000 (转换为字符/秒)
        // 为了与其他指标保持一致（值越大越好），使用字符/秒作为效率指标
        const efficiency = (textLength / processingTimeMs) * 1000;
        this.recordServiceEfficiency(serviceId, efficiency);
    }
    /**
     * OBS-1: 记录 TTS 处理效率（按心跳周期）
     * @param serviceId 服务ID（如 'piper-tts', 'your-tts'）
     * @param audioDurationMs 生成的音频时长（毫秒）
     * @param processingTimeMs TTS 处理时间（毫秒）
     */
    recordTTSEfficiency(serviceId, audioDurationMs, processingTimeMs) {
        // 如果音频时长无效，跳过记录
        if (!audioDurationMs || audioDurationMs <= 0 || processingTimeMs <= 0) {
            return;
        }
        // 计算处理效率 = 音频时长 / 处理时间
        const efficiency = audioDurationMs / processingTimeMs;
        this.recordServiceEfficiency(serviceId, efficiency);
        logger_1.default.debug({
            audioDurationMs,
            processingTimeMs,
            efficiency: efficiency.toFixed(2),
        }, 'OBS-1: Recorded processing efficiency for current heartbeat cycle');
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
        return await this.asrHandler.routeASRTask(task);
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
        // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
        this.startGpuTrackingForService(endpoint.serviceId);
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
            const taskStartTime = Date.now();
            const response = await httpClient.post('/v1/translate', {
                text: task.text,
                src_lang: task.src_lang,
                tgt_lang: task.tgt_lang,
                context_text: task.context_text,
                num_candidates: task.num_candidates, // 传递候选数量（如果指定）
            }, {
                signal: abortController.signal, // 支持任务取消
            });
            // OBS-1: 记录 NMT 处理效率
            const taskEndTime = Date.now();
            const processingTimeMs = taskEndTime - taskStartTime;
            const textLength = task.text?.length || 0;
            this.recordNMTEfficiency(endpoint.serviceId, textLength, processingTimeMs);
            const translatedText = response.data.text || '';
            logger_1.default.debug({
                serviceId: endpoint.serviceId,
                jobId: task.job_id,
                translatedTextLength: translatedText.length,
                translatedTextPreview: translatedText.substring(0, 100),
                sourceTextLength: task.text.length,
                sourceTextPreview: task.text.substring(0, 50),
            }, 'NMT service returned translation');
            return {
                text: translatedText,
                confidence: response.data.confidence,
                candidates: response.data.candidates || undefined, // 返回候选列表（如果有）
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
        // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
        this.startGpuTrackingForService(endpoint.serviceId);
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
            const taskStartTime = Date.now();
            // 将WAV音频数据转换为Buffer
            const wavBuffer = Buffer.from(response.data);
            // 注意：Opus 编码已移至 PipelineOrchestrator 中处理
            // TaskRouter 现在只返回 WAV 数据，由 Pipeline 负责编码为 Opus
            const wavBase64 = wavBuffer.toString('base64');
            // OBS-1: 记录 TTS 处理效率
            const taskEndTime = Date.now();
            const processingTimeMs = taskEndTime - taskStartTime;
            // 计算音频时长（用于效率统计）
            let audioDurationMs;
            try {
                const { sampleRate, channels } = (0, opus_encoder_1.parseWavFile)(wavBuffer);
                const sampleCount = wavBuffer.length / (2 * channels);
                audioDurationMs = Math.round((sampleCount / sampleRate) * 1000);
                if (audioDurationMs) {
                    this.recordTTSEfficiency(endpoint.serviceId, audioDurationMs, processingTimeMs);
                }
            }
            catch (error) {
                logger_1.default.warn({ error }, 'Failed to calculate audio duration for efficiency tracking');
            }
            logger_1.default.info({
                serviceId: endpoint.serviceId,
                wavSize: wavBuffer.length,
                base64Length: wavBase64.length,
                audioDurationMs,
            }, 'TTS: WAV audio received, will be encoded to Opus in Pipeline');
            return {
                audio: wavBase64,
                audio_format: 'wav', // 返回 WAV 格式，由 Pipeline 编码为 Opus
                sample_rate: task.sample_rate || 16000,
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
