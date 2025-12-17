import { ipcMain } from 'electron';
import { loadNodeConfig, saveNodeConfig, ServicePreferences } from '../node-config';
import logger from '../logger';
import type { NodeAgent } from '../agent/node-agent';
import type { ModelManager } from '../model-manager/model-manager';
import type { RustServiceManager } from '../rust-service-manager';
import type { PythonServiceManager } from '../python-service-manager';

export function registerRuntimeHandlers(
  nodeAgent: NodeAgent | null,
  modelManager: ModelManager | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
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
  ipcMain.handle('get-python-service-status', async (_, serviceName: 'nmt' | 'tts' | 'yourtts') => {
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

  ipcMain.handle('start-python-service', async (_, serviceName: 'nmt' | 'tts' | 'yourtts') => {
    if (!pythonServiceManager) {
      throw new Error('Python service manager not initialized');
    }
    try {
      await pythonServiceManager.startService(serviceName);
      return { success: true };
    } catch (error) {
      logger.error({ error, serviceName }, 'Failed to start Python service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('stop-python-service', async (_, serviceName: 'nmt' | 'tts' | 'yourtts') => {
    if (!pythonServiceManager) {
      throw new Error('Python service manager not initialized');
    }
    try {
      await pythonServiceManager.stopService(serviceName);
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
      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to stop Rust service');
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 根据已安装的模型自动启动所需服务
  ipcMain.handle('auto-start-services-by-models', async () => {
    if (!modelManager || !rustServiceManager || !pythonServiceManager) {
      return { success: false, error: 'Service manager not initialized' };
    }

    try {
      const installedModels = modelManager.getInstalledModels();
      const servicesToStart: Array<'nmt' | 'tts' | 'yourtts' | 'rust'> = [];

      // 检查是否需要启动各个服务
      const hasNmtModel = installedModels.some(m =>
        m.modelId.includes('nmt') || m.modelId.includes('m2m')
      );
      const hasTtsModel = installedModels.some(m =>
        m.modelId.includes('piper') || (m.modelId.includes('tts') && !m.modelId.includes('your'))
      );
      const hasYourttsModel = installedModels.some(m =>
        m.modelId.includes('yourtts') || m.modelId.includes('your_tts')
      );
      const hasAsrModel = installedModels.some(m =>
        m.modelId.includes('asr') || m.modelId.includes('whisper')
      );

      if (hasNmtModel) servicesToStart.push('nmt');
      if (hasTtsModel) servicesToStart.push('tts');
      if (hasYourttsModel) servicesToStart.push('yourtts');
      if (hasAsrModel) servicesToStart.push('rust');

      // 启动服务
      const results: Record<string, boolean> = {};
      for (const service of servicesToStart) {
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
      logger.error({ error }, 'Failed to auto-start services based on models');
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
        config.servicePreferences = {
          ...config.servicePreferences,
          ...prefs,
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
}

