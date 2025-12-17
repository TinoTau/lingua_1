"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerModelHandlers = registerModelHandlers;
const electron_1 = require("electron");
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
function registerModelHandlers(modelManager) {
    electron_1.ipcMain.handle('get-installed-models', async () => {
        const models = modelManager?.getInstalledModels() || [];
        logger_1.default.debug({ modelCount: models.length }, 'IPC: get-installed-models returned');
        return models;
    });
    electron_1.ipcMain.handle('get-available-models', async () => {
        try {
            const models = await modelManager?.getAvailableModels() || [];
            logger_1.default.debug({ modelCount: models.length }, 'IPC: get-available-models returned');
            return models;
        }
        catch (error) {
            logger_1.default.error({ error: error.message }, 'IPC: get-available-models failed');
            throw error; // 抛出错误，让 UI 能够捕获
        }
    });
    electron_1.ipcMain.handle('download-model', async (_, modelId, version) => {
        if (!modelManager)
            return false;
        try {
            await modelManager.downloadModel(modelId, version);
            return true;
        }
        catch (error) {
            logger_1.default.error({ error, modelId }, 'Failed to download model');
            return false;
        }
    });
    electron_1.ipcMain.handle('uninstall-model', async (_, modelId, version) => {
        return modelManager?.uninstallModel(modelId, version) || false;
    });
    electron_1.ipcMain.handle('get-model-path', async (_, modelId, version) => {
        if (!modelManager)
            return null;
        try {
            return await modelManager.getModelPath(modelId, version);
        }
        catch (error) {
            logger_1.default.error({ error, modelId }, 'Failed to get model path');
            return null;
        }
    });
    electron_1.ipcMain.handle('get-model-ranking', async () => {
        try {
            const axios = require('axios');
            // 优先从配置文件读取，其次从环境变量，最后使用默认值
            const config = (0, node_config_1.loadNodeConfig)();
            const configUrl = config.modelHub?.url;
            const envUrl = process.env.MODEL_HUB_URL;
            let urlToUse;
            if (configUrl) {
                urlToUse = configUrl;
            }
            else if (envUrl) {
                urlToUse = envUrl;
            }
            else {
                urlToUse = 'http://127.0.0.1:5000';
            }
            // 如果 URL 包含 localhost，替换为 127.0.0.1 以避免 IPv6 解析问题
            const modelHubUrl = urlToUse.replace(/localhost/g, '127.0.0.1');
            const response = await axios.get(`${modelHubUrl}/api/model-usage/ranking`);
            return response.data || [];
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get model ranking');
            return [];
        }
    });
}
