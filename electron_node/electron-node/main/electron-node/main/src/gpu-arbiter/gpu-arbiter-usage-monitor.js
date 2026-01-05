"use strict";
/**
 * GPU使用率监控模块
 * 负责GPU使用率采样、缓存、状态管理和动态调整
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GpuUsageMonitor = void 0;
const logger_1 = __importDefault(require("../logger"));
const system_resources_1 = require("../system-resources");
const types_1 = require("./types");
class GpuUsageMonitor {
    constructor(config, activeLeases, onStateChangeToNormal) {
        this.config = config;
        this.activeLeases = activeLeases;
        this.onStateChangeToNormal = onStateChangeToNormal;
        this.state = {
            gpuUsageCache: new Map(),
            gpuAdmissionStates: new Map(),
            dynamicAdjustments: new Map(),
            lastLoggedGpuUsage: null,
            lastLogTime: 0,
            monitorInterval: null,
        };
    }
    /**
     * 初始化GPU状态
     */
    initializeGpuKeys(gpuKeys) {
        for (const gpuKey of gpuKeys) {
            this.state.gpuAdmissionStates.set(gpuKey, types_1.GpuAdmissionState.NORMAL);
        }
    }
    /**
     * 启动GPU使用率监控
     */
    startMonitoring() {
        if (this.state.monitorInterval) {
            return; // 已经启动
        }
        this.state.monitorInterval = setInterval(() => {
            this.sampleGpuUsage();
        }, this.config.sampleIntervalMs);
        logger_1.default.debug({ sampleIntervalMs: this.config.sampleIntervalMs }, 'GpuArbiter: GPU usage monitoring started');
    }
    /**
     * 停止GPU使用率监控
     */
    stopMonitoring() {
        if (this.state.monitorInterval) {
            clearInterval(this.state.monitorInterval);
            this.state.monitorInterval = null;
            logger_1.default.debug({}, 'GpuArbiter: GPU usage monitoring stopped');
        }
    }
    /**
     * 采样GPU使用率并更新缓存
     */
    async sampleGpuUsage() {
        try {
            const gpuInfo = await (0, system_resources_1.getGpuUsage)();
            if (!gpuInfo || gpuInfo.usage === null || gpuInfo.usage === undefined) {
                return; // 无法获取GPU使用率，跳过
            }
            const gpuUsage = gpuInfo.usage;
            const now = Date.now();
            // 更新所有GPU的缓存
            for (const gpuKey of this.state.gpuAdmissionStates.keys()) {
                this.state.gpuUsageCache.set(gpuKey, {
                    usagePercent: gpuUsage,
                    sampledAt: now,
                });
                // 更新滞回线状态
                this.updateAdmissionState(gpuKey, gpuUsage);
            }
            // 如果GPU使用率超过阈值，记录详细日志（向后兼容）
            if (gpuUsage > this.config.gpuUsageThreshold) {
                const timeSinceLastLog = now - this.state.lastLogTime;
                const usageChanged = this.state.lastLoggedGpuUsage === null ||
                    Math.abs(this.state.lastLoggedGpuUsage - gpuUsage) > 5;
                if (timeSinceLastLog > 30000 || usageChanged) {
                    this.logGpuUsageExceeded(gpuUsage, gpuInfo.memory);
                    this.state.lastLoggedGpuUsage = gpuUsage;
                    this.state.lastLogTime = now;
                }
            }
            else {
                // GPU使用率恢复正常，重置上次记录的值
                if (this.state.lastLoggedGpuUsage !== null) {
                    this.state.lastLoggedGpuUsage = null;
                    this.state.lastLogTime = 0;
                }
            }
        }
        catch (error) {
            logger_1.default.debug({ error }, 'GpuArbiter: Failed to sample GPU usage');
        }
    }
    /**
     * 更新GPU准入状态（滞回线逻辑）
     */
    updateAdmissionState(gpuKey, gpuUsage) {
        const currentState = this.state.gpuAdmissionStates.get(gpuKey);
        if (!currentState) {
            return;
        }
        // 获取当前有效的阈值（考虑动态调整）
        const { highWater, lowWater } = this.getEffectiveThresholds(gpuKey);
        let newState = currentState;
        if (currentState === types_1.GpuAdmissionState.NORMAL) {
            // NORMAL → HIGH_PRESSURE：usage >= highWater
            if (gpuUsage >= highWater) {
                newState = types_1.GpuAdmissionState.HIGH_PRESSURE;
                logger_1.default.info({
                    gpuKey,
                    gpuUsage,
                    highWater,
                    lowWater,
                }, 'GpuArbiter: GPU admission state changed to HIGH_PRESSURE');
            }
        }
        else {
            // HIGH_PRESSURE → NORMAL：usage <= lowWater
            if (gpuUsage <= lowWater) {
                newState = types_1.GpuAdmissionState.NORMAL;
                logger_1.default.info({
                    gpuKey,
                    gpuUsage,
                    highWater,
                    lowWater,
                }, 'GpuArbiter: GPU admission state changed to NORMAL');
                // 状态恢复正常，触发回调处理等待队列
                if (this.onStateChangeToNormal) {
                    this.onStateChangeToNormal(gpuKey);
                }
            }
        }
        if (newState !== currentState) {
            this.state.gpuAdmissionStates.set(gpuKey, newState);
        }
        // 清理过期的动态调整
        this.cleanupExpiredAdjustments(gpuKey);
    }
    /**
     * 获取有效的阈值（考虑动态调整）
     */
    getEffectiveThresholds(gpuKey) {
        const adjustment = this.state.dynamicAdjustments.get(gpuKey);
        const now = Date.now();
        if (adjustment && adjustment.expiresAt > now) {
            return {
                highWater: adjustment.highWater,
                lowWater: adjustment.lowWater,
            };
        }
        return {
            highWater: this.config.baseHighWater,
            lowWater: this.config.baseLowWater,
        };
    }
    /**
     * 清理过期的动态调整
     */
    cleanupExpiredAdjustments(gpuKey) {
        const adjustment = this.state.dynamicAdjustments.get(gpuKey);
        if (adjustment && adjustment.expiresAt <= Date.now()) {
            this.state.dynamicAdjustments.delete(gpuKey);
            logger_1.default.debug({ gpuKey }, 'GpuArbiter: Dynamic adjustment expired, reverted to base thresholds');
        }
    }
    /**
     * 从缓存获取GPU使用率
     */
    getGpuUsageFromCache(gpuKey) {
        const cache = this.state.gpuUsageCache.get(gpuKey);
        if (!cache) {
            return null;
        }
        const now = Date.now();
        const age = now - cache.sampledAt;
        // 如果缓存过期，返回null（视为不可靠数据）
        if (age > this.config.cacheTtlMs) {
            return null;
        }
        return cache;
    }
    /**
     * 获取GPU准入状态
     */
    getAdmissionState(gpuKey) {
        return this.state.gpuAdmissionStates.get(gpuKey);
    }
    /**
     * ASR任务感知的动态滞回调整
     */
    notifyAsrTaskHint(gpuKey, hint) {
        if (!this.config.dynamicAdjustmentEnabled) {
            return;
        }
        // 检查是否为长音频
        if (hint.estimatedAudioMs >= this.config.longAudioThresholdMs) {
            const now = Date.now();
            const expiresAt = now + this.config.adjustmentTtlMs;
            // 临时提高阈值
            const adjustedHighWater = this.config.baseHighWater + this.config.highWaterBoost;
            const adjustedLowWater = this.config.baseLowWater + this.config.lowWaterBoost;
            this.state.dynamicAdjustments.set(gpuKey, {
                highWater: adjustedHighWater,
                lowWater: adjustedLowWater,
                expiresAt,
            });
            logger_1.default.info({
                gpuKey,
                estimatedAudioMs: hint.estimatedAudioMs,
                estimatedGpuHoldMs: hint.estimatedGpuHoldMs,
                baseHighWater: this.config.baseHighWater,
                baseLowWater: this.config.baseLowWater,
                adjustedHighWater,
                adjustedLowWater,
                adjustmentTtlMs: this.config.adjustmentTtlMs,
            }, 'GpuArbiter: Dynamic adjustment applied for long ASR task');
        }
    }
    /**
     * 更新配置
     */
    updateConfig(configPatch) {
        if (configPatch.sampleIntervalMs !== undefined) {
            this.config.sampleIntervalMs = configPatch.sampleIntervalMs;
        }
        if (configPatch.cacheTtlMs !== undefined) {
            this.config.cacheTtlMs = configPatch.cacheTtlMs;
        }
        if (configPatch.baseHighWater !== undefined) {
            this.config.baseHighWater = configPatch.baseHighWater;
        }
        if (configPatch.baseLowWater !== undefined) {
            this.config.baseLowWater = configPatch.baseLowWater;
        }
        if (configPatch.dynamicAdjustmentEnabled !== undefined) {
            this.config.dynamicAdjustmentEnabled = configPatch.dynamicAdjustmentEnabled;
        }
        if (configPatch.longAudioThresholdMs !== undefined) {
            this.config.longAudioThresholdMs = configPatch.longAudioThresholdMs;
        }
        if (configPatch.highWaterBoost !== undefined) {
            this.config.highWaterBoost = configPatch.highWaterBoost;
        }
        if (configPatch.lowWaterBoost !== undefined) {
            this.config.lowWaterBoost = configPatch.lowWaterBoost;
        }
        if (configPatch.adjustmentTtlMs !== undefined) {
            this.config.adjustmentTtlMs = configPatch.adjustmentTtlMs;
        }
        if (configPatch.gpuUsageThreshold !== undefined) {
            this.config.gpuUsageThreshold = configPatch.gpuUsageThreshold;
        }
        // 如果采样间隔改变，重启监控
        const wasMonitoring = this.state.monitorInterval !== null;
        if (wasMonitoring && configPatch.sampleIntervalMs !== undefined) {
            this.stopMonitoring();
            this.startMonitoring();
        }
    }
    /**
     * 记录GPU使用率超过阈值的详细日志
     */
    logGpuUsageExceeded(gpuUsage, gpuMemory) {
        // 收集所有活跃租约的详细信息
        const activeLeasesInfo = [];
        for (const [leaseId, lease] of this.activeLeases.entries()) {
            const holdTimeMs = Date.now() - lease.acquiredAt;
            activeLeasesInfo.push({
                leaseId,
                gpuKey: lease.gpuKey,
                taskType: lease.taskType,
                holdTimeMs,
                jobId: lease.trace?.jobId,
                sessionId: lease.trace?.sessionId,
                utteranceIndex: lease.trace?.utteranceIndex,
                stage: lease.trace?.stage,
            });
        }
        // 按服务类型分组统计
        const serviceStats = {};
        for (const lease of activeLeasesInfo) {
            serviceStats[lease.taskType] = (serviceStats[lease.taskType] || 0) + 1;
        }
        logger_1.default.warn({
            gpuUsage,
            gpuMemory,
            threshold: this.config.gpuUsageThreshold,
            activeLeasesCount: activeLeasesInfo.length,
            activeLeases: activeLeasesInfo,
            serviceStats,
            note: 'GPU使用率超过阈值，当前各服务正在处理的任务详情',
        }, 'GpuArbiter: GPU usage exceeded threshold');
    }
    /**
     * 获取状态（用于快照）
     */
    getStateForSnapshot(gpuKey) {
        return {
            admissionState: this.state.gpuAdmissionStates.get(gpuKey),
            usageCache: this.getGpuUsageFromCache(gpuKey),
        };
    }
}
exports.GpuUsageMonitor = GpuUsageMonitor;
