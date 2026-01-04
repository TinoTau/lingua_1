"use strict";
/**
 * Task Router Semantic Repair Handler
 * 处理语义修复任务路由相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouterSemanticRepairHandler = void 0;
const logger_1 = __importDefault(require("../logger"));
const messages_1 = require("../../../../shared/protocols/messages");
const task_router_service_selector_1 = require("./task-router-service-selector");
const task_router_semantic_repair_concurrency_1 = require("./task-router-semantic-repair-concurrency");
const task_router_semantic_repair_health_1 = require("./task-router-semantic-repair-health");
const semantic_repair_cache_1 = require("./semantic-repair-cache");
const semantic_repair_model_integrity_1 = require("./semantic-repair-model-integrity");
class TaskRouterSemanticRepairHandler {
    constructor(selectServiceEndpoint, startGpuTrackingForService, serviceConnections, updateConnections, maxConcurrency = 2, // P0-5: 默认最大并发数为2
    isServiceRunningCallback, // P0-1: 用于检查进程是否运行
    cacheConfig, // P2-1: 缓存配置
    enableModelIntegrityCheck = false, // P2-2: 是否启用模型完整性检查
    getServicePathCallback, // P2-2: 获取服务包路径的回调
    getServiceEndpointById // 直接根据服务ID查找端点
    ) {
        this.selectServiceEndpoint = selectServiceEndpoint;
        this.startGpuTrackingForService = startGpuTrackingForService;
        this.serviceConnections = serviceConnections;
        this.updateConnections = updateConnections;
        this.modelIntegrityChecker = null; // P2-2: 模型完整性校验器
        this.isServiceRunningCallback = null;
        this.getServicePathCallback = null; // P2-2: 获取服务包路径的回调
        this.getServiceEndpointById = null; // 直接根据服务ID查找端点
        this.getServiceEndpointById = getServiceEndpointById || null;
        this.serviceSelector = new task_router_service_selector_1.TaskRouterServiceSelector();
        this.concurrencyManager = new task_router_semantic_repair_concurrency_1.SemanticRepairConcurrencyManager({
            maxConcurrency,
        });
        this.healthChecker = new task_router_semantic_repair_health_1.SemanticRepairHealthChecker({
            enableModelIntegrityCheck, // P2-2: 传递配置
        });
        this.isServiceRunningCallback = isServiceRunningCallback || null;
        this.getServicePathCallback = getServicePathCallback || null;
        // P2-1: 初始化缓存
        this.cache = new semantic_repair_cache_1.SemanticRepairCache({
            maxSize: cacheConfig?.maxSize || 200,
            ttlMs: cacheConfig?.ttlMs || 5 * 60 * 1000, // 默认5分钟
            modelVersion: cacheConfig?.modelVersion || 'default',
        });
        // P2-2: 初始化模型完整性校验器（如果启用）
        if (enableModelIntegrityCheck) {
            this.modelIntegrityChecker = new semantic_repair_model_integrity_1.SemanticRepairModelIntegrityChecker({
                checkOnStartup: true,
                checkOnHealthCheck: false, // 默认不在健康检查时检查，避免频繁IO
                checkInterval: 30 * 60 * 1000, // 默认30分钟
            });
            this.healthChecker.setModelIntegrityChecker(this.modelIntegrityChecker);
        }
    }
    /**
     * 路由语义修复任务
     */
    async routeSemanticRepairTask(task) {
        // P2-1: 检查缓存
        const cachedResult = this.cache.get(task.lang, task.text_in);
        if (cachedResult) {
            logger_1.default.debug({
                jobId: task.job_id,
                lang: task.lang,
                textInPreview: task.text_in.substring(0, 50),
                decision: cachedResult.decision,
                confidence: cachedResult.confidence,
            }, 'Semantic repair result from cache');
            return cachedResult;
        }
        // 根据语言选择服务ID
        const serviceId = this.getServiceIdForLanguage(task.lang);
        // 优先使用直接查找方法（如果提供）
        let endpoint = null;
        if (this.getServiceEndpointById) {
            endpoint = this.getServiceEndpointById(serviceId);
        }
        // 如果没有直接查找方法或找不到，尝试通过selectServiceEndpoint查找SEMANTIC类型的服务
        if (!endpoint) {
            endpoint = this.selectServiceEndpoint(messages_1.ServiceType.SEMANTIC);
            // 验证返回的端点是否匹配我们需要的服务ID
            if (endpoint && endpoint.serviceId !== serviceId) {
                endpoint = null;
            }
        }
        if (!endpoint) {
            logger_1.default.debug({
                lang: task.lang,
                serviceId,
                message: 'Semantic repair service not found',
            }, 'Semantic repair service not available, returning PASS');
            return {
                decision: 'PASS',
                text_out: task.text_in,
                confidence: 1.0,
                reason_codes: ['SERVICE_NOT_AVAILABLE'],
            };
        }
        // P0-1: 检查服务健康状态（只有WARMED状态才可用）
        // 注意：在测试环境中，如果没有提供isServiceRunningCallback，跳过健康检查
        if (this.isServiceRunningCallback) {
            const isProcessRunning = this.isServiceRunningCallback(endpoint.serviceId);
            const healthResult = await this.healthChecker.checkServiceHealth(endpoint.serviceId, endpoint.baseUrl, isProcessRunning);
            if (!healthResult.isAvailable) {
                logger_1.default.warn({
                    serviceId: endpoint.serviceId,
                    baseUrl: endpoint.baseUrl,
                    status: healthResult.status,
                    reason: healthResult.reason,
                }, 'Semantic repair service not available (not warmed), returning PASS');
                return {
                    decision: 'PASS',
                    text_out: task.text_in,
                    confidence: 1.0,
                    reason_codes: [`SERVICE_NOT_${healthResult.status}`],
                };
            }
        }
        // P0-5: 获取并发许可（如果超过限制则等待）
        const acquireStartTime = Date.now();
        try {
            logger_1.default.info({
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                serviceId: endpoint.serviceId,
                textLength: task.text_in?.length || 0,
            }, 'SemanticRepairHandler: Attempting to acquire concurrency permit');
            await this.concurrencyManager.acquire(endpoint.serviceId, task.job_id, 5000);
            const acquireDuration = Date.now() - acquireStartTime;
            logger_1.default.info({
                jobId: task.job_id,
                serviceId: endpoint.serviceId,
                acquireDurationMs: acquireDuration,
            }, 'SemanticRepairHandler: Concurrency permit acquired');
        }
        catch (error) {
            const acquireDuration = Date.now() - acquireStartTime;
            logger_1.default.warn({
                error: error.message,
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                serviceId: endpoint.serviceId,
                acquireDurationMs: acquireDuration,
            }, 'Semantic repair concurrency timeout, returning PASS');
            return {
                decision: 'PASS',
                text_out: task.text_in,
                confidence: 1.0,
                reason_codes: ['CONCURRENCY_TIMEOUT'],
            };
        }
        // 更新连接数
        this.updateConnections(endpoint.serviceId, 1);
        this.startGpuTrackingForService(endpoint.serviceId);
        const serviceCallStartTime = Date.now();
        try {
            // 调用语义修复服务
            logger_1.default.info({
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                serviceId: endpoint.serviceId,
                baseUrl: endpoint.baseUrl,
                textLength: task.text_in?.length || 0,
            }, 'SemanticRepairHandler: Calling semantic repair service');
            const result = await this.callSemanticRepairService(endpoint, task);
            const serviceCallDuration = Date.now() - serviceCallStartTime;
            // P2-1: 缓存结果（只缓存REPAIR决策）
            this.cache.set(task.lang, task.text_in, result);
            logger_1.default.info({
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                lang: task.lang,
                decision: result.decision,
                confidence: result.confidence,
                reasonCodes: result.reason_codes,
                serviceCallDurationMs: serviceCallDuration,
                cached: result.decision === 'REPAIR',
            }, 'Semantic repair task completed');
            return result;
        }
        catch (error) {
            const serviceCallDuration = Date.now() - serviceCallStartTime;
            logger_1.default.error({
                error: error.message,
                stack: error.stack,
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                lang: task.lang,
                serviceId: endpoint.serviceId,
                serviceCallDurationMs: serviceCallDuration,
                isTimeout: error.message?.includes('timeout') || error.name === 'AbortError',
            }, 'Semantic repair service error, returning PASS');
            // 错误时返回PASS，不阻塞流程
            return {
                decision: 'PASS',
                text_out: task.text_in,
                confidence: 1.0,
                reason_codes: ['SERVICE_ERROR'],
            };
        }
        finally {
            // P0-5: 释放并发许可
            logger_1.default.info({
                jobId: task.job_id,
                serviceId: endpoint.serviceId,
            }, 'SemanticRepairHandler: Releasing concurrency permit');
            this.concurrencyManager.release(endpoint.serviceId, task.job_id);
            // 更新连接数
            this.updateConnections(endpoint.serviceId, -1);
        }
    }
    /**
     * 根据语言获取服务ID
     */
    getServiceIdForLanguage(lang) {
        if (lang === 'zh') {
            return 'semantic-repair-zh';
        }
        else {
            return 'semantic-repair-en';
        }
    }
    /**
     * 调用语义修复服务
     */
    async callSemanticRepairService(endpoint, task) {
        const url = `${endpoint.baseUrl}/repair`;
        const timeout = 10000; // 增加到10秒超时（模型生成可能需要更长时间）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    job_id: task.job_id,
                    session_id: task.session_id,
                    utterance_index: task.utterance_index,
                    lang: task.lang,
                    text_in: task.text_in,
                    quality_score: task.quality_score,
                    micro_context: task.micro_context,
                    meta: task.meta,
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            // 验证响应格式
            if (!data.decision || !data.text_out || typeof data.confidence !== 'number') {
                throw new Error('Invalid response format from semantic repair service');
            }
            return {
                decision: data.decision,
                text_out: data.text_out,
                confidence: data.confidence,
                diff: data.diff,
                reason_codes: data.reason_codes || [],
                repair_time_ms: data.repair_time_ms,
            };
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Semantic repair service timeout');
            }
            throw error;
        }
    }
    /**
     * 检查语义修复服务健康状态
     * P0-1: 使用真实的健康检查器
     */
    async checkServiceHealth(serviceId, baseUrl) {
        const isProcessRunning = this.isServiceRunningCallback
            ? this.isServiceRunningCallback(serviceId)
            : false;
        const healthResult = await this.healthChecker.checkServiceHealth(serviceId, baseUrl, isProcessRunning);
        return healthResult.isAvailable;
    }
    /**
     * 获取详细的服务健康状态
     * P0-1: 返回详细的状态信息
     */
    async getServiceHealthStatus(serviceId, baseUrl) {
        const isProcessRunning = this.isServiceRunningCallback
            ? this.isServiceRunningCallback(serviceId)
            : false;
        return await this.healthChecker.checkServiceHealth(serviceId, baseUrl, isProcessRunning);
    }
    /**
     * P2-1: 获取缓存统计信息
     */
    getCacheStats() {
        return this.cache.getStats();
    }
    /**
     * P2-1: 清除缓存
     */
    clearCache() {
        this.cache.clear();
    }
    /**
     * P2-1: 更新模型版本（当模型更新时调用）
     */
    updateModelVersion(newVersion) {
        this.cache.updateModelVersion(newVersion);
    }
}
exports.TaskRouterSemanticRepairHandler = TaskRouterSemanticRepairHandler;
