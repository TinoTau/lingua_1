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
const aggregator_middleware_1 = require("./aggregator-middleware");
const postprocess_coordinator_1 = require("./postprocess/postprocess-coordinator");
class NodeAgent {
    constructor(inferenceService, modelManager, serviceRegistryManager, rustServiceManager, pythonServiceManager) {
        this.ws = null;
        this.nodeId = null;
        this.heartbeatInterval = null;
        this.capabilityStateChangedHandler = null; // 保存监听器函数，用于清理
        this.heartbeatDebounceTimer = null; // 心跳防抖定时器
        this.HEARTBEAT_DEBOUNCE_MS = 2000; // 防抖延迟：2秒内最多触发一次立即心跳
        this.postProcessCoordinator = null; // PostProcess 协调器（新架构）
        // 防止重复处理同一个job（只保留最近的两个job_id，用于检测相邻重复）
        this.recentJobIds = [];
        // 优先从配置文件读取，其次从环境变量，最后使用默认值
        this.nodeConfig = (0, node_config_1.loadNodeConfig)();
        this.schedulerUrl =
            this.nodeConfig.scheduler?.url ||
                process.env.SCHEDULER_URL ||
                'ws://127.0.0.1:5010/ws/node';
        this.inferenceService = inferenceService;
        // 通过参数传入或从 inferenceService 获取 modelManager
        this.modelManager = modelManager || inferenceService.modelManager;
        this.serviceRegistryManager = serviceRegistryManager;
        this.rustServiceManager = rustServiceManager;
        this.pythonServiceManager = pythonServiceManager;
        // 初始化 Aggregator 中间件（默认启用）
        // 从 InferenceService 获取 TaskRouter（用于重新触发 NMT）
        const taskRouter = this.inferenceService.taskRouter;
        const aggregatorConfig = {
            enabled: true, // 可以通过配置控制
            mode: 'offline', // 默认 offline，可以根据 job 动态调整
            ttlMs: 5 * 60 * 1000, // 5 分钟 TTL
            maxSessions: 500, // 降低最大会话数（从 1000 降低到 500，减少内存占用）
            translationCacheSize: 200, // 翻译缓存大小：最多 200 条（提高缓存命中率）
            translationCacheTtlMs: 10 * 60 * 1000, // 翻译缓存过期时间：10 分钟（提高缓存命中率）
            enableAsyncRetranslation: true, // 异步重新翻译（默认启用，长文本使用异步处理）
            asyncRetranslationThreshold: 50, // 异步重新翻译阈值（文本长度，默认 50 字符）
            nmtRepairEnabled: true, // 启用 NMT Repair
            nmtRepairNumCandidates: 5, // 生成 5 个候选
            nmtRepairThreshold: 0.7, // 质量分数 < 0.7 时触发
        };
        this.aggregatorMiddleware = new aggregator_middleware_1.AggregatorMiddleware(aggregatorConfig, taskRouter);
        // 初始化 PostProcessCoordinator（新架构，通过 Feature Flag 控制）
        const enablePostProcessTranslation = this.nodeConfig.features?.enablePostProcessTranslation ?? true;
        if (enablePostProcessTranslation) {
            const aggregatorManager = this.aggregatorMiddleware.manager;
            const postProcessConfig = {
                enabled: true,
                translationConfig: {
                    translationCacheSize: aggregatorConfig.translationCacheSize,
                    translationCacheTtlMs: aggregatorConfig.translationCacheTtlMs,
                    enableAsyncRetranslation: aggregatorConfig.enableAsyncRetranslation,
                    asyncRetranslationThreshold: aggregatorConfig.asyncRetranslationThreshold,
                    nmtRepairEnabled: aggregatorConfig.nmtRepairEnabled,
                    nmtRepairNumCandidates: aggregatorConfig.nmtRepairNumCandidates,
                    nmtRepairThreshold: aggregatorConfig.nmtRepairThreshold,
                },
            };
            this.postProcessCoordinator = new postprocess_coordinator_1.PostProcessCoordinator(aggregatorManager, taskRouter, postProcessConfig);
            logger_1.default.info({}, 'PostProcessCoordinator initialized (new architecture)');
        }
        // S1: 将AggregatorManager传递给InferenceService（用于构建prompt）
        const aggregatorManager = this.aggregatorMiddleware.manager;
        if (aggregatorManager && this.inferenceService) {
            this.inferenceService.setAggregatorManager(aggregatorManager);
            logger_1.default.info({}, 'S1: AggregatorManager passed to InferenceService for prompt building');
        }
        // 将AggregatorMiddleware传递给InferenceService（用于在ASR之后、NMT之前进行文本聚合）
        if (this.aggregatorMiddleware && this.inferenceService) {
            this.inferenceService.setAggregatorMiddleware(this.aggregatorMiddleware);
            logger_1.default.info({}, 'AggregatorMiddleware passed to InferenceService for pre-NMT aggregation');
        }
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
        };
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
                // 向后兼容：保留 asr_metrics
                const asrMetrics = this.inferenceService.getASRMetrics?.();
                if (asrMetrics) {
                    message.asr_metrics = asrMetrics;
                }
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
     * 方案2：动态检测是否应该收集 Rerun 指标
     * 检查是否有 ASR 服务运行（Rerun 功能依赖 ASR）
     */
    shouldCollectRerunMetrics(installedServices) {
        // Rerun 功能需要 ASR 服务支持
        const hasASRService = installedServices.some(s => s.type === messages_1.ServiceType.ASR && s.status === 'running');
        return hasASRService;
    }
    /**
     * 方案2：动态检测是否应该收集 ASR 指标
     * 检查是否有 ASR 服务运行
     */
    shouldCollectASRMetrics(installedServices) {
        const hasASRService = installedServices.some(s => s.type === messages_1.ServiceType.ASR && s.status === 'running');
        return hasASRService;
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
        // 检查是否与最近处理的job_id重复（只检查相邻的两个，因为重复通常是明显的）
        if (this.recentJobIds.length > 0 && this.recentJobIds[this.recentJobIds.length - 1] === job.job_id) {
            logger_1.default.warn({
                jobId: job.job_id,
                traceId: job.trace_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                recentJobIds: this.recentJobIds,
            }, 'Skipping duplicate job_id (same as last processed job)');
            return;
        }
        // 更新最近处理的job_id列表（只保留最近2个）
        this.recentJobIds.push(job.job_id);
        if (this.recentJobIds.length > 2) {
            this.recentJobIds.shift(); // 移除最旧的
        }
        const startTime = Date.now();
        logger_1.default.info({
            jobId: job.job_id,
            traceId: job.trace_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
        }, 'Received job_assign, starting processing');
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
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                audioFormat: job.audio_format,
                audioLength: job.audio ? job.audio.length : 0,
            }, 'Processing job: received audio data');
            const result = await this.inferenceService.processJob(job, partialCallback);
            // 后处理（在发送结果前）
            // 优先使用 PostProcessCoordinator（新架构），否则使用 AggregatorMiddleware（旧架构）
            let finalResult = result;
            const enablePostProcessTranslation = this.nodeConfig.features?.enablePostProcessTranslation ?? true;
            if (enablePostProcessTranslation && this.postProcessCoordinator) {
                // 使用新架构：PostProcessCoordinator
                logger_1.default.debug({ jobId: job.job_id, sessionId: job.session_id }, 'Processing through PostProcessCoordinator (new architecture)');
                const postProcessResult = await this.postProcessCoordinator.process(job, result);
                // 统一处理 TTS Opus 编码（无论来自 Pipeline 还是 PostProcess）
                let ttsAudio = postProcessResult.ttsAudio || result.tts_audio || '';
                let ttsFormat = postProcessResult.ttsFormat || result.tts_format || 'opus';
                // 如果 TTS 音频是 WAV 格式，需要编码为 Opus（统一在 NodeAgent 层处理）
                if (ttsAudio && (ttsFormat === 'wav' || ttsFormat === 'pcm16')) {
                    try {
                        const { convertWavToOpus } = await Promise.resolve().then(() => __importStar(require('../utils/opus-codec')));
                        const wavBuffer = Buffer.from(ttsAudio, 'base64');
                        const opusData = await convertWavToOpus(wavBuffer);
                        ttsAudio = opusData.toString('base64');
                        ttsFormat = 'opus';
                        logger_1.default.info({
                            jobId: job.job_id,
                            sessionId: job.session_id,
                            utteranceIndex: job.utterance_index,
                            wavSize: wavBuffer.length,
                            opusSize: opusData.length,
                            compression: (wavBuffer.length / opusData.length).toFixed(2),
                        }, 'NodeAgent: TTS WAV audio encoded to Opus successfully (unified encoding)');
                    }
                    catch (opusError) {
                        const errorMessage = opusError instanceof Error ? opusError.message : String(opusError);
                        logger_1.default.error({
                            error: opusError,
                            jobId: job.job_id,
                            sessionId: job.session_id,
                            utteranceIndex: job.utterance_index,
                            errorMessage,
                        }, 'NodeAgent: Failed to encode TTS WAV to Opus, returning empty audio');
                        ttsAudio = '';
                        ttsFormat = 'opus';
                    }
                }
                if (postProcessResult.shouldSend) {
                    finalResult = {
                        ...result,
                        text_asr: postProcessResult.aggregatedText,
                        text_translated: postProcessResult.translatedText,
                        tts_audio: ttsAudio,
                        tts_format: ttsFormat,
                    };
                    logger_1.default.debug({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        action: postProcessResult.action,
                        originalLength: result.text_asr?.length || 0,
                        aggregatedLength: postProcessResult.aggregatedText.length,
                    }, 'PostProcessCoordinator processing completed');
                }
                else {
                    // PostProcessCoordinator 决定不发送（可能是重复文本或被过滤）
                    // 修复：如果PostProcessCoordinator决定不发送（shouldSend=false），不发送job_result
                    // 避免发送重复内容或空结果导致重复输出
                    logger_1.default.info({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        utteranceIndex: job.utterance_index,
                        reason: postProcessResult.reason || 'PostProcessCoordinator filtered result',
                        aggregatedText: postProcessResult.aggregatedText?.substring(0, 50) || '',
                        aggregatedTextLength: postProcessResult.aggregatedText?.length || 0,
                    }, 'PostProcessCoordinator filtered result (shouldSend=false), skipping job_result send to avoid duplicate output');
                    return; // 不发送结果，避免重复输出
                }
            }
            else {
                // 如果未使用 PostProcessCoordinator（不应该发生，但保留作为安全措施）
                finalResult = result;
            }
            // 注意：AggregatorMiddleware 现在在 PipelineOrchestrator 中调用（ASR 之后、NMT 之前）
            // 不再在这里调用，避免重复处理和重复翻译
            // 如果启用了 AggregatorMiddleware，文本聚合已经在 PipelineOrchestrator 中完成
            // 检查ASR结果是否为空
            const asrTextTrimmed = (finalResult.text_asr || '').trim();
            const isEmpty = !asrTextTrimmed || asrTextTrimmed.length === 0;
            if (isEmpty) {
                // 修复：即使ASR结果为空，也发送job_result（空结果）给调度服务器
                // 这样调度服务器知道节点端已经处理完成，不会触发超时
                // 调度服务器的result_queue会处理空结果，不会发送给客户端
                logger_1.default.info({
                    jobId: job.job_id,
                    traceId: job.trace_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                    reason: 'ASR result is empty, but sending empty job_result to scheduler to prevent timeout',
                }, 'NodeAgent: ASR result is empty, sending empty job_result to scheduler to prevent timeout');
                // 继续执行，发送空结果
            }
            else {
                logger_1.default.info({
                    jobId: job.job_id,
                    utteranceIndex: job.utterance_index,
                    textAsr: finalResult.text_asr?.substring(0, 50),
                    textAsrLength: finalResult.text_asr?.length || 0,
                    textTranslated: finalResult.text_translated?.substring(0, 100),
                    textTranslatedLength: finalResult.text_translated?.length || 0,
                    ttsAudioLength: finalResult.tts_audio?.length || 0,
                }, 'Job processing completed successfully');
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
                text_asr: finalResult.text_asr,
                text_translated: finalResult.text_translated,
                tts_audio: finalResult.tts_audio,
                tts_format: finalResult.tts_format || 'opus', // 强制使用 opus 格式
                extra: finalResult.extra,
                processing_time_ms: Date.now() - startTime,
                trace_id: job.trace_id, // Added: propagate trace_id
                // OBS-2: 透传 ASR 质量信息
                asr_quality_level: finalResult.asr_quality_level,
                reason_codes: finalResult.reason_codes,
                quality_score: finalResult.quality_score,
                rerun_count: finalResult.rerun_count,
                segments_meta: finalResult.segments_meta,
            };
            // 检查是否与上次发送的文本完全相同（防止重复发送）
            // 优化：使用更严格的文本比较
            const lastSentText = this.aggregatorMiddleware.getLastSentText(job.session_id);
            if (lastSentText && finalResult.text_asr) {
                const normalizeText = (text) => {
                    return text.replace(/\s+/g, ' ').trim();
                };
                const normalizedCurrent = normalizeText(finalResult.text_asr);
                const normalizedLast = normalizeText(lastSentText);
                if (normalizedCurrent === normalizedLast && normalizedCurrent.length > 0) {
                    logger_1.default.info({
                        jobId: job.job_id,
                        sessionId: job.session_id,
                        text: finalResult.text_asr.substring(0, 50),
                        normalizedText: normalizedCurrent.substring(0, 50),
                    }, 'Skipping duplicate job result (same as last sent after normalization)');
                    return; // 不发送重复的结果
                }
            }
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                responseLength: JSON.stringify(response).length,
                textAsrLength: finalResult.text_asr?.length || 0,
                ttsAudioLength: finalResult.tts_audio?.length || 0,
            }, 'Sending job_result to scheduler');
            this.ws.send(JSON.stringify(response));
            logger_1.default.info({
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                processingTimeMs: Date.now() - startTime,
            }, 'Job result sent successfully');
            // 更新最后发送的文本（在成功发送后）
            if (finalResult.text_asr) {
                this.aggregatorMiddleware.setLastSentText(job.session_id, finalResult.text_asr.trim());
            }
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
