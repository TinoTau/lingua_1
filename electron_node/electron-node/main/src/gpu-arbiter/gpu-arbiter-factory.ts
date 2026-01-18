/**
 * GPU 仲裁器工厂
 * 提供单例模式的GpuArbiter实例
 */

import { GpuArbiter } from './gpu-arbiter';
import { GpuArbiterConfig, GpuTaskType } from './types';
import { loadNodeConfig } from '../node-config';

let gpuArbiterInstance: GpuArbiter | null = null;

/**
 * 获取GPU仲裁器实例（单例）
 */
export function getGpuArbiter(): GpuArbiter | null {
  if (gpuArbiterInstance) {
    return gpuArbiterInstance;
  }

  const config = loadGpuArbiterConfig();
  if (!config.enabled) {
    return null;
  }

  gpuArbiterInstance = new GpuArbiter(config);
  return gpuArbiterInstance;
}

/**
 * 从配置加载GPU仲裁器配置
 * 导出此函数以便其他模块可以使用统一的配置加载逻辑
 */
export function loadGpuArbiterConfig(): GpuArbiterConfig {
  const nodeConfig = loadNodeConfig();
  const gpuArbiterConfig = nodeConfig.gpuArbiter;

  // 默认配置
  const defaultConfig: GpuArbiterConfig = {
    enabled: true, // GPU 仲裁器必须启用，用于控制 GPU 并发
    gpuKeys: ["gpu:0"],
    defaultQueueLimit: 8,
    defaultHoldMaxMs: 8000,
    policies: {
      ASR: {
        priority: 90,
        maxWaitMs: 10000, // 增加到10秒，避免GPU lease timeout导致ASR失败
        busyPolicy: "WAIT",
      },
      NMT: {
        priority: 80,
        maxWaitMs: 8000, // 增加到8秒，避免GPU lease timeout导致NMT失败
        busyPolicy: "WAIT",
      },
      TTS: {
        priority: 70,
        maxWaitMs: 13000, // 增加到13秒，因为TTS首次运行需要加载模型，耗时较长，避免超时
        busyPolicy: "WAIT",
      },
      SEMANTIC_REPAIR: {
        priority: 20,
        maxWaitMs: 8000, // 增加到8秒，确保语义修复有足够时间等待GPU
        busyPolicy: "WAIT", // 必须等待，不能跳过
      },
    },
  };

  if (!gpuArbiterConfig) {
    return defaultConfig;
  }

  // 合并policies，确保所有字段都有值
  const mergedPolicies: GpuArbiterConfig['policies'] = {};
  if (defaultConfig.policies) {
    for (const [key, defaultPolicy] of Object.entries(defaultConfig.policies)) {
      const taskType = key as GpuTaskType;
      // 跳过OTHER类型，因为它不在默认配置中
      if (taskType === 'OTHER') continue;
      
      const userPolicy = gpuArbiterConfig.policies?.[taskType];
      if (userPolicy) {
        mergedPolicies[taskType] = {
          priority: userPolicy.priority ?? defaultPolicy.priority,
          maxWaitMs: userPolicy.maxWaitMs ?? defaultPolicy.maxWaitMs,
          busyPolicy: userPolicy.busyPolicy ?? defaultPolicy.busyPolicy,
        };
      } else {
        mergedPolicies[taskType] = defaultPolicy;
      }
    }
  }
  if (gpuArbiterConfig.policies) {
    for (const [key, userPolicy] of Object.entries(gpuArbiterConfig.policies)) {
      const taskType = key as GpuTaskType;
      // 跳过OTHER类型
      if (taskType === 'OTHER') continue;
      
      if (!mergedPolicies[taskType]) {
        // 如果默认配置中没有，使用用户配置（需要确保所有字段都有值）
        const defaultPolicy = defaultConfig.policies?.[taskType];
        mergedPolicies[taskType] = {
          priority: userPolicy.priority ?? defaultPolicy?.priority ?? 50,
          maxWaitMs: userPolicy.maxWaitMs ?? defaultPolicy?.maxWaitMs ?? 3000,
          busyPolicy: userPolicy.busyPolicy ?? defaultPolicy?.busyPolicy ?? 'WAIT',
        };
      }
    }
  }

  return {
    enabled: gpuArbiterConfig.enabled ?? defaultConfig.enabled,
    gpuKeys: gpuArbiterConfig.gpuKeys ?? defaultConfig.gpuKeys,
    defaultQueueLimit: gpuArbiterConfig.defaultQueueLimit ?? defaultConfig.defaultQueueLimit,
    defaultHoldMaxMs: gpuArbiterConfig.defaultHoldMaxMs ?? defaultConfig.defaultHoldMaxMs,
    gpuUsageThreshold: gpuArbiterConfig.gpuUsageThreshold, // 向后兼容
    gpuUsage: gpuArbiterConfig.gpuUsage, // 新的GPU使用率配置
    policies: mergedPolicies,
  };
}

/**
 * 重置实例（用于测试）
 */
export function resetGpuArbiterInstance(): void {
  gpuArbiterInstance = null;
}
