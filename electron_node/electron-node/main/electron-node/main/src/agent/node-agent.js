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
const model_manager_1 = require("../model-manager/model-manager");
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
class NodeAgent {
    constructor(inferenceService, modelManager, serviceRegistryManager) {
        this.ws = null;
        this.nodeId = null;
        this.heartbeatInterval = null;
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
                logger_1.default.info({}, 'Connected to scheduler server');
                this.registerNode();
                this.startHeartbeat();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });
            this.ws.on('error', (error) => {
                logger_1.default.error({ error }, 'WebSocket error');
            });
            this.ws.on('close', () => {
                logger_1.default.info({}, 'Connection to scheduler server closed');
                this.stopHeartbeat();
                // 尝试重连
                setTimeout(() => this.start(), 5000);
            });
            // 监听模型状态变化，实时更新 capability_state
            if (this.modelManager && typeof this.modelManager.on === 'function') {
                this.modelManager.on('capability-state-changed', () => {
                    // 状态变化时，在下次心跳时更新 capability_state
                    // 这里不立即发送，因为心跳会定期发送最新的状态
                    logger_1.default.debug({}, 'Model state changed, will update capability_state on next heartbeat');
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
    }
    async registerNode() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        try {
            // 获取硬件信息
            const hardware = await this.getHardwareInfo();
            // 获取已安装的模型
            const installedModels = await this.inferenceService.getInstalledModels();
            // 获取已安装的服务包（Phase1 严格模式：Scheduler 会用 service_id 做核心链路过滤）
            const installedServices = await this.getInstalledServices();
            // 获取 capability_state（可选；为空时不要发送，避免覆盖 Scheduler 端的推断能力图）
            const capabilityState = await this.getCapabilityState();
            // Phase 1：把“服务包维度”的可用性也并入 capability_state（key=service_id）
            // 这样 Scheduler 的 required(service_id) 可以直接通过 capability_state 判定 Ready
            for (const s of installedServices) {
                if (!capabilityState[s.service_id]) {
                    capabilityState[s.service_id] = 'ready';
                }
            }
            // 获取支持的功能
            const featuresSupported = this.inferenceService.getFeaturesSupported();
            // 对齐协议规范：node_register 消息格式
            const message = {
                type: 'node_register',
                node_id: this.nodeId || null, // 首次连接时为 null
                version: '1.0.0', // TODO: 从 package.json 读取
                platform: this.getPlatform(),
                hardware: hardware,
                installed_models: installedModels,
                installed_services: installedServices.length > 0 ? installedServices : undefined,
                features_supported: featuresSupported,
                accept_public_jobs: true, // TODO: 从配置读取
                capability_state: Object.keys(capabilityState).length > 0 ? capabilityState : undefined,
            };
            this.ws.send(JSON.stringify(message));
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to register node');
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
        // 获取已安装的服务包
        const installedServices = await this.getInstalledServices();
        // 获取 capability_state（节点模型能力图）
        const capabilityState = await this.getCapabilityState();
        // Phase 1：把服务包 service_id 合并进 capability_state（至少标记为 ready）
        for (const s of installedServices) {
            if (!capabilityState[s.service_id]) {
                capabilityState[s.service_id] = 'ready';
            }
        }
        // 记录 capability_state 信息
        const capabilityStateCount = Object.keys(capabilityState).length;
        const readyCount = Object.values(capabilityState).filter(s => s === 'ready').length;
        logger_1.default.info({
            capabilityStateCount,
            readyCount,
            installedModelsCount: installedModels.length,
            installedServicesCount: installedServices.length,
            installedServices: installedServices.map(s => s.service_id)
        }, 'Sending heartbeat with capability_state and installed_services');
        // 对齐协议规范：node_heartbeat 消息格式
        const message = {
            type: 'node_heartbeat',
            node_id: this.nodeId,
            timestamp: Date.now(),
            resource_usage: {
                cpu_percent: resources.cpu,
                gpu_percent: resources.gpu || undefined,
                gpu_mem_percent: resources.gpuMem || undefined,
                mem_percent: resources.memory,
                running_jobs: this.inferenceService.getCurrentJobCount(),
            },
            installed_models: installedModels.length > 0 ? installedModels : undefined,
            installed_services: installedServices.length > 0 ? installedServices : undefined,
            // 为空时不要发送，避免把 Scheduler 端已有的 capability_state 覆盖成空
            capability_state: capabilityStateCount > 0 ? capabilityState : undefined,
        };
        this.ws.send(JSON.stringify(message));
        if (capabilityStateCount === 0) {
            logger_1.default.warn({
                modelHubUrl: this.modelManager ? 'configured' : 'not configured'
            }, 'Heartbeat sent with empty capability_state - this may cause health check failures');
        }
    }
    /**
     * 获取已安装的服务包列表
     */
    async getInstalledServices() {
        if (!this.serviceRegistryManager) {
            logger_1.default.warn({}, 'ServiceRegistryManager not available for heartbeat');
            return [];
        }
        try {
            // 确保注册表已加载
            await this.serviceRegistryManager.loadRegistry();
            const installed = this.serviceRegistryManager.listInstalled();
            logger_1.default.debug({
                installedCount: installed.length,
                installed: installed.map((s) => ({
                    service_id: s.service_id,
                    version: s.version,
                    platform: s.platform
                }))
            }, 'Getting installed services for heartbeat');
            // 转换为协议格式
            return installed.map((service) => ({
                service_id: service.service_id,
                version: service.version,
                platform: service.platform,
            }));
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get installed services for heartbeat');
            return [];
        }
    }
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
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
     * 获取节点当前的 capability_state（模型能力图）
     * 来自 ModelManager.getCapabilityState()
     */
    async getCapabilityState() {
        if (!this.modelManager || typeof this.modelManager.getCapabilityState !== 'function') {
            logger_1.default.warn('ModelManager not available or getCapabilityState method not found');
            return {};
        }
        try {
            const state = await this.modelManager.getCapabilityState();
            // 确保始终返回一个对象
            const result = state || {};
            logger_1.default.debug({
                capabilityStateCount: Object.keys(result).length,
                readyCount: Object.values(result).filter(s => s === 'ready').length
            }, 'Retrieved capability_state from ModelManager');
            return result;
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get capability_state from ModelManager');
            return {};
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
                    const ok = typeof this.inferenceService.cancelJob === 'function'
                        ? this.inferenceService.cancelJob(cancel.job_id)
                        : false;
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
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId)
            return;
        const startTime = Date.now();
        try {
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
            const result = await this.inferenceService.processJob(job, partialCallback);
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
            };
            this.ws.send(JSON.stringify(response));
        }
        catch (error) {
            logger_1.default.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Failed to process job');
            // 检查是否是 ModelNotAvailableError
            if (error instanceof model_manager_1.ModelNotAvailableError) {
                // 发送 MODEL_NOT_AVAILABLE 错误给调度服务器
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
                        message: `Model ${error.modelId}@${error.version} is not available: ${error.reason}`,
                        details: {
                            model_id: error.modelId,
                            version: error.version,
                            // 兼容“模型=服务包”的命名：提供 service_id/service_version 作为别名字段
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
