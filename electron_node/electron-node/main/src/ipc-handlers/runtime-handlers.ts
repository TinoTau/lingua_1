import { ipcMain } from 'electron';
import { loadNodeConfig, saveNodeConfig, ServicePreferences } from '../node-config';
import logger from '../logger';
import type { NodeAgent } from '../agent/node-agent';
import type { ModelManager } from '../model-manager/model-manager';
import type { InferenceService } from '../inference/inference-service';
import type { RustServiceManager } from '../rust-service-manager';
import type { PythonServiceManager } from '../python-service-manager';
import type { ServiceRegistryManager } from '../service-registry';
import type { SemanticRepairServiceManager } from '../semantic-repair-service-manager';
import type { PythonServiceName } from '../python-service-manager/types';
import type { SemanticRepairServiceId } from '../semantic-repair-service-manager';

/**
 * Python 服务名称到配置字段名的映射
 */
const PYTHON_SERVICE_PREFERENCE_MAP: Record<PythonServiceName, keyof ServicePreferences> = {
  nmt: 'nmtEnabled',
  tts: 'ttsEnabled',
  yourtts: 'yourttsEnabled',
  faster_whisper_vad: 'fasterWhisperVadEnabled',
  speaker_embedding: 'speakerEmbeddingEnabled',
};

/**
 * 语义修复服务ID到配置字段名的映射
 */
const SEMANTIC_REPAIR_SERVICE_PREFERENCE_MAP: Record<SemanticRepairServiceId, keyof ServicePreferences> = {
  'semantic-repair-zh': 'semanticRepairZhEnabled',
  'semantic-repair-en': 'semanticRepairEnEnabled',
  'en-normalize': 'enNormalizeEnabled',
};

/**
 * 更新服务自动启动配置（Python 服务）
 */
function updatePythonServicePreference(
  serviceName: PythonServiceName,
  enabled: boolean,
  config: ReturnType<typeof loadNodeConfig>
): boolean {
  const preferenceKey = PYTHON_SERVICE_PREFERENCE_MAP[serviceName];
  if (!preferenceKey) {
    logger.warn({ serviceName }, 'Unknown Python service name for preference mapping');
    return false;
  }

  const currentValue = config.servicePreferences[preferenceKey] as boolean | undefined;
  // 如果当前值与目标值不同，则更新
  if (currentValue !== enabled) {
    (config.servicePreferences[preferenceKey] as boolean) = enabled;
    return true;
  }
  return false;
}

/**
 * 更新服务自动启动配置（语义修复服务）
 */
function updateSemanticRepairServicePreference(
  serviceId: SemanticRepairServiceId,
  enabled: boolean,
  config: ReturnType<typeof loadNodeConfig>
): boolean {
  const preferenceKey = SEMANTIC_REPAIR_SERVICE_PREFERENCE_MAP[serviceId];
  if (!preferenceKey) {
    logger.warn({ serviceId }, 'Unknown semantic repair service ID for preference mapping');
    return false;
  }

  const currentValue = config.servicePreferences[preferenceKey] as boolean | undefined;
  // 如果当前值与目标值不同，则更新
  if (currentValue !== enabled) {
    (config.servicePreferences[preferenceKey] as boolean) = enabled;
    return true;
  }
  return false;
}

export function registerRuntimeHandlers(
  nodeAgent: NodeAgent | null,
  modelManager: ModelManager | null,
  inferenceService: InferenceService | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  serviceRegistryManager: ServiceRegistryManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): void {
  ipcMain.handle('get-node-status', async () => {
    return nodeAgent?.getStatus() || { online: false, nodeId: null };
  });

  ipcMain.handle('reconnect-node', async () => {
    if (nodeAgent) {
      try {
        // 先停止现有连接（如果存在）
        nodeAgent.stop();
        // 然后重新启动
        await nodeAgent.start();
        logger.info({}, 'Node reconnection initiated');
        return { success: true };
      } catch (error) {
        logger.error({ error }, 'Failed to reconnect node');
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    }
    return { success: false, error: 'Node agent not initialized' };
  });

  ipcMain.handle('get-rust-service-status', async () => {
    return rustServiceManager?.getStatus() || {
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
    };
  });

  // Python 服务管理 IPC 接口
  ipcMain.handle('get-python-service-status', async (_, serviceName: 'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding') => {
    return pythonServiceManager?.getServiceStatus(serviceName) || {
      name: serviceName,
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
    };
  });

  ipcMain.handle('get-all-python-service-statuses', async () => {
    return pythonServiceManager?.getAllServiceStatuses() || [];
  });

  ipcMain.handle('start-python-service', async (_, serviceName: PythonServiceName) => {
    if (!pythonServiceManager) {
      throw new Error('Python service manager not initialized');
    }
    try {
      await pythonServiceManager.startService(serviceName);

      // 用户手动启动服务后，将自动启动设为是（记录用户选择）
      const config = loadNodeConfig();
      const updated = updatePythonServicePreference(serviceName, true, config);

      if (updated) {
        saveNodeConfig(config);
        logger.info({ serviceName }, '用户手动启动服务，已更新自动启动配置为是');
      }

      return { success: true };
    } catch (error) {
      logger.error({ error, serviceName }, 'Failed to start Python service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('stop-python-service', async (_, serviceName: PythonServiceName) => {
    if (!pythonServiceManager) {
      throw new Error('Python service manager not initialized');
    }
    try {
      await pythonServiceManager.stopService(serviceName);

      // 用户手动关闭服务后，将自动启动设为否
      const config = loadNodeConfig();
      const updated = updatePythonServicePreference(serviceName, false, config);

      if (updated) {
        saveNodeConfig(config);
        logger.info({ serviceName }, '用户手动关闭服务，已更新自动启动配置为否');
      }

      return { success: true };
    } catch (error) {
      logger.error({ error, serviceName }, 'Failed to stop Python service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Rust 服务管理 IPC 接口
  ipcMain.handle('start-rust-service', async () => {
    if (!rustServiceManager) {
      throw new Error('Rust service manager not initialized');
    }
    try {
      await rustServiceManager.start();

      // 用户手动启动服务后，将自动启动设为是（记录用户选择）
      const config = loadNodeConfig();
      if (!config.servicePreferences.rustEnabled) {
        config.servicePreferences.rustEnabled = true;
        saveNodeConfig(config);
        logger.info({}, '用户手动启动 Rust 服务，已更新自动启动配置为是');
      }

      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to start Rust service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('stop-rust-service', async () => {
    if (!rustServiceManager) {
      throw new Error('Rust service manager not initialized');
    }
    try {
      await rustServiceManager.stop();

      // 用户手动关闭服务后，将自动启动设为否
      const config = loadNodeConfig();
      if (config.servicePreferences.rustEnabled) {
        config.servicePreferences.rustEnabled = false;
        saveNodeConfig(config);
        logger.info({}, '用户手动关闭 Rust 服务，已更新自动启动配置为否');
      }

      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to stop Rust service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 根据已安装的服务包自动启动所需服务
  ipcMain.handle('auto-start-services-by-models', async () => {
    if (!serviceRegistryManager || !rustServiceManager || !pythonServiceManager) {
      return { success: false, error: 'Service manager not initialized' };
    }

    try {
      // 确保注册表已加载
      await serviceRegistryManager.loadRegistry();
      const installedServices = serviceRegistryManager.listInstalled();

      // 获取所有已安装的 service_id（去重）
      const serviceIds = new Set<string>();
      installedServices.forEach((service) => {
        serviceIds.add(service.service_id);
      });

      const servicesToStart: Array<'nmt' | 'tts' | 'yourtts' | 'rust'> = [];

      // 根据 service_id 判断需要启动哪些服务
      // service_id 到服务类型的映射
      for (const serviceId of serviceIds) {
        if (serviceId === 'node-inference') {
          servicesToStart.push('rust');
        } else if (serviceId === 'nmt-m2m100') {
          servicesToStart.push('nmt');
        } else if (serviceId === 'piper-tts') {
          servicesToStart.push('tts');
        } else if (serviceId === 'your-tts') {
          servicesToStart.push('yourtts');
        }
      }

      // 去重
      const uniqueServices = Array.from(new Set(servicesToStart));

      // 启动服务
      const results: Record<string, boolean> = {};
      for (const service of uniqueServices) {
        try {
          if (service === 'rust') {
            await rustServiceManager.start();
          } else {
            await pythonServiceManager.startService(service);
          }
          results[service] = true;
        } catch (error) {
          logger.error({ error, service }, 'Failed to auto-start service');
          results[service] = false;
        }
      }

      return { success: true, results };
    } catch (error) {
      logger.error({ error }, 'Failed to auto-start services based on installed services');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 服务偏好设置（用于记住用户上一次选择的功能）
  ipcMain.handle('get-service-preferences', async (): Promise<ServicePreferences> => {
    // 使用同步版本，因为配置文件很小，读取很快，不会阻塞
    // 如果未来需要优化，可以改为异步版本
    const config = loadNodeConfig();
    return config.servicePreferences;
  });

  ipcMain.handle(
    'set-service-preferences',
    async (
      _,
      prefs: ServicePreferences,
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const config = loadNodeConfig();
        // 确保所有字段都被保存（包括新添加的字段）
        config.servicePreferences = {
          ...config.servicePreferences,
          ...prefs,
          // 确保新字段有默认值（如果未提供）
          fasterWhisperVadEnabled: prefs.fasterWhisperVadEnabled ?? config.servicePreferences.fasterWhisperVadEnabled ?? false,
          speakerEmbeddingEnabled: prefs.speakerEmbeddingEnabled ?? config.servicePreferences.speakerEmbeddingEnabled ?? false,
          // 语义修复服务偏好（如果未提供，保持原有值）
          semanticRepairZhEnabled: prefs.semanticRepairZhEnabled ?? config.servicePreferences.semanticRepairZhEnabled,
          semanticRepairEnEnabled: prefs.semanticRepairEnEnabled ?? config.servicePreferences.semanticRepairEnEnabled,
          enNormalizeEnabled: prefs.enNormalizeEnabled ?? config.servicePreferences.enNormalizeEnabled,
        };
        saveNodeConfig(config);
        return { success: true };
      } catch (error) {
        logger.error({ error }, 'Failed to save service preferences');
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle('generate-pairing-code', async () => {
    return nodeAgent?.generatePairingCode() || null;
  });

  // 获取处理效率指标（OBS-1，按服务ID分组）
  ipcMain.handle('get-processing-metrics', async () => {
    if (!inferenceService) {
      return {};
    }
    return inferenceService.getProcessingMetrics() || {};
  });

  // 语义修复服务管理 IPC 接口
  ipcMain.handle('get-semantic-repair-service-status', async (_, serviceId: 'en-normalize' | 'semantic-repair-zh' | 'semantic-repair-en') => {
    return semanticRepairServiceManager?.getServiceStatus(serviceId) || {
      serviceId,
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
    };
  });

  ipcMain.handle('get-all-semantic-repair-service-statuses', async () => {
    if (!semanticRepairServiceManager) {
      return [];
    }
    return await semanticRepairServiceManager.getAllServiceStatuses();
  });

  ipcMain.handle('start-semantic-repair-service', async (_, serviceId: SemanticRepairServiceId) => {
    if (!semanticRepairServiceManager) {
      return { success: false, error: 'Semantic repair service manager not initialized' };
    }
    try {
      await semanticRepairServiceManager.startService(serviceId);

      // 用户手动启动服务后，将自动启动设为是（记录用户选择）
      const config = loadNodeConfig();
      const updated = updateSemanticRepairServicePreference(serviceId, true, config);

      if (updated) {
        saveNodeConfig(config);
        logger.info({ serviceId }, '用户手动启动语义修复服务，已更新自动启动配置为是');
      }

      return { success: true };
    } catch (error) {
      logger.error({ error, serviceId }, 'Failed to start semantic repair service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('stop-semantic-repair-service', async (_, serviceId: SemanticRepairServiceId) => {
    if (!semanticRepairServiceManager) {
      return { success: false, error: 'Semantic repair service manager not initialized' };
    }
    try {
      await semanticRepairServiceManager.stopService(serviceId);

      // 用户手动关闭服务后，将自动启动设为否
      const config = loadNodeConfig();
      const updated = updateSemanticRepairServicePreference(serviceId, false, config);

      if (updated) {
        saveNodeConfig(config);
        logger.info({ serviceId }, '用户手动关闭语义修复服务，已更新自动启动配置为否');
      }

      return { success: true };
    } catch (error) {
      logger.error({ error, serviceId }, 'Failed to stop semantic repair service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

