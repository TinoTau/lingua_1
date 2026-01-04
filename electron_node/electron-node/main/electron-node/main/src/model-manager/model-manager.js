"use strict";
// ===== ModelManager 主类 =====
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelManager = exports.ModelNotAvailableError = void 0;
const events_1 = require("events");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const axios_1 = __importDefault(require("axios"));
const errors_1 = require("./errors");
var errors_2 = require("./errors");
Object.defineProperty(exports, "ModelNotAvailableError", { enumerable: true, get: function () { return errors_2.ModelNotAvailableError; } });
// 导入模块
const utils_1 = require("./utils");
const registry_1 = require("./registry");
const lock_manager_1 = require("./lock-manager");
const downloader_1 = require("./downloader");
const verifier_1 = require("./verifier");
const installer_1 = require("./installer");
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
/**
 * ModelManager 类 - 模型管理器
 */
class ModelManager extends events_1.EventEmitter {
    constructor() {
        super();
        this.registry = {};
        this.downloadTasks = new Map();
        // 配置常量
        this.MAX_CONCURRENT_FILES = 3;
        this.MAX_RETRIES = 3;
        this.TASK_LOCK_TIMEOUT = 30 * 60 * 1000; // 30 分钟
        // 优先从配置文件读取，其次从环境变量，最后使用默认值
        const config = (0, node_config_1.loadNodeConfig)();
        const configUrl = config.modelHub?.url;
        const envUrl = process.env.MODEL_HUB_URL;
        // 确定使用的 URL，优先级：配置文件 > 环境变量 > 默认值
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
        this.modelHubUrl = urlToUse.replace(/localhost/g, '127.0.0.1');
        // 优先使用非 C 盘路径
        let userData;
        if (process.env.USER_DATA) {
            userData = process.env.USER_DATA;
        }
        else if (electron_1.app) {
            const defaultUserData = electron_1.app.getPath('userData');
            if (defaultUserData.startsWith('C:\\') || defaultUserData.startsWith('C:/')) {
                const alternativePath = (0, utils_1.findAlternativePath)();
                userData = alternativePath || defaultUserData;
            }
            else {
                userData = defaultUserData;
            }
        }
        else {
            userData = './user-data';
        }
        this.modelsDir = path.join(userData, 'models');
        this.registryPath = path.join(this.modelsDir, 'registry.json');
        this.tempDir = path.join(this.modelsDir, 'temp');
        this.lockDir = path.join(this.modelsDir, 'in-progress-downloads');
        // 初始化模块
        this.registryManager = new registry_1.RegistryManager(this.registryPath);
        this.lockManager = new lock_manager_1.LockManager(this.lockDir, this.TASK_LOCK_TIMEOUT);
        this.downloader = new downloader_1.ModelDownloader(this.modelHubUrl, this.tempDir, this.MAX_CONCURRENT_FILES, this.MAX_RETRIES);
        this.verifier = new verifier_1.ModelVerifier(this.modelHubUrl, this.modelsDir, this.tempDir);
        this.installer = new installer_1.ModelInstaller(this.modelsDir, this.tempDir, this.registryManager);
        this.initialize();
    }
    async initialize() {
        // 记录使用的 Model Hub URL
        const logger = (await Promise.resolve().then(() => __importStar(require('../logger')))).default;
        const config = (0, node_config_1.loadNodeConfig)();
        logger.info({
            modelHubUrl: this.modelHubUrl,
            source: config.modelHub?.url ? 'config' : process.env.MODEL_HUB_URL ? 'environment' : 'default'
        }, 'Model Hub URL configured');
        try {
            // 创建必要的目录
            await fs.mkdir(this.modelsDir, { recursive: true });
            await fs.mkdir(this.tempDir, { recursive: true });
            await fs.mkdir(this.lockDir, { recursive: true });
            // 加载 registry
            this.registry = await this.registryManager.loadRegistry();
            logger.info({
                registrySize: Object.keys(this.registry).length,
                totalVersions: Object.values(this.registry).reduce((sum, versions) => sum + Object.keys(versions).length, 0)
            }, 'Registry loaded');
            // 清理孤儿锁
            await this.lockManager.cleanupOrphanLocks();
        }
        catch (error) {
            logger.error({ error }, 'Failed to initialize ModelManager');
        }
    }
    // ===== 模型列表获取 =====
    async getAvailableModels() {
        try {
            logger_1.default.debug({ modelHubUrl: this.modelHubUrl }, 'Fetching available models from Model Hub');
            const response = await axios_1.default.get(`${this.modelHubUrl}/api/models`, {
                timeout: 10000, // 10秒超时
            });
            // 降低Model Hub相关日志级别为debug，减少终端输出
            logger_1.default.debug({ modelCount: response.data.length, modelHubUrl: this.modelHubUrl }, 'Successfully fetched available models from Model Hub');
            return response.data;
        }
        catch (error) {
            const errorMessage = error.code === 'ECONNREFUSED'
                ? `Cannot connect to Model Hub at ${this.modelHubUrl}. Please ensure Model Hub is running.`
                : error.code === 'ETIMEDOUT'
                    ? `Connection to Model Hub timed out. Please check your network connection.`
                    : error.response?.status === 404
                        ? `Model Hub endpoint not found. Please check if Model Hub is running at ${this.modelHubUrl}`
                        : error.message || 'Unknown error';
            logger_1.default.error({
                error: error.message,
                errorCode: error.code,
                modelHubUrl: this.modelHubUrl,
                status: error.response?.status,
                statusText: error.response?.statusText
            }, 'Failed to get available models list from Model Hub');
            // 抛出错误而不是返回空数组，让调用者知道出错了
            throw new Error(errorMessage);
        }
    }
    getInstalledModels() {
        const result = [];
        for (const [modelId, versions] of Object.entries(this.registry)) {
            for (const [version, info] of Object.entries(versions)) {
                result.push({ modelId, version, info });
            }
        }
        logger_1.default.debug({
            registrySize: Object.keys(this.registry).length,
            installedModelCount: result.length
        }, 'getInstalledModels called');
        return result;
    }
    /**
     * 获取节点模型能力图（capability_state）
     * 返回所有模型的状态映射：model_id -> ModelStatus
     */
    async getCapabilityState() {
        const capabilityState = {};
        try {
            // 获取所有可用模型
            const availableModels = await this.getAvailableModels();
            logger_1.default.debug({ modelCount: availableModels.length }, 'Building capability_state from available models');
            // 遍历所有可用模型，检查其状态
            for (const model of availableModels) {
                const defaultVersion = model.default_version;
                const installedVersion = this.registry[model.id]?.[defaultVersion];
                if (!installedVersion) {
                    // 模型未安装
                    capabilityState[model.id] = 'not_installed';
                }
                else {
                    // 将 InstalledModelVersion['status'] 映射到 ModelStatus
                    const status = installedVersion.status;
                    switch (status) {
                        case 'ready':
                            capabilityState[model.id] = 'ready';
                            break;
                        case 'downloading':
                        case 'verifying':
                        case 'installing':
                            capabilityState[model.id] = 'downloading';
                            break;
                        case 'error':
                            capabilityState[model.id] = 'error';
                            break;
                        default:
                            capabilityState[model.id] = 'not_installed';
                    }
                }
            }
            const readyCount = Object.values(capabilityState).filter(s => s === 'ready').length;
            logger_1.default.info({
                totalModels: Object.keys(capabilityState).length,
                readyModels: readyCount,
                notInstalledModels: Object.values(capabilityState).filter(s => s === 'not_installed').length
            }, 'Capability state built successfully');
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get capability_state');
        }
        return capabilityState;
    }
    /**
     * 将内部状态转换为 ModelStatus
     */
    mapToModelStatus(status) {
        switch (status) {
            case 'ready':
                return 'ready';
            case 'downloading':
            case 'verifying':
            case 'installing':
                return 'downloading';
            case 'error':
                return 'error';
            default:
                return 'not_installed';
        }
    }
    // ===== 模型路径获取 =====
    async getModelPath(modelId, version) {
        // 获取模型信息
        const models = await this.getAvailableModels();
        const model = models.find(m => m.id === modelId);
        if (!model) {
            throw new errors_1.ModelNotAvailableError(modelId, version || 'latest', 'not_installed');
        }
        // 确定版本
        const targetVersion = version || model.default_version;
        // 检查是否已安装
        const installed = this.registry[modelId]?.[targetVersion];
        if (!installed) {
            throw new errors_1.ModelNotAvailableError(modelId, targetVersion, 'not_installed');
        }
        if (installed.status !== 'ready') {
            throw new errors_1.ModelNotAvailableError(modelId, targetVersion, installed.status);
        }
        // 返回模型目录路径
        return path.join(this.modelsDir, modelId, targetVersion);
    }
    // ===== 模型下载 =====
    async downloadModel(modelId, version) {
        // 获取模型信息
        const models = await this.getAvailableModels();
        const model = models.find(m => m.id === modelId);
        if (!model) {
            throw new Error(`Model not found: ${modelId}`);
        }
        const targetVersion = version || model.default_version;
        const versionInfo = model.versions.find(v => v.version === targetVersion);
        if (!versionInfo) {
            throw new Error(`Version not found: ${modelId}@${targetVersion}`);
        }
        const taskKey = `${modelId}_${targetVersion}`;
        // 检查是否已有下载任务
        if (this.downloadTasks.has(taskKey)) {
            return this.downloadTasks.get(taskKey);
        }
        // 尝试获取任务锁
        const lockAcquired = await this.lockManager.acquireTaskLock(modelId, targetVersion);
        if (!lockAcquired) {
            throw new Error('Model is currently being downloaded');
        }
        // 创建下载任务
        const downloadTask = this.performDownload(modelId, targetVersion, versionInfo);
        this.downloadTasks.set(taskKey, downloadTask);
        try {
            await downloadTask;
        }
        finally {
            this.downloadTasks.delete(taskKey);
            await this.lockManager.releaseTaskLock(modelId, targetVersion);
        }
    }
    async performDownload(modelId, version, versionInfo) {
        try {
            // 更新状态为 downloading
            this.updateModelStatus(modelId, version, 'downloading');
            this.emitProgress(modelId, version, 0, versionInfo.size_bytes, 'downloading', {
                totalFiles: versionInfo.files.length,
                downloadedFiles: 0,
            });
            // 下载文件
            await this.downloader.downloadModelFiles(modelId, version, versionInfo, (progress) => {
                this.emit('progress', progress);
            });
            // 验证文件
            this.updateModelStatus(modelId, version, 'verifying');
            this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'verifying', {
                currentFile: '正在验证文件...',
            });
            await this.verifier.verifyFiles(modelId, version, versionInfo, (progress) => {
                this.emit('progress', progress);
            });
            // 安装（移动文件到正式目录）
            this.updateModelStatus(modelId, version, 'installing');
            this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'installing', {
                currentFile: '正在安装模型...',
            });
            await this.installer.installFiles(modelId, version, versionInfo, this.registry);
            // 完成
            this.updateModelStatus(modelId, version, 'ready');
            this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'ready');
        }
        catch (error) {
            this.updateModelStatus(modelId, version, 'error');
            this.emitError(modelId, version, error);
            throw error;
        }
    }
    updateModelStatus(modelId, version, status) {
        if (!this.registry[modelId]) {
            this.registry[modelId] = {};
        }
        const previousStatus = this.registry[modelId][version]?.status;
        if (!this.registry[modelId][version]) {
            this.registry[modelId][version] = {
                status,
                installed_at: new Date().toISOString(),
                size_bytes: 0,
                checksum_sha256: '',
            };
        }
        else {
            this.registry[modelId][version].status = status;
        }
        // 异步保存，不阻塞
        this.registryManager.saveRegistry(this.registry).catch((error) => logger_1.default.error({ error }, 'Failed to save registry'));
        // 如果状态发生变化，触发 capability_state 更新事件
        if (previousStatus !== status) {
            this.emit('capability-state-changed', { modelId, version, status });
        }
    }
    emitProgress(modelId, version, downloadedBytes, totalBytes, state, extra) {
        const progress = {
            modelId,
            version,
            downloadedBytes,
            totalBytes,
            percent: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
            state,
            ...extra,
        };
        this.emit('progress', progress);
    }
    emitError(modelId, version, error) {
        const errorInfo = {
            modelId,
            version,
            stage: (0, utils_1.getErrorStage)(error),
            message: error instanceof Error ? error.message : String(error),
            canRetry: (0, utils_1.isRetryableError)(error),
        };
        this.emit('error', errorInfo);
    }
    // ===== 模型卸载 =====
    async uninstallModel(modelId, version) {
        try {
            if (version) {
                // 卸载指定版本
                const versionDir = path.join(this.modelsDir, modelId, version);
                if (await (0, utils_1.fileExists)(versionDir)) {
                    await fs.rm(versionDir, { recursive: true });
                }
                if (this.registry[modelId]?.[version]) {
                    delete this.registry[modelId][version];
                    if (Object.keys(this.registry[modelId]).length === 0) {
                        delete this.registry[modelId];
                    }
                }
            }
            else {
                // 卸载所有版本
                const modelDir = path.join(this.modelsDir, modelId);
                if (await (0, utils_1.fileExists)(modelDir)) {
                    await fs.rm(modelDir, { recursive: true });
                }
                delete this.registry[modelId];
            }
            await this.registryManager.saveRegistry(this.registry);
            return true;
        }
        catch (error) {
            logger_1.default.error({ error, modelId }, 'Failed to uninstall model');
            return false;
        }
    }
}
exports.ModelManager = ModelManager;
