/**
 * GPU 租约辅助函数
 * 提供便捷的GPU租约获取和释放包装
 */

import { getGpuArbiter, loadGpuArbiterConfig } from './gpu-arbiter-factory';
import { GpuTaskType, GpuLeaseRequest, GpuLease } from './types';
import logger from '../logger';

/**
 * 使用GPU租约执行函数
 * 自动处理租约的获取和释放
 */
export async function withGpuLease<T>(
  taskType: GpuTaskType,
  fn: (lease: GpuLease) => Promise<T>,
  trace?: GpuLeaseRequest['trace']
): Promise<T> {
  const gpuArbiter = getGpuArbiter();
  if (!gpuArbiter) {
    // GPU仲裁器未启用，直接执行
    const dummyLease: GpuLease = {
      leaseId: 'no-arbiter',
      gpuKey: 'gpu:0',
      taskType,
      acquiredAt: Date.now(),
      holdMaxMs: 8000,
      release: () => { },
    };
    return await fn(dummyLease);
  }

  // 使用统一的配置加载逻辑，确保使用正确的默认配置（包括默认的 policies）
  const config = loadGpuArbiterConfig();

  // 安全获取policy（处理OTHER类型）
  const policy = (taskType !== 'OTHER' && config.policies?.[taskType])
    ? config.policies[taskType]
    : undefined;

  const request: GpuLeaseRequest = {
    gpuKey: (config.gpuKeys && config.gpuKeys[0]) || 'gpu:0',
    taskType,
    priority: policy?.priority ?? 50,
    maxWaitMs: policy?.maxWaitMs ?? (config.defaultHoldMaxMs ?? 8000),
    holdMaxMs: config.defaultHoldMaxMs ?? 8000,
    queueLimit: config.defaultQueueLimit ?? 8,
    busyPolicy: policy?.busyPolicy ?? 'WAIT',
    trace: trace || {},
  };

  const result = await gpuArbiter.acquire(request);

  if (result.status === 'SKIPPED') {
    logger.warn(
      {
        taskType,
        reason: result.reason,
        ...trace,
      },
      'GpuLeaseHelper: GPU lease skipped - this will cause job processing to fail'
    );
    throw new Error(`GPU lease skipped: ${result.reason}`);
  }

  if (result.status === 'FALLBACK_CPU') {
    logger.debug(
      {
        taskType,
        reason: result.reason,
        ...trace,
      },
      'GpuLeaseHelper: GPU lease fallback to CPU'
    );
    throw new Error(`GPU lease fallback to CPU: ${result.reason}`);
  }

  if (result.status === 'TIMEOUT') {
    logger.warn(
      {
        taskType,
        reason: result.reason,
        ...trace,
      },
      'GpuLeaseHelper: GPU lease timeout - this will cause job processing to fail'
    );
    throw new Error(`GPU lease timeout: ${result.reason}`);
  }

  // 获取租约成功（此时result.status一定是'ACQUIRED'）
  if (result.status !== 'ACQUIRED') {
    // TypeScript类型保护，理论上不会到达这里
    throw new Error(`Unexpected GPU lease status: ${(result as any).status}`);
  }

  const lease: GpuLease = {
    leaseId: result.leaseId,
    gpuKey: request.gpuKey,
    taskType,
    acquiredAt: result.acquiredAt,
    holdMaxMs: request.holdMaxMs,
    release: () => gpuArbiter.release(result.leaseId),
  };

  try {
    return await fn(lease);
  } finally {
    lease.release();
  }
}

/**
 * 尝试获取GPU租约（非阻塞）
 * 如果获取失败，返回null
 */
export async function tryAcquireGpuLease(
  taskType: GpuTaskType,
  trace?: GpuLeaseRequest['trace']
): Promise<GpuLease | null> {
  const gpuArbiter = getGpuArbiter();
  if (!gpuArbiter) {
    // GPU仲裁器未启用，返回虚拟租约
    return {
      leaseId: 'no-arbiter',
      gpuKey: 'gpu:0',
      taskType,
      acquiredAt: Date.now(),
      holdMaxMs: 8000,
      release: () => { },
    };
  }

  // 使用统一的配置加载逻辑，确保使用正确的默认配置（包括默认的 policies）
  const config = loadGpuArbiterConfig();

  // 安全获取policy（处理OTHER类型）
  const policy = (taskType !== 'OTHER' && config.policies?.[taskType])
    ? config.policies[taskType]
    : undefined;

  const request: GpuLeaseRequest = {
    gpuKey: (config.gpuKeys && config.gpuKeys[0]) || 'gpu:0',
    taskType,
    priority: policy?.priority ?? 50,
    maxWaitMs: policy?.maxWaitMs ?? (config.defaultHoldMaxMs ?? 8000),
    holdMaxMs: config.defaultHoldMaxMs ?? 8000,
    queueLimit: config.defaultQueueLimit ?? 8,
    busyPolicy: policy?.busyPolicy ?? 'WAIT',
    trace: trace || {},
  };

  const result = await gpuArbiter.acquire(request);

  if (result.status !== 'ACQUIRED') {
    return null;
  }

  return {
    leaseId: result.leaseId,
    gpuKey: request.gpuKey,
    taskType,
    acquiredAt: result.acquiredAt,
    holdMaxMs: request.holdMaxMs,
    release: () => gpuArbiter.release(result.leaseId),
  };
}
