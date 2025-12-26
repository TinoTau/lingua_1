"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeAgent = void 0;
const ws_1 = __importDefault(require("ws"));
const si = __importStar(require("systeminformation"));
const os = __importStar(require("os"));
const messages_1 = require("../../../../shared/protocols/messages");
const model_manager_1 = require("../model-manager/model-manager");
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
class NodeAgent {
    constructor(inferenceService, modelManager, serviceRegistryManager, rustServiceManager, pythonServiceManager) {
        this.ws = null;
        this.nodeId = null;
        this.heartbeatInterval = null;
        this.capabilityStateChangedHandler = null; // 保存监听器函数，用于清理
        this.heartbeatDebounceTimer = null; // 心跳防抖定时器
        this.HEARTBEAT_DEBOUNCE_MS = 2000; // 防抖延迟：2秒内最多触发一次立即心跳
        // 优先从配置文件读取，其次从环境变量，最后使用默认值
        const config = (0, node_config_1.loadNodeConfig)();
        this.schedulerUrl =
            config.scheduler?.url ||
                process.env.SCHEDULER_URL ||
                'ws://127.0.0.1:5010/ws/node';
        this.inferenceService = inferenceService;
        // 通过参数传入或从 inferenceService 获取 modelManager
        this.modelManager = modelManager || inferenceService.modelManager;
        this.serviceRegistryManager = serviceRegistryManager;
        this.rustServiceManager = rustServiceManager;
        this.pythonServiceManager = pythonServiceManager;
        logger_1.default.info({ schedulerUrl: this.schedulerUrl }, 'Scheduler server URL configured');
    }
    async start() {
        try {
            // 如果已有连接，先关闭
            if (this.ws) {
                this.stop();
            }
            this.ws = new ws_1.default(this.schedulerUrl);
            this.ws.on('open', () => {
                logger_1.default.info({ schedulerUrl: this.schedulerUrl }, 'Connected to scheduler server, starting registration');
                // 使用 Promise 确保注册完成后再启动心跳
                this.registerNode().catch((error) => {
                    logger_1.default.error({ error }, 'Failed to register node in open handler');
                });
                this.startHeartbeat();
            });
            this.ws.on('message', (data) => {
                const messageStr = data.toString();
                logger_1.default.debug({ message: messageStr }, 'Received message from scheduler');
                this.handleMessage(messageStr);
            });
            this.ws.on('error', (error) => {
                logger_1.default.error({ error, schedulerUrl: this.schedulerUrl }, 'WebSocket error');
            });
            this.ws.on('close', (code, reason) => {
                logger_1.default.info({ code, reason: reason?.toString() }, 'Connection to scheduler server closed');
                this.stopHeartbeat();
                // 尝试重连
                setTimeout(() => this.start(), 5000);
            });
            // 监听模型状态变化，实时更新 capability_state
            // 先移除旧的监听器（如果存在），避免重复添加
            if (this.modelManager && typeof this.modelManager.on === 'function') {
                if (this.capabilityStateChangedHandler) {
                    this.modelManager.off('capability-state-changed', this.capabilityStateChangedHandler);
                }
                // 创建新的监听器函数并保存
                this.capabilityStateChangedHandler = () => {
                    // 状态变化时，立即触发心跳（带防抖）
                    logger_1.default.debug({}, 'Model state changed, triggering immediate heartbeat');
                    this.triggerImmediateHeartbeat();
                };
                this.modelManager.on('capability-state-changed', this.capabilityStateChangedHandler);
            }
            // 注册 Python 服务状态变化回调
            if (this.pythonServiceManager && typeof this.pythonServiceManager.setOnStatusChangeCallback === 'function') {
                this.pythonServiceManager.setOnStatusChangeCallback((serviceName, status) => {
                    // 服务状态变化时，立即触发心跳（带防抖）
                    logger_1.default.debug({ serviceName, running: status.running }, 'Python service status changed, triggering immediate heartbeat');
                    this.triggerImmediateHeartbeat();
                });
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to start Node Agent');
        }
    }
    stop() {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        // 移除 capability-state-changed 监听器，避免内存泄漏
        if (this.modelManager && this.capabilityStateChangedHandler) {
            this.modelManager.off('capability-state-changed', this.capabilityStateChangedHandler);
            this.capabilityStateChangedHandler = null;
        }
    }
    async registerNode() {
        if (!this.ws) {
            logger_1.default.warn({}, 'Cannot register node: WebSocket is null');
            return;
        }
        if (this.ws.readyState !== ws_1.default.OPEN) {
            logger_1.default.warn({ readyState: this.ws.readyState }, 'Cannot register node: WebSocket is not OPEN');
            return;
        }
        logger_1.default.info({ readyState: this.ws.readyState }, 'Starting node registration');
        try {
            // 获取硬件信息
            logger_1.default.debug({}, 'Getting hardware info...');
            const hardware = await this.getHardwareInfo();
            logger_1.default.debug({ gpus: hardware.gpus?.length || 0 }, 'Hardware info retrieved');
            // 获取已安装的模型
            logger_1.default.debug({}, 'Getting installed models...');
            const installedModels = await this.inferenceService.getInstalledModels();
            logger_1.default.debug({ modelCount: installedModels.length }, 'Installed models retrieved');
            // 获取服务实现列表与按类型聚合的能力
            logger_1.default.debug({}, 'Getting installed services...');
            const installedServicesAll = await this.getInstalledServices();
            logger_1.default.debug({ serviceCount: installedServicesAll.length }, 'Installed services retrieved');
            logger_1.default.debug({}, 'Getting capability by type...');
            const capabilityByType = await this.getCapabilityByType(installedServicesAll);
            logger_1.default.debug({ capabilityCount: capabilityByType.length }, 'Capability by type retrieved');
            // 获取支持的功能
            logger_1.default.debug({}, 'Getting features supported...');
            const featuresSupported = this.inferenceService.getFeaturesSupported();
            logger_1.default.debug({ features: featuresSupported }, 'Features supported retrieved');
            // 对齐协议规范：node_register 消息格式
            const message = {
                type: 'node_register',
                node_id: this.nodeId || null, // 首次连接时为 null
                version: '2.0.0', // TODO: 从 package.json 读取
                capability_schema_version: '2.0', // ServiceType 能力模型版本
                platform: this.getPlatform(),
                hardware: hardware,
                installed_models: installedModels,
                // 上报全部已安装实现（含运行状态），调度按 type 聚合
                // 如果为空数组，则发送 undefined 以匹配 Option<Vec<InstalledService>>
                installed_services: installedServicesAll.length > 0 ? installedServicesAll : undefined,
                capability_by_type: capabilityByType,
                features_supported: featuresSupported,
                accept_public_jobs: true, // TODO: 从配置读取
            };
            const messageStr = JSON.stringify(message);
            logger_1.default.info({
                node_id: this.nodeId,
                capability_schema_version: message.capability_schema_version,
                platform: message.platform,
                gpus: hardware.gpus?.length || 0,
                installed_services_count: installedServicesAll.length,
                capability_by_type_count: capabilityByType.length,
                capabilityByType,
                message_length: messageStr.length,
                ws_readyState: this.ws.readyState,
            }, 'Sending node registration message');
            logger_1.default.debug({ message: messageStr }, 'Node registration message content');
            if (this.ws.readyState !== ws_1.default.OPEN) {
                logger_1.default.error({ readyState: this.ws.readyState }, 'WebSocket is not OPEN when trying to send registration message');
                return;
            }
            this.ws.send(messageStr);
            logger_1.default.info({ message_length: messageStr.length }, 'Node registration message sent successfully');
        }
        catch (error) {
            const errorDetails = {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                name: error instanceof Error ? error.name : undefined,
                error: error,
            };
            logger_1.default.error(errorDetails, 'Failed to register node');
        }
    }
    getPlatform() {
        const platform = os.platform();
        if (platform === 'win32')
            return 'windows';
        if (platform === 'darwin')
            return 'macos';
        return 'linux';
    }
    async getHardwareInfo() {
        try {
            const mem = await si.mem();
            const cpu = await si.cpu();
            // 获取 GPU 硬件信息（使用 nvidia-smi）
            const gpus = await this.getGpuHardwareInfo();
            return {
                cpu_cores: cpu.cores || os.cpus().length,
                memory_gb: Math.round(mem.total / (1024 * 1024 * 1024)),
                gpus: gpus.length > 0 ? gpus : undefined,
            };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get hardware info');
            return {
                cpu_cores: os.cpus().length,
                memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
            };
        }
    }
    /**
     * 获取 GPU 硬件信息（名称和显存大小）
     * 使用 nvidia-smi 命令获取
     */
    async getGpuHardwareInfo() {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            // nvidia-smi 命令：获取GPU名称和显存大小
            const nvidiaSmi = spawn('nvidia-smi', [
                '--query-gpu=name,memory.total',
                '--format=csv,noheader,nounits'
            ]);
            let output = '';
            let errorOutput = '';
            nvidiaSmi.stdout.on('data', (data) => {
                output += data.toString();
            });
            nvidiaSmi.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            nvidiaSmi.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    try {
                        const lines = output.trim().split('\n');
                        const gpus = [];
                        for (const line of lines) {
                            // 格式: "GPU Name, Memory Total (MB)"
                            const parts = line.split(',');
                            if (parts.length >= 2) {
                                const name = parts[0].trim();
                                const memoryMb = parseFloat(parts[1].trim());
                                const memoryGb = Math.round(memoryMb / 1024);
                                if (!isNaN(memoryGb) && name) {
                                    gpus.push({ name, memory_gb: memoryGb });
                                }
                            }
                        }
                        if (gpus.length > 0) {
                            logger_1.default.info({ gpus }, 'Successfully fetched GPU hardware info');
                            resolve(gpus);
                        }
                        else {
                            logger_1.default.warn({ output }, 'Failed to parse GPU hardware info');
                            resolve([]);
                        }
                    }
                    catch (parseError) {
                        logger_1.default.warn({ parseError, output }, 'Failed to parse nvidia-smi output');
                        resolve([]);
                    }
                }
                else {
                    logger_1.default.warn({ code, errorOutput: errorOutput.trim() }, 'nvidia-smi command failed or no GPU found');
                    resolve([]);
                }
            });
            nvidiaSmi.on('error', (error) => {
                // nvidia-smi 命令不存在或无法执行
                logger_1.default.warn({ error: error.message }, 'nvidia-smi command not available');
                resolve([]);
            });
        });
    }
    startHeartbeat() {
        // 如果 nodeId 已存在（重连场景），立即发送一次心跳
        if (this.ws && this.ws.readyState === ws_1.default.OPEN && this.nodeId) {
            this.sendHeartbeatOnce().catch((error) => {
                logger_1.default.warn({ error }, 'Failed to send initial heartbeat');
            });
        }
        // 设置定时器，每15秒发送一次心跳
        this.heartbeatInterval = setInterval(async () => {
            if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId)
                return;
            await this.sendHeartbeatOnce();
        }, 15000); // 每15秒发送一次心跳
    }
    /**
     * 立即发送一次心跳（用于 node_register_ack 后立刻同步 installed_services/capability_state）
     * 避免等待 15s interval 导致调度端短时间内认为“无可用节点/无服务包”。
     */
    async sendHeartbeatOnce() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId)
            return;
        const resources = await this.getSystemResources();
        const installedModels = await this.inferenceService.getInstalledModels();
        const installedServicesAll = await this.getInstalledServices();
        const capabilityByType = await this.getCapabilityByType(installedServicesAll);
        logger_1.default.info({
            nodeId: this.nodeId,
            installedModelsCount: installedModels.length,
            installedServicesCount: installedServicesAll.length,
            capabilityByTypeCount: capabilityByType.length,
            capabilityByType,
            installedServices: installedServicesAll.map(s => `${s.service_id}:${s.type}:${s.status}`),
        }, 'Sending heartbeat with type-level capability');
        // 对齐协议规范：node_heartbeat 消息格式
        // 注意：gpu_percent 必须提供（不能为 undefined），因为调度服务器的健康检查要求所有节点都必须有 GPU
        // 如果无法获取 GPU 使用率，使用 0.0 作为默认值
        const message = {
            type: 'node_heartbeat',
            node_id: this.nodeId,
            timestamp: Date.now(),
            resource_usage: {
                cpu_percent: resources.cpu,
                gpu_percent: resources.gpu ?? 0.0, // 如果为 null，使用 0.0 作为默认值
                gpu_mem_percent: resources.gpuMem || undefined,
                mem_percent: resources.memory,
                running_jobs: this.inferenceService.getCurrentJobCount(),
            },
            installed_models: installedModels.length > 0 ? installedModels : undefined,
            installed_services: installedServicesAll,
            capability_by_type: capabilityByType,
            // Gate-B: Rerun 指标（如果可用）
            rerun_metrics: this.inferenceService.getRerunMetrics?.() || undefined,
        };
        const messageStr = JSON.stringify(message);
        logger_1.default.debug({ message: messageStr }, 'Heartbeat message content');
        this.ws.send(messageStr);
    }
    /**
     * 获取已安装的服务包列表
     * 包括：
     * 1. 从服务注册表中读取的已注册服务
     * 2. 实际运行但未在注册表中的本地服务（如 faster-whisper-vad、speaker-embedding）
     */
    async getInstalledServices() {
        const result = [];
        const defaultVersion = '2.0.0';
        const serviceTypeMap = {
            'faster-whisper-vad': messages_1.ServiceType.ASR,
            'node-inference': messages_1.ServiceType.ASR,
            'nmt-m2m100': messages_1.ServiceType.NMT,
            'piper-tts': messages_1.ServiceType.TTS,
            'speaker-embedding': messages_1.ServiceType.TONE,
            'your-tts': messages_1.ServiceType.TONE,
        };
        const defaultDevice = 'gpu';
        const pushService = (service_id, status, version) => {
            const type = serviceTypeMap[service_id];
            if (!type) {
                logger_1.default.warn({ service_id }, 'Unknown service_id, skipped when building installed_services');
                return;
            }
            // 去重：若已存在则更新状态
            const existingIndex = result.findIndex(s => s.service_id === service_id);
            const entry = {
                service_id,
                type,
                device: defaultDevice,
                status,
                version: version || defaultVersion,
            };
            if (existingIndex >= 0) {
                result[existingIndex] = entry;
            }
            else {
                result.push(entry);
            }
        };
        // 1. 从服务注册表获取已注册的服务
        if (this.serviceRegistryManager) {
            try {
                await this.serviceRegistryManager.loadRegistry();
                const installed = this.serviceRegistryManager.listInstalled();
                logger_1.default.debug({
                    installedCount: installed.length,
                    installed: installed.map((s) => ({
                        service_id: s.service_id,
                        version: s.version,
                        platform: s.platform
                    }))
                }, 'Getting installed services from registry for heartbeat');
                installed.forEach((service) => {
                    const running = this.isServiceRunning(service.service_id);
                    pushService(service.service_id, running ? 'running' : 'stopped', service.version);
                });
            }
            catch (error) {
                logger_1.default.error({ error }, 'Failed to get installed services from registry');
            }
        }
        // 2. 补充实际运行但未在注册表中的本地服务（Python）
        const serviceIdMap = {
            nmt: 'nmt-m2m100',
            tts: 'piper-tts',
            yourtts: 'your-tts',
            speaker_embedding: 'speaker-embedding',
            faster_whisper_vad: 'faster-whisper-vad',
        };
        if (this.pythonServiceManager) {
            const pythonServiceNames = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];
            for (const serviceName of pythonServiceNames) {
                const serviceId = serviceIdMap[serviceName];
                const alreadyAdded = result.some(s => s.service_id === serviceId);
                if (!alreadyAdded) {
                    const status = this.pythonServiceManager.getServiceStatus(serviceName);
                    if (status?.running) {
                        pushService(serviceId, 'running');
                        logger_1.default.debug({ serviceId, serviceName }, 'Added running service to installed services list (not in registry)');
                    }
                }
            }
        }
        // 3. 补充 Rust 服务（node-inference）
        if (this.rustServiceManager && typeof this.rustServiceManager.getStatus === 'function') {
            const rustStatus = this.rustServiceManager.getStatus();
            const alreadyAdded = result.some(s => s.service_id === 'node-inference');
            if (!alreadyAdded && rustStatus?.running) {
                pushService('node-inference', 'running');
                logger_1.default.debug({}, 'Added node-inference to installed services list (not in registry)');
            }
        }
        logger_1.default.info({
            totalCount: result.length,
            services: result.map(s => `${s.service_id}:${s.status}`),
        }, 'Getting installed services for heartbeat (type-level)');
        return result;
    }
    /**
     * 聚合 type 级可用性：同一类型只要有 GPU+running 的实现即 ready
     */
    async getCapabilityByType(installedServices) {
        const types = [messages_1.ServiceType.ASR, messages_1.ServiceType.NMT, messages_1.ServiceType.TTS, messages_1.ServiceType.TONE];
        const capability = [];
        for (const t of types) {
            const runningGpu = installedServices.filter(s => s.type === t && s.device === 'gpu' && s.status === 'running');
            if (runningGpu.length > 0) {
                capability.push({
                    type: t,
                    ready: true,
                    ready_impl_ids: runningGpu.map(s => s.service_id),
                });
                continue;
            }
            const anyInstalled = installedServices.some(s => s.type === t);
            const anyRunning = installedServices.some(s => s.type === t && s.status === 'running');
            const anyGpu = installedServices.some(s => s.type === t && s.device === 'gpu');
            let reason = 'no_impl';
            if (anyInstalled && anyGpu && !anyRunning)
                reason = 'gpu_impl_not_running';
            else if (anyInstalled && anyRunning && !anyGpu)
                reason = 'only_cpu_running';
            else if (anyInstalled && !anyRunning)
                reason = 'no_running_impl';
            capability.push({
                type: t,
                ready: false,
                reason,
            });
        }
        logger_1.default.debug({ capability }, 'Built capability_by_type');
        return capability;
    }
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        // 清理防抖定时器
        if (this.heartbeatDebounceTimer) {
            clearTimeout(this.heartbeatDebounceTimer);
            this.heartbeatDebounceTimer = null;
        }
    }
    /**
     * 触发立即心跳（带防抖机制）
     * 避免在短时间内多次触发导致心跳过于频繁
     */
    triggerImmediateHeartbeat() {
        // 如果已有待发送的立即心跳，取消它
        if (this.heartbeatDebounceTimer) {
            clearTimeout(this.heartbeatDebounceTimer);
        }
        // 设置新的防抖定时器
        this.heartbeatDebounceTimer = setTimeout(async () => {
            this.heartbeatDebounceTimer = null;
            if (this.ws && this.ws.readyState === ws_1.default.OPEN && this.nodeId) {
                logger_1.default.debug({}, 'Triggering immediate heartbeat due to service state change');
                await this.sendHeartbeatOnce();
            }
        }, this.HEARTBEAT_DEBOUNCE_MS);
    }
    async getSystemResources() {
        try {
            const [cpu, mem] = await Promise.all([
                si.currentLoad(),
                si.mem(),
            ]);
            // TODO: 获取 GPU 使用率（需要额外库，如 nvidia-ml-py）
            return {
                cpu: cpu.currentLoad || 0,
                gpu: null,
                gpuMem: null,
                memory: (mem.used / mem.total) * 100,
            };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get system resources');
            return { cpu: 0, gpu: null, gpuMem: null, memory: 0 };
        }
    }
    /**
     * 检查服务是否正在运行
     * 根据 service_id 映射到对应的服务管理器并检查运行状态
     */
    isServiceRunning(serviceId) {
        try {
            // 服务 ID 到服务管理器的映射
            if (serviceId === 'node-inference') {
                // node-inference 通过 RustServiceManager 管理
                if (this.rustServiceManager && typeof this.rustServiceManager.getStatus === 'function') {
                    const status = this.rustServiceManager.getStatus();
                    return status?.running === true;
                }
            }
            else if (serviceId === 'nmt-m2m100') {
                // nmt-m2m100 通过 PythonServiceManager 管理（服务名是 'nmt'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('nmt');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'piper-tts') {
                // piper-tts 通过 PythonServiceManager 管理（服务名是 'tts'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('tts');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'your-tts') {
                // your-tts 通过 PythonServiceManager 管理（服务名是 'yourtts'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('yourtts');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'speaker-embedding') {
                // speaker-embedding 通过 PythonServiceManager 管理（服务名是 'speaker_embedding'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('speaker_embedding');
                    return status?.running === true;
                }
            }
            else if (serviceId === 'faster-whisper-vad') {
                // faster-whisper-vad 通过 PythonServiceManager 管理（服务名是 'faster_whisper_vad'）
                if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
                    const status = this.pythonServiceManager.getServiceStatus('faster_whisper_vad');
                    return status?.running === true;
                }
            }
            // 未知的服务 ID 或服务管理器不可用，返回 false
            return false;
        }
        catch (error) {
            logger_1.default.error({ error, serviceId }, 'Failed to check service running status');
            return false;
        }
    }
    async handleMessage(data) {
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'node_register_ack': {
                    const ack = message;
                    this.nodeId = ack.node_id;
                    logger_1.default.info({ nodeId: this.nodeId }, 'Node registered successfully');
                    // 立刻补发一次心跳，把 installed_services/capability_state 尽快同步到 Scheduler
                    this.sendHeartbeatOnce().catch((error) => {
                        logger_1.default.warn({ error }, 'Failed to send immediate heartbeat after node_register_ack');
                    });
                    break;
                }
                case 'job_assign': {
                    const job = message;
                    await this.handleJob(job);
                    break;
                }
                case 'job_cancel': {
                    const cancel = message;
                    const ok = this.inferenceService.cancelJob(cancel.job_id);
                    logger_1.default.info({ jobId: cancel.job_id, traceId: cancel.trace_id, reason: cancel.reason, ok }, 'Received job_cancel from scheduler');
                    break;
                }
                case 'pairing_code':
                    // 配对码已生成，通过 IPC 通知渲染进程
                    break;
                default:
                    logger_1.default.warn({ messageType: message.type }, 'Unknown message type');
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to handle message');
        }
    }
    async handleJob(job) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId) {
            logger_1.default.warn({ jobId: job.job_id, wsState: this.ws?.readyState, nodeId: this.nodeId }, 'Cannot handle job: WebSocket not ready');
            return;
        }
        const startTime = Date.now();
        logger_1.default.info({ jobId: job.job_id, traceId: job.trace_id, sessionId: job.session_id }, 'Received job_assign, starting processing');
        try {
            // 根据 features 启动所需的服务
            if (job.features?.speaker_identification && this.pythonServiceManager) {
                try {
                    await this.pythonServiceManager.startService('speaker_embedding');
                    logger_1.default.info({ jobId: job.job_id }, 'Started speaker_embedding service for speaker_identification feature');
                }
                catch (error) {
                    logger_1.default.warn({ error, jobId: job.job_id }, 'Failed to start speaker_embedding service, continuing without it');
                }
            }
            // 如果启用了流式 ASR，设置部分结果回调
            const partialCallback = job.enable_streaming_asr ? (partial) => {
                // 发送 ASR 部分结果到调度服务器
                // 对齐协议规范：asr_partial 消息格式（从节点发送到调度服务器，需要包含 node_id）
                if (this.ws && this.ws.readyState === ws_1.default.OPEN && this.nodeId) {
                    const partialMessage = {
                        type: 'asr_partial',
                        node_id: this.nodeId,
                        session_id: job.session_id,
                        utterance_index: job.utterance_index,
                        job_id: job.job_id,
                        text: partial.text,
                        is_final: partial.is_final,
                        trace_id: job.trace_id, // Added: propagate trace_id
                    };
                    this.ws.send(JSON.stringify(partialMessage));
                }
            } : undefined;
            // 调用推理服务处理任务
            logger_1.default.debug({ jobId: job.job_id }, 'Calling inferenceService.processJob');
            const result = await this.inferenceService.processJob(job, partialCallback);
            // 检查ASR结果是否为空
            const asrTextTrimmed = (result.text_asr || '').trim();
            const isEmpty = !asrTextTrimmed || asrTextTrimmed.length === 0;
            if (isEmpty) {
                logger_1.default.warn({ jobId: job.job_id, traceId: job.trace_id }, 'ASR result is empty (silence detected), sending empty job_result for job_id/trace_id verification');
            }
            else {
                logger_1.default.info({ jobId: job.job_id, textAsr: result.text_asr?.substring(0, 50), textTranslated: result.text_translated?.substring(0, 50) }, 'Job processing completed successfully');
            }
            // 对齐协议规范：job_result 消息格式
            const response = {
                type: 'job_result',
                job_id: job.job_id,
                attempt_id: job.attempt_id,
                node_id: this.nodeId,
                session_id: job.session_id,
                utterance_index: job.utterance_index,
                success: true,
                text_asr: result.text_asr,
                text_translated: result.text_translated,
                tts_audio: result.tts_audio,
                tts_format: result.tts_format || 'pcm16',
                extra: result.extra,
                processing_time_ms: Date.now() - startTime,
                trace_id: job.trace_id, // Added: propagate trace_id
                // OBS-2: 透传 ASR 质量信息
                asr_quality_level: result.asr_quality_level,
                reason_codes: result.reason_codes,
                quality_score: result.quality_score,
                rerun_count: result.rerun_count,
                segments_meta: result.segments_meta,
            };
            logger_1.default.info({ jobId: job.job_id, responseLength: JSON.stringify(response).length }, 'Sending job_result to scheduler');
            this.ws.send(JSON.stringify(response));
            logger_1.default.info({ jobId: job.job_id, processingTimeMs: Date.now() - startTime }, 'Job result sent successfully');
        }
        catch (error) {
            logger_1.default.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Failed to process job');
            // 检查是否是 ModelNotAvailableError
            if (error instanceof model_manager_1.ModelNotAvailableError) {
                // 发送 MODEL_NOT_AVAILABLE 错误给调度服务器
                // 注意：根据新架构，使用 service_id 而不是 model_id
                const errorResponse = {
                    type: 'job_result',
                    job_id: job.job_id,
                    attempt_id: job.attempt_id,
                    node_id: this.nodeId,
                    session_id: job.session_id,
                    utterance_index: job.utterance_index,
                    success: false,
                    processing_time_ms: Date.now() - startTime,
                    error: {
                        code: 'MODEL_NOT_AVAILABLE',
                        message: `Service ${error.modelId}@${error.version} is not available: ${error.reason}`,
                        details: {
                            service_id: error.modelId,
                            service_version: error.version,
                            reason: error.reason,
                        },
                    },
                    trace_id: job.trace_id, // Added: propagate trace_id
                };
                this.ws.send(JSON.stringify(errorResponse));
                return;
            }
            // 其他错误
            const errorResponse = {
                type: 'job_result',
                job_id: job.job_id,
                attempt_id: job.attempt_id,
                node_id: this.nodeId,
                session_id: job.session_id,
                utterance_index: job.utterance_index,
                success: false,
                processing_time_ms: Date.now() - startTime,
                error: {
                    code: 'PROCESSING_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                },
                trace_id: job.trace_id, // Added: propagate trace_id
            };
            this.ws.send(JSON.stringify(errorResponse));
        }
    }
    getStatus() {
        return {
            online: this.ws?.readyState === ws_1.default.OPEN,
            nodeId: this.nodeId,
            connected: this.ws?.readyState === ws_1.default.OPEN || false,
            lastHeartbeat: new Date(),
        };
    }
    async generatePairingCode() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return null;
        return new Promise((resolve) => {
            const handler = (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'pairing_code') {
                        this.ws?.off('message', handler);
                        resolve(message.code);
                    }
                }
                catch (error) {
                    // 忽略解析错误
                }
            };
            this.ws?.on('message', handler);
            this.ws?.send(JSON.stringify({ type: 'request_pairing_code' }));
            // 超时处理
            setTimeout(() => {
                this.ws?.off('message', handler);
                resolve(null);
            }, 5000);
        });
    }
}
exports.NodeAgent = NodeAgent;
