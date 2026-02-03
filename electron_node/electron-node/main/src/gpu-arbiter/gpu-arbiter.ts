/**
 * GPU 仲裁器（GpuArbiter）
 * 提供统一的GPU资源租约接口，避免多服务同时抢占GPU
 */

import logger from '../logger';
import {
  GpuTaskType,
  GpuLeaseRequest,
  GpuLeaseAcquireResult,
  GpuLease,
  GpuArbiterConfig,
  GpuArbiterSnapshot,
  GpuAdmissionState,
  AsrGpuHint,
} from './types';
import { GpuUsageMonitor, GpuUsageMonitorConfig } from './gpu-arbiter-usage-monitor';
import { GpuArbiterQueueManager } from './gpu-arbiter-queue-manager';
import { GpuArbiterMetricsManager } from './gpu-arbiter-metrics';
import { ActiveLease, buildActiveLeaseWithWatchdog } from './gpu-arbiter-lease';
import { getAcquireDecision } from './gpu-arbiter-acquire-admission';
import { buildUsageConfigPatch } from './gpu-arbiter-config-patch';

export class GpuArbiter {
  private config: GpuArbiterConfig;
  private enabled: boolean;

  // 每个GPU的互斥锁
  private mutexes: Map<string, boolean> = new Map();
  private activeLeases: Map<string, ActiveLease> = new Map();

  private leaseIdCounter: number = 0;

  // 模块化组件
  private usageMonitor: GpuUsageMonitor;
  private queueManager: GpuArbiterQueueManager;
  private metricsManager: GpuArbiterMetricsManager;

  constructor(config: GpuArbiterConfig) {
    this.config = config;
    this.enabled = config.enabled;

    // 构建GPU使用率监控配置
    const gpuUsageThreshold = config.gpuUsageThreshold ?? 85.0;
    const usageConfig: GpuUsageMonitorConfig = {
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
    this.usageMonitor = new GpuUsageMonitor(
      usageConfig,
      this.activeLeases as any,
      (gpuKey) => {
        // 状态恢复正常时，处理等待队列
        this.processQueue(gpuKey);
      }
    );
    this.metricsManager = new GpuArbiterMetricsManager();

    // 初始化队列管理器（需要回调）
    this.queueManager = new GpuArbiterQueueManager({
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

    logger.info(
      {
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
      },
      'GpuArbiter initialized'
    );
  }

  /**
   * 获取GPU租约
   */
  async acquire(request: GpuLeaseRequest): Promise<GpuLeaseAcquireResult> {
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
      logger.error({ gpuKey, taskType }, 'GpuArbiter: Invalid GPU key - this is a configuration error');
      // 配置错误，抛出异常而不是返回SKIPPED
      throw new Error(`GpuArbiter: Invalid GPU key ${gpuKey} - this is a configuration error`);
    }

    const queue = this.queueManager.getQueue(gpuKey);
    const isLocked = this.mutexes.get(gpuKey)!;
    const admissionState = this.usageMonitor.getAdmissionState(gpuKey)!;

    // 检查队列长度，但不拒绝任务
    // 如果队列已满或接近满，记录警告日志，但让任务进入队列等待
    // 资源耗尽应该通过心跳通知调度服务器停止分配任务，而不是直接拒绝已分配的任务
    if (queue.length >= queueLimit) {
      this.metricsManager.recordMetric(gpuKey, 'queueFullTotal', 1);
      logger.warn(
        {
          gpuKey,
          taskType,
          queueLength: queue.length,
          queueLimit,
          note: 'Queue is full, but task will still wait. Scheduler should stop assigning new tasks based on heartbeat resource usage.',
          ...trace,
        },
        'GpuArbiter: Queue full - task will wait, scheduler should be notified via heartbeat to stop assigning tasks'
      );
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

      logger.info(
        {
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
        },
        'GpuArbiter: New task will wait in queue - earlier tasks are waiting, FIFO scheduling ensures earlier tasks complete first'
      );
    }

    const gpuUsageInfo = this.usageMonitor.getGpuUsageFromCache(gpuKey);
    const isHighPressure = admissionState === GpuAdmissionState.HIGH_PRESSURE;
    const decision = getAcquireDecision(admissionState, isLocked, queue.length, taskType, priority);

    if (decision === 'ACQUIRE_NOW') {
      if (isHighPressure && !isLocked && queue.length === 0 && taskType === 'ASR' && priority >= 90) {
        logger.debug(
          { gpuKey, taskType, priority, admissionState, ...trace },
          'GpuArbiter: Admission fallback rule applied for high-priority ASR task'
        );
      } else if (isHighPressure && priority >= 70 && !isLocked) {
        logger.debug(
          { gpuKey, taskType, priority, admissionState, gpuUsage: gpuUsageInfo?.usagePercent, ...trace },
          'GpuArbiter: GPU idle but in HIGH_PRESSURE state, allowing immediate acquire for high-priority task'
        );
      }
      return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
    }

    if (isHighPressure && priority < 70) {
      logger.info(
        {
          gpuKey,
          taskType,
          priority,
          admissionState,
          gpuUsage: gpuUsageInfo?.usagePercent,
          queueLength: queue.length,
          note: 'Low-priority task will wait in queue. Scheduler should stop assigning new tasks based on heartbeat resource usage.',
          ...trace,
        },
        'GpuArbiter: GPU usage high, low-priority task will wait in queue (scheduler should be notified via heartbeat)'
      );
    } else if (!isHighPressure && isLocked) {
      logger.info(
        {
          gpuKey,
          taskType,
          queueLength: queue.length,
          note: 'GPU busy, task will wait in queue. Scheduler should stop assigning new tasks based on heartbeat resource usage.',
          ...trace,
        },
        'GpuArbiter: GPU busy, task will wait in queue (scheduler should be notified via heartbeat)'
      );
    }

    return this.enqueueRequest(gpuKey, request, maxWaitMs);
  }

  /**
   * 立即获取租约（GPU空闲时）
   */
  private acquireImmediately(
    gpuKey: string,
    taskType: GpuTaskType,
    holdMaxMs: number,
    trace: GpuLeaseRequest['trace']
  ): GpuLeaseAcquireResult {
    const leaseId = this.generateLeaseId();
    const acquiredAt = Date.now();

    this.mutexes.set(gpuKey, true);

    const recordMetric = (k: string, name: string, value: number | string, inc?: number) => {
      this.metricsManager.recordMetric(k, name, value, inc);
    };
    const lease = buildActiveLeaseWithWatchdog(
      leaseId,
      gpuKey,
      taskType,
      holdMaxMs,
      trace,
      acquiredAt,
      recordMetric
    );

    this.activeLeases.set(leaseId, lease);
    this.metricsManager.recordMetric(gpuKey, 'acquireTotal', 'ACQUIRED', 1);

    logger.info(
      {
        gpuKey,
        taskType,
        leaseId,
        ...trace,
      },
      'GpuArbiter: Lease acquired immediately'
    );

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
  private enqueueRequest(
    gpuKey: string,
    request: GpuLeaseRequest,
    maxWaitMs: number
  ): Promise<GpuLeaseAcquireResult> {
    const promise = this.queueManager.enqueueRequest(gpuKey, request, maxWaitMs, () => this.generateLeaseId());
    this.processQueue(gpuKey);
    return promise;
  }

  /**
   * 处理队列
   */
  private processQueue(gpuKey: string): void {
    const isLocked = this.mutexes.get(gpuKey)!;
    this.queueManager.processQueue(gpuKey, isLocked);
  }

  /**
   * 释放租约
   */
  release(leaseId: string): void {
    if (!this.enabled) {
      return;
    }

    const lease = this.activeLeases.get(leaseId);
    if (!lease) {
      logger.warn({ leaseId }, 'GpuArbiter: Attempted to release non-existent lease');
      return;
    }

    const { gpuKey, taskType, acquiredAt } = lease;

    lease.clearWatchdog?.();

    const holdMs = Date.now() - acquiredAt;
    this.metricsManager.recordMetric(gpuKey, 'holdMs', holdMs);

    this.mutexes.set(gpuKey, false);
    this.activeLeases.delete(leaseId);

    const trace = lease.trace || {};

    logger.debug(
      {
        gpuKey,
        taskType,
        leaseId,
        holdMs,
        ...trace,
      },
      'GpuArbiter: Lease released'
    );

    this.processQueue(gpuKey);
  }

  /**
   * 获取快照（用于监控/调试）
   */
  snapshot(gpuKey: string): GpuArbiterSnapshot | null {
    if (!this.mutexes.has(gpuKey)) {
      return null;
    }

    const isLocked = this.mutexes.get(gpuKey)!;
    const metrics = this.metricsManager.getMetricsSnapshot(gpuKey);
    if (!metrics) {
      return null;
    }

    const monitorState = this.usageMonitor.getStateForSnapshot(gpuKey);
    const queueSnapshot = this.queueManager.getQueueSnapshot(gpuKey);

    let currentLease: GpuArbiterSnapshot['currentLease'] = null;
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
  setConfig(configPatch: Partial<GpuArbiterConfig>): void {
    const wasEnabled = this.enabled;
    this.config = { ...this.config, ...configPatch };
    this.enabled = this.config.enabled;

    const gpuUsageThreshold = configPatch.gpuUsageThreshold ?? this.config.gpuUsageThreshold ?? 85.0;

    if (configPatch.gpuUsage || configPatch.gpuUsageThreshold !== undefined) {
      const usageConfigPatch = buildUsageConfigPatch(configPatch);
      if (Object.keys(usageConfigPatch).length > 0) {
        this.usageMonitor.updateConfig(usageConfigPatch);
      }
    }

    // 如果启用状态改变，重新启动或停止监控
    if (this.enabled && !wasEnabled) {
      this.usageMonitor.startMonitoring();
    } else if (!this.enabled && wasEnabled) {
      this.usageMonitor.stopMonitoring();
    }

    logger.info({ config: this.config }, 'GpuArbiter: Config updated');
  }

  /**
   * ASR任务感知的动态滞回调整
   */
  notifyAsrTaskHint(gpuKey: string, hint: AsrGpuHint): void {
    this.usageMonitor.notifyAsrTaskHint(gpuKey, hint);
  }

  /**
   * 生成租约ID
   */
  private generateLeaseId(): string {
    return `lease_${Date.now()}_${++this.leaseIdCounter}`;
  }

  /**
   * 创建租约对象
   */
  createLease(result: GpuLeaseAcquireResult & { status: "ACQUIRED" }): GpuLease {
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
