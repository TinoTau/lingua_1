"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedAvailableServices = getCachedAvailableServices;
exports.getCachedServiceRanking = getCachedServiceRanking;
exports.getLastCacheUpdate = getLastCacheUpdate;
exports.getCacheTTL = getCacheTTL;
exports.setCachedAvailableServices = setCachedAvailableServices;
exports.setCachedServiceRanking = setCachedServiceRanking;
exports.setLastCacheUpdate = setLastCacheUpdate;
exports.preloadServiceData = preloadServiceData;
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
// 服务列表和排行的缓存
let cachedAvailableServices = null;
let cachedServiceRanking = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 30000; // 缓存有效期：30秒
function getCachedAvailableServices() {
    return cachedAvailableServices;
}
function getCachedServiceRanking() {
    return cachedServiceRanking;
}
function getLastCacheUpdate() {
    return lastCacheUpdate;
}
function getCacheTTL() {
    return CACHE_TTL;
}
function setCachedAvailableServices(services) {
    cachedAvailableServices = services;
}
function setCachedServiceRanking(ranking) {
    cachedServiceRanking = ranking;
}
function setLastCacheUpdate(timestamp) {
    lastCacheUpdate = timestamp;
}
/**
 * 预加载服务数据（在启动时调用）
 */
async function preloadServiceData() {
    try {
        const axios = require('axios');
        const config = (0, node_config_1.loadNodeConfig)();
        let schedulerUrl = config.scheduler?.url || process.env.SCHEDULER_URL || 'ws://127.0.0.1:5010/ws/node';
        // 如果 URL 包含 localhost，替换为 127.0.0.1 以避免 IPv6 解析问题
        schedulerUrl = schedulerUrl.replace(/localhost/g, '127.0.0.1');
        const httpUrl = schedulerUrl.replace(/^ws:\/\//, 'http://').replace(/\/ws\/node$/, '');
        const statsUrl = `${httpUrl}/api/v1/stats`;
        logger_1.default.info({ statsUrl }, 'Preloading service data from scheduler');
        const response = await axios.get(statsUrl, { timeout: 5000 });
        // 记录完整的响应数据结构，便于调试
        logger_1.default.info({
            statsUrl,
            hasData: !!response.data,
            hasNodes: !!response.data?.nodes,
            nodesKeys: response.data?.nodes ? Object.keys(response.data.nodes) : [],
            serviceNodeCounts: response.data?.nodes?.service_node_counts,
            serviceNodeCountsKeys: response.data?.nodes?.service_node_counts ? Object.keys(response.data.nodes.service_node_counts) : [],
            connectedNodes: response.data?.nodes?.connected_nodes || 0,
        }, 'Received stats response in preloadServiceData');
        // 缓存服务列表
        cachedAvailableServices = response.data?.nodes?.available_services || [];
        // 缓存服务排行
        const serviceNodeCounts = response.data?.nodes?.service_node_counts || {};
        cachedServiceRanking = Object.entries(serviceNodeCounts)
            .map(([service_id, node_count]) => ({
            service_id,
            node_count: typeof node_count === 'number' ? node_count : 0,
        }))
            .sort((a, b) => b.node_count - a.node_count)
            .map((item, index) => ({
            ...item,
            rank: index + 1,
        }));
        lastCacheUpdate = Date.now();
        logger_1.default.info({
            serviceCount: cachedAvailableServices?.length || 0,
            rankingCount: cachedServiceRanking?.length || 0,
            serviceNodeCountsEntries: Object.entries(serviceNodeCounts).slice(0, 10), // 记录前10个条目
        }, 'Service data preloaded and cached successfully');
        // 设置定期刷新缓存（每30秒）
        setInterval(async () => {
            try {
                const response = await axios.get(statsUrl, { timeout: 5000 });
                cachedAvailableServices = response.data?.nodes?.available_services || [];
                const serviceNodeCounts = response.data?.nodes?.service_node_counts || {};
                cachedServiceRanking = Object.entries(serviceNodeCounts)
                    .map(([service_id, node_count]) => ({
                    service_id,
                    node_count: typeof node_count === 'number' ? node_count : 0,
                }))
                    .sort((a, b) => b.node_count - a.node_count)
                    .map((item, index) => ({
                    ...item,
                    rank: index + 1,
                }));
                lastCacheUpdate = Date.now();
                logger_1.default.debug({
                    serviceCount: cachedAvailableServices?.length || 0,
                    rankingCount: cachedServiceRanking?.length || 0
                }, 'Service data cache refreshed');
            }
            catch (error) {
                logger_1.default.debug({ error: error.message }, 'Failed to refresh service data cache, will retry later');
            }
        }, CACHE_TTL);
    }
    catch (error) {
        logger_1.default.warn({ error: error.message }, 'Failed to preload service data, will retry on demand');
    }
}
