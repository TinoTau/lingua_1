"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodeAgent = void 0;
const ws_1 = __importDefault(require("ws"));
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
const aggregator_middleware_1 = require("./aggregator-middleware");
const postprocess_coordinator_1 = require("./postprocess/postprocess-coordinator");
const node_agent_hardware_1 = require("./node-agent-hardware");
const node_agent_services_1 = require("./node-agent-services");
const node_agent_heartbeat_1 = require("./node-agent-heartbeat");
const node_agent_registration_1 = require("./node-agent-registration");
const node_agent_job_processor_1 = require("./node-agent-job-processor");
const node_agent_result_sender_1 = require("./node-agent-result-sender");
class NodeAgent {
    constructor(inferenceService, modelManager, serviceRegistryManager, rustServiceManager, pythonServiceManager) {
        this.ws = null;
        this.nodeId = null;
        this.capabilityStateChangedHandler = null; // 保存监听器函数，用于清理
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
        // 初始化模块化处理器
        this.hardwareHandler = new node_agent_hardware_1.HardwareInfoHandler();
        this.servicesHandler = new node_agent_services_1.ServicesHandler(this.serviceRegistryManager, this.rustServiceManager, this.pythonServiceManager);
        // 初始化心跳处理器（需要先初始化其他handler）
        this.heartbeatHandler = new node_agent_heartbeat_1.HeartbeatHandler(this.ws, this.nodeId, this.inferenceService, this.nodeConfig, () => this.servicesHandler.getInstalledServices(), (services) => this.servicesHandler.getCapabilityByType(services), (services) => this.servicesHandler.shouldCollectRerunMetrics(services), (services) => this.servicesHandler.shouldCollectASRMetrics(services));
        // 初始化注册处理器
        this.registrationHandler = new node_agent_registration_1.RegistrationHandler(this.ws, this.nodeId, this.inferenceService, this.hardwareHandler, () => this.servicesHandler.getInstalledServices(), (services) => this.servicesHandler.getCapabilityByType(services));
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
                },
            };
            this.postProcessCoordinator = new postprocess_coordinator_1.PostProcessCoordinator(aggregatorManager, taskRouter, this.servicesHandler, // 传递ServicesHandler用于服务发现
            postProcessConfig);
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
        // 初始化job处理器和结果发送器
        this.jobProcessor = new node_agent_job_processor_1.JobProcessor(this.inferenceService, this.postProcessCoordinator, this.aggregatorMiddleware, this.nodeConfig, this.pythonServiceManager);
        // 获取DedupStage实例，传递给ResultSender用于在成功发送后记录job_id
        const dedupStage = this.postProcessCoordinator?.getDedupStage() || null;
        this.resultSender = new node_agent_result_sender_1.ResultSender(this.aggregatorMiddleware, dedupStage);
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
                logger_1.default.info({ schedulerUrl: this.schedulerUrl, nodeId: this.nodeId }, 'Connected to scheduler server, starting registration');
                // 更新handler的连接信息
                this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
                this.registrationHandler.updateConnection(this.ws, this.nodeId);
                // 更新job处理器和结果发送器的连接信息
                this.jobProcessor.updateConnection(this.ws, this.nodeId);
                this.resultSender.updateConnection(this.ws, this.nodeId);
                // 使用 Promise 确保注册完成后再启动心跳
                this.registrationHandler.registerNode().catch((error) => {
                    logger_1.default.error({ error }, 'Failed to register node in open handler');
                });
                this.heartbeatHandler.startHeartbeat();
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
                logger_1.default.warn({
                    code,
                    reason: reason?.toString(),
                    nodeId: this.nodeId,
                    note: code === 1006 ? 'Abnormal closure - connection may have been lost during job processing' : 'Normal closure'
                }, 'Connection to scheduler server closed');
                this.heartbeatHandler.stopHeartbeat();
                // 连接关闭时，更新所有handler的连接信息（但保留nodeId用于重连）
                this.heartbeatHandler.updateConnection(null, this.nodeId);
                this.registrationHandler.updateConnection(null, this.nodeId);
                this.jobProcessor.updateConnection(null, this.nodeId);
                this.resultSender.updateConnection(null, this.nodeId);
                // 尝试重连
                setTimeout(() => {
                    logger_1.default.info({ nodeId: this.nodeId }, 'Attempting to reconnect to scheduler server');
                    this.start();
                }, 5000);
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
                    this.heartbeatHandler.triggerImmediateHeartbeat();
                };
                this.modelManager.on('capability-state-changed', this.capabilityStateChangedHandler);
            }
            // 注册 Python 服务状态变化回调
            if (this.pythonServiceManager && typeof this.pythonServiceManager.setOnStatusChangeCallback === 'function') {
                this.pythonServiceManager.setOnStatusChangeCallback((serviceName, status) => {
                    // 服务状态变化时，立即触发心跳（带防抖）
                    logger_1.default.debug({ serviceName, running: status.running }, 'Python service status changed, triggering immediate heartbeat');
                    this.heartbeatHandler.triggerImmediateHeartbeat();
                });
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to start Node Agent');
        }
    }
    stop() {
        this.heartbeatHandler.stopHeartbeat();
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
    async handleMessage(data) {
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'node_register_ack': {
                    const ack = message;
                    this.nodeId = ack.node_id;
                    // 更新所有handler的nodeId（确保它们有正确的nodeId和WebSocket连接）
                    this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
                    this.registrationHandler.updateConnection(this.ws, this.nodeId);
                    this.jobProcessor.updateConnection(this.ws, this.nodeId);
                    this.resultSender.updateConnection(this.ws, this.nodeId);
                    logger_1.default.info({ nodeId: this.nodeId }, 'Node registered successfully');
                    // 立刻补发一次心跳，把 installed_services/capability_state 尽快同步到 Scheduler
                    this.heartbeatHandler.sendHeartbeatOnce().catch((error) => {
                        logger_1.default.warn({ error }, 'Failed to send immediate heartbeat after node_register_ack');
                    });
                    break;
                }
                case 'job_assign': {
                    const job = message;
                    // 诊断：记录接收到的 audio_format（用于调试为什么会出现空值）
                    logger_1.default.info({
                        jobId: job.job_id,
                        traceId: job.trace_id,
                        audioFormat: job.audio_format,
                        audioFormatType: typeof job.audio_format,
                        audioFormatLength: job.audio_format?.length,
                        hasAudioFormat: 'audio_format' in job,
                        messageKeys: Object.keys(job),
                    }, 'Received job_assign message, checking audio_format field');
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
            // 使用job处理器处理job
            const processStartTime = Date.now();
            const processResult = await this.jobProcessor.processJob(job, startTime);
            const processDuration = Date.now() - processStartTime;
            if (processDuration > 30000) {
                logger_1.default.warn({
                    jobId: job.job_id,
                    processDurationMs: processDuration,
                    note: 'Job processing took longer than 30 seconds',
                }, 'Long job processing time detected');
            }
            // 使用结果发送器发送结果
            if (!processResult.shouldSend) {
                // PostProcessCoordinator决定不发送，发送空结果
                this.resultSender.sendJobResult(job, processResult.finalResult, startTime, false, processResult.reason);
                return;
            }
            this.resultSender.sendJobResult(job, processResult.finalResult, startTime, true);
        }
        catch (error) {
            this.resultSender.sendErrorResult(job, error, startTime);
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
