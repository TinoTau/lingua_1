"use strict";
/**
 * GPU 仲裁器（GpuArbiter）
 * 提供统一的GPU资源租约接口，避免多服务同时抢占GPU
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GpuArbiter = void 0;
const logger_1 = __importDefault(require("../logger"));
const types_1 = require("./types");
const gpu_arbiter_usage_monitor_1 = require("./gpu-arbiter-usage-monitor");
const gpu_arbiter_queue_manager_1 = require("./gpu-arbiter-queue-manager");
const gpu_arbiter_metrics_1 = require("./gpu-arbiter-metrics");
class GpuArbiter {
    constructor(config) {
        // 每个GPU的互斥锁
        this.mutexes = new Map();
        this.activeLeases = new Map();
        this.leaseIdCounter = 0;
        this.config = config;
        this.enabled = config.enabled;
        // 构建GPU使用率监控配置
        const gpuUsageThreshold = config.gpuUsageThreshold ?? 85.0;
        const usageConfig = {
            sampleIntervalMs: config.gpuUsage?.sampleIntervalMs ?? 800,
            cacheTtlMs: config.gpuUsage?.cacheTtlMs ?? 2000,
            baseHighWater: config.gpuUsage?.baseHighWater ?? 85,
            baseLowWater: config.gpuUsage?.baseLowWater ?? 78,
            dynamicAdjustmentEnabled: config.gpuUsage?.dynamicAdjustment?.enabled ?? true,
            longAudioThresholdMs: config.gpuUsage?.dynamicAdjustment?.longAudioThresholdMs ?? 8000,
            highWaterBoost: config.gpuUsage?.dynamicAdjustment?.highWaterBoost ?? 7,
            lowWaterBoost: config.gpuUsage?.dynamicAdjustment?.lowWaterBoost ?? 7,
            adjustmentTtlMs: config.gpuUsage?.dynamicAdjustment?.adjustmentTtlMs ?? 15000,
            gpuUsageThreshold,
        };
        // 初始化模块
        this.usageMonitor = new gpu_arbiter_usage_monitor_1.GpuUsageMonitor(usageConfig, this.activeLeases, (gpuKey) => {
            // 状态恢复正常时，处理等待队列
            this.processQueue(gpuKey);
        });
        this.metricsManager = new gpu_arbiter_metrics_1.GpuArbiterMetricsManager();
        // 初始化队列管理器（需要回调）
        this.queueManager = new gpu_arbiter_queue_manager_1.GpuArbiterQueueManager({
            acquireImmediately: (gpuKey, taskType, holdMaxMs, trace) => {
                return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
            },
            recordMetric: (gpuKey, metricName, value, increment) => {
                this.metricsManager.recordMetric(gpuKey, metricName, value, increment);
            },
            getAdmissionState: (gpuKey) => {
                return this.usageMonitor.getAdmissionState(gpuKey);
            },
            getGpuUsageFromCache: (gpuKey) => {
                const cache = this.usageMonitor.getGpuUsageFromCache(gpuKey);
                return cache ? { usagePercent: cache.usagePercent, sampledAt: cache.sampledAt } : null;
            },
            processQueueCallback: (gpuKey) => {
                this.processQueue(gpuKey);
            },
        });
        // 初始化每个GPU
        for (const gpuKey of config.gpuKeys) {
            this.mutexes.set(gpuKey, false);
            this.usageMonitor.initializeGpuKeys([gpuKey]);
            this.queueManager.initializeGpuKey(gpuKey);
            this.metricsManager.initializeGpuKey(gpuKey);
        }
        // 如果启用，启动GPU使用率监控
        if (this.enabled) {
            this.usageMonitor.startMonitoring();
        }
        logger_1.default.info({
            enabled: this.enabled,
            gpuKeys: config.gpuKeys,
            defaultQueueLimit: config.defaultQueueLimit,
            defaultHoldMaxMs: config.defaultHoldMaxMs,
            gpuUsageThreshold,
            gpuUsage: {
                sampleIntervalMs: usageConfig.sampleIntervalMs,
                cacheTtlMs: usageConfig.cacheTtlMs,
                baseHighWater: usageConfig.baseHighWater,
                baseLowWater: usageConfig.baseLowWater,
                dynamicAdjustmentEnabled: usageConfig.dynamicAdjustmentEnabled,
            },
        }, 'GpuArbiter initialized');
    }
    /**
     * 获取GPU租约
     */
    async acquire(request) {
        if (!this.enabled) {
            const leaseId = this.generateLeaseId();
            return {
                status: "ACQUIRED",
                leaseId,
                acquiredAt: Date.now(),
                queueWaitMs: 0,
            };
        }
        const { gpuKey, taskType, priority, maxWaitMs, holdMaxMs, queueLimit, busyPolicy, trace } = request;
        if (!this.mutexes.has(gpuKey)) {
            logger_1.default.error({ gpuKey, taskType }, 'GpuArbiter: Invalid GPU key - this is a configuration error');
            // 配置错误，抛出异常而不是返回SKIPPED
            throw new Error(`GpuArbiter: Invalid GPU key ${gpuKey} - this is a configuration error`);
        }
        const queue = this.queueManager.getQueue(gpuKey);
        const isLocked = this.mutexes.get(gpuKey);
        const admissionState = this.usageMonitor.getAdmissionState(gpuKey);
        // 检查队列长度，但不拒绝任务
        // 如果队列已满或接近满，记录警告日志，但让任务进入队列等待
        // 资源耗尽应该通过心跳通知调度服务器停止分配任务，而不是直接拒绝已分配的任务
        if (queue.length >= queueLimit) {
            this.metricsManager.recordMetric(gpuKey, 'queueFullTotal', 1);
            logger_1.default.warn({
                gpuKey,
                taskType,
                queueLength: queue.length,
                queueLimit,
                note: 'Queue is full, but task will still wait. Scheduler should stop assigning new tasks based on heartbeat resource usage.',
                ...trace,
            }, 'GpuArbiter: Queue full - task will wait, scheduler should be notified via heartbeat to stop assigning tasks');
            // 不拒绝任务，让它进入队列等待（即使超过 queueLimit）
            // 这样调度服务器分配的任务不会被废弃
        }
        // 如果队列中有任务在等待，记录日志但不拒绝新任务
        // 新任务会进入队列，按 FIFO 顺序等待，前面的任务优先完成
        if (queue.length > 0) {
            const now = Date.now();
            const oldestTask = queue[0];
            const oldestWaitTimeMs = now - oldestTask.queuedAt;
            const gpuUsageInfo = this.usageMonitor.getGpuUsageFromCache(gpuKey);
            const gpuUsagePercent = gpuUsageInfo?.usagePercent || 0;
            logger_1.default.info({
                gpuKey,
                taskType,
                queueLength: queue.length,
                oldestWaitTimeMs,
                gpuUsagePercent,
                oldestTaskType: oldestTask.request.taskType,
                oldestJobId: oldestTask.request.trace?.jobId,
                oldestUtteranceIndex: oldestTask.request.trace?.utteranceIndex,
                newJobId: trace?.jobId,
                newUtteranceIndex: trace?.utteranceIndex,
                ...trace,
            }, 'GpuArbiter: New task will wait in queue - earlier tasks are waiting, FIFO scheduling ensures earlier tasks complete first');
        }
        // 检查GPU使用率状态
        const gpuUsageInfo = this.usageMonitor.getGpuUsageFromCache(gpuKey);
        const isHighPressure = admissionState === types_1.GpuAdmissionState.HIGH_PRESSURE;
        // Admission兜底规则
        if (isHighPressure && !isLocked && queue.length === 0 && taskType === "ASR" && priority >= 90) {
            logger_1.default.debug({
                gpuKey,
                taskType,
                priority,
                admissionState,
                ...trace,
            }, 'GpuArbiter: Admission fallback rule applied for high-priority ASR task');
            return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
        }
        // 如果GPU使用率高，根据任务类型和策略处理
        if (isHighPressure) {
            if (priority >= 70) {
                if (!isLocked) {
                    logger_1.default.debug({
                        gpuKey,
                        taskType,
                        priority,
                        admissionState,
                        gpuUsage: gpuUsageInfo?.usagePercent,
                        ...trace,
                    }, 'GpuArbiter: GPU idle but in HIGH_PRESSURE state, allowing immediate acquire for high-priority task');
                    return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
                }
                return this.enqueueRequest(gpuKey, request, maxWaitMs);
            }
            else {
                // 低优任务：必须等待，不能跳过
                // 资源耗尽应该通过心跳通知调度服务器停止分配任务，而不是直接拒绝已分配的任务
                logger_1.default.info({
                    gpuKey,
                    taskType,
                    priority,
                    admissionState,
                    gpuUsage: gpuUsageInfo?.usagePercent,
                    queueLength: queue.length,
                    note: 'Low-priority task will wait in queue. Scheduler should stop assigning new tasks based on heartbeat resource usage.',
                    ...trace,
                }, 'GpuArbiter: GPU usage high, low-priority task will wait in queue (scheduler should be notified via heartbeat)');
                return this.enqueueRequest(gpuKey, request, maxWaitMs);
            }
        }
        // GPU使用率正常，继续原有逻辑
        if (!isLocked) {
            return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
        }
        // GPU被占用，必须等待，不能跳过
        // 资源耗尽应该通过心跳通知调度服务器停止分配任务，而不是直接拒绝已分配的任务
        logger_1.default.info({
            gpuKey,
            taskType,
            queueLength: queue.length,
            note: 'GPU busy, task will wait in queue. Scheduler should stop assigning new tasks based on heartbeat resource usage.',
            ...trace,
        }, 'GpuArbiter: GPU busy, task will wait in queue (scheduler should be notified via heartbeat)');
        // WAIT策略：加入队列等待
        return this.enqueueRequest(gpuKey, request, maxWaitMs);
    }
    /**
     * 立即获取租约（GPU空闲时）
     */
    acquireImmediately(gpuKey, taskType, holdMaxMs, trace) {
        const leaseId = this.generateLeaseId();
        const acquiredAt = Date.now();
        this.mutexes.set(gpuKey, true);
        const lease = {
            leaseId,
            gpuKey,
            taskType,
            acquiredAt,
            holdMaxMs,
            trace,
        };
        lease.watchdogHandle = setTimeout(() => {
            this.metricsManager.recordMetric(gpuKey, 'watchdogExceededTotal', 1);
            logger_1.default.warn({
                gpuKey,
                taskType,
                leaseId,
                holdTimeMs: Date.now() - acquiredAt,
                holdMaxMs,
                ...trace,
            }, 'GpuArbiter: Lease hold time exceeded holdMaxMs (watchdog)');
        }, holdMaxMs);
        this.activeLeases.set(leaseId, lease);
        this.metricsManager.recordMetric(gpuKey, 'acquireTotal', 'ACQUIRED', 1);
        logger_1.default.info({
            gpuKey,
            taskType,
            leaseId,
            ...trace,
        }, 'GpuArbiter: Lease acquired immediately');
        return {
            status: "ACQUIRED",
            leaseId,
            acquiredAt,
            queueWaitMs: 0,
        };
    }
    /**
     * 将请求加入队列
     */
    enqueueRequest(gpuKey, request, maxWaitMs) {
        const promise = this.queueManager.enqueueRequest(gpuKey, request, maxWaitMs, () => this.generateLeaseId());
        this.processQueue(gpuKey);
        return promise;
    }
    /**
     * 处理队列
     */
    processQueue(gpuKey) {
        const isLocked = this.mutexes.get(gpuKey);
        this.queueManager.processQueue(gpuKey, isLocked);
    }
    /**
     * 释放租约
     */
    release(leaseId) {
        if (!this.enabled) {
            return;
        }
        const lease = this.activeLeases.get(leaseId);
        if (!lease) {
            logger_1.default.warn({ leaseId }, 'GpuArbiter: Attempted to release non-existent lease');
            return;
        }
        const { gpuKey, taskType, acquiredAt } = lease;
        if (lease.watchdogHandle) {
            clearTimeout(lease.watchdogHandle);
        }
        const holdMs = Date.now() - acquiredAt;
        this.metricsManager.recordMetric(gpuKey, 'holdMs', holdMs);
        this.mutexes.set(gpuKey, false);
        this.activeLeases.delete(leaseId);
        const trace = lease.trace || {};
        logger_1.default.debug({
            gpuKey,
            taskType,
            leaseId,
            holdMs,
            ...trace,
        }, 'GpuArbiter: Lease released');
        this.processQueue(gpuKey);
    }
    /**
     * 获取快照（用于监控/调试）
     */
    snapshot(gpuKey) {
        if (!this.mutexes.has(gpuKey)) {
            return null;
        }
        const isLocked = this.mutexes.get(gpuKey);
        const metrics = this.metricsManager.getMetricsSnapshot(gpuKey);
        if (!metrics) {
            return null;
        }
        const monitorState = this.usageMonitor.getStateForSnapshot(gpuKey);
        const queueSnapshot = this.queueManager.getQueueSnapshot(gpuKey);
        let currentLease = null;
        for (const lease of this.activeLeases.values()) {
            if (lease.gpuKey === gpuKey) {
                currentLease = {
                    leaseId: lease.leaseId,
                    taskType: lease.taskType,
                    acquiredAt: lease.acquiredAt,
                    holdTimeMs: Date.now() - lease.acquiredAt,
                };
                break;
            }
        }
        return {
            gpuKey,
            currentLease,
            queueLength: queueSnapshot.length,
            queue: queueSnapshot,
            metrics,
            gpuAdmissionState: monitorState.admissionState,
            gpuUsage: monitorState.usageCache?.usagePercent,
            gpuUsageCacheAgeMs: monitorState.usageCache ? Date.now() - monitorState.usageCache.sampledAt : undefined,
        };
    }
    /**
     * 更新配置
     */
    setConfig(configPatch) {
        const wasEnabled = this.enabled;
        this.config = { ...this.config, ...configPatch };
        this.enabled = this.config.enabled;
        const gpuUsageThreshold = configPatch.gpuUsageThreshold ?? this.config.gpuUsageThreshold ?? 85.0;
        // 更新GPU使用率监控配置
        if (configPatch.gpuUsage || configPatch.gpuUsageThreshold !== undefined) {
            const usageConfigPatch = {};
            if (configPatch.gpuUsageThreshold !== undefined) {
                usageConfigPatch.gpuUsageThreshold = configPatch.gpuUsageThreshold;
            }
            if (configPatch.gpuUsage) {
                if (configPatch.gpuUsage.sampleIntervalMs !== undefined) {
                    usageConfigPatch.sampleIntervalMs = configPatch.gpuUsage.sampleIntervalMs;
                }
                if (configPatch.gpuUsage.cacheTtlMs !== undefined) {
                    usageConfigPatch.cacheTtlMs = configPatch.gpuUsage.cacheTtlMs;
                }
                if (configPatch.gpuUsage.baseHighWater !== undefined) {
                    usageConfigPatch.baseHighWater = configPatch.gpuUsage.baseHighWater;
                }
                if (configPatch.gpuUsage.baseLowWater !== undefined) {
                    usageConfigPatch.baseLowWater = configPatch.gpuUsage.baseLowWater;
                }
                if (configPatch.gpuUsage.dynamicAdjustment) {
                    if (configPatch.gpuUsage.dynamicAdjustment.enabled !== undefined) {
                        usageConfigPatch.dynamicAdjustmentEnabled = configPatch.gpuUsage.dynamicAdjustment.enabled;
                    }
                    if (configPatch.gpuUsage.dynamicAdjustment.longAudioThresholdMs !== undefined) {
                        usageConfigPatch.longAudioThresholdMs = configPatch.gpuUsage.dynamicAdjustment.longAudioThresholdMs;
                    }
                    if (configPatch.gpuUsage.dynamicAdjustment.highWaterBoost !== undefined) {
                        usageConfigPatch.highWaterBoost = configPatch.gpuUsage.dynamicAdjustment.highWaterBoost;
                    }
                    if (configPatch.gpuUsage.dynamicAdjustment.lowWaterBoost !== undefined) {
                        usageConfigPatch.lowWaterBoost = configPatch.gpuUsage.dynamicAdjustment.lowWaterBoost;
                    }
                    if (configPatch.gpuUsage.dynamicAdjustment.adjustmentTtlMs !== undefined) {
                        usageConfigPatch.adjustmentTtlMs = configPatch.gpuUsage.dynamicAdjustment.adjustmentTtlMs;
                    }
                }
            }
            this.usageMonitor.updateConfig(usageConfigPatch);
        }
        // 如果启用状态改变，重新启动或停止监控
        if (this.enabled && !wasEnabled) {
            this.usageMonitor.startMonitoring();
        }
        else if (!this.enabled && wasEnabled) {
            this.usageMonitor.stopMonitoring();
        }
        logger_1.default.info({ config: this.config }, 'GpuArbiter: Config updated');
    }
    /**
     * ASR任务感知的动态滞回调整
     */
    notifyAsrTaskHint(gpuKey, hint) {
        this.usageMonitor.notifyAsrTaskHint(gpuKey, hint);
    }
    /**
     * 生成租约ID
     */
    generateLeaseId() {
        return `lease_${Date.now()}_${++this.leaseIdCounter}`;
    }
    /**
     * 创建租约对象
     */
    createLease(result) {
        return {
            leaseId: result.leaseId,
            gpuKey: this.config.gpuKeys[0],
            taskType: "OTHER",
            acquiredAt: result.acquiredAt,
            holdMaxMs: this.config.defaultHoldMaxMs,
            release: () => this.release(result.leaseId),
        };
    }
}
exports.GpuArbiter = GpuArbiter;
