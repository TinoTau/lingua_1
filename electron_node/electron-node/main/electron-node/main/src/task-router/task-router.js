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
const node_config_1 = require("../node-config");
// Opus 编码支持（已移至 PipelineOrchestrator，这里只保留 parseWavFile 用于效率统计）
const opus_encoder_1 = require("../utils/opus-encoder");
// CONF-3: 基于 segments 时间戳的断裂/异常检测
const bad_segment_detector_1 = require("./bad-segment-detector");
// P0.5-SH-1: 坏段触发条件封装
const rerun_trigger_1 = require("./rerun-trigger");
class TaskRouter {
    /**
     * Gate-A: 重置指定 session 的连续低质量计数
     * @param sessionId 会话 ID
     */
    resetConsecutiveLowQualityCount(sessionId) {
        this.consecutiveLowQualityCount.set(sessionId, 0);
        logger_1.default.info({
            sessionId,
        }, 'Gate-A: Reset consecutiveLowQualityCount for session');
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
        // P0.5-SH-5: Rerun 指标统计
        this.rerunMetrics = {
            totalReruns: 0,
            successfulReruns: 0,
            failedReruns: 0,
            timeoutReruns: 0,
            qualityImprovements: 0, // 质量提升的重跑次数
        };
        // P0.5-CTX-2: 连续低质量计数（用于 reset context）
        this.consecutiveLowQualityCount = new Map(); // sessionId -> count
        // OBS-1: 处理效率观测指标统计（按心跳周期，按服务ID分组）
        // 每个服务ID对应一个处理效率列表
        this.currentCycleServiceEfficiencies = new Map(); // serviceId -> efficiency[]
        // 初始化时加载 ASR 配置
        this.loadASRConfig();
    }
    /**
     * 加载 ASR 配置
     */
    loadASRConfig() {
        try {
            const config = (0, node_config_1.loadNodeConfig)();
            this.asrConfig = config.asr;
        }
        catch (error) {
            logger_1.default.warn({ error }, 'Failed to load ASR config, using defaults');
            this.asrConfig = undefined; // 使用默认值
        }
    }
    /**
     * 获取 ASR 配置（带默认值）
     * 返回完整的配置对象，确保所有字段都有值
     */
    getASRConfig() {
        if (!this.asrConfig) {
            // 如果配置未加载，尝试重新加载
            this.loadASRConfig();
        }
        const defaultConfig = {
            beam_size: 10,
            temperature: 0.0,
            patience: 1.0,
            compression_ratio_threshold: 2.4,
            log_prob_threshold: -1.0,
            no_speech_threshold: 0.6,
        };
        if (!this.asrConfig) {
            return defaultConfig;
        }
        // 合并配置，确保所有字段都有值
        return {
            beam_size: this.asrConfig.beam_size ?? defaultConfig.beam_size,
            temperature: this.asrConfig.temperature ?? defaultConfig.temperature,
            patience: this.asrConfig.patience ?? defaultConfig.patience,
            compression_ratio_threshold: this.asrConfig.compression_ratio_threshold ?? defaultConfig.compression_ratio_threshold,
            log_prob_threshold: this.asrConfig.log_prob_threshold ?? defaultConfig.log_prob_threshold,
            no_speech_threshold: this.asrConfig.no_speech_threshold ?? defaultConfig.no_speech_threshold,
        };
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
        return { ...this.rerunMetrics };
    }
    /**
     * OBS-1: 获取 ASR 观测指标（用于上报）
     */
    /**
     * OBS-1: 获取当前心跳周期的处理效率指标（按服务ID分组）
     * 返回每个服务ID的平均处理效率
     */
    getProcessingMetrics() {
        const result = {};
        // 计算每个服务ID的平均处理效率
        for (const [serviceId, efficiencies] of this.currentCycleServiceEfficiencies.entries()) {
            if (efficiencies.length > 0) {
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
     * OBS-1: 判断任务模式（会议室或线下）
     * 注意：节点端无法直接判断任务是否在房间中，因为节点端没有 room_manager
     * 简化实现：
     * - 如果任务有 session_id（通过调度服务器），默认为普通会话模式（offline）
     * - 真正的会议室模式判断需要在调度服务器端完成
     * - 这里暂时统一使用 'offline' 模式统计，后续可以通过任务中的其他字段（如 target_session_ids）来判断
     */
    getTaskMode(task) {
        // TODO: 如果调度服务器在 job_assign 中传递了模式信息，可以使用该信息
        // 目前暂时统一使用 'offline' 模式统计
        // 真正的会议室模式判断应该在调度服务器端完成，然后通过指标聚合来区分
        return 'offline';
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
     * OBS-1: 记录 ASR 处理效率（按心跳周期）
     * @param serviceId 服务ID（如 'faster-whisper-vad'）
     * @param audioDurationMs 音频时长（毫秒）
     * @param processingTimeMs ASR 处理时间（毫秒，包含重跑时间）
     */
    recordASREfficiency(serviceId, audioDurationMs, processingTimeMs) {
        // 如果音频时长无效，跳过记录
        if (!audioDurationMs || audioDurationMs <= 0 || processingTimeMs <= 0) {
            logger_1.default.debug({ serviceId, audioDurationMs, processingTimeMs }, 'OBS-1: Skipping ASR efficiency recording due to invalid parameters');
            return;
        }
        // 计算处理效率 = 音频时长 / 处理时间
        const efficiency = audioDurationMs / processingTimeMs;
        this.recordServiceEfficiency(serviceId, efficiency);
        logger_1.default.debug({ serviceId, audioDurationMs, processingTimeMs, efficiency: efficiency.toFixed(2) }, 'OBS-1: Recorded ASR processing efficiency');
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
        // OBS-1: 记录任务开始时间（用于计算延迟）
        const taskStartTime = Date.now();
        // OBS-1: 获取任务模式
        const taskMode = this.getTaskMode(task);
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.ASR);
        if (!endpoint) {
            throw new Error('No available ASR service');
        }
        // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
        this.startGpuTrackingForService(endpoint.serviceId);
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
            // ASR 服务路由：目前只支持 faster-whisper-vad
            if (endpoint.serviceId !== 'faster-whisper-vad') {
                throw new Error(`Unsupported ASR service: ${endpoint.serviceId}. Only faster-whisper-vad is supported.`);
            }
            // faster-whisper-vad 使用 /utterance 接口
            let response;
            {
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
                // 检查音频输入质量（用于调试 Job2 问题）
                let audioDataLength = 0;
                let audioDataPreview = '';
                try {
                    if (task.audio) {
                        const audioBuffer = Buffer.from(task.audio, 'base64');
                        audioDataLength = audioBuffer.length;
                        // 计算音频时长（假设 PCM16，16kHz）
                        const estimatedDurationMs = Math.round((audioDataLength / 2) / 16); // PCM16 = 2 bytes per sample, 16kHz = 16000 samples per second
                        // 计算 RMS（用于检查音频是否为空或静音）
                        const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
                        let sumSquares = 0;
                        for (let i = 0; i < samples.length; i++) {
                            sumSquares += samples[i] * samples[i];
                        }
                        const rms = Math.sqrt(sumSquares / samples.length);
                        const rmsNormalized = rms / 32768.0; // 归一化到 0-1
                        audioDataPreview = `length=${audioDataLength}, duration=${estimatedDurationMs}ms, rms=${rmsNormalized.toFixed(4)}`;
                        logger_1.default.info({
                            serviceId: endpoint.serviceId,
                            jobId: task.job_id,
                            utteranceIndex: task.utterance_index,
                            audioDataLength,
                            estimatedDurationMs,
                            rms: rmsNormalized.toFixed(4),
                            audioFormat,
                            sampleRate: task.sample_rate || 16000,
                            contextTextLength: task.context_text?.length || 0,
                            contextTextPreview: task.context_text ? task.context_text.substring(0, 200) : null,
                        }, 'ASR task: Audio input quality check');
                    }
                }
                catch (error) {
                    logger_1.default.warn({
                        serviceId: endpoint.serviceId,
                        jobId: task.job_id,
                        utteranceIndex: task.utterance_index,
                        error: error.message,
                    }, 'ASR task: Failed to analyze audio input quality');
                }
                const requestBody = {
                    job_id: task.job_id || `asr_${Date.now()}`,
                    src_lang: task.src_lang,
                    tgt_lang: task.src_lang, // ASR 不需要目标语言
                    audio: task.audio,
                    audio_format: audioFormat,
                    sample_rate: task.sample_rate || 16000,
                    task: 'transcribe', // 必需字段
                    beam_size: task.beam_size || this.getASRConfig().beam_size, // S2-6: 支持自定义 beam_size（二次解码使用更大值）
                    condition_on_previous_text: false, // 修复：改为 false，避免重复识别（当上下文文本和当前音频内容相同时，会导致重复输出）
                    use_context_buffer: false, // 修复：禁用音频上下文，避免重复识别和增加处理时间（utterance已经是完整的，不需要音频上下文）
                    use_text_context: true, // 保留文本上下文（initial_prompt），这是Faster Whisper的标准功能
                    enable_streaming_asr: task.enable_streaming || false,
                    context_text: task.context_text,
                    // S2-6: 二次解码参数（如果提供）
                    best_of: task.best_of,
                    temperature: task.temperature,
                    patience: task.patience,
                    // EDGE-4: Padding 配置（如果提供）
                    padding_ms: task.padding_ms,
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
                // 实现语言置信度分级逻辑（CONF-1）
                const langProb = response.data.language_probability ?? 0;
                let useTextContext = false; // 默认关闭上下文
                let conditionOnPreviousText = false; // 默认关闭
                // P0.5-CTX-1: 低质量禁用 context（在坏段检测之前先检查 qualityScore）
                // 注意：这里先使用默认值，坏段检测后会在重跑逻辑中更新
                const tempBadSegmentDetection = (0, bad_segment_detector_1.detectBadSegment)({
                    text: response.data.text || '',
                    language: response.data.language || task.src_lang,
                    language_probability: langProb,
                    language_probabilities: response.data.language_probabilities,
                    segments: response.data.segments,
                }, response.data.duration ? Math.round(response.data.duration * 1000) : undefined, task.context_text);
                // P0.5-CTX-1: qualityScore < 0.4 → 禁用上下文 prompt
                if (tempBadSegmentDetection.qualityScore < 0.4) {
                    useTextContext = false;
                    conditionOnPreviousText = false;
                    logger_1.default.info({
                        jobId: task.job_id,
                        qualityScore: tempBadSegmentDetection.qualityScore,
                    }, 'P0.5-CTX-1: Low quality score, disabling context');
                }
                // 仅在极少数"同语种连续且高置信"的窗口中才允许开启（可选）
                // 这里先实现基础逻辑，后续可以添加"最近多段语言一致"的检查
                if (langProb >= 0.90 && tempBadSegmentDetection.qualityScore >= 0.4) {
                    // 高置信且高质量：可以启用上下文（可选，根据方案默认关闭）
                    // useTextContext = true;  // 暂时保持关闭，等待后续优化
                }
                if (langProb < 0.70) {
                    // 低置信：强制关闭上下文（防污染）
                    useTextContext = false;
                    conditionOnPreviousText = false;
                }
                // 构建 ASR 结果
                const asrText = response.data.text || '';
                const asrResult = {
                    text: asrText,
                    confidence: 1.0, // faster-whisper-vad 不返回 confidence
                    language: response.data.language || task.src_lang,
                    language_probability: response.data.language_probability, // 新增：检测到的语言的概率
                    language_probabilities: response.data.language_probabilities, // 新增：所有语言的概率信息
                    segments: response.data.segments, // 新增：Segment 元数据（包含时间戳）
                    is_final: true,
                };
                // 记录 ASR 服务返回的原始文本（用于调试）
                // 改为 info 级别，以便在日志中看到 ASR 服务返回的原始结果
                logger_1.default.info({
                    serviceId: endpoint.serviceId,
                    jobId: task.job_id,
                    utteranceIndex: task.utterance_index,
                    asrTextLength: asrText.length,
                    asrTextPreview: asrText.substring(0, 100),
                    language: asrResult.language,
                    languageProbability: asrResult.language_probability,
                    segmentCount: response.data.segments?.length || 0,
                    audioDurationMs: response.data.duration ? Math.round(response.data.duration * 1000) : undefined,
                    // 添加 segments 的详细信息，以便调试
                    segmentsPreview: response.data.segments?.slice(0, 3).map((seg) => ({
                        text: seg.text?.substring(0, 50) || '',
                        start: seg.start,
                        end: seg.end,
                    })) || [],
                }, 'ASR service returned result');
                // CONF-3 + RERUN-1: 基于 segments 时间戳的断裂/异常检测 + 坏段判定
                // OBS-1: 计算音频时长（用于处理效率统计）
                const audioDurationMs = response.data.duration
                    ? Math.round(response.data.duration * 1000) // 转换为毫秒
                    : undefined;
                // 如果 response.data.duration 不存在，尝试从 segments 计算
                // 注意：这是备用方案，优先使用 response.data.duration
                let calculatedAudioDurationMs = audioDurationMs;
                if (!calculatedAudioDurationMs && asrResult.segments && asrResult.segments.length > 0) {
                    // 从 segments 计算音频时长（最后一个 segment 的 end 时间）
                    const lastSegment = asrResult.segments[asrResult.segments.length - 1];
                    if (lastSegment && lastSegment.end) {
                        calculatedAudioDurationMs = Math.round(lastSegment.end * 1000);
                        logger_1.default.debug({ jobId: task.job_id, calculatedAudioDurationMs }, 'OBS-1: Calculated audio duration from segments');
                    }
                }
                // 获取上一段文本（从 context_text 中提取，如果可用）
                // 注意：context_text 是传递给 ASR 服务的，可能包含上一个 utterance 的文本
                const previousText = task.context_text || undefined;
                const badSegmentDetection = (0, bad_segment_detector_1.detectBadSegment)(asrResult, audioDurationMs, previousText);
                if (badSegmentDetection.isBad) {
                    logger_1.default.warn({
                        jobId: task.job_id,
                        reasonCodes: badSegmentDetection.reasonCodes,
                        qualityScore: badSegmentDetection.qualityScore,
                        segmentCount: asrResult.segments?.length || 0,
                        audioDurationMs,
                        languageProbability: asrResult.language_probability,
                    }, 'CONF-3: Bad segment detected based on segments timestamps');
                }
                else {
                    logger_1.default.debug({
                        jobId: task.job_id,
                        qualityScore: badSegmentDetection.qualityScore,
                        segmentCount: asrResult.segments?.length || 0,
                    }, 'CONF-3: Segment quality check passed');
                }
                // 将检测结果附加到 ASR 结果中（用于日志和后续处理）
                asrResult.badSegmentDetection = badSegmentDetection;
                // P0.5-CTX-2: 检查连续低质量（在重跑之前）
                const sessionId = task.session_id || task.job_id || 'unknown';
                if (badSegmentDetection.qualityScore < 0.4) {
                    const currentCount = this.consecutiveLowQualityCount.get(sessionId) || 0;
                    const newCount = currentCount + 1;
                    this.consecutiveLowQualityCount.set(sessionId, newCount);
                    if (newCount >= 2) {
                        logger_1.default.warn({
                            jobId: task.job_id,
                            sessionId,
                            consecutiveLowQualityCount: newCount,
                            qualityScore: badSegmentDetection.qualityScore,
                        }, 'P0.5-CTX-2: Consecutive low quality detected (>=2), should reset context');
                        asrResult.shouldResetContext = true;
                    }
                }
                else {
                    // 质量正常，重置连续低质量计数
                    this.consecutiveLowQualityCount.set(sessionId, 0);
                }
                // P0.5-SH-1/2: 检查是否应该触发 Top-2 语言重跑
                const rerunCondition = (0, rerun_trigger_1.shouldTriggerRerun)(asrResult, audioDurationMs, task);
                if (rerunCondition.shouldRerun) {
                    logger_1.default.info({
                        jobId: task.job_id,
                        reason: rerunCondition.reason,
                        languageProbability: asrResult.language_probability,
                        qualityScore: badSegmentDetection.qualityScore,
                    }, 'P0.5-SH-2: Triggering Top-2 language rerun');
                    // P0.5-SH-2: 获取 Top-2 语言并执行重跑
                    const top2Langs = (0, rerun_trigger_1.getTop2LanguagesForRerun)(asrResult.language_probabilities || {}, asrResult.language);
                    if (top2Langs.length > 0) {
                        // 尝试使用 Top-2 语言重跑
                        let bestResult = asrResult; // 默认使用原始结果
                        let bestQualityScore = badSegmentDetection.qualityScore;
                        for (const lang of top2Langs) {
                            try {
                                logger_1.default.info({
                                    jobId: task.job_id,
                                    rerunLanguage: lang,
                                    originalLanguage: asrResult.language,
                                    rerunCount: (task.rerun_count || 0) + 1,
                                }, 'P0.5-SH-2: Attempting rerun with forced language');
                                // P0.5-SH-4: 创建带超时的 AbortController
                                const rerunTimeoutMs = task.rerun_timeout_ms ?? 5000; // 默认 5 秒
                                const rerunAbortController = new AbortController();
                                const rerunTimeoutId = setTimeout(() => {
                                    rerunAbortController.abort();
                                    logger_1.default.warn({
                                        jobId: task.job_id,
                                        rerunLanguage: lang,
                                        timeoutMs: rerunTimeoutMs,
                                    }, 'P0.5-SH-4: Rerun timeout exceeded');
                                }, rerunTimeoutMs);
                                try {
                                    // 使用强制语言重跑 ASR
                                    const rerunTask = {
                                        ...task,
                                        src_lang: lang, // 强制使用指定语言
                                        rerun_count: (task.rerun_count || 0) + 1, // 递增重跑次数
                                    };
                                    // 创建新的请求体，强制使用指定语言
                                    const rerunRequestBody = {
                                        ...requestBody,
                                        src_lang: lang,
                                        language: lang, // 强制语言
                                    };
                                    // 执行重跑请求（带超时）
                                    const rerunResponse = await httpClient.post('/utterance', rerunRequestBody, {
                                        signal: rerunAbortController.signal,
                                    });
                                    clearTimeout(rerunTimeoutId); // 清除超时定时器
                                    // 构建重跑结果
                                    const rerunResult = {
                                        text: rerunResponse.data.text || '',
                                        confidence: 1.0,
                                        language: rerunResponse.data.language || lang,
                                        language_probability: rerunResponse.data.language_probability,
                                        language_probabilities: rerunResponse.data.language_probabilities,
                                        segments: rerunResponse.data.segments,
                                        is_final: true,
                                    };
                                    // 重新检测坏段（用于质量评分）
                                    const rerunAudioDurationMs = rerunResponse.data.duration
                                        ? Math.round(rerunResponse.data.duration * 1000)
                                        : undefined;
                                    const rerunBadSegmentDetection = (0, bad_segment_detector_1.detectBadSegment)(rerunResult, rerunAudioDurationMs, previousText);
                                    rerunResult.badSegmentDetection = rerunBadSegmentDetection;
                                    // P0.5-SH-3: 使用 qualityScore 择优
                                    if (rerunBadSegmentDetection.qualityScore > bestQualityScore) {
                                        logger_1.default.info({
                                            jobId: task.job_id,
                                            rerunLanguage: lang,
                                            originalQualityScore: bestQualityScore,
                                            rerunQualityScore: rerunBadSegmentDetection.qualityScore,
                                        }, 'P0.5-SH-3: Rerun result has better quality score, selecting it');
                                        bestResult = rerunResult;
                                        bestQualityScore = rerunBadSegmentDetection.qualityScore;
                                        // P0.5-SH-5: 记录质量提升
                                        this.rerunMetrics.qualityImprovements++;
                                    }
                                    else {
                                        logger_1.default.debug({
                                            jobId: task.job_id,
                                            rerunLanguage: lang,
                                            originalQualityScore: bestQualityScore,
                                            rerunQualityScore: rerunBadSegmentDetection.qualityScore,
                                        }, 'P0.5-SH-3: Rerun result quality score not better, keeping original');
                                    }
                                    // P0.5-SH-5: 记录成功重跑
                                    this.rerunMetrics.totalReruns++;
                                    this.rerunMetrics.successfulReruns++;
                                }
                                catch (rerunError) {
                                    clearTimeout(rerunTimeoutId); // 确保清除超时定时器
                                    // P0.5-SH-5: 记录失败重跑
                                    this.rerunMetrics.totalReruns++;
                                    if (rerunAbortController.signal.aborted) {
                                        logger_1.default.warn({
                                            jobId: task.job_id,
                                            rerunLanguage: lang,
                                            timeoutMs: rerunTimeoutMs,
                                        }, 'P0.5-SH-4: Rerun aborted due to timeout');
                                        this.rerunMetrics.timeoutReruns++;
                                    }
                                    else {
                                        logger_1.default.warn({
                                            jobId: task.job_id,
                                            rerunLanguage: lang,
                                            error: rerunError.message,
                                        }, 'P0.5-SH-2: Rerun failed, continuing with next language or original result');
                                        this.rerunMetrics.failedReruns++;
                                    }
                                    // 继续尝试下一个语言，或使用原始结果
                                }
                            }
                            catch (outerError) {
                                logger_1.default.error({
                                    jobId: task.job_id,
                                    rerunLanguage: lang,
                                    error: outerError.message,
                                }, 'P0.5-SH-2: Unexpected error during rerun setup');
                                // 继续尝试下一个语言，或使用原始结果
                            }
                        }
                        // 返回最佳结果
                        if (bestResult !== asrResult) {
                            logger_1.default.info({
                                jobId: task.job_id,
                                originalLanguage: asrResult.language,
                                selectedLanguage: bestResult.language,
                                originalQualityScore: badSegmentDetection.qualityScore,
                                selectedQualityScore: bestQualityScore,
                            }, 'P0.5-SH-3: Selected rerun result as best');
                        }
                        // OBS-1: 记录处理效率（重跑场景，包含重跑时间）
                        const taskEndTime = Date.now();
                        const processingTimeMs = taskEndTime - taskStartTime;
                        // 使用原始音频时长（calculatedAudioDurationMs 或 audioDurationMs），不是重跑的音频时长
                        this.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
                        return bestResult;
                    }
                    else {
                        logger_1.default.warn({
                            jobId: task.job_id,
                        }, 'P0.5-SH-2: No Top-2 languages available for rerun');
                    }
                }
                // OBS-1: 记录处理效率（正常场景，无重跑）
                const taskEndTime = Date.now();
                const processingTimeMs = taskEndTime - taskStartTime;
                // 使用计算出的音频时长（优先使用 response.data.duration，否则使用 segments 计算的值）
                this.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
                return asrResult;
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
