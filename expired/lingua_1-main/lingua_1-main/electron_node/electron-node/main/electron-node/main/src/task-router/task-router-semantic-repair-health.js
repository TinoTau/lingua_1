"use strict";
/**
 * Task Router Semantic Repair Health Check
 * P0-1: 实现真实的语义修复服务健康检查机制
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairHealthChecker = exports.SemanticRepairServiceStatus = void 0;
const logger_1 = __importDefault(require("../logger"));
var SemanticRepairServiceStatus;
(function (SemanticRepairServiceStatus) {
    SemanticRepairServiceStatus["INSTALLED"] = "INSTALLED";
    SemanticRepairServiceStatus["RUNNING"] = "RUNNING";
    SemanticRepairServiceStatus["HEALTHY"] = "HEALTHY";
    SemanticRepairServiceStatus["WARMED"] = "WARMED";
})(SemanticRepairServiceStatus || (exports.SemanticRepairServiceStatus = SemanticRepairServiceStatus = {}));
class SemanticRepairHealthChecker {
    constructor(config = {}) {
        this.healthCache = new Map();
        this.modelIntegrityChecker = null; // P2-2: 模型完整性校验器（延迟加载）
        this.config = {
            healthCheckTimeout: config.healthCheckTimeout ?? 1000,
            healthCheckInterval: config.healthCheckInterval ?? 5000,
            warmedCheckTimeout: config.warmedCheckTimeout ?? 2000,
            enableModelIntegrityCheck: config.enableModelIntegrityCheck ?? false,
            modelIntegrityCheckInterval: config.modelIntegrityCheckInterval ?? 30 * 60 * 1000, // 默认30分钟
        };
    }
    /**
     * P2-2: 设置模型完整性校验器
     */
    setModelIntegrityChecker(checker) {
        this.modelIntegrityChecker = checker;
    }
    /**
     * 检查服务健康状态
     * P0-1: 实现真实的健康检查，包括进程、端口、HTTP接口、模型warm状态
     */
    async checkServiceHealth(serviceId, baseUrl, isProcessRunning = false) {
        const cacheKey = `${serviceId}:${baseUrl}`;
        const cached = this.healthCache.get(cacheKey);
        const now = Date.now();
        // 使用缓存（如果检查间隔内）
        if (cached && (now - cached.lastCheckTime) < this.config.healthCheckInterval) {
            logger_1.default.debug({
                serviceId,
                baseUrl,
                status: cached.result.status,
                cached: true,
            }, 'SemanticRepairHealthChecker: Using cached health check result');
            return cached.result;
        }
        // 1. 检查进程是否运行
        if (!isProcessRunning) {
            const result = {
                status: SemanticRepairServiceStatus.INSTALLED,
                isAvailable: false,
                reason: 'Process not running',
                lastCheckTime: now,
            };
            this.updateCache(cacheKey, result, now);
            return result;
        }
        // 2. 检查HTTP健康接口
        const healthCheckResult = await this.checkHealthEndpoint(baseUrl);
        if (!healthCheckResult.healthy) {
            const result = {
                status: SemanticRepairServiceStatus.RUNNING,
                isAvailable: false,
                reason: healthCheckResult.reason || 'Health endpoint not accessible',
                lastCheckTime: now,
                responseTime: healthCheckResult.responseTime,
            };
            this.updateCache(cacheKey, result, now);
            return result;
        }
        // 3. 检查模型是否已warm
        const warmedCheckResult = await this.checkModelWarmed(baseUrl);
        if (!warmedCheckResult.warmed) {
            const result = {
                status: SemanticRepairServiceStatus.HEALTHY,
                isAvailable: false,
                reason: warmedCheckResult.reason || 'Model not warmed',
                lastCheckTime: now,
                responseTime: healthCheckResult.responseTime,
            };
            this.updateCache(cacheKey, result, now);
            return result;
        }
        // P2-2: 4. 可选：检查模型完整性（如果启用）
        if (this.config.enableModelIntegrityCheck && this.modelIntegrityChecker) {
            // 注意：这里需要服务包路径，需要从外部传入
            // 暂时跳过，在TaskRouter层面处理
        }
        // 5. 服务完全可用
        const result = {
            status: SemanticRepairServiceStatus.WARMED,
            isAvailable: true,
            reason: 'Service ready',
            lastCheckTime: now,
            responseTime: healthCheckResult.responseTime,
        };
        this.updateCache(cacheKey, result, now);
        logger_1.default.info({
            serviceId,
            baseUrl,
            status: result.status,
            responseTime: result.responseTime,
        }, 'SemanticRepairHealthChecker: Service is healthy and warmed');
        return result;
    }
    /**
     * 检查健康端点
     */
    async checkHealthEndpoint(baseUrl) {
        const startTime = Date.now();
        const url = `${baseUrl}/health`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.healthCheckTimeout);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                const responseTime = Date.now() - startTime;
                if (!response.ok) {
                    return {
                        healthy: false,
                        reason: `HTTP ${response.status}: ${response.statusText}`,
                        responseTime,
                    };
                }
                const data = await response.json();
                const status = data.status || data.health || 'unknown';
                if (status === 'healthy' || status === 'ready' || status === 'ok') {
                    return {
                        healthy: true,
                        responseTime,
                    };
                }
                else {
                    return {
                        healthy: false,
                        reason: `Service status: ${status}`,
                        responseTime,
                    };
                }
            }
            catch (error) {
                clearTimeout(timeoutId);
                const responseTime = Date.now() - startTime;
                if (error.name === 'AbortError') {
                    return {
                        healthy: false,
                        reason: 'Health check timeout',
                        responseTime,
                    };
                }
                return {
                    healthy: false,
                    reason: error.message || 'Health check failed',
                    responseTime,
                };
            }
        }
        catch (error) {
            const responseTime = Date.now() - startTime;
            return {
                healthy: false,
                reason: error.message || 'Health check error',
                responseTime,
            };
        }
    }
    /**
     * 检查模型是否已warm
     * 通过调用/health端点并检查响应中的warmed字段
     */
    async checkModelWarmed(baseUrl) {
        const url = `${baseUrl}/health`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.warmedCheckTimeout);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    return {
                        warmed: false,
                        reason: `HTTP ${response.status}`,
                    };
                }
                const data = await response.json();
                // 检查响应中的warmed字段
                if (data.warmed === true || data.model_warmed === true) {
                    return {
                        warmed: true,
                    };
                }
                // 如果响应中没有warmed字段，但status为ready，也认为已warm
                if (data.status === 'ready' || data.status === 'warmed') {
                    return {
                        warmed: true,
                    };
                }
                return {
                    warmed: false,
                    reason: 'Model not warmed (warmed field is false or missing)',
                };
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    return {
                        warmed: false,
                        reason: 'Warm check timeout',
                    };
                }
                return {
                    warmed: false,
                    reason: error.message || 'Warm check failed',
                };
            }
        }
        catch (error) {
            return {
                warmed: false,
                reason: error.message || 'Warm check error',
            };
        }
    }
    /**
     * 更新缓存
     */
    updateCache(cacheKey, result, checkTime) {
        this.healthCache.set(cacheKey, {
            result,
            lastCheckTime: checkTime,
        });
    }
    /**
     * 清除缓存（用于强制重新检查）
     */
    clearCache(serviceId, baseUrl) {
        if (serviceId && baseUrl) {
            const cacheKey = `${serviceId}:${baseUrl}`;
            this.healthCache.delete(cacheKey);
        }
        else {
            this.healthCache.clear();
        }
    }
    /**
     * 获取缓存的状态
     */
    getCachedStatus(serviceId, baseUrl) {
        const cacheKey = `${serviceId}:${baseUrl}`;
        const cached = this.healthCache.get(cacheKey);
        return cached ? cached.result : null;
    }
}
exports.SemanticRepairHealthChecker = SemanticRepairHealthChecker;
