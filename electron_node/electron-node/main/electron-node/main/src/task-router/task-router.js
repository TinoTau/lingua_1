"use strict";
// 任务路由器 - 根据任务类型路由到对应的服务
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouter = void 0;
const logger_1 = __importDefault(require("../logger"));
const messages_1 = require("../../../../shared/protocols/messages");
const node_config_1 = require("../node-config");
const task_router_asr_1 = require("./task-router-asr");
const task_router_nmt_1 = require("./task-router-nmt");
const task_router_tts_1 = require("./task-router-tts");
const task_router_tone_1 = require("./task-router-tone");
const task_router_semantic_repair_1 = require("./task-router-semantic-repair");
const task_router_service_manager_1 = require("./task-router-service-manager");
const task_router_service_selector_1 = require("./task-router-service-selector");
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
        // best-effort cancel 支持：HTTP AbortController（用于中断 HTTP 请求）
        this.jobAbortControllers = new Map();
        // OBS-1: 处理效率观测指标统计（按心跳周期，按服务ID分组）
        // 每个服务ID对应一个处理效率列表（用于NMT、TTS等非ASR服务）
        this.currentCycleServiceEfficiencies = new Map(); // serviceId -> efficiency[]
        // 初始化服务管理器和选择器
        this.serviceManager = new task_router_service_manager_1.TaskRouterServiceManager(this.pythonServiceManager, this.rustServiceManager, this.serviceRegistryManager);
        this.serviceSelector = new task_router_service_selector_1.TaskRouterServiceSelector();
        // 初始化SEMANTIC类型的端点列表（用于语义修复服务）
        this.serviceEndpoints.set(messages_1.ServiceType.SEMANTIC, []);
        // 初始化路由处理器
        const updateConnections = (serviceId, delta) => {
            const connections = this.serviceConnections.get(serviceId) || 0;
            this.serviceConnections.set(serviceId, Math.max(0, connections + delta));
        };
        this.asrHandler = new task_router_asr_1.TaskRouterASRHandler((serviceType) => this.selectServiceEndpoint(serviceType), (serviceId) => this.startGpuTrackingForService(serviceId), this.serviceConnections, updateConnections);
        this.nmtHandler = new task_router_nmt_1.TaskRouterNMTHandler((serviceType) => this.selectServiceEndpoint(serviceType), (serviceId) => this.startGpuTrackingForService(serviceId), this.serviceConnections, updateConnections, (serviceId, efficiency) => this.recordServiceEfficiency(serviceId, efficiency));
        this.ttsHandler = new task_router_tts_1.TaskRouterTTSHandler((serviceType) => this.selectServiceEndpoint(serviceType), (serviceId) => this.startGpuTrackingForService(serviceId), this.serviceConnections, updateConnections, (serviceId, efficiency) => this.recordServiceEfficiency(serviceId, efficiency));
        this.toneHandler = new task_router_tone_1.TaskRouterTONEHandler((serviceType) => this.selectServiceEndpoint(serviceType), this.serviceConnections, updateConnections);
        // P0-5: 语义修复服务并发限制（默认2）
        const semanticRepairMaxConcurrency = 2;
        // P2-1: 读取缓存配置
        const config = (0, node_config_1.loadNodeConfig)();
        const cacheConfig = config.features?.semanticRepair?.cache;
        // P2-2: 读取模型完整性检查配置
        const enableModelIntegrityCheck = config.features?.semanticRepair?.modelIntegrityCheck?.enabled ?? false;
        // P0-1: 传递服务运行状态检查回调
        // P2-2: 传递获取服务包路径的回调
        this.semanticRepairHandler = new task_router_semantic_repair_1.TaskRouterSemanticRepairHandler((serviceType) => this.selectServiceEndpoint(serviceType), (serviceId) => this.startGpuTrackingForService(serviceId), this.serviceConnections, updateConnections, semanticRepairMaxConcurrency, (serviceId) => {
            // 检查语义修复服务是否运行（通过SEMANTIC类型的端点列表）
            const semanticEndpoints = this.serviceEndpoints.get(messages_1.ServiceType.SEMANTIC) || [];
            const endpoint = semanticEndpoints.find(e => e.serviceId === serviceId);
            return endpoint?.status === 'running' || false;
        }, cacheConfig, // P2-1: 传递缓存配置
        enableModelIntegrityCheck, // P2-2: 是否启用模型完整性检查
        (serviceId) => {
            // P2-2: 从服务注册表获取服务包路径
            if (!this.serviceRegistryManager) {
                return null;
            }
            const current = this.serviceRegistryManager.getCurrent(serviceId);
            return current?.install_path || null;
        }, (serviceId) => {
            // 直接根据服务ID查找端点（用于语义修复服务）
            const semanticEndpoints = this.serviceEndpoints.get(messages_1.ServiceType.SEMANTIC) || [];
            return semanticEndpoints.find(e => e.serviceId === serviceId && e.status === 'running') || null;
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
        this.serviceEndpoints = await this.serviceManager.refreshServiceEndpoints();
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
        // 合并所有 handler 的指标
        const asrMetrics = this.asrHandler.getProcessingMetrics();
        const nmtMetrics = this.nmtHandler.getProcessingMetrics();
        const ttsMetrics = this.ttsHandler.getProcessingMetrics();
        const result = { ...asrMetrics, ...nmtMetrics, ...ttsMetrics };
        // 计算其他服务的平均处理效率（如果有）
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
        this.nmtHandler.resetCycleMetrics();
        this.ttsHandler.resetCycleMetrics();
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
                // 创建临时映射，只包含运行中的端点
                const runningEndpointsMap = new Map();
                runningEndpointsMap.set(serviceType, runningEndpoints);
                return this.serviceSelector.selectServiceEndpoint(serviceType, runningEndpointsMap, this.selectionStrategy);
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
        return await this.nmtHandler.routeNMTTask(task);
    }
    /**
     * 路由 TTS 任务
     */
    async routeTTSTask(task) {
        return await this.ttsHandler.routeTTSTask(task);
    }
    /**
     * 路由 TONE 任务
     */
    async routeTONETask(task) {
        return await this.toneHandler.routeTONETask(task);
    }
    /**
     * 路由语义修复任务
     */
    async routeSemanticRepairTask(task) {
        return await this.semanticRepairHandler.routeSemanticRepairTask(task);
    }
    /**
     * 检查语义修复服务健康状态
     */
    async checkSemanticRepairServiceHealth(serviceId, baseUrl) {
        return await this.semanticRepairHandler.checkServiceHealth(serviceId, baseUrl);
    }
    /**
     * 设置服务选择策略
     */
    setSelectionStrategy(strategy) {
        this.selectionStrategy = strategy;
    }
}
exports.TaskRouter = TaskRouter;
