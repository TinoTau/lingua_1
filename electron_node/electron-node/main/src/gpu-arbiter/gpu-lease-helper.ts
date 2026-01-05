/**
 * GPU 租约辅助函数
 * 提供便捷的GPU租约获取和释放包装
 */

import { getGpuArbiter } from './gpu-arbiter-factory';
import { GpuTaskType, GpuLeaseRequest, GpuLease } from './types';
import logger from '../logger';
import { loadNodeConfig } from '../node-config';

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
      release: () => {},
    };
    return await fn(dummyLease);
  }

  const config = loadNodeConfig();
  const defaultConfig = config.gpuArbiter || {
    enabled: false,
    gpuKeys: ['gpu:0'],
    defaultQueueLimit: 8,
    defaultHoldMaxMs: 8000,
  };

  // 安全获取policy（处理OTHER类型）
  const policy = (taskType !== 'OTHER' && config.gpuArbiter?.policies?.[taskType]) 
    ? config.gpuArbiter.policies[taskType]
    : undefined;

  const request: GpuLeaseRequest = {
    gpuKey: (defaultConfig.gpuKeys && defaultConfig.gpuKeys[0]) || 'gpu:0',
    taskType,
    priority: policy?.priority ?? 50,
    maxWaitMs: policy?.maxWaitMs ?? (defaultConfig.defaultHoldMaxMs ?? 8000),
    holdMaxMs: defaultConfig.defaultHoldMaxMs ?? 8000,
    queueLimit: defaultConfig.defaultQueueLimit ?? 8,
    busyPolicy: policy?.busyPolicy ?? 'WAIT',
    trace: trace || {},
  };

  const result = await gpuArbiter.acquire(request);

  if (result.status === 'SKIPPED') {
    logger.debug(
      {
        taskType,
        reason: result.reason,
        ...trace,
      },
      'GpuLeaseHelper: GPU lease skipped'
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

  // 获取租约成功
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
      release: () => {},
    };
  }

  const config = loadNodeConfig();
  const defaultConfig = config.gpuArbiter || {
    enabled: false,
    gpuKeys: ['gpu:0'],
    defaultQueueLimit: 8,
    defaultHoldMaxMs: 8000,
  };

  // 安全获取policy（处理OTHER类型）
  const policy = (taskType !== 'OTHER' && config.gpuArbiter?.policies?.[taskType]) 
    ? config.gpuArbiter.policies[taskType]
    : undefined;

  const request: GpuLeaseRequest = {
    gpuKey: (defaultConfig.gpuKeys && defaultConfig.gpuKeys[0]) || 'gpu:0',
    taskType,
    priority: policy?.priority ?? 50,
    maxWaitMs: policy?.maxWaitMs ?? (defaultConfig.defaultHoldMaxMs ?? 8000),
    holdMaxMs: defaultConfig.defaultHoldMaxMs ?? 8000,
    queueLimit: defaultConfig.defaultQueueLimit ?? 8,
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
