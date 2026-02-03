/**
 * GpuArbiter setConfig 配置补丁构建（从 gpu-arbiter.ts 迁出）
 * 仅迁移实现，不改变接口与逻辑。
 */

import type { GpuArbiterConfig } from './types';
import type { GpuUsageMonitorConfig } from './gpu-arbiter-usage-monitor';

/**
 * 从 GpuArbiterConfig 补丁构建 GpuUsageMonitor 的配置补丁
 */
export function buildUsageConfigPatch(
  configPatch: Partial<GpuArbiterConfig>
): Partial<GpuUsageMonitorConfig> {
  const usageConfigPatch: Partial<GpuUsageMonitorConfig> = {};
  if (configPatch.gpuUsageThreshold !== undefined) {
    usageConfigPatch.gpuUsageThreshold = configPatch.gpuUsageThreshold;
  }
  if (configPatch.gpuUsage) {
    if (configPatch.gpuUsage.sampleIntervalMs !== undefined) {
      usageConfigPatch.sampleIntervalMs = configPatch.gpuUsage.sampleIntervalMs;
    }
    if (configPatch.gpuUsage.cacheTtlMs !== undefined) {
      usageConfigPatch.cacheTtlMs = configPatch.gpuUsage.cacheTtlMs;
    }
    if (configPatch.gpuUsage.baseHighWater !== undefined) {
      usageConfigPatch.baseHighWater = configPatch.gpuUsage.baseHighWater;
    }
    if (configPatch.gpuUsage.baseLowWater !== undefined) {
      usageConfigPatch.baseLowWater = configPatch.gpuUsage.baseLowWater;
    }
    if (configPatch.gpuUsage.dynamicAdjustment) {
      if (configPatch.gpuUsage.dynamicAdjustment.enabled !== undefined) {
        usageConfigPatch.dynamicAdjustmentEnabled = configPatch.gpuUsage.dynamicAdjustment.enabled;
      }
      if (configPatch.gpuUsage.dynamicAdjustment.longAudioThresholdMs !== undefined) {
        usageConfigPatch.longAudioThresholdMs = configPatch.gpuUsage.dynamicAdjustment.longAudioThresholdMs;
      }
      if (configPatch.gpuUsage.dynamicAdjustment.highWaterBoost !== undefined) {
        usageConfigPatch.highWaterBoost = configPatch.gpuUsage.dynamicAdjustment.highWaterBoost;
      }
      if (configPatch.gpuUsage.dynamicAdjustment.lowWaterBoost !== undefined) {
        usageConfigPatch.lowWaterBoost = configPatch.gpuUsage.dynamicAdjustment.lowWaterBoost;
      }
      if (configPatch.gpuUsage.dynamicAdjustment.adjustmentTtlMs !== undefined) {
        usageConfigPatch.adjustmentTtlMs = configPatch.gpuUsage.dynamicAdjustment.adjustmentTtlMs;
      }
    }
  }
  return usageConfigPatch;
}
