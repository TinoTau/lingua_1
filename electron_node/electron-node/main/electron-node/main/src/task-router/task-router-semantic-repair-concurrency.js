"use strict";
/**
 * Task Router Semantic Repair Concurrency Manager
 * 管理语义修复服务的并发限制
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairConcurrencyManager = void 0;
const logger_1 = __importDefault(require("../logger"));
class SemanticRepairConcurrencyManager {
    constructor(config = {}) {
        this.activeRequests = new Map(); // serviceId -> Set<job_id>
        this.waitingQueue = [];
        this.config = {
            maxConcurrency: config.maxConcurrency || 2,
            serviceMaxConcurrency: config.serviceMaxConcurrency || new Map(),
        };
    }
    /**
     * 获取服务的最大并发数
     */
    getMaxConcurrency(serviceId) {
        return this.config.serviceMaxConcurrency?.get(serviceId) || this.config.maxConcurrency || 2;
    }
    /**
     * 获取当前活跃请求数
     */
    getActiveCount(serviceId) {
        return this.activeRequests.get(serviceId)?.size || 0;
    }
    /**
     * 获取并发许可（如果超过限制则等待）
     */
    async acquire(serviceId, jobId, timeoutMs = 5000) {
        const maxConcurrency = this.getMaxConcurrency(serviceId);
        const activeCount = this.getActiveCount(serviceId);
        // 如果未超过限制，直接获取许可
        if (activeCount < maxConcurrency) {
            this.addActiveRequest(serviceId, jobId);
            logger_1.default.debug({
                serviceId,
                jobId,
                activeCount: activeCount + 1,
                maxConcurrency,
            }, 'SemanticRepairConcurrencyManager: Acquired permit immediately');
            return;
        }
        // 超过限制，加入等待队列
        const queueStartTime = Date.now();
        logger_1.default.info({
            serviceId,
            jobId,
            activeCount,
            maxConcurrency,
            queueLength: this.waitingQueue.length,
            timeoutMs,
            waitingJobIds: this.waitingQueue.map(item => item.jobId),
            activeJobIds: Array.from(this.activeRequests.get(serviceId) || []),
        }, 'SemanticRepairConcurrencyManager: Concurrency limit reached, queuing request');
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                // 从等待队列中移除
                const waitDuration = Date.now() - queueStartTime;
                const index = this.waitingQueue.findIndex((item) => item.serviceId === serviceId && item.jobId === jobId);
                if (index >= 0) {
                    this.waitingQueue.splice(index, 1);
                }
                logger_1.default.warn({
                    serviceId,
                    jobId,
                    waitDurationMs: waitDuration,
                    timeoutMs,
                    activeCount: this.getActiveCount(serviceId),
                    queueLength: this.waitingQueue.length,
                    activeJobIds: Array.from(this.activeRequests.get(serviceId) || []),
                }, 'SemanticRepairConcurrencyManager: Concurrency timeout - job waited too long');
                reject(new Error(`Semantic repair concurrency timeout for ${serviceId}, job ${jobId}`));
            }, timeoutMs);
            this.waitingQueue.push({
                serviceId,
                jobId,
                resolve: () => {
                    clearTimeout(timeout);
                    const waitDuration = Date.now() - queueStartTime;
                    logger_1.default.info({
                        serviceId,
                        jobId,
                        waitDurationMs: waitDuration,
                        queueLength: this.waitingQueue.length - 1,
                        activeCount: this.getActiveCount(serviceId),
                    }, 'SemanticRepairConcurrencyManager: Permit acquired after waiting');
                    this.addActiveRequest(serviceId, jobId);
                    resolve();
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
                timeout,
            });
            // 尝试处理等待队列
            this.processWaitingQueue();
        });
    }
    /**
     * 释放并发许可
     */
    release(serviceId, jobId) {
        const activeSet = this.activeRequests.get(serviceId);
        if (activeSet) {
            activeSet.delete(jobId);
            if (activeSet.size === 0) {
                this.activeRequests.delete(serviceId);
            }
        }
        const activeCountAfter = this.getActiveCount(serviceId);
        const queueLengthBefore = this.waitingQueue.length;
        logger_1.default.info({
            serviceId,
            jobId,
            activeCount: activeCountAfter,
            queueLengthBefore,
            waitingJobIds: this.waitingQueue.map(item => item.jobId),
        }, 'SemanticRepairConcurrencyManager: Released permit, processing waiting queue');
        // 处理等待队列
        this.processWaitingQueue();
        const queueLengthAfter = this.waitingQueue.length;
        if (queueLengthAfter < queueLengthBefore) {
            logger_1.default.info({
                serviceId,
                queueLengthBefore,
                queueLengthAfter,
                processedCount: queueLengthBefore - queueLengthAfter,
            }, 'SemanticRepairConcurrencyManager: Processed waiting queue items');
        }
    }
    /**
     * 添加活跃请求
     */
    addActiveRequest(serviceId, jobId) {
        let activeSet = this.activeRequests.get(serviceId);
        if (!activeSet) {
            activeSet = new Set();
            this.activeRequests.set(serviceId, activeSet);
        }
        activeSet.add(jobId);
    }
    /**
     * 处理等待队列
     */
    processWaitingQueue() {
        for (let i = this.waitingQueue.length - 1; i >= 0; i--) {
            const item = this.waitingQueue[i];
            const activeCount = this.getActiveCount(item.serviceId);
            const maxConcurrency = this.getMaxConcurrency(item.serviceId);
            if (activeCount < maxConcurrency) {
                // 可以处理，从队列中移除
                this.waitingQueue.splice(i, 1);
                item.resolve();
            }
        }
    }
    /**
     * 获取统计信息
     */
    getStats() {
        const activeRequests = new Map();
        for (const [serviceId, set] of this.activeRequests.entries()) {
            activeRequests.set(serviceId, set.size);
        }
        return {
            activeRequests,
            waitingQueue: this.waitingQueue.length,
        };
    }
}
exports.SemanticRepairConcurrencyManager = SemanticRepairConcurrencyManager;
