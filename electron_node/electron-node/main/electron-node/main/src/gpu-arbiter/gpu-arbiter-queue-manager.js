"use strict";
/**
 * GPU仲裁器队列管理模块
 * 负责请求队列的管理、优先级排序和队列处理
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GpuArbiterQueueManager = void 0;
const logger_1 = __importDefault(require("../logger"));
const types_1 = require("./types");
class GpuArbiterQueueManager {
    constructor(callbacks) {
        this.queues = new Map();
        this.callbacks = callbacks;
    }
    /**
     * 初始化GPU队列
     */
    initializeGpuKey(gpuKey) {
        this.queues.set(gpuKey, []);
    }
    /**
     * 获取队列
     */
    getQueue(gpuKey) {
        return this.queues.get(gpuKey) || [];
    }
    /**
     * 将请求加入队列
     */
    enqueueRequest(gpuKey, request, maxWaitMs, generateLeaseId) {
        return new Promise((resolve, reject) => {
            const leaseId = generateLeaseId();
            const queuedAt = Date.now();
            const queue = this.queues.get(gpuKey);
            const pendingRequest = {
                leaseId,
                request,
                queuedAt,
                resolve,
                reject,
            };
            // 设置超时
            pendingRequest.timeoutHandle = setTimeout(() => {
                // 从队列中移除
                const index = queue.indexOf(pendingRequest);
                if (index >= 0) {
                    queue.splice(index, 1);
                }
                this.callbacks.recordMetric(gpuKey, 'timeoutsTotal', 1);
                // 检查是否因为GPU使用率高而超时
                const admissionState = this.callbacks.getAdmissionState(gpuKey);
                const isHighPressure = admissionState === types_1.GpuAdmissionState.HIGH_PRESSURE;
                const timeoutReason = isHighPressure ? "GPU_USAGE_HIGH" : "TIMEOUT";
                logger_1.default.warn({
                    gpuKey,
                    taskType: request.taskType,
                    leaseId,
                    waitTimeMs: Date.now() - queuedAt,
                    maxWaitMs,
                    admissionState,
                    ...request.trace,
                }, `GpuArbiter: Request timeout in queue (${timeoutReason})`);
                if (isHighPressure && request.priority >= 70) {
                    // 高优先级任务在HIGH_PRESSURE状态下超时，返回TIMEOUT状态
                    this.callbacks.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
                    resolve({
                        status: "TIMEOUT",
                        reason: "GPU_USAGE_HIGH",
                    });
                }
                else if (request.busyPolicy === "FALLBACK_CPU") {
                    this.callbacks.recordMetric(gpuKey, 'acquireTotal', 'FALLBACK_CPU', 1);
                    resolve({
                        status: "FALLBACK_CPU",
                        reason: timeoutReason,
                    });
                }
                else {
                    this.callbacks.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
                    resolve({
                        status: "SKIPPED",
                        reason: timeoutReason,
                    });
                }
            }, maxWaitMs);
            // 按 FIFO 插入队列（先到先服务，前面的任务优先完成）
            queue.push(pendingRequest);
            // 尝试处理队列
            if (this.callbacks.processQueueCallback) {
                this.callbacks.processQueueCallback(gpuKey);
            }
        });
    }
    /**
     * 处理队列（尝试从队列中取出请求并分配租约）
     */
    processQueue(gpuKey, isLocked) {
        if (isLocked) {
            return; // GPU被占用，等待释放
        }
        const queue = this.queues.get(gpuKey);
        if (queue.length === 0) {
            return; // 队列为空
        }
        // 检查GPU使用率状态
        const admissionState = this.callbacks.getAdmissionState(gpuKey);
        const usageCache = this.callbacks.getGpuUsageFromCache(gpuKey);
        // FIFO 调度：无论什么状态，都按照到达顺序处理（前面的任务优先完成）
        // 取出队列头部的请求（最早到达的任务）
        const pendingRequest = queue.shift();
        if (pendingRequest.timeoutHandle) {
            clearTimeout(pendingRequest.timeoutHandle);
        }
        const { request } = pendingRequest;
        const result = this.callbacks.acquireImmediately(gpuKey, request.taskType, request.holdMaxMs, request.trace);
        // 记录等待时间
        const queueWaitMs = Date.now() - pendingRequest.queuedAt;
        this.callbacks.recordMetric(gpuKey, 'queueWaitMs', queueWaitMs);
        logger_1.default.info({
            gpuKey,
            taskType: request.taskType,
            leaseId: result.status === "ACQUIRED" ? result.leaseId : undefined,
            queueWaitMs,
            queueLength: queue.length,
            admissionState,
            gpuUsage: usageCache?.usagePercent,
            ...request.trace,
        }, 'GpuArbiter: Task dequeued (FIFO scheduling, first-come-first-served)');
        pendingRequest.resolve(result);
    }
    /**
     * 获取队列快照
     */
    getQueueSnapshot(gpuKey) {
        const queue = this.queues.get(gpuKey) || [];
        return queue.map((req) => ({
            leaseId: req.leaseId,
            taskType: req.request.taskType,
            priority: req.request.priority,
            waitTimeMs: Date.now() - req.queuedAt,
        }));
    }
}
exports.GpuArbiterQueueManager = GpuArbiterQueueManager;
