/**
 * GPU仲裁器指标统计模块
 * 负责收集和记录GPU仲裁器的各种指标
 */

export interface GpuArbiterMetrics {
  acquireTotal: { ACQUIRED: number; SKIPPED: number; FALLBACK_CPU: number };
  queueWaitMs: number[];
  holdMs: number[];
  timeoutsTotal: number;
  queueFullTotal: number;
  watchdogExceededTotal: number;
}

export class GpuArbiterMetricsManager {
  private metrics: Map<string, GpuArbiterMetrics> = new Map();

  /**
   * 初始化GPU指标
   */
  initializeGpuKey(gpuKey: string): void {
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
  recordMetric(
    gpuKey: string,
    metricName: string,
    value: number | string,
    increment?: number
  ): void {
    const metrics = this.metrics.get(gpuKey);
    if (!metrics) {
      return;
    }

    if (metricName === 'acquireTotal' && typeof value === 'string') {
      metrics.acquireTotal[value as keyof typeof metrics.acquireTotal] += increment || 1;
    } else if (metricName === 'queueWaitMs' && typeof value === 'number') {
      metrics.queueWaitMs.push(value);
      // 限制历史记录长度
      if (metrics.queueWaitMs.length > 1000) {
        metrics.queueWaitMs.shift();
      }
    } else if (metricName === 'holdMs' && typeof value === 'number') {
      metrics.holdMs.push(value);
      // 限制历史记录长度
      if (metrics.holdMs.length > 1000) {
        metrics.holdMs.shift();
      }
    } else if (typeof value === 'number') {
      (metrics as any)[metricName] += increment || value;
    }
  }

  /**
   * 获取指标快照
   */
  getMetricsSnapshot(gpuKey: string): GpuArbiterMetrics | null {
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
  getMetrics(gpuKey: string): GpuArbiterMetrics | undefined {
    return this.metrics.get(gpuKey);
  }
}
