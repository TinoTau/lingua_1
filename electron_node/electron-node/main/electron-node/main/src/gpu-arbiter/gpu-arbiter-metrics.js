"use strict";
/**
 * GPU仲裁器指标统计模块
 * 负责收集和记录GPU仲裁器的各种指标
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GpuArbiterMetricsManager = void 0;
class GpuArbiterMetricsManager {
    constructor() {
        this.metrics = new Map();
    }
    /**
     * 初始化GPU指标
     */
    initializeGpuKey(gpuKey) {
        this.metrics.set(gpuKey, {
            acquireTotal: { ACQUIRED: 0, SKIPPED: 0, FALLBACK_CPU: 0 },
            queueWaitMs: [],
            holdMs: [],
            timeoutsTotal: 0,
            queueFullTotal: 0,
            watchdogExceededTotal: 0,
        });
    }
    /**
     * 记录指标
     */
    recordMetric(gpuKey, metricName, value, increment) {
        const metrics = this.metrics.get(gpuKey);
        if (!metrics) {
            return;
        }
        if (metricName === 'acquireTotal' && typeof value === 'string') {
            metrics.acquireTotal[value] += increment || 1;
        }
        else if (metricName === 'queueWaitMs' && typeof value === 'number') {
            metrics.queueWaitMs.push(value);
            // 限制历史记录长度
            if (metrics.queueWaitMs.length > 1000) {
                metrics.queueWaitMs.shift();
            }
        }
        else if (metricName === 'holdMs' && typeof value === 'number') {
            metrics.holdMs.push(value);
            // 限制历史记录长度
            if (metrics.holdMs.length > 1000) {
                metrics.holdMs.shift();
            }
        }
        else if (typeof value === 'number') {
            metrics[metricName] += increment || value;
        }
    }
    /**
     * 获取指标快照
     */
    getMetricsSnapshot(gpuKey) {
        const metrics = this.metrics.get(gpuKey);
        if (!metrics) {
            return null;
        }
        return {
            ...metrics,
            queueWaitMs: [...metrics.queueWaitMs].slice(-100), // 保留最近100条
            holdMs: [...metrics.holdMs].slice(-100), // 保留最近100条
        };
    }
    /**
     * 获取原始指标（用于内部使用）
     */
    getMetrics(gpuKey) {
        return this.metrics.get(gpuKey);
    }
}
exports.GpuArbiterMetricsManager = GpuArbiterMetricsManager;
