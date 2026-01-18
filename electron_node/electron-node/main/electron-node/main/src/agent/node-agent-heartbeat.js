"use strict";
/**
 * Node Agent Heartbeat Handler
 * 处理心跳相关的逻辑
 */
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
exports.HeartbeatHandler = void 0;
const ws_1 = __importDefault(require("ws"));
const si = __importStar(require("systeminformation"));
const logger_1 = __importDefault(require("../logger"));
const node_agent_language_capability_1 = require("./node-agent-language-capability");
const gpu_arbiter_factory_1 = require("../gpu-arbiter/gpu-arbiter-factory");
class HeartbeatHandler {
    constructor(ws, nodeId, inferenceService, nodeConfig, getInstalledServices, getCapabilityByType, shouldCollectRerunMetrics, shouldCollectASRMetrics) {
        this.ws = ws;
        this.nodeId = nodeId;
        this.inferenceService = inferenceService;
        this.nodeConfig = nodeConfig;
        this.getInstalledServices = getInstalledServices;
        this.getCapabilityByType = getCapabilityByType;
        this.shouldCollectRerunMetrics = shouldCollectRerunMetrics;
        this.shouldCollectASRMetrics = shouldCollectASRMetrics;
        this.heartbeatInterval = null;
        this.heartbeatDebounceTimer = null;
        this.HEARTBEAT_DEBOUNCE_MS = 2000; // 防抖延迟：2秒内最多触发一次立即心跳
        this.languageDetector = new node_agent_language_capability_1.LanguageCapabilityDetector();
    }
    /**
     * 启动心跳
     */
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
     * 停止心跳
     */
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
     * 立即发送一次心跳（用于 node_register_ack 后立刻同步 installed_services/capability_state）
     * 避免等待 15s interval 导致调度端短时间内认为"无可用节点/无服务包"。
     */
    async sendHeartbeatOnce() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN || !this.nodeId)
            return;
        const resources = await this.getSystemResources();
        const installedModels = await this.inferenceService.getInstalledModels();
        const installedServicesAll = await this.getInstalledServices();
        const capabilityByType = await this.getCapabilityByType(installedServicesAll);
        // 记录资源使用情况，特别是GPU使用率
        const gpuUsage = resources.gpu ?? 0.0;
        if (gpuUsage > 85.0) {
            logger_1.default.warn({
                nodeId: this.nodeId,
                gpuUsage,
                cpuUsage: resources.cpu,
                memoryUsage: resources.memory,
                gpuMemUsage: resources.gpuMem,
                note: 'GPU usage exceeds 85% threshold',
            }, 'High GPU usage detected in heartbeat');
        }
        // 降低心跳日志级别为 debug，减少终端输出
        logger_1.default.debug({
            nodeId: this.nodeId,
            installedModelsCount: installedModels.length,
            installedServicesCount: installedServicesAll.length,
            capabilityByTypeCount: capabilityByType.length,
            capabilityByType,
            installedServices: installedServicesAll.map(s => `${s.service_id}:${s.type}:${s.status}`),
            resourceUsage: {
                cpu: resources.cpu,
                gpu: gpuUsage,
                gpuMem: resources.gpuMem,
                memory: resources.memory,
            },
        }, 'Sending heartbeat with type-level capability');
        // 获取GPU队列信息（用于通知调度服务器节点忙）
        const gpuArbiter = (0, gpu_arbiter_factory_1.getGpuArbiter)();
        let gpuQueueLength = 0;
        if (gpuArbiter) {
            const snapshot = gpuArbiter.snapshot('gpu:0');
            if (snapshot) {
                gpuQueueLength = snapshot.queueLength;
                // 如果GPU队列有任务等待，记录警告日志
                if (gpuQueueLength > 0) {
                    logger_1.default.warn({
                        nodeId: this.nodeId,
                        gpuQueueLength,
                        gpuUsage: snapshot.gpuUsage,
                        gpuAdmissionState: snapshot.gpuAdmissionState,
                        note: 'GPU queue has pending tasks, scheduler should stop assigning new tasks',
                    }, 'GPU queue has pending tasks - scheduler should be notified to stop assigning new tasks');
                }
            }
        }
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
                // GPU队列长度：用于通知调度服务器节点忙，应该停止分配新任务
                gpu_queue_length: gpuQueueLength > 0 ? gpuQueueLength : undefined,
            },
            installed_models: installedModels.length > 0 ? installedModels : undefined,
            installed_services: installedServicesAll,
            capability_by_type: capabilityByType,
            language_capabilities: await this.languageDetector.detectLanguageCapabilities(installedServicesAll, installedModels, capabilityByType),
        };
        // 记录语言对列表上报信息（用于调试）
        if (message.language_capabilities?.supported_language_pairs) {
            const pairs = message.language_capabilities.supported_language_pairs;
            logger_1.default.info({
                nodeId: this.nodeId,
                pair_count: pairs.length,
                pairs: pairs.map(p => `${p.src}-${p.tgt}`).join(', ')
            }, '上报语言对列表到调度服务器');
        }
        else {
            logger_1.default.warn({
                nodeId: this.nodeId
            }, '未生成语言对列表，将使用向后兼容模式');
        }
        // 方案1+方案2：基于配置和服务状态的动态指标收集（支持热插拔）
        const metricsConfig = this.nodeConfig.metrics;
        const metricsEnabled = metricsConfig?.enabled !== false; // 默认启用（向后兼容）
        if (metricsEnabled) {
            // 检查 Rerun 指标（Gate-B）
            const rerunMetricsEnabled = metricsConfig?.metrics?.rerun !== false; // 默认启用
            if (rerunMetricsEnabled && this.shouldCollectRerunMetrics(installedServicesAll)) {
                const rerunMetrics = this.inferenceService.getRerunMetrics?.();
                if (rerunMetrics) {
                    message.rerun_metrics = rerunMetrics;
                }
            }
            // 检查处理效率指标（OBS-1）
            const asrMetricsEnabled = metricsConfig?.metrics?.asr !== false; // 默认启用
            if (asrMetricsEnabled && this.shouldCollectASRMetrics(installedServicesAll)) {
                // 获取按服务ID分组的处理效率指标
                // 注意：在发送心跳前获取，因为心跳发送后会重置数据
                const serviceEfficiencies = this.inferenceService.getProcessingMetrics?.();
                if (serviceEfficiencies && Object.keys(serviceEfficiencies).length > 0) {
                    message.processing_metrics = {
                        serviceEfficiencies,
                    };
                }
                // 注意：asr_metrics 已移除，使用 processing_metrics 代替
            }
        }
        const messageStr = JSON.stringify(message);
        logger_1.default.debug({ message: messageStr }, 'Heartbeat message content');
        this.ws.send(messageStr);
        // OBS-1: 心跳发送后重置周期数据，为下一个周期做准备
        // 注意：在消息发送之后重置，确保 UI 可以获取到当前周期的数据
        const asrMetricsEnabled = this.nodeConfig.metrics?.metrics?.asr !== false;
        if (asrMetricsEnabled && this.shouldCollectASRMetrics(installedServicesAll)) {
            this.inferenceService.resetProcessingMetrics?.();
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
    /**
     * 获取系统资源
     */
    async getSystemResources() {
        try {
            const { getGpuUsage } = await Promise.resolve().then(() => __importStar(require('../system-resources')));
            const [cpu, mem, gpuInfo] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                getGpuUsage(), // 获取 GPU 使用率
            ]);
            return {
                cpu: cpu.currentLoad || 0,
                gpu: gpuInfo?.usage ?? null,
                gpuMem: gpuInfo?.memory ?? null,
                memory: (mem.used / mem.total) * 100,
            };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get system resources');
            return { cpu: 0, gpu: null, gpuMem: null, memory: 0 };
        }
    }
    /**
     * 更新 WebSocket 和 nodeId（用于重连场景）
     */
    updateConnection(ws, nodeId) {
        this.ws = ws;
        this.nodeId = nodeId;
    }
}
exports.HeartbeatHandler = HeartbeatHandler;
