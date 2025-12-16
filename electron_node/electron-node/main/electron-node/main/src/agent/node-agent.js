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
const logger_1 = __importDefault(require("../logger"));
class NodeAgent {
    constructor(inferenceService, modelManager) {
        this.ws = null;
        this.nodeId = null;
        this.heartbeatInterval = null;
        this.schedulerUrl = process.env.SCHEDULER_URL || 'ws://localhost:5010/ws/node';
        this.inferenceService = inferenceService;
        // 通过参数传入或从 inferenceService 获取 modelManager
        this.modelManager = modelManager || inferenceService.modelManager;
    }
    async start() {
        try {
            this.ws = new ws_1.default(this.schedulerUrl);
            this.ws.on('open', () => {
                logger_1.default.info({}, '已连接到调度服务器');
                this.registerNode();
                this.startHeartbeat();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });
            this.ws.on('error', (error) => {
                logger_1.default.error({ error }, 'WebSocket 错误');
            });
            this.ws.on('close', () => {
                logger_1.default.info({}, '与调度服务器的连接已关闭');
                this.stopHeartbeat();
                // 尝试重连
                setTimeout(() => this.start(), 5000);
            });
            // 监听模型状态变化，实时更新 capability_state
            if (this.modelManager && typeof this.modelManager.on === 'function') {
                this.modelManager.on('capability-state-changed', () => {
                    // 状态变化时，在下次心跳时更新 capability_state
                    // 这里不立即发送，因为心跳会定期发送最新的状态
                    logger_1.default.debug({}, '模型状态已变化，将在下次心跳时更新 capability_state');
                });
            }
        }
        catch (error) {
            logger_1.default.error({ error }, '启动 Node Agent 失败');
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
                features_supported: featuresSupported,
                accept_public_jobs: true, // TODO: 从配置读取
            };
            this.ws.send(JSON.stringify(message));
        }
        catch (error) {
            logger_1.default.error({ error }, '注册节点失败');
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
            // TODO: 获取 GPU 信息（需要额外库，如 nvidia-ml-py 或 systeminformation 的图形卡信息）
            const gpus = [];
            return {
                cpu_cores: cpu.cores || os.cpus().length,
                memory_gb: Math.round(mem.total / (1024 * 1024 * 1024)),
                gpus: gpus.length > 0 ? gpus : undefined,
            };
        }
        catch (error) {
            logger_1.default.error({ error }, '获取硬件信息失败');
            return {
                cpu_cores: os.cpus().length,
                memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
            };
        }
    }
    startHeartbeat() {
        this.heartbeatInterval = setInterval(async () => {
            if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId)
                return;
            const resources = await this.getSystemResources();
            const installedModels = await this.inferenceService.getInstalledModels();
            // 获取 capability_state（节点模型能力图）
            const capabilityState = await this.getCapabilityState();
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
                capability_state: capabilityState,
            };
            this.ws.send(JSON.stringify(message));
        }, 15000); // 每15秒发送一次心跳
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
            logger_1.default.error({ error }, '获取系统资源失败');
            return { cpu: 0, gpu: null, gpuMem: null, memory: 0 };
        }
    }
    /**
     * 获取节点当前的 capability_state（模型能力图）
     * 来自 ModelManager.getCapabilityState()
     */
    async getCapabilityState() {
        if (!this.modelManager || typeof this.modelManager.getCapabilityState !== 'function') {
            return {};
        }
        try {
            const state = await this.modelManager.getCapabilityState();
            // 确保始终返回一个对象
            return state || {};
        }
        catch (error) {
            logger_1.default.error({ error }, '获取 capability_state 失败');
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
                    logger_1.default.info({ nodeId: this.nodeId }, '节点注册成功');
                    break;
                }
                case 'job_assign': {
                    const job = message;
                    await this.handleJob(job);
                    break;
                }
                case 'pairing_code':
                    // 配对码已生成，通过 IPC 通知渲染进程
                    break;
                default:
                    logger_1.default.warn({ messageType: message.type }, '未知消息类型');
            }
        }
        catch (error) {
            logger_1.default.error({ error }, '处理消息失败');
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
            logger_1.default.error({ error, jobId: job.job_id, traceId: job.trace_id }, '处理任务失败');
            // 检查是否是 ModelNotAvailableError
            if (error instanceof model_manager_1.ModelNotAvailableError) {
                // 发送 MODEL_NOT_AVAILABLE 错误给调度服务器
                const errorResponse = {
                    type: 'job_result',
                    job_id: job.job_id,
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
