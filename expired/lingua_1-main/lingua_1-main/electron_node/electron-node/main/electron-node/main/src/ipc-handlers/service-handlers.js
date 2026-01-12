"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerServiceHandlers = registerServiceHandlers;
const electron_1 = require("electron");
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
const window_manager_1 = require("../window-manager");
const service_cache_1 = require("./service-cache");
const service_uninstall_1 = require("./service-uninstall");
function registerServiceHandlers(serviceRegistryManager, servicePackageManager, rustServiceManager, pythonServiceManager) {
    electron_1.ipcMain.handle('get-installed-services', async () => {
        try {
            if (!serviceRegistryManager) {
                logger_1.default.warn({}, 'Service registry manager not initialized');
                return [];
            }
            // 直接使用已加载的注册表，不重新加载（避免阻塞）
            // 如果需要在获取最新数据，可以后续添加刷新机制，但不应该在每次调用时都重新加载
            // 从服务注册表获取已安装的服务（使用内存中的注册表数据）
            const installed = serviceRegistryManager.listInstalled();
            logger_1.default.info({
                installedCount: installed.length,
                installed: installed.map(s => ({
                    service_id: s.service_id,
                    version: s.version,
                    platform: s.platform,
                    install_path: s.install_path
                }))
            }, 'Retrieved installed services from registry');
            // 转换为前端期望的格式
            // 直接从 installed.json 读取 size_bytes，不需要计算文件系统，快速且不阻塞
            const result = installed.map((service) => {
                // 从 installed.json 中读取 size_bytes（在安装时从 services_index.json 复制而来）
                const sizeBytes = service.size_bytes || 0;
                return {
                    serviceId: service.service_id,
                    version: service.version,
                    platform: service.platform,
                    info: {
                        status: 'ready',
                        installed_at: service.installed_at,
                        size_bytes: sizeBytes,
                    },
                };
            });
            logger_1.default.info({
                serviceCount: result.length,
                services: result.map(s => s.serviceId)
            }, 'IPC: get-installed-services returned');
            return result;
        }
        catch (error) {
            logger_1.default.error({ error: error.message, stack: error.stack }, 'Failed to get installed services');
            return [];
        }
    });
    electron_1.ipcMain.handle('get-available-services', async () => {
        // 如果缓存有效，直接返回缓存数据（快速返回，不阻塞）
        const now = Date.now();
        const cachedServices = (0, service_cache_1.getCachedAvailableServices)();
        const lastUpdate = (0, service_cache_1.getLastCacheUpdate)();
        const ttl = (0, service_cache_1.getCacheTTL)();
        if (cachedServices !== null && (now - lastUpdate) < ttl) {
            logger_1.default.debug({ serviceCount: cachedServices.length }, 'Returning cached available services');
            return [...cachedServices]; // 返回副本，避免外部修改
        }
        // 如果有旧缓存，先返回旧缓存，然后在后台更新（不阻塞界面）
        if (cachedServices !== null && cachedServices.length > 0) {
            logger_1.default.debug({ serviceCount: cachedServices.length }, 'Returning stale cache for available services, will refresh in background');
            // 在后台异步更新，不等待结果
            setImmediate(async () => {
                try {
                    await refreshAvailableServices();
                }
                catch (error) {
                    logger_1.default.debug({ error }, 'Background available services refresh failed, will retry on next request');
                }
            });
            return [...cachedServices];
        }
        // 没有缓存，需要立即返回，不阻塞界面
        // 使用 Promise.race 确保快速返回
        try {
            const response = await Promise.race([
                refreshAvailableServices(),
                new Promise((resolve) => {
                    setTimeout(() => {
                        logger_1.default.debug({}, 'Available services fetch timeout, returning empty array');
                        resolve([]);
                    }, 2000); // 2秒超时，快速返回
                })
            ]);
            if (response && response.length > 0) {
                return response;
            }
            // 如果超时或返回空，返回空数组
            logger_1.default.debug({}, 'Available services fetch returned empty or timed out');
            return [];
        }
        catch (error) {
            logger_1.default.debug({ error: error.message }, 'Available services fetch failed, returning empty array');
            return [];
        }
    });
    // 辅助函数：刷新可用服务列表
    async function refreshAvailableServices() {
        try {
            const axios = require('axios');
            const config = (0, node_config_1.loadNodeConfig)();
            // 从调度服务器获取服务列表
            let schedulerUrl = config.scheduler?.url || process.env.SCHEDULER_URL || 'ws://127.0.0.1:5010/ws/node';
            // 如果 URL 包含 localhost，替换为 127.0.0.1 以避免 IPv6 解析问题
            schedulerUrl = schedulerUrl.replace(/localhost/g, '127.0.0.1');
            // 将 WebSocket URL 转换为 HTTP URL
            const httpUrl = schedulerUrl.replace(/^ws:\/\//, 'http://').replace(/\/ws\/node$/, '');
            const statsUrl = `${httpUrl}/api/v1/stats`;
            logger_1.default.debug({ statsUrl }, 'Fetching available services from scheduler');
            const response = await axios.get(statsUrl, {
                timeout: 2000, // 2秒超时，确保快速返回
                validateStatus: (status) => status < 500, // 接受 4xx 错误，但不接受 5xx
            });
            const services = response.data?.nodes?.available_services || [];
            // 更新缓存
            (0, service_cache_1.setCachedAvailableServices)(services);
            (0, service_cache_1.setLastCacheUpdate)(Date.now());
            logger_1.default.debug({ serviceCount: services.length, statsUrl }, 'Successfully fetched available services from scheduler');
            return services;
        }
        catch (error) {
            // 记录错误但不抛出，让调用者处理
            logger_1.default.debug({
                error: error.message,
                errorCode: error.code,
                statsUrl: error.config?.url
            }, 'Failed to refresh available services');
            throw error; // 重新抛出，让 Promise.race 处理
        }
    }
    electron_1.ipcMain.handle('download-service', async (_, serviceId, version, platform) => {
        try {
            if (!servicePackageManager) {
                logger_1.default.error({}, 'Service package manager not initialized');
                throw new Error('服务包管理器未初始化');
            }
            logger_1.default.info({ serviceId, version, platform }, 'Starting service download');
            const mainWindow = (0, window_manager_1.getMainWindow)();
            // 发送进度事件给前端
            const sendProgress = (progress) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('services:progress', {
                        serviceId: progress.service_id,
                        version: progress.version,
                        platform: progress.platform,
                        stage: progress.stage,
                        downloadedBytes: progress.downloadedBytes,
                        totalBytes: progress.totalBytes,
                        percent: progress.percent,
                    });
                }
            };
            // 调用服务包管理器安装服务
            await servicePackageManager.installService(serviceId, version, sendProgress);
            logger_1.default.info({ serviceId, version, platform }, 'Service downloaded and installed successfully');
            return true;
        }
        catch (error) {
            logger_1.default.error({ error: error.message, serviceId, version, platform }, 'Failed to download service');
            const mainWindow = (0, window_manager_1.getMainWindow)();
            // 发送错误事件给前端
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('services:error', {
                    serviceId,
                    version,
                    platform,
                    error: error.message || 'Unknown error',
                });
            }
            throw error;
        }
    });
    electron_1.ipcMain.handle('uninstall-service', async (_, serviceId, version) => {
        return await (0, service_uninstall_1.uninstallService)(serviceId, version, serviceRegistryManager, rustServiceManager, pythonServiceManager);
    });
    electron_1.ipcMain.handle('get-service-ranking', async () => {
        // 如果缓存有效且不为空，直接返回缓存数据（快速返回，不阻塞）
        const now = Date.now();
        const cachedRanking = (0, service_cache_1.getCachedServiceRanking)();
        const lastUpdate = (0, service_cache_1.getLastCacheUpdate)();
        const ttl = (0, service_cache_1.getCacheTTL)();
        // 只有当缓存不为空且有效时才使用缓存
        if (cachedRanking !== null && cachedRanking.length > 0 && (now - lastUpdate) < ttl) {
            logger_1.default.debug({ rankingCount: cachedRanking.length }, 'Returning cached service ranking');
            return [...cachedRanking]; // 返回副本，避免外部修改
        }
        // 如果有旧缓存（即使为空），先返回旧缓存，然后在后台更新（不阻塞界面）
        if (cachedRanking !== null && cachedRanking.length > 0) {
            logger_1.default.debug({ rankingCount: cachedRanking.length }, 'Returning stale cache for ranking, will refresh in background');
            // 在后台异步更新，不等待结果
            setImmediate(async () => {
                try {
                    await refreshServiceRanking();
                }
                catch (error) {
                    logger_1.default.debug({ error }, 'Background ranking refresh failed, will retry on next request');
                }
            });
            return [...cachedRanking];
        }
        // 如果缓存为空，强制刷新（不返回空缓存）
        if (cachedRanking !== null && cachedRanking.length === 0) {
            logger_1.default.info({}, 'Cache is empty, forcing refresh for service ranking');
        }
        // 没有缓存，需要立即返回，不阻塞界面
        // 使用 Promise.race 确保快速返回
        try {
            const response = await Promise.race([
                refreshServiceRanking(),
                new Promise((resolve) => {
                    setTimeout(() => {
                        logger_1.default.warn({}, 'Service ranking fetch timeout, returning empty array');
                        resolve([]);
                    }, 6000); // 6秒超时，给 refreshServiceRanking 的 5 秒超时留出缓冲
                })
            ]);
            if (response && response.length > 0) {
                logger_1.default.info({ rankingCount: response.length }, 'Service ranking fetched successfully');
                return response;
            }
            // 如果超时或返回空，返回空数组
            logger_1.default.warn({}, 'Service ranking fetch returned empty or timed out');
            return [];
        }
        catch (error) {
            logger_1.default.error({ error: error.message }, 'Service ranking fetch failed, returning empty array');
            return [];
        }
    });
    // 辅助函数：刷新服务排行
    async function refreshServiceRanking() {
        try {
            const axios = require('axios');
            const config = (0, node_config_1.loadNodeConfig)();
            // 从调度服务器获取服务排行（基于使用节点数）
            let schedulerUrl = config.scheduler?.url || process.env.SCHEDULER_URL || 'ws://127.0.0.1:5010/ws/node';
            // 如果 URL 包含 localhost，替换为 127.0.0.1 以避免 IPv6 解析问题
            schedulerUrl = schedulerUrl.replace(/localhost/g, '127.0.0.1');
            const httpUrl = schedulerUrl.replace(/^ws:\/\//, 'http://').replace(/\/ws\/node$/, '');
            const statsUrl = `${httpUrl}/api/v1/stats`;
            logger_1.default.info({ statsUrl }, 'Fetching service ranking from scheduler');
            const response = await axios.get(statsUrl, {
                timeout: 5000, // 5秒超时，给调度服务器更多时间响应
                validateStatus: (status) => status < 500,
            });
            // 记录完整的响应数据结构，便于调试
            logger_1.default.info({
                statsUrl,
                hasData: !!response.data,
                hasNodes: !!response.data?.nodes,
                nodesKeys: response.data?.nodes ? Object.keys(response.data.nodes) : [],
                serviceNodeCounts: response.data?.nodes?.service_node_counts,
                serviceNodeCountsKeys: response.data?.nodes?.service_node_counts ? Object.keys(response.data.nodes.service_node_counts) : [],
            }, 'Received stats response from scheduler');
            const serviceNodeCounts = response.data?.nodes?.service_node_counts || {};
            const connectedNodes = response.data?.nodes?.connected_nodes || 0;
            const availableServices = response.data?.nodes?.available_services || [];
            logger_1.default.info({
                statsUrl,
                serviceNodeCountsKeys: Object.keys(serviceNodeCounts),
                serviceNodeCountsEntries: Object.entries(serviceNodeCounts).slice(0, 10), // 记录前10个条目
                hasData: Object.keys(serviceNodeCounts).length > 0,
                connectedNodes,
                availableServicesCount: availableServices.length,
            }, 'Service node counts from scheduler');
            // 转换为排行格式，按使用节点数排序
            const ranking = Object.entries(serviceNodeCounts)
                .map(([service_id, node_count]) => ({
                service_id,
                node_count: typeof node_count === 'number' ? node_count : 0,
            }))
                .sort((a, b) => b.node_count - a.node_count)
                .map((item, index) => ({
                ...item,
                rank: index + 1,
            }));
            logger_1.default.info({
                rankingCount: ranking.length,
                ranking: ranking.slice(0, 10) // 记录前10个
            }, 'Successfully fetched service ranking from scheduler');
            // 如果没有排行数据，记录警告信息
            if (ranking.length === 0) {
                logger_1.default.warn({
                    connectedNodes: response.data?.nodes?.connected_nodes || 0,
                    availableServices: response.data?.nodes?.available_services?.length || 0,
                    hasServiceNodeCounts: !!response.data?.nodes?.service_node_counts,
                    serviceNodeCountsType: typeof response.data?.nodes?.service_node_counts,
                }, 'Service ranking is empty - no nodes are using services or no nodes connected');
            }
            // 更新缓存
            (0, service_cache_1.setCachedServiceRanking)(ranking);
            (0, service_cache_1.setLastCacheUpdate)(Date.now());
            return ranking;
        }
        catch (error) {
            // 记录错误信息
            logger_1.default.error({
                error: error.message,
                errorCode: error.code,
                errorStack: error.stack,
                statsUrl: error.config?.url,
                responseStatus: error.response?.status,
                responseData: error.response?.data,
            }, 'Failed to refresh service ranking');
            throw error; // 重新抛出，让 Promise.race 处理
        }
    }
}
