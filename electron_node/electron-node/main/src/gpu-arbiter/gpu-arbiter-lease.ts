/**
 * GPU 仲裁器租约逻辑：ActiveLease 构建与看门狗
 * 从 gpu-arbiter.ts 迁出，仅迁移实现，不新增逻辑与调用路径。
 */

import logger from '../logger';
import type { GpuTaskType, GpuLeaseRequest } from './types';

export interface ActiveLease {
  leaseId: string;
  gpuKey: string;
  taskType: GpuTaskType;
  acquiredAt: number;
  holdMaxMs: number;
  watchdogHandle?: NodeJS.Timeout;
  trace?: GpuLeaseRequest['trace'];
  /** 释放时调用，用于清除看门狗定时器 */
  clearWatchdog?: () => void;
}

export type RecordMetricFn = (gpuKey: string, metricName: string, value: number | string, increment?: number) => void;

/**
 * 构建租约并安排看门狗定时器；返回的 lease 带 clearWatchdog，释放时需调用
 */
export function buildActiveLeaseWithWatchdog(
  leaseId: string,
  gpuKey: string,
  taskType: GpuTaskType,
  holdMaxMs: number,
  trace: GpuLeaseRequest['trace'] | undefined,
  acquiredAt: number,
  recordMetric: RecordMetricFn
): ActiveLease {
  const watchdogHandle = setTimeout(() => {
    recordMetric(gpuKey, 'watchdogExceededTotal', 1, 1);
    logger.warn(
      {
        gpuKey,
        taskType,
        leaseId,
        holdTimeMs: Date.now() - acquiredAt,
        holdMaxMs,
        ...trace,
      },
      'GpuArbiter: Lease hold time exceeded holdMaxMs (watchdog)'
    );
  }, holdMaxMs);

  const lease: ActiveLease = {
    leaseId,
    gpuKey,
    taskType,
    acquiredAt,
    holdMaxMs,
    trace,
    watchdogHandle,
    clearWatchdog: () => {
      if (watchdogHandle) clearTimeout(watchdogHandle);
    },
  };

  return lease;
}
