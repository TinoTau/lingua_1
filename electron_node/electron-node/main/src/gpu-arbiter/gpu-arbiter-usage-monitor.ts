/**
 * GPU使用率监控模块
 * 负责GPU使用率采样、缓存、状态管理和动态调整
 */

import logger from '../logger';
import { getGpuUsage } from '../system-resources';
import {
  GpuTaskType,
  GpuUsageCache,
  GpuAdmissionState,
  AsrGpuHint,
} from './types';

export interface GpuUsageMonitorConfig {
  sampleIntervalMs: number;
  cacheTtlMs: number;
  baseHighWater: number;
  baseLowWater: number;
  dynamicAdjustmentEnabled: boolean;
  longAudioThresholdMs: number;
  highWaterBoost: number;
  lowWaterBoost: number;
  adjustmentTtlMs: number;
  gpuUsageThreshold: number; // 向后兼容
}

export interface GpuUsageMonitorState {
  gpuUsageCache: Map<string, GpuUsageCache>;
  gpuAdmissionStates: Map<string, GpuAdmissionState>;
  dynamicAdjustments: Map<string, {
    highWater: number;
    lowWater: number;
    expiresAt: number;
  }>;
  lastLoggedGpuUsage: number | null;
  lastLogTime: number;
  monitorInterval: NodeJS.Timeout | null;
}

export class GpuUsageMonitor {
  private config: GpuUsageMonitorConfig;
  private state: GpuUsageMonitorState;
  private activeLeases: Map<string, {
    gpuKey: string;
    taskType: GpuTaskType;
    acquiredAt: number;
    trace?: {
      jobId?: string;
      sessionId?: string;
      utteranceIndex?: number;
      stage?: string;
    };
  }>;
  private onStateChangeToNormal?: (gpuKey: string) => void;

  constructor(
    config: GpuUsageMonitorConfig,
    activeLeases: Map<string, {
      gpuKey: string;
      taskType: GpuTaskType;
      acquiredAt: number;
      trace?: {
        jobId?: string;
        sessionId?: string;
        utteranceIndex?: number;
        stage?: string;
      };
    }>,
    onStateChangeToNormal?: (gpuKey: string) => void
  ) {
    this.config = config;
    this.activeLeases = activeLeases;
    this.onStateChangeToNormal = onStateChangeToNormal;
    this.state = {
      gpuUsageCache: new Map(),
      gpuAdmissionStates: new Map(),
      dynamicAdjustments: new Map(),
      lastLoggedGpuUsage: null,
      lastLogTime: 0,
      monitorInterval: null,
    };
  }

  /**
   * 初始化GPU状态
   */
  initializeGpuKeys(gpuKeys: string[]): void {
    for (const gpuKey of gpuKeys) {
      this.state.gpuAdmissionStates.set(gpuKey, GpuAdmissionState.NORMAL);
    }
  }

  /**
   * 启动GPU使用率监控
   */
  startMonitoring(): void {
    if (this.state.monitorInterval) {
      return; // 已经启动
    }

    this.state.monitorInterval = setInterval(() => {
      this.sampleGpuUsage();
    }, this.config.sampleIntervalMs);

    logger.debug(
      { sampleIntervalMs: this.config.sampleIntervalMs },
      'GpuArbiter: GPU usage monitoring started'
    );
  }

  /**
   * 停止GPU使用率监控
   */
  stopMonitoring(): void {
    if (this.state.monitorInterval) {
      clearInterval(this.state.monitorInterval);
      this.state.monitorInterval = null;
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

      // 更新所有GPU的缓存
      for (const gpuKey of this.state.gpuAdmissionStates.keys()) {
        this.state.gpuUsageCache.set(gpuKey, {
          usagePercent: gpuUsage,
          sampledAt: now,
        });

        // 更新滞回线状态
        this.updateAdmissionState(gpuKey, gpuUsage);
      }

      // 如果GPU使用率超过阈值，记录详细日志（向后兼容）
      if (gpuUsage > this.config.gpuUsageThreshold) {
        const timeSinceLastLog = now - this.state.lastLogTime;
        const usageChanged = this.state.lastLoggedGpuUsage === null ||
          Math.abs(this.state.lastLoggedGpuUsage - gpuUsage) > 5;

        if (timeSinceLastLog > 30000 || usageChanged) {
          this.logGpuUsageExceeded(gpuUsage, gpuInfo.memory);
          this.state.lastLoggedGpuUsage = gpuUsage;
          this.state.lastLogTime = now;
        }
      } else {
        // GPU使用率恢复正常，重置上次记录的值
        if (this.state.lastLoggedGpuUsage !== null) {
          this.state.lastLoggedGpuUsage = null;
          this.state.lastLogTime = 0;
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
    const currentState = this.state.gpuAdmissionStates.get(gpuKey);
    if (!currentState) {
      return;
    }

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

        // 状态恢复正常，触发回调处理等待队列
        if (this.onStateChangeToNormal) {
          this.onStateChangeToNormal(gpuKey);
        }
      }
    }

    if (newState !== currentState) {
      this.state.gpuAdmissionStates.set(gpuKey, newState);
    }

    // 清理过期的动态调整
    this.cleanupExpiredAdjustments(gpuKey);
  }

  /**
   * 获取有效的阈值（考虑动态调整）
   */
  private getEffectiveThresholds(gpuKey: string): { highWater: number; lowWater: number } {
    const adjustment = this.state.dynamicAdjustments.get(gpuKey);
    const now = Date.now();

    if (adjustment && adjustment.expiresAt > now) {
      return {
        highWater: adjustment.highWater,
        lowWater: adjustment.lowWater,
      };
    }

    return {
      highWater: this.config.baseHighWater,
      lowWater: this.config.baseLowWater,
    };
  }

  /**
   * 清理过期的动态调整
   */
  private cleanupExpiredAdjustments(gpuKey: string): void {
    const adjustment = this.state.dynamicAdjustments.get(gpuKey);
    if (adjustment && adjustment.expiresAt <= Date.now()) {
      this.state.dynamicAdjustments.delete(gpuKey);
      logger.debug(
        { gpuKey },
        'GpuArbiter: Dynamic adjustment expired, reverted to base thresholds'
      );
    }
  }

  /**
   * 从缓存获取GPU使用率
   */
  getGpuUsageFromCache(gpuKey: string): GpuUsageCache | null {
    const cache = this.state.gpuUsageCache.get(gpuKey);
    if (!cache) {
      return null;
    }

    const now = Date.now();
    const age = now - cache.sampledAt;

    // 如果缓存过期，返回null（视为不可靠数据）
    if (age > this.config.cacheTtlMs) {
      return null;
    }

    return cache;
  }

  /**
   * 获取GPU准入状态
   */
  getAdmissionState(gpuKey: string): GpuAdmissionState | undefined {
    return this.state.gpuAdmissionStates.get(gpuKey);
  }

  /**
   * ASR任务感知的动态滞回调整
   */
  notifyAsrTaskHint(gpuKey: string, hint: AsrGpuHint): void {
    if (!this.config.dynamicAdjustmentEnabled) {
      return;
    }

    // 检查是否为长音频
    if (hint.estimatedAudioMs >= this.config.longAudioThresholdMs) {
      const now = Date.now();
      const expiresAt = now + this.config.adjustmentTtlMs;

      // 临时提高阈值
      const adjustedHighWater = this.config.baseHighWater + this.config.highWaterBoost;
      const adjustedLowWater = this.config.baseLowWater + this.config.lowWaterBoost;

      this.state.dynamicAdjustments.set(gpuKey, {
        highWater: adjustedHighWater,
        lowWater: adjustedLowWater,
        expiresAt,
      });

      logger.info(
        {
          gpuKey,
          estimatedAudioMs: hint.estimatedAudioMs,
          estimatedGpuHoldMs: hint.estimatedGpuHoldMs,
          baseHighWater: this.config.baseHighWater,
          baseLowWater: this.config.baseLowWater,
          adjustedHighWater,
          adjustedLowWater,
          adjustmentTtlMs: this.config.adjustmentTtlMs,
        },
        'GpuArbiter: Dynamic adjustment applied for long ASR task'
      );
    }
  }

  /**
   * 更新配置
   */
  updateConfig(configPatch: Partial<GpuUsageMonitorConfig>): void {
    if (configPatch.sampleIntervalMs !== undefined) {
      this.config.sampleIntervalMs = configPatch.sampleIntervalMs;
    }
    if (configPatch.cacheTtlMs !== undefined) {
      this.config.cacheTtlMs = configPatch.cacheTtlMs;
    }
    if (configPatch.baseHighWater !== undefined) {
      this.config.baseHighWater = configPatch.baseHighWater;
    }
    if (configPatch.baseLowWater !== undefined) {
      this.config.baseLowWater = configPatch.baseLowWater;
    }
    if (configPatch.dynamicAdjustmentEnabled !== undefined) {
      this.config.dynamicAdjustmentEnabled = configPatch.dynamicAdjustmentEnabled;
    }
    if (configPatch.longAudioThresholdMs !== undefined) {
      this.config.longAudioThresholdMs = configPatch.longAudioThresholdMs;
    }
    if (configPatch.highWaterBoost !== undefined) {
      this.config.highWaterBoost = configPatch.highWaterBoost;
    }
    if (configPatch.lowWaterBoost !== undefined) {
      this.config.lowWaterBoost = configPatch.lowWaterBoost;
    }
    if (configPatch.adjustmentTtlMs !== undefined) {
      this.config.adjustmentTtlMs = configPatch.adjustmentTtlMs;
    }
    if (configPatch.gpuUsageThreshold !== undefined) {
      this.config.gpuUsageThreshold = configPatch.gpuUsageThreshold;
    }

    // 如果采样间隔改变，重启监控
    const wasMonitoring = this.state.monitorInterval !== null;
    if (wasMonitoring && configPatch.sampleIntervalMs !== undefined) {
      this.stopMonitoring();
      this.startMonitoring();
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

    for (const [leaseId, lease] of this.activeLeases.entries()) {
      const holdTimeMs = Date.now() - lease.acquiredAt;
      activeLeasesInfo.push({
        leaseId,
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
        threshold: this.config.gpuUsageThreshold,
        activeLeasesCount: activeLeasesInfo.length,
        activeLeases: activeLeasesInfo,
        serviceStats,
        note: 'GPU使用率超过阈值，当前各服务正在处理的任务详情',
      },
      'GpuArbiter: GPU usage exceeded threshold'
    );
  }

  /**
   * 获取状态（用于快照）
   */
  getStateForSnapshot(gpuKey: string): {
    admissionState: GpuAdmissionState | undefined;
    usageCache: GpuUsageCache | null;
  } {
    return {
      admissionState: this.state.gpuAdmissionStates.get(gpuKey),
      usageCache: this.getGpuUsageFromCache(gpuKey),
    };
  }
}
