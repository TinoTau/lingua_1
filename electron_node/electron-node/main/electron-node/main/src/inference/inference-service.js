"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InferenceService = void 0;
const logger_1 = __importDefault(require("../logger"));
const task_router_1 = require("../task-router/task-router");
const job_pipeline_1 = require("../pipeline/job-pipeline");
const session_context_manager_1 = require("../pipeline-orchestrator/session-context-manager");
class InferenceService {
    constructor(modelManager, pythonServiceManager, rustServiceManager, serviceRegistryManager, aggregatorManager, // S1: 可选的AggregatorManager（仅用于构建prompt）
    aggregatorMiddleware, // 已废弃：不再传递给PipelineOrchestrator，但保留参数以兼容旧代码
    semanticRepairServiceManager, // 可选的SemanticRepairServiceManager（用于检查语义修复服务实际运行状态）
    servicesHandler // 可选的ServicesHandler（用于语义修复服务发现）
    ) {
        this.currentJobs = new Set();
        this.hasProcessedFirstJob = false; // 跟踪是否已经处理过第一个 job
        this.onTaskProcessedCallback = null;
        this.onTaskStartCallback = null;
        this.onTaskEndCallback = null;
        // S1: AggregatorManager引用（可选，用于构建prompt）
        this.aggregatorManager = null;
        // AggregatorMiddleware引用（可选，用于在ASR之后、NMT之前进行文本聚合）
        this.aggregatorMiddleware = null;
        this.modelManager = modelManager;
        // 初始化新架构组件（必需）
        if (!pythonServiceManager || !rustServiceManager || !serviceRegistryManager) {
            throw new Error('TaskRouter requires pythonServiceManager, rustServiceManager, and serviceRegistryManager');
        }
        this.taskRouter = new task_router_1.TaskRouter(pythonServiceManager, rustServiceManager, serviceRegistryManager, semanticRepairServiceManager);
        // S1: 保存引用
        this.aggregatorManager = aggregatorManager;
        this.aggregatorMiddleware = aggregatorMiddleware;
        // 初始化 SessionContextManager
        this.sessionContextManager = new session_context_manager_1.SessionContextManager();
        this.sessionContextManager.setTaskRouter(this.taskRouter);
        // 初始化 DedupStage（全局实例，用于维护 job_id 去重状态）
        const { DedupStage } = require('../agent/postprocess/dedup-stage');
        const dedupStage = new DedupStage();
        // 初始化 AudioAggregator（用于在job之间共享音频缓冲区）
        // 通过依赖注入方式创建，支持热插拔场景：每次 InferenceService 创建时都有新的干净实例
        const { AudioAggregator } = require('../pipeline-orchestrator/audio-aggregator');
        const audioAggregator = new AudioAggregator();
        // 初始化 servicesBundle
        this.servicesBundle = {
            taskRouter: this.taskRouter,
            aggregatorManager: aggregatorManager || null,
            servicesHandler: servicesHandler || null,
            deduplicationHandler: null, // 将在运行时通过 setDeduplicationHandler 设置
            sessionContextManager: this.sessionContextManager,
            aggregatorMiddleware: aggregatorMiddleware || null,
            dedupStage: dedupStage,
            audioAggregator: audioAggregator,
        };
        // 异步初始化服务端点
        this.taskRouter.initialize().catch((error) => {
            logger_1.default.error({ error }, 'Failed to initialize TaskRouter');
        });
    }
    /**
     * S1: 设置AggregatorManager（用于动态更新）
     */
    setAggregatorManager(aggregatorManager) {
        this.aggregatorManager = aggregatorManager;
        this.servicesBundle.aggregatorManager = aggregatorManager;
        logger_1.default.info({}, 'InferenceService: AggregatorManager updated');
    }
    /**
     * 设置ServicesHandler（用于语义修复服务发现）
     */
    setServicesHandler(servicesHandler) {
        this.servicesBundle.servicesHandler = servicesHandler;
        logger_1.default.info({}, 'InferenceService: ServicesHandler updated');
    }
    /**
     * 设置DeduplicationHandler（用于去重）
     */
    setDeduplicationHandler(deduplicationHandler) {
        this.servicesBundle.deduplicationHandler = deduplicationHandler;
        logger_1.default.info({}, 'InferenceService: DeduplicationHandler updated');
    }
    /**
     * 设置AggregatorMiddleware（用于去重时获取lastSentText）
     */
    setAggregatorMiddleware(aggregatorMiddleware) {
        this.aggregatorMiddleware = aggregatorMiddleware;
        this.servicesBundle.aggregatorMiddleware = aggregatorMiddleware;
        logger_1.default.info({}, 'InferenceService: AggregatorMiddleware updated');
    }
    /**
     * 设置ResultSender（用于发送原始job的结果）
     */
    setResultSender(resultSender) {
        this.servicesBundle.resultSender = resultSender;
        logger_1.default.info({}, 'InferenceService: ResultSender updated');
    }
    /**
     * 清理 Session（统一入口）
     */
    removeSession(sessionId) {
        this.servicesBundle.aggregatorManager?.removeSession(sessionId);
        this.servicesBundle.deduplicationHandler?.removeSession(sessionId);
        this.servicesBundle.servicesHandler?.removeSession?.(sessionId);
        this.servicesBundle.sessionContextManager?.removeSession?.(sessionId);
        this.servicesBundle.dedupStage?.removeSession?.(sessionId);
        logger_1.default.info({ sessionId }, 'InferenceService: Session removed from all components');
    }
    /**
     * 获取 DedupStage 实例（用于在成功发送后记录job_id）
     */
    getDedupStage() {
        return this.servicesBundle.dedupStage;
    }
    setOnTaskProcessedCallback(callback) {
        this.onTaskProcessedCallback = callback;
    }
    setOnTaskStartCallback(callback) {
        this.onTaskStartCallback = callback;
    }
    setOnTaskEndCallback(callback) {
        this.onTaskEndCallback = callback;
    }
    /**
     * Gate-B: 获取 Rerun 指标（用于上报）
     */
    getRerunMetrics() {
        return this.taskRouter.getRerunMetrics?.() || {
            totalReruns: 0,
            successfulReruns: 0,
            failedReruns: 0,
            timeoutReruns: 0,
            qualityImprovements: 0,
        };
    }
    /**
     * OBS-1: 获取处理效率指标（按服务ID分组）
     * @returns Record<serviceId, efficiency>
     */
    getProcessingMetrics() {
        return this.taskRouter.getProcessingMetrics?.() || {};
    }
    /**
     * OBS-1: 获取指定服务ID的处理效率
     * @param serviceId 服务ID
     * @returns 处理效率，如果该服务在心跳周期内没有任务则为 null
     */
    getServiceEfficiency(serviceId) {
        return this.taskRouter.getServiceEfficiency?.(serviceId) || null;
    }
    /**
     * OBS-1: 重置当前心跳周期的处理效率指标（所有服务）
     * 在心跳发送后调用，清空当前周期的数据
     */
    resetProcessingMetrics() {
        this.taskRouter.resetCycleMetrics?.();
    }
    async processJob(job, partialCallback) {
        const wasFirstJob = !this.hasProcessedFirstJob;
        this.currentJobs.add(job.job_id);
        // 如果是第一个任务（节点启动后的第一个），等待服务就绪
        if (wasFirstJob) {
            this.hasProcessedFirstJob = true;
            logger_1.default.info({ jobId: job.job_id }, 'First job detected, waiting for services to be ready');
            await this.waitForServicesReady();
        }
        // 如果是第一个任务，通知任务开始（用于启动GPU跟踪）
        if (wasFirstJob && this.onTaskStartCallback) {
            this.onTaskStartCallback();
        }
        try {
            // 刷新服务端点列表（带缓存机制，避免频繁刷新）
            // 注意：首次任务已在 waitForServicesReady() 中强制刷新，这里使用缓存即可
            await this.taskRouter.refreshServiceEndpoints();
            // 使用新的 JobPipeline
            const result = await (0, job_pipeline_1.runJobPipeline)({
                job,
                partialCallback,
                asrCompletedCallback: (asrCompleted) => {
                    // ASR 完成回调：从 currentJobs 中移除，释放 ASR 服务容量
                    if (asrCompleted) {
                        this.currentJobs.delete(job.job_id);
                        logger_1.default.debug({ jobId: job.job_id }, 'ASR completed, removed from currentJobs to free ASR service capacity');
                        // 如果这是最后一个任务，通知任务结束（用于停止GPU跟踪）
                        if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
                            this.onTaskEndCallback();
                        }
                    }
                },
                services: this.servicesBundle,
                callbacks: {
                    onTaskStart: this.onTaskStartCallback || undefined,
                    onTaskEnd: this.onTaskEndCallback || undefined,
                    onTaskProcessed: this.onTaskProcessedCallback || undefined,
                },
            });
            return result;
        }
        catch (error) {
            logger_1.default.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Pipeline orchestration failed');
            throw error;
        }
        finally {
            // 确保任务从 currentJobs 中移除（如果 ASR 完成回调没有执行）
            if (this.currentJobs.has(job.job_id)) {
                this.currentJobs.delete(job.job_id);
                // 如果没有任务了，通知任务结束（用于停止GPU跟踪）
                if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
                    this.onTaskEndCallback();
                }
            }
        }
    }
    /**
     * 取消任务
     * 注意：取消不保证推理服务一定立刻停止（取决于下游实现）
     */
    cancelJob(jobId) {
        // 尝试通过 TaskRouter 取消任务（中断 HTTP 请求）
        const cancelled = this.taskRouter.cancelJob(jobId);
        // 从 currentJobs 中移除任务
        if (this.currentJobs.has(jobId)) {
            this.currentJobs.delete(jobId);
            // 如果没有任务了，通知任务结束（用于停止GPU跟踪）
            if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
                this.onTaskEndCallback();
            }
            return true;
        }
        return cancelled;
    }
    getCurrentJobCount() {
        return this.currentJobs.size;
    }
    async getInstalledModels() {
        // 从 ModelManager 获取已安装的模型，转换为协议格式
        // 注意：返回的 InstalledModel 接口包含 model_id 字段，这是协议定义的一部分
        const installed = this.modelManager.getInstalledModels();
        // 获取可用模型列表以获取完整元数据
        // 如果 Model Hub 连接失败，使用空数组，避免阻止节点注册
        let availableModels = [];
        try {
            availableModels = await this.modelManager.getAvailableModels();
        }
        catch (error) {
            logger_1.default.warn({
                error: error.message,
                errorCode: error.code
            }, 'Failed to get available models from Model Hub, using empty list (node registration will continue)');
            // 继续执行，使用空数组，这样节点仍然可以注册
        }
        return installed.map(m => {
            // 从可用模型列表中查找完整信息
            const modelInfo = availableModels.find(am => am.id === m.modelId);
            // 从 model_id 推断模型类型（临时方案，实际应该从元数据获取）
            let kind = 'other';
            if (modelInfo) {
                if (modelInfo.task === 'asr')
                    kind = 'asr';
                else if (modelInfo.task === 'nmt')
                    kind = 'nmt';
                else if (modelInfo.task === 'tts')
                    kind = 'tts';
                else if (modelInfo.task === 'emotion')
                    kind = 'emotion';
            }
            else {
                // 回退到名称推断
                if (m.modelId.includes('asr') || m.modelId.includes('whisper')) {
                    kind = 'asr';
                }
                else if (m.modelId.includes('nmt') || m.modelId.includes('m2m')) {
                    kind = 'nmt';
                }
                else if (m.modelId.includes('tts') || m.modelId.includes('piper')) {
                    kind = 'tts';
                }
                else if (m.modelId.includes('emotion')) {
                    kind = 'emotion';
                }
            }
            return {
                model_id: m.modelId,
                kind: kind,
                src_lang: modelInfo?.languages?.[0] || null,
                tgt_lang: modelInfo?.languages?.[1] || null,
                dialect: null, // TODO: 从元数据获取
                version: m.version || '1.0.0',
                enabled: m.info.status === 'ready', // 只有 ready 状态才启用
            };
        });
    }
    /**
     * 等待服务就绪（用于第一次任务）
     * 检查ASR、NMT、TTS服务是否都有可用的端点
     */
    async waitForServicesReady(maxWaitMs = 5000) {
        const startTime = Date.now();
        const checkInterval = 200; // 每200ms检查一次（更频繁的检查）
        logger_1.default.info({ maxWaitMs }, 'Waiting for services to be ready');
        // 先强制刷新一次服务端点列表（确保获取最新状态）
        await this.taskRouter.forceRefreshServiceEndpoints();
        while (Date.now() - startTime < maxWaitMs) {
            try {
                // 循环中强制刷新服务端点列表（需要实时检测服务状态）
                await this.taskRouter.forceRefreshServiceEndpoints();
                // 检查是否有可用的服务端点
                const hasASR = await this.checkServiceTypeReady('ASR');
                const hasNMT = await this.checkServiceTypeReady('NMT');
                const hasTTS = await this.checkServiceTypeReady('TTS');
                if (hasASR && hasNMT && hasTTS) {
                    logger_1.default.info({ elapsedMs: Date.now() - startTime }, 'All services are ready');
                    return;
                }
                logger_1.default.debug({
                    elapsedMs: Date.now() - startTime,
                    hasASR,
                    hasNMT,
                    hasTTS,
                }, 'Services not all ready yet, waiting...');
            }
            catch (error) {
                logger_1.default.warn({ error, elapsedMs: Date.now() - startTime }, 'Error checking service readiness');
            }
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        logger_1.default.warn({
            elapsedMs: Date.now() - startTime,
            maxWaitMs,
        }, 'Services not ready after timeout, proceeding anyway (may fail)');
    }
    /**
     * 检查指定服务类型是否有可用的端点
     */
    async checkServiceTypeReady(serviceType) {
        try {
            // 通过TaskRouter的公共方法检查（需要添加）
            // 暂时通过反射或类型断言访问（不推荐，但可以工作）
            const router = this.taskRouter;
            // ServiceType是枚举，值应该是 'ASR', 'NMT', 'TTS', 'TONE'
            const serviceTypeEnum = serviceType;
            const endpoints = router.serviceEndpoints?.get(serviceTypeEnum) || [];
            // 注意：refreshServiceEndpoints 只会添加 status === 'running' 的服务
            // 所以这里只需要检查端点数量即可
            const hasEndpoints = endpoints.length > 0;
            if (!hasEndpoints) {
                logger_1.default.debug({ serviceType, endpointCount: endpoints.length }, 'No endpoints available for service type');
            }
            return hasEndpoints;
        }
        catch (error) {
            logger_1.default.warn({ error, serviceType }, 'Error checking service type readiness');
            return false;
        }
    }
    getFeaturesSupported() {
        // TODO: 根据实际安装的模型和启用的模块返回支持的功能
        // 这里返回一个示例，实际应该根据模型和模块状态动态生成
        return {
            emotion_detection: false,
            voice_style_detection: false,
            speech_rate_detection: false,
            speech_rate_control: false,
            speaker_identification: false,
            persona_adaptation: false,
        };
    }
}
exports.InferenceService = InferenceService;
