/**
 * GPU 仲裁器（GpuArbiter）
 * 提供统一的GPU资源租约接口，避免多服务同时抢占GPU
 */

import logger from '../logger';
import { getGpuUsage } from '../system-resources';
import {
  GpuTaskType,
  GpuLeaseRequest,
  GpuLeaseAcquireResult,
  GpuLease,
  GpuArbiterConfig,
  GpuArbiterSnapshot,
  BusyPolicy,
  GpuUsageCache,
  GpuAdmissionState,
  AsrGpuHint,
} from './types';

interface PendingRequest {
  leaseId: string;
  request: GpuLeaseRequest;
  queuedAt: number;
  resolve: (result: GpuLeaseAcquireResult) => void;
  reject: (error: Error) => void;
  timeoutHandle?: NodeJS.Timeout;
}

interface ActiveLease {
  leaseId: string;
  gpuKey: string;
  taskType: GpuTaskType;
  acquiredAt: number;
  holdMaxMs: number;
  watchdogHandle?: NodeJS.Timeout;
  trace?: GpuLeaseRequest['trace']; // 保存trace信息用于释放时记录
}

export class GpuArbiter {
  private config: GpuArbiterConfig;
  private enabled: boolean;
  
  // 每个GPU的互斥锁和队列
  private mutexes: Map<string, boolean> = new Map();  // gpuKey -> isLocked
  private queues: Map<string, PendingRequest[]> = new Map();  // gpuKey -> queue
  private activeLeases: Map<string, ActiveLease> = new Map();  // leaseId -> lease
  
  // 指标统计
  private metrics: Map<string, {
    acquireTotal: { ACQUIRED: number; SKIPPED: number; FALLBACK_CPU: number };
    queueWaitMs: number[];
    holdMs: number[];
    timeoutsTotal: number;
    queueFullTotal: number;
    watchdogExceededTotal: number;
  }> = new Map();
  
  private leaseIdCounter: number = 0;
  
  // GPU使用率监控和缓存
  private gpuUsageMonitorInterval: NodeJS.Timeout | null = null;
  private gpuUsageCache: Map<string, GpuUsageCache> = new Map(); // gpuKey -> cache
  private gpuAdmissionStates: Map<string, GpuAdmissionState> = new Map(); // gpuKey -> state
  private gpuUsageThreshold: number = 85.0; // 默认阈值85%（向后兼容）
  private lastLoggedGpuUsage: number | null = null; // 上次记录的GPU使用率，用于避免重复日志
  private lastLogTime: number = 0; // 上次记录日志的时间戳
  
  // GPU使用率配置
  private usageSampleIntervalMs: number = 800;
  private usageCacheTtlMs: number = 2000;
  private baseHighWater: number = 85;
  private baseLowWater: number = 78;
  
  // 动态调整配置
  private dynamicAdjustmentEnabled: boolean = true;
  private longAudioThresholdMs: number = 8000;
  private highWaterBoost: number = 7;
  private lowWaterBoost: number = 7;
  private adjustmentTtlMs: number = 15000;
  
  // 动态调整状态（按gpuKey）
  private dynamicAdjustments: Map<string, {
    highWater: number;
    lowWater: number;
    expiresAt: number;
  }> = new Map();

  constructor(config: GpuArbiterConfig) {
    this.config = config;
    this.enabled = config.enabled;
    
    // 从配置中读取GPU使用率阈值（向后兼容）
    if (config.gpuUsageThreshold !== undefined) {
      this.gpuUsageThreshold = config.gpuUsageThreshold;
    }
    
    // 读取GPU使用率配置
    if (config.gpuUsage) {
      this.usageSampleIntervalMs = config.gpuUsage.sampleIntervalMs ?? 800;
      this.usageCacheTtlMs = config.gpuUsage.cacheTtlMs ?? 2000;
      this.baseHighWater = config.gpuUsage.baseHighWater ?? 85;
      this.baseLowWater = config.gpuUsage.baseLowWater ?? 78;
      
      if (config.gpuUsage.dynamicAdjustment) {
        this.dynamicAdjustmentEnabled = config.gpuUsage.dynamicAdjustment.enabled ?? true;
        this.longAudioThresholdMs = config.gpuUsage.dynamicAdjustment.longAudioThresholdMs ?? 8000;
        this.highWaterBoost = config.gpuUsage.dynamicAdjustment.highWaterBoost ?? 7;
        this.lowWaterBoost = config.gpuUsage.dynamicAdjustment.lowWaterBoost ?? 7;
        this.adjustmentTtlMs = config.gpuUsage.dynamicAdjustment.adjustmentTtlMs ?? 15000;
      }
    }
    
    // 初始化每个GPU的互斥锁、队列、状态和缓存
    for (const gpuKey of config.gpuKeys) {
      this.mutexes.set(gpuKey, false);
      this.queues.set(gpuKey, []);
      this.gpuAdmissionStates.set(gpuKey, GpuAdmissionState.NORMAL);
      this.metrics.set(gpuKey, {
        acquireTotal: { ACQUIRED: 0, SKIPPED: 0, FALLBACK_CPU: 0 },
        queueWaitMs: [],
        holdMs: [],
        timeoutsTotal: 0,
        queueFullTotal: 0,
        watchdogExceededTotal: 0,
      });
    }
    
    // 如果启用，启动GPU使用率监控
    if (this.enabled) {
      this.startGpuUsageMonitoring();
    }
    
    logger.info(
      {
        enabled: this.enabled,
        gpuKeys: config.gpuKeys,
        defaultQueueLimit: config.defaultQueueLimit,
        defaultHoldMaxMs: config.defaultHoldMaxMs,
        gpuUsageThreshold: this.gpuUsageThreshold,
        gpuUsage: {
          sampleIntervalMs: this.usageSampleIntervalMs,
          cacheTtlMs: this.usageCacheTtlMs,
          baseHighWater: this.baseHighWater,
          baseLowWater: this.baseLowWater,
          dynamicAdjustmentEnabled: this.dynamicAdjustmentEnabled,
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
      // 如果未启用，直接返回ACQUIRED（不进行仲裁）
      const leaseId = this.generateLeaseId();
      return {
        status: "ACQUIRED",
        leaseId,
        acquiredAt: Date.now(),
        queueWaitMs: 0,
      };
    }

    const { gpuKey, taskType, priority, maxWaitMs, holdMaxMs, queueLimit, busyPolicy, trace } = request;

    // 检查GPU Key是否有效
    if (!this.mutexes.has(gpuKey)) {
      logger.error({ gpuKey, taskType }, 'GpuArbiter: Invalid GPU key');
      return {
        status: "SKIPPED",
        reason: "GPU_BUSY",
      };
    }

    const queue = this.queues.get(gpuKey)!;
    const isLocked = this.mutexes.get(gpuKey)!;
    const admissionState = this.gpuAdmissionStates.get(gpuKey)!;

    // 检查队列是否已满
    if (queue.length >= queueLimit) {
      this.recordMetric(gpuKey, 'queueFullTotal', 1);
      logger.warn(
        {
          gpuKey,
          taskType,
          queueLength: queue.length,
          queueLimit,
          ...trace,
        },
        'GpuArbiter: Queue full'
      );

      if (busyPolicy === "SKIP") {
        this.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
        return {
          status: "SKIPPED",
          reason: "QUEUE_FULL",
        };
      } else if (busyPolicy === "FALLBACK_CPU") {
        this.recordMetric(gpuKey, 'acquireTotal', 'FALLBACK_CPU', 1);
        return {
          status: "FALLBACK_CPU",
          reason: "QUEUE_FULL",
        };
      }
      // WAIT策略：继续等待（但队列已满，实际上会超时）
    }

    // 检查GPU使用率状态（只读缓存，O(1)操作）
    const gpuUsageInfo = this.getGpuUsageFromCache(gpuKey);
    const isHighPressure = admissionState === GpuAdmissionState.HIGH_PRESSURE;

    // Admission兜底规则：即使usage >= highWater，如果无active lease且队列为空，允许最高优任务（ASR）尝试acquire
    if (isHighPressure && !isLocked && queue.length === 0 && taskType === "ASR" && priority >= 90) {
      logger.debug(
        {
          gpuKey,
          taskType,
          priority,
          admissionState,
          ...trace,
        },
        'GpuArbiter: Admission fallback rule applied for high-priority ASR task'
      );
      return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
    }

    // 如果GPU使用率高，根据任务类型和策略处理
    if (isHighPressure) {
      // 高优任务（ASR/NMT/TTS）：允许进入等待队列
      if (priority >= 70) {
        // 如果GPU空闲，检查是否可以立即获取（在HIGH_PRESSURE状态下，通常需要等待）
        if (!isLocked) {
          // 在HIGH_PRESSURE状态下，即使GPU空闲，也建议等待，但允许立即获取
          // 这样可以避免在GPU使用率刚降低但状态还未切换时立即分配新任务
          logger.debug(
            {
              gpuKey,
              taskType,
              priority,
              admissionState,
              gpuUsage: gpuUsageInfo?.usagePercent,
              ...trace,
            },
            'GpuArbiter: GPU idle but in HIGH_PRESSURE state, allowing immediate acquire for high-priority task'
          );
          return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
        }
        // GPU被占用，加入队列等待
        return this.enqueueRequest(gpuKey, request, maxWaitMs);
      } else {
        // 低优任务（Semantic Repair）：直接SKIP/FALLBACK，不入队
        if (busyPolicy === "SKIP") {
          this.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
          logger.debug(
            {
              gpuKey,
              taskType,
              priority,
              admissionState,
              gpuUsage: gpuUsageInfo?.usagePercent,
              ...trace,
            },
            'GpuArbiter: GPU usage high, skipping low-priority task (SKIP policy)'
          );
          return {
            status: "SKIPPED",
            reason: "GPU_USAGE_HIGH",
          };
        } else if (busyPolicy === "FALLBACK_CPU") {
          this.recordMetric(gpuKey, 'acquireTotal', 'FALLBACK_CPU', 1);
          logger.debug(
            {
              gpuKey,
              taskType,
              priority,
              admissionState,
              gpuUsage: gpuUsageInfo?.usagePercent,
              ...trace,
            },
            'GpuArbiter: GPU usage high, falling back to CPU for low-priority task (FALLBACK_CPU policy)'
          );
          return {
            status: "FALLBACK_CPU",
            reason: "GPU_USAGE_HIGH",
          };
        }
        // WAIT策略的低优任务在HIGH_PRESSURE状态下也直接SKIP
        this.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
        return {
          status: "SKIPPED",
          reason: "GPU_USAGE_HIGH",
        };
      }
    }

    // GPU使用率正常，继续原有逻辑
    // 如果GPU空闲，直接获取
    if (!isLocked) {
      return this.acquireImmediately(gpuKey, taskType, holdMaxMs, trace);
    }

    // GPU被占用，根据策略处理
    if (busyPolicy === "SKIP") {
      this.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
      logger.debug(
        {
          gpuKey,
          taskType,
          ...trace,
        },
        'GpuArbiter: GPU busy, skipping (SKIP policy)'
      );
      return {
        status: "SKIPPED",
        reason: "GPU_BUSY",
      };
    }

    if (busyPolicy === "FALLBACK_CPU") {
      this.recordMetric(gpuKey, 'acquireTotal', 'FALLBACK_CPU', 1);
      logger.debug(
        {
          gpuKey,
          taskType,
          ...trace,
        },
        'GpuArbiter: GPU busy, falling back to CPU (FALLBACK_CPU policy)'
      );
      return {
        status: "FALLBACK_CPU",
        reason: "GPU_BUSY",
      };
    }

    // WAIT策略：加入队列等待
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

    // 锁定GPU
    this.mutexes.set(gpuKey, true);

    // 创建活跃租约
    const lease: ActiveLease = {
      leaseId,
      gpuKey,
      taskType,
      acquiredAt,
      holdMaxMs,
      trace, // 保存trace信息
    };

    // 设置watchdog
    lease.watchdogHandle = setTimeout(() => {
      this.recordMetric(gpuKey, 'watchdogExceededTotal', 1);
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

    this.activeLeases.set(leaseId, lease);
    this.recordMetric(gpuKey, 'acquireTotal', 'ACQUIRED', 1);

    logger.info(
      {
        gpuKey,
        taskType,
        leaseId,
        ...trace, // 包含jobId, sessionId, utteranceIndex, stage等信息
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
    return new Promise((resolve, reject) => {
      const leaseId = this.generateLeaseId();
      const queuedAt = Date.now();
      const queue = this.queues.get(gpuKey)!;

      const pendingRequest: PendingRequest = {
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

        this.recordMetric(gpuKey, 'timeoutsTotal', 1);
        
        // 检查是否因为GPU使用率高而超时
        const admissionState = this.gpuAdmissionStates.get(gpuKey);
        const isHighPressure = admissionState === GpuAdmissionState.HIGH_PRESSURE;
        const timeoutReason = isHighPressure ? "GPU_USAGE_HIGH" : "TIMEOUT";

        logger.warn(
          {
            gpuKey,
            taskType: request.taskType,
            leaseId,
            waitTimeMs: Date.now() - queuedAt,
            maxWaitMs,
            admissionState,
            ...request.trace,
          },
          `GpuArbiter: Request timeout in queue (${timeoutReason})`
        );

        if (isHighPressure && request.priority >= 70) {
          // 高优先级任务在HIGH_PRESSURE状态下超时，返回TIMEOUT状态
          this.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
          resolve({
            status: "TIMEOUT",
            reason: "GPU_USAGE_HIGH",
          });
        } else if (request.busyPolicy === "FALLBACK_CPU") {
          this.recordMetric(gpuKey, 'acquireTotal', 'FALLBACK_CPU', 1);
          resolve({
            status: "FALLBACK_CPU",
            reason: timeoutReason,
          });
        } else {
          this.recordMetric(gpuKey, 'acquireTotal', 'SKIPPED', 1);
          resolve({
            status: "SKIPPED",
            reason: timeoutReason,
          });
        }
      }, maxWaitMs);

      // 按优先级插入队列（优先级高的在前，同优先级按FIFO）
      this.insertByPriority(queue, pendingRequest);
      this.processQueue(gpuKey);
    });
  }

  /**
   * 按优先级插入队列
   */
  private insertByPriority(queue: PendingRequest[], request: PendingRequest): void {
    const priority = request.request.priority;
    let insertIndex = queue.length;

    // 找到第一个优先级小于等于当前请求的位置
    for (let i = 0; i < queue.length; i++) {
      if (queue[i].request.priority < priority) {
        insertIndex = i;
        break;
      }
    }

    queue.splice(insertIndex, 0, request);
  }

  /**
   * 处理队列（尝试从队列中取出请求并分配租约）
   */
  private processQueue(gpuKey: string): void {
    const isLocked = this.mutexes.get(gpuKey)!;
    if (isLocked) {
      return; // GPU被占用，等待释放
    }

    const queue = this.queues.get(gpuKey)!;
    if (queue.length === 0) {
      return; // 队列为空
    }

    // 检查GPU使用率状态
    const admissionState = this.gpuAdmissionStates.get(gpuKey)!;
    const usageCache = this.getGpuUsageFromCache(gpuKey);
    
    // 如果处于HIGH_PRESSURE状态，只处理高优先级任务
    if (admissionState === GpuAdmissionState.HIGH_PRESSURE) {
      // 查找第一个高优先级任务（priority >= 70）
      const highPriorityIndex = queue.findIndex(req => req.request.priority >= 70);
      if (highPriorityIndex === -1) {
        // 没有高优先级任务，等待状态恢复
        return;
      }
      
      // 移除高优先级任务
      const pendingRequest = queue.splice(highPriorityIndex, 1)[0];
      if (pendingRequest.timeoutHandle) {
        clearTimeout(pendingRequest.timeoutHandle);
      }

      const { request } = pendingRequest;
      const result = this.acquireImmediately(
        gpuKey,
        request.taskType,
        request.holdMaxMs,
        request.trace
      );

      // 记录等待时间
      const queueWaitMs = Date.now() - pendingRequest.queuedAt;
      this.recordMetric(gpuKey, 'queueWaitMs', queueWaitMs);

      logger.debug(
        {
          gpuKey,
          taskType: request.taskType,
          leaseId: result.status === "ACQUIRED" ? result.leaseId : undefined,
          queueWaitMs,
          admissionState,
          gpuUsage: usageCache?.usagePercent,
          ...request.trace,
        },
        'GpuArbiter: High-priority request dequeued and acquired (HIGH_PRESSURE state)'
      );

      pendingRequest.resolve(result);
      
      // 继续处理队列（可能有更多高优先级任务）
      setImmediate(() => this.processQueue(gpuKey));
      return;
    }

    // NORMAL状态：正常处理队列
    // 取出队列头部的请求
    const pendingRequest = queue.shift()!;
    if (pendingRequest.timeoutHandle) {
      clearTimeout(pendingRequest.timeoutHandle);
    }

    const { request } = pendingRequest;
    const result = this.acquireImmediately(
      gpuKey,
      request.taskType,
      request.holdMaxMs,
      request.trace
    );

    // 记录等待时间
    const queueWaitMs = Date.now() - pendingRequest.queuedAt;
    this.recordMetric(gpuKey, 'queueWaitMs', queueWaitMs);

    logger.debug(
      {
        gpuKey,
        taskType: request.taskType,
        leaseId: result.status === "ACQUIRED" ? result.leaseId : undefined,
        queueWaitMs,
        ...request.trace,
      },
      'GpuArbiter: Request dequeued and acquired'
    );

    pendingRequest.resolve(result);
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

    // 清除watchdog
    if (lease.watchdogHandle) {
      clearTimeout(lease.watchdogHandle);
    }

    // 记录占用时间
    const holdMs = Date.now() - acquiredAt;
    this.recordMetric(gpuKey, 'holdMs', holdMs);

    // 释放GPU锁
    this.mutexes.set(gpuKey, false);
    this.activeLeases.delete(leaseId);

    // 获取trace信息（如果存在）
    const trace = lease.trace || {};
    
    logger.debug(
      {
        gpuKey,
        taskType,
        leaseId,
        holdMs,
        ...trace, // 包含jobId, sessionId, utteranceIndex, stage等信息
      },
      'GpuArbiter: Lease released'
    );

    // 处理队列中的下一个请求
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
    const queue = this.queues.get(gpuKey)!;
    const metrics = this.metrics.get(gpuKey)!;
    const admissionState = this.gpuAdmissionStates.get(gpuKey)!;
    const usageCache = this.getGpuUsageFromCache(gpuKey);

    // 查找当前活跃租约
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
      queueLength: queue.length,
      queue: queue.map((req) => ({
        leaseId: req.leaseId,
        taskType: req.request.taskType,
        priority: req.request.priority,
        waitTimeMs: Date.now() - req.queuedAt,
      })),
      metrics: {
        ...metrics,
        queueWaitMs: [...metrics.queueWaitMs].slice(-100), // 保留最近100条
        holdMs: [...metrics.holdMs].slice(-100), // 保留最近100条
      },
      gpuAdmissionState: admissionState,
      gpuUsage: usageCache?.usagePercent,
      gpuUsageCacheAgeMs: usageCache ? Date.now() - usageCache.sampledAt : undefined,
    };
  }

  /**
   * 更新配置
   */
  setConfig(configPatch: Partial<GpuArbiterConfig>): void {
    const wasEnabled = this.enabled;
    this.config = { ...this.config, ...configPatch };
    this.enabled = this.config.enabled;
    
    // 更新GPU使用率阈值（向后兼容）
    if (configPatch.gpuUsageThreshold !== undefined) {
      this.gpuUsageThreshold = configPatch.gpuUsageThreshold;
    }
    
    // 更新GPU使用率配置
    if (configPatch.gpuUsage) {
      if (configPatch.gpuUsage.sampleIntervalMs !== undefined) {
        this.usageSampleIntervalMs = configPatch.gpuUsage.sampleIntervalMs;
      }
      if (configPatch.gpuUsage.cacheTtlMs !== undefined) {
        this.usageCacheTtlMs = configPatch.gpuUsage.cacheTtlMs;
      }
      if (configPatch.gpuUsage.baseHighWater !== undefined) {
        this.baseHighWater = configPatch.gpuUsage.baseHighWater;
      }
      if (configPatch.gpuUsage.baseLowWater !== undefined) {
        this.baseLowWater = configPatch.gpuUsage.baseLowWater;
      }
      
      if (configPatch.gpuUsage.dynamicAdjustment) {
        if (configPatch.gpuUsage.dynamicAdjustment.enabled !== undefined) {
          this.dynamicAdjustmentEnabled = configPatch.gpuUsage.dynamicAdjustment.enabled;
        }
        if (configPatch.gpuUsage.dynamicAdjustment.longAudioThresholdMs !== undefined) {
          this.longAudioThresholdMs = configPatch.gpuUsage.dynamicAdjustment.longAudioThresholdMs;
        }
        if (configPatch.gpuUsage.dynamicAdjustment.highWaterBoost !== undefined) {
          this.highWaterBoost = configPatch.gpuUsage.dynamicAdjustment.highWaterBoost;
        }
        if (configPatch.gpuUsage.dynamicAdjustment.lowWaterBoost !== undefined) {
          this.lowWaterBoost = configPatch.gpuUsage.dynamicAdjustment.lowWaterBoost;
        }
        if (configPatch.gpuUsage.dynamicAdjustment.adjustmentTtlMs !== undefined) {
          this.adjustmentTtlMs = configPatch.gpuUsage.dynamicAdjustment.adjustmentTtlMs;
        }
      }
      
      // 如果采样间隔改变，重启监控
      if (this.enabled && wasEnabled) {
        this.stopGpuUsageMonitoring();
        this.startGpuUsageMonitoring();
      }
    }
    
    // 如果启用状态改变，重新启动或停止监控
    if (this.enabled && !wasEnabled) {
      this.startGpuUsageMonitoring();
    } else if (!this.enabled && wasEnabled) {
      this.stopGpuUsageMonitoring();
    }
    
    logger.info({ config: this.config }, 'GpuArbiter: Config updated');
  }
  
  /**
   * 启动GPU使用率监控
   */
  private startGpuUsageMonitoring(): void {
    if (this.gpuUsageMonitorInterval) {
      return; // 已经启动
    }
    
    // 按配置的采样间隔检查GPU使用率
    this.gpuUsageMonitorInterval = setInterval(() => {
      this.sampleGpuUsage();
    }, this.usageSampleIntervalMs);
    
    logger.debug(
      { sampleIntervalMs: this.usageSampleIntervalMs },
      'GpuArbiter: GPU usage monitoring started'
    );
  }
  
  /**
   * 停止GPU使用率监控
   */
  private stopGpuUsageMonitoring(): void {
    if (this.gpuUsageMonitorInterval) {
      clearInterval(this.gpuUsageMonitorInterval);
      this.gpuUsageMonitorInterval = null;
      logger.debug({}, 'GpuArbiter: GPU usage monitoring stopped');
    }
  }
  
  /**
   * 采样GPU使用率并更新缓存
   */
  private async sampleGpuUsage(): Promise<void> {
    try {
      const gpuInfo = await getGpuUsage();
      if (!gpuInfo || gpuInfo.usage === null || gpuInfo.usage === undefined) {
        return; // 无法获取GPU使用率，跳过
      }
      
      const gpuUsage = gpuInfo.usage;
      const now = Date.now();
      
      // 更新所有GPU的缓存（当前实现假设只有一个GPU，但支持多GPU扩展）
      for (const gpuKey of this.config.gpuKeys) {
        this.gpuUsageCache.set(gpuKey, {
          usagePercent: gpuUsage,
          sampledAt: now,
        });
        
        // 更新滞回线状态
        this.updateAdmissionState(gpuKey, gpuUsage);
      }
      
      // 如果GPU使用率超过阈值，记录详细日志（向后兼容）
      if (gpuUsage > this.gpuUsageThreshold) {
        const timeSinceLastLog = now - this.lastLogTime;
        const usageChanged = this.lastLoggedGpuUsage === null || 
                            Math.abs(this.lastLoggedGpuUsage - gpuUsage) > 5;
        
        if (timeSinceLastLog > 30000 || usageChanged) {
          this.logGpuUsageExceeded(gpuUsage, gpuInfo.memory);
          this.lastLoggedGpuUsage = gpuUsage;
          this.lastLogTime = now;
        }
      } else {
        // GPU使用率恢复正常，重置上次记录的值
        if (this.lastLoggedGpuUsage !== null) {
          this.lastLoggedGpuUsage = null;
          this.lastLogTime = 0;
        }
      }
    } catch (error) {
      logger.debug({ error }, 'GpuArbiter: Failed to sample GPU usage');
    }
  }
  
  /**
   * 更新GPU准入状态（滞回线逻辑）
   */
  private updateAdmissionState(gpuKey: string, gpuUsage: number): void {
    const currentState = this.gpuAdmissionStates.get(gpuKey)!;
    
    // 获取当前有效的阈值（考虑动态调整）
    const { highWater, lowWater } = this.getEffectiveThresholds(gpuKey);
    
    let newState = currentState;
    
    if (currentState === GpuAdmissionState.NORMAL) {
      // NORMAL → HIGH_PRESSURE：usage >= highWater
      if (gpuUsage >= highWater) {
        newState = GpuAdmissionState.HIGH_PRESSURE;
        logger.info(
          {
            gpuKey,
            gpuUsage,
            highWater,
            lowWater,
          },
          'GpuArbiter: GPU admission state changed to HIGH_PRESSURE'
        );
      }
    } else {
      // HIGH_PRESSURE → NORMAL：usage <= lowWater
      if (gpuUsage <= lowWater) {
        newState = GpuAdmissionState.NORMAL;
        logger.info(
          {
            gpuKey,
            gpuUsage,
            highWater,
            lowWater,
          },
          'GpuArbiter: GPU admission state changed to NORMAL'
        );
        
        // 状态恢复正常，处理等待队列
        this.processQueue(gpuKey);
      }
    }
    
    if (newState !== currentState) {
      this.gpuAdmissionStates.set(gpuKey, newState);
    }
    
    // 清理过期的动态调整
    this.cleanupExpiredAdjustments(gpuKey);
  }
  
  /**
   * 获取有效的阈值（考虑动态调整）
   */
  private getEffectiveThresholds(gpuKey: string): { highWater: number; lowWater: number } {
    const adjustment = this.dynamicAdjustments.get(gpuKey);
    const now = Date.now();
    
    if (adjustment && adjustment.expiresAt > now) {
      return {
        highWater: adjustment.highWater,
        lowWater: adjustment.lowWater,
      };
    }
    
    return {
      highWater: this.baseHighWater,
      lowWater: this.baseLowWater,
    };
  }
  
  /**
   * 清理过期的动态调整
   */
  private cleanupExpiredAdjustments(gpuKey: string): void {
    const adjustment = this.dynamicAdjustments.get(gpuKey);
    if (adjustment && adjustment.expiresAt <= Date.now()) {
      this.dynamicAdjustments.delete(gpuKey);
      logger.debug(
        { gpuKey },
        'GpuArbiter: Dynamic adjustment expired, reverted to base thresholds'
      );
    }
  }
  
  /**
   * 从缓存获取GPU使用率
   */
  private getGpuUsageFromCache(gpuKey: string): GpuUsageCache | null {
    const cache = this.gpuUsageCache.get(gpuKey);
    if (!cache) {
      return null;
    }
    
    const now = Date.now();
    const age = now - cache.sampledAt;
    
    // 如果缓存过期，返回null（视为不可靠数据）
    if (age > this.usageCacheTtlMs) {
      return null;
    }
    
    return cache;
  }
  
  /**
   * ASR任务感知的动态滞回调整
   */
  notifyAsrTaskHint(gpuKey: string, hint: AsrGpuHint): void {
    if (!this.dynamicAdjustmentEnabled) {
      return;
    }
    
    // 检查是否为长音频
    if (hint.estimatedAudioMs >= this.longAudioThresholdMs) {
      const now = Date.now();
      const expiresAt = now + this.adjustmentTtlMs;
      
      // 临时提高阈值
      const adjustedHighWater = this.baseHighWater + this.highWaterBoost;
      const adjustedLowWater = this.baseLowWater + this.lowWaterBoost;
      
      this.dynamicAdjustments.set(gpuKey, {
        highWater: adjustedHighWater,
        lowWater: adjustedLowWater,
        expiresAt,
      });
      
      logger.info(
        {
          gpuKey,
          estimatedAudioMs: hint.estimatedAudioMs,
          estimatedGpuHoldMs: hint.estimatedGpuHoldMs,
          baseHighWater: this.baseHighWater,
          baseLowWater: this.baseLowWater,
          adjustedHighWater,
          adjustedLowWater,
          adjustmentTtlMs: this.adjustmentTtlMs,
        },
        'GpuArbiter: Dynamic adjustment applied for long ASR task'
      );
    }
  }
  
  /**
   * 记录GPU使用率超过阈值的详细日志
   */
  private logGpuUsageExceeded(gpuUsage: number, gpuMemory: number | undefined): void {
    // 收集所有活跃租约的详细信息
    const activeLeasesInfo: Array<{
      leaseId: string;
      gpuKey: string;
      taskType: GpuTaskType;
      holdTimeMs: number;
      jobId?: string;
      sessionId?: string;
      utteranceIndex?: number;
      stage?: string;
    }> = [];
    
    for (const lease of this.activeLeases.values()) {
      const holdTimeMs = Date.now() - lease.acquiredAt;
      activeLeasesInfo.push({
        leaseId: lease.leaseId,
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
    const serviceStats: Record<string, number> = {};
    for (const lease of activeLeasesInfo) {
      serviceStats[lease.taskType] = (serviceStats[lease.taskType] || 0) + 1;
    }
    
    logger.warn(
      {
        gpuUsage,
        gpuMemory,
        threshold: this.gpuUsageThreshold,
        activeLeasesCount: activeLeasesInfo.length,
        activeLeases: activeLeasesInfo,
        serviceStats,
        note: 'GPU使用率超过阈值，当前各服务正在处理的任务详情',
      },
      'GpuArbiter: GPU usage exceeded threshold'
    );
  }

  /**
   * 生成租约ID
   */
  private generateLeaseId(): string {
    return `lease_${Date.now()}_${++this.leaseIdCounter}`;
  }

  /**
   * 记录指标
   */
  private recordMetric(
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
   * 创建租约对象
   */
  createLease(result: GpuLeaseAcquireResult & { status: "ACQUIRED" }): GpuLease {
    return {
      leaseId: result.leaseId,
      gpuKey: this.config.gpuKeys[0], // 简化：使用第一个GPU
      taskType: "OTHER", // 需要从请求中获取
      acquiredAt: result.acquiredAt,
      holdMaxMs: this.config.defaultHoldMaxMs,
      release: () => this.release(result.leaseId),
    };
  }
}
