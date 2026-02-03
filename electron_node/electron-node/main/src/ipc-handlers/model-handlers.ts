import { ipcMain } from 'electron';
import { getModelHubUrl } from '../node-config';
import logger from '../logger';
import type { ModelManager } from '../model-manager/model-manager';

export function registerModelHandlers(modelManager: ModelManager | null): void {
  ipcMain.handle('get-installed-models', async () => {
    const models = modelManager?.getInstalledModels() || [];
    logger.debug({ modelCount: models.length }, 'IPC: get-installed-models returned');
    return models;
  });

  ipcMain.handle('get-available-models', async () => {
    try {
      const models = await modelManager?.getAvailableModels() || [];
      logger.debug({ modelCount: models.length }, 'IPC: get-available-models returned');
      return models;
    } catch (error: any) {
      logger.error({ error: error.message }, 'IPC: get-available-models failed');
      throw error; // 抛出错误，让 UI 能够捕获
    }
  });

  ipcMain.handle('download-model', async (_, modelId: string, version?: string) => {
    if (!modelManager) return false;
    try {
      await modelManager.downloadModel(modelId, version);
      return true;
    } catch (error) {
      logger.error({ error, modelId }, 'Failed to download model');
      return false;
    }
  });

  ipcMain.handle('uninstall-model', async (_, modelId: string, version?: string) => {
    return modelManager?.uninstallModel(modelId, version) || false;
  });

  ipcMain.handle('get-model-path', async (_, modelId: string, version?: string) => {
    if (!modelManager) return null;
    try {
      return await modelManager.getModelPath(modelId, version);
    } catch (error) {
      logger.error({ error, modelId }, 'Failed to get model path');
      return null;
    }
  });

  ipcMain.handle('get-model-ranking', async () => {
    try {
      const axios = require('axios');
      const modelHubUrl = getModelHubUrl();
      const response = await axios.get(`${modelHubUrl}/api/model-usage/ranking`);
      return response.data || [];
    } catch (error) {
      logger.error({ error }, 'Failed to get model ranking');
      return [];
    }
  });
}

