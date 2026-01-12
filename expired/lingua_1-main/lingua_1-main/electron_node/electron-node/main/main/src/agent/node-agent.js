"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function () { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function (o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function (o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function (o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function (o) {
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
class NodeAgent {
    constructor(inferenceService) {
        this.ws = null;
        this.nodeId = null;
        this.heartbeatInterval = null;
        this.schedulerUrl = process.env.SCHEDULER_URL || 'ws://localhost:5010/ws/node';
        this.inferenceService = inferenceService;
    }
    async start() {
        try {
            this.ws = new ws_1.default(this.schedulerUrl);
            this.ws.on('open', () => {
                console.log('已连接到调度服务器');
                this.registerNode();
                this.startHeartbeat();
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data.toString());
            });
            this.ws.on('error', (error) => {
                console.error('WebSocket 错误:', error);
            });
            this.ws.on('close', () => {
                console.log('与调度服务器的连接已关闭');
                this.stopHeartbeat();
                // 尝试重连
                setTimeout(() => this.start(), 5000);
            });
        }
        catch (error) {
            console.error('启动 Node Agent 失败:', error);
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
            const installedModels = this.inferenceService.getInstalledModels();
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
            console.error('注册节点失败:', error);
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
            console.error('获取硬件信息失败:', error);
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
            const installedModels = this.inferenceService.getInstalledModels();
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
            console.error('获取系统资源失败:', error);
            return { cpu: 0, gpu: null, gpuMem: null, memory: 0 };
        }
    }
    async handleMessage(data) {
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'node_register_ack': {
                    const ack = message;
                    this.nodeId = ack.node_id;
                    console.log('节点注册成功:', this.nodeId);
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
                    console.log('收到 Scheduler job_cancel:', cancel.job_id, cancel.trace_id, cancel.reason, ok);
                    break;
                }
                case 'pairing_code':
                    // 配对码已生成，通过 IPC 通知渲染进程
                    break;
                default:
                    console.warn('未知消息类型:', message.type);
            }
        }
        catch (error) {
            console.error('处理消息失败:', error);
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
                if (this.ws && this.ws.readyState === ws_1.default.OPEN && this.nodeId) {
                    const partialMessage = {
                        type: 'asr_partial',
                        node_id: this.nodeId,
                        session_id: job.session_id,
                        utterance_index: job.utterance_index,
                        job_id: job.job_id,
                        text: partial.text,
                        is_final: partial.is_final,
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
            };
            this.ws.send(JSON.stringify(response));
        }
        catch (error) {
            console.error('处理任务失败:', error);
            // 对齐协议规范：job_result 错误响应格式
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
