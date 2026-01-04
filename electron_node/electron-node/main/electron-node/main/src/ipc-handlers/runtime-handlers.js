"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRuntimeHandlers = registerRuntimeHandlers;
const electron_1 = require("electron");
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
function registerRuntimeHandlers(nodeAgent, modelManager, inferenceService, rustServiceManager, pythonServiceManager, serviceRegistryManager, semanticRepairServiceManager) {
    electron_1.ipcMain.handle('get-node-status', async () => {
        return nodeAgent?.getStatus() || { online: false, nodeId: null };
    });
    electron_1.ipcMain.handle('reconnect-node', async () => {
        if (nodeAgent) {
            try {
                // 先停止现有连接（如果存在）
                nodeAgent.stop();
                // 然后重新启动
                await nodeAgent.start();
                logger_1.default.info({}, 'Node reconnection initiated');
                return { success: true };
            }
            catch (error) {
                logger_1.default.error({ error }, 'Failed to reconnect node');
                return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
            }
        }
        return { success: false, error: 'Node agent not initialized' };
    });
    electron_1.ipcMain.handle('get-rust-service-status', async () => {
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
    electron_1.ipcMain.handle('get-python-service-status', async (_, serviceName) => {
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
    electron_1.ipcMain.handle('get-all-python-service-statuses', async () => {
        return pythonServiceManager?.getAllServiceStatuses() || [];
    });
    electron_1.ipcMain.handle('start-python-service', async (_, serviceName) => {
        if (!pythonServiceManager) {
            throw new Error('Python service manager not initialized');
        }
        try {
            await pythonServiceManager.startService(serviceName);
            return { success: true };
        }
        catch (error) {
            logger_1.default.error({ error, serviceName }, 'Failed to start Python service');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('stop-python-service', async (_, serviceName) => {
        if (!pythonServiceManager) {
            throw new Error('Python service manager not initialized');
        }
        try {
            await pythonServiceManager.stopService(serviceName);
            return { success: true };
        }
        catch (error) {
            logger_1.default.error({ error, serviceName }, 'Failed to stop Python service');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    // Rust 服务管理 IPC 接口
    electron_1.ipcMain.handle('start-rust-service', async () => {
        if (!rustServiceManager) {
            throw new Error('Rust service manager not initialized');
        }
        try {
            await rustServiceManager.start();
            return { success: true };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to start Rust service');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('stop-rust-service', async () => {
        if (!rustServiceManager) {
            throw new Error('Rust service manager not initialized');
        }
        try {
            await rustServiceManager.stop();
            return { success: true };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to stop Rust service');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    // 根据已安装的服务包自动启动所需服务
    electron_1.ipcMain.handle('auto-start-services-by-models', async () => {
        if (!serviceRegistryManager || !rustServiceManager || !pythonServiceManager) {
            return { success: false, error: 'Service manager not initialized' };
        }
        try {
            // 确保注册表已加载
            await serviceRegistryManager.loadRegistry();
            const installedServices = serviceRegistryManager.listInstalled();
            // 获取所有已安装的 service_id（去重）
            const serviceIds = new Set();
            installedServices.forEach((service) => {
                serviceIds.add(service.service_id);
            });
            const servicesToStart = [];
            // 根据 service_id 判断需要启动哪些服务
            // service_id 到服务类型的映射
            for (const serviceId of serviceIds) {
                if (serviceId === 'node-inference') {
                    servicesToStart.push('rust');
                }
                else if (serviceId === 'nmt-m2m100') {
                    servicesToStart.push('nmt');
                }
                else if (serviceId === 'piper-tts') {
                    servicesToStart.push('tts');
                }
                else if (serviceId === 'your-tts') {
                    servicesToStart.push('yourtts');
                }
            }
            // 去重
            const uniqueServices = Array.from(new Set(servicesToStart));
            // 启动服务
            const results = {};
            for (const service of uniqueServices) {
                try {
                    if (service === 'rust') {
                        await rustServiceManager.start();
                    }
                    else {
                        await pythonServiceManager.startService(service);
                    }
                    results[service] = true;
                }
                catch (error) {
                    logger_1.default.error({ error, service }, 'Failed to auto-start service');
                    results[service] = false;
                }
            }
            return { success: true, results };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to auto-start services based on installed services');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    // 服务偏好设置（用于记住用户上一次选择的功能）
    electron_1.ipcMain.handle('get-service-preferences', async () => {
        // 使用同步版本，因为配置文件很小，读取很快，不会阻塞
        // 如果未来需要优化，可以改为异步版本
        const config = (0, node_config_1.loadNodeConfig)();
        return config.servicePreferences;
    });
    electron_1.ipcMain.handle('set-service-preferences', async (_, prefs) => {
        try {
            const config = (0, node_config_1.loadNodeConfig)();
            // 确保所有字段都被保存（包括新添加的字段）
            config.servicePreferences = {
                ...config.servicePreferences,
                ...prefs,
                // 确保新字段有默认值（如果未提供）
                fasterWhisperVadEnabled: prefs.fasterWhisperVadEnabled ?? config.servicePreferences.fasterWhisperVadEnabled ?? false,
                speakerEmbeddingEnabled: prefs.speakerEmbeddingEnabled ?? config.servicePreferences.speakerEmbeddingEnabled ?? false,
            };
            (0, node_config_1.saveNodeConfig)(config);
            return { success: true };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to save service preferences');
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    });
    electron_1.ipcMain.handle('generate-pairing-code', async () => {
        return nodeAgent?.generatePairingCode() || null;
    });
    // 获取处理效率指标（OBS-1，按服务ID分组）
    electron_1.ipcMain.handle('get-processing-metrics', async () => {
        if (!inferenceService) {
            return {};
        }
        return inferenceService.getProcessingMetrics() || {};
    });
    // 语义修复服务管理 IPC 接口
    electron_1.ipcMain.handle('get-semantic-repair-service-status', async (_, serviceId) => {
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
    electron_1.ipcMain.handle('get-all-semantic-repair-service-statuses', async () => {
        if (!semanticRepairServiceManager) {
            return [];
        }
        return await semanticRepairServiceManager.getAllServiceStatuses();
    });
    electron_1.ipcMain.handle('start-semantic-repair-service', async (_, serviceId) => {
        if (!semanticRepairServiceManager) {
            return { success: false, error: 'Semantic repair service manager not initialized' };
        }
        try {
            await semanticRepairServiceManager.startService(serviceId);
            return { success: true };
        }
        catch (error) {
            logger_1.default.error({ error, serviceId }, 'Failed to start semantic repair service');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
    electron_1.ipcMain.handle('stop-semantic-repair-service', async (_, serviceId) => {
        if (!semanticRepairServiceManager) {
            return { success: false, error: 'Semantic repair service manager not initialized' };
        }
        try {
            await semanticRepairServiceManager.stopService(serviceId);
            return { success: true };
        }
        catch (error) {
            logger_1.default.error({ error, serviceId }, 'Failed to stop semantic repair service');
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    });
}
