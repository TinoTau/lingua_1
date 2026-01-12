"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    getSystemResources: () => electron_1.ipcRenderer.invoke('get-system-resources'),
    // 服务管理接口（已替换模型管理）
    getInstalledServices: () => electron_1.ipcRenderer.invoke('get-installed-services'),
    getAvailableServices: () => electron_1.ipcRenderer.invoke('get-available-services'),
    downloadService: (serviceId, version, platform) => electron_1.ipcRenderer.invoke('download-service', serviceId, version, platform),
    uninstallService: (serviceId, version) => electron_1.ipcRenderer.invoke('uninstall-service', serviceId, version),
    getServiceRanking: () => electron_1.ipcRenderer.invoke('get-service-ranking'),
    // 服务下载事件
    onServiceProgress: (callback) => {
        electron_1.ipcRenderer.on('services:progress', (_, progress) => callback(progress));
    },
    onServiceError: (callback) => {
        electron_1.ipcRenderer.on('services:error', (_, error) => callback(error));
    },
    removeServiceProgressListener: () => {
        electron_1.ipcRenderer.removeAllListeners('services:progress');
    },
    removeServiceErrorListener: () => {
        electron_1.ipcRenderer.removeAllListeners('services:error');
    },
    // 模型管理接口（保留以兼容旧代码，但已废弃）
    getInstalledModels: () => electron_1.ipcRenderer.invoke('get-installed-models'),
    getAvailableModels: () => electron_1.ipcRenderer.invoke('get-available-models'),
    downloadModel: (modelId, version) => electron_1.ipcRenderer.invoke('download-model', modelId, version),
    uninstallModel: (modelId, version) => electron_1.ipcRenderer.invoke('uninstall-model', modelId, version),
    getModelPath: (modelId, version) => electron_1.ipcRenderer.invoke('get-model-path', modelId, version),
    getModelRanking: () => electron_1.ipcRenderer.invoke('get-model-ranking'),
    // 模型下载事件（保留以兼容旧代码，但已废弃）
    onModelProgress: (callback) => {
        electron_1.ipcRenderer.on('models:progress', (_, progress) => callback(progress));
    },
    onModelError: (callback) => {
        electron_1.ipcRenderer.on('models:error', (_, error) => callback(error));
    },
    removeModelProgressListener: () => {
        electron_1.ipcRenderer.removeAllListeners('models:progress');
    },
    removeModelErrorListener: () => {
        electron_1.ipcRenderer.removeAllListeners('models:error');
    },
    // 节点管理
    getNodeStatus: () => electron_1.ipcRenderer.invoke('get-node-status'),
    reconnectNode: () => electron_1.ipcRenderer.invoke('reconnect-node'),
    generatePairingCode: () => electron_1.ipcRenderer.invoke('generate-pairing-code'),
    // Rust 服务管理
    getRustServiceStatus: () => electron_1.ipcRenderer.invoke('get-rust-service-status'),
    startRustService: () => electron_1.ipcRenderer.invoke('start-rust-service'),
    stopRustService: () => electron_1.ipcRenderer.invoke('stop-rust-service'),
    // Python 服务管理
    getPythonServiceStatus: (serviceName) => electron_1.ipcRenderer.invoke('get-python-service-status', serviceName),
    getAllPythonServiceStatuses: () => electron_1.ipcRenderer.invoke('get-all-python-service-statuses'),
    startPythonService: (serviceName) => electron_1.ipcRenderer.invoke('start-python-service', serviceName),
    stopPythonService: (serviceName) => electron_1.ipcRenderer.invoke('stop-python-service', serviceName),
    // 自动启动服务（根据已安装的模型）
    autoStartServicesByModels: () => electron_1.ipcRenderer.invoke('auto-start-services-by-models'),
    // 服务偏好（记住用户上一次选择的功能）
    getServicePreferences: () => electron_1.ipcRenderer.invoke('get-service-preferences'),
    setServicePreferences: (prefs) => electron_1.ipcRenderer.invoke('set-service-preferences', prefs),
    // 处理效率指标（OBS-1）
    getProcessingMetrics: () => electron_1.ipcRenderer.invoke('get-processing-metrics'),
    // 语义修复服务管理
    getSemanticRepairServiceStatus: (serviceId) => electron_1.ipcRenderer.invoke('get-semantic-repair-service-status', serviceId),
    getAllSemanticRepairServiceStatuses: () => electron_1.ipcRenderer.invoke('get-all-semantic-repair-service-statuses'),
    startSemanticRepairService: (serviceId) => electron_1.ipcRenderer.invoke('start-semantic-repair-service', serviceId),
    stopSemanticRepairService: (serviceId) => electron_1.ipcRenderer.invoke('stop-semantic-repair-service', serviceId),
    // 注意：模块管理 API 已移除
    // 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
});
