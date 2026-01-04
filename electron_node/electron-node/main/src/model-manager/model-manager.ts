// ===== ModelManager 主类 =====

import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';
import axios from 'axios';

// 导入类型和错误
import {
  ModelInfo,
  ModelVersion,
  InstalledModelVersion,
  Registry,
  ModelDownloadProgress,
  ModelDownloadError,
} from './types';
import { ModelNotAvailableError } from './errors';
import type { ModelStatus } from '@shared/protocols/messages';
export { ModelFileInfo, ModelVersion, ModelInfo, InstalledModelVersion, Registry, ModelDownloadProgress, ModelDownloadError } from './types';
export { ModelNotAvailableError } from './errors';

// 导入模块
import { findAlternativePath, getErrorStage, isRetryableError, fileExists } from './utils';
import { RegistryManager } from './registry';
import { LockManager } from './lock-manager';
import { ModelDownloader } from './downloader';
import { ModelVerifier } from './verifier';
import { ModelInstaller } from './installer';
import { loadNodeConfig } from '../node-config';
import logger from '../logger';

/**
 * ModelManager 类 - 模型管理器
 */
export class ModelManager extends EventEmitter {
  private modelHubUrl: string;
  private modelsDir: string;
  private registryPath: string;
  private tempDir: string;
  private lockDir: string;
  private registry: Registry = {};
  private downloadTasks: Map<string, Promise<void>> = new Map();

  // 模块实例
  private registryManager: RegistryManager;
  private lockManager: LockManager;
  private downloader: ModelDownloader;
  private verifier: ModelVerifier;
  private installer: ModelInstaller;

  // 配置常量
  private readonly MAX_CONCURRENT_FILES = 3;
  private readonly MAX_RETRIES = 3;
  private readonly TASK_LOCK_TIMEOUT = 30 * 60 * 1000; // 30 分钟

  constructor() {
    super();
    // 优先从配置文件读取，其次从环境变量，最后使用默认值
    const config = loadNodeConfig();
    const configUrl = config.modelHub?.url;
    const envUrl = process.env.MODEL_HUB_URL;
    
    // 确定使用的 URL，优先级：配置文件 > 环境变量 > 默认值
    let urlToUse: string;
    if (configUrl) {
      urlToUse = configUrl;
    } else if (envUrl) {
      urlToUse = envUrl;
    } else {
      urlToUse = 'http://127.0.0.1:5000';
    }
    
    // 如果 URL 包含 localhost，替换为 127.0.0.1 以避免 IPv6 解析问题
    this.modelHubUrl = urlToUse.replace(/localhost/g, '127.0.0.1');

    // 优先使用非 C 盘路径
    let userData: string;
    if (process.env.USER_DATA) {
      userData = process.env.USER_DATA;
    } else if (app) {
      const defaultUserData = app.getPath('userData');
      if (defaultUserData.startsWith('C:\\') || defaultUserData.startsWith('C:/')) {
        const alternativePath = findAlternativePath();
        userData = alternativePath || defaultUserData;
      } else {
        userData = defaultUserData;
      }
    } else {
      userData = './user-data';
    }

    this.modelsDir = path.join(userData, 'models');
    this.registryPath = path.join(this.modelsDir, 'registry.json');
    this.tempDir = path.join(this.modelsDir, 'temp');
    this.lockDir = path.join(this.modelsDir, 'in-progress-downloads');

    // 初始化模块
    this.registryManager = new RegistryManager(this.registryPath);
    this.lockManager = new LockManager(this.lockDir, this.TASK_LOCK_TIMEOUT);
    this.downloader = new ModelDownloader(
      this.modelHubUrl,
      this.tempDir,
      this.MAX_CONCURRENT_FILES,
      this.MAX_RETRIES
    );
    this.verifier = new ModelVerifier(this.modelHubUrl, this.modelsDir, this.tempDir);
    this.installer = new ModelInstaller(this.modelsDir, this.tempDir, this.registryManager);

    this.initialize();
  }

  private async initialize(): Promise<void> {
    // 记录使用的 Model Hub URL
    const logger = (await import('../logger')).default;
    const config = loadNodeConfig();
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
    } catch (error) {
      logger.error({ error }, 'Failed to initialize ModelManager');
    }
  }

  // ===== 模型列表获取 =====

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      logger.debug({ modelHubUrl: this.modelHubUrl }, 'Fetching available models from Model Hub');
      const response = await axios.get<ModelInfo[]>(`${this.modelHubUrl}/api/models`, {
        timeout: 10000, // 10秒超时
      });
      // 降低Model Hub相关日志级别为debug，减少终端输出
      logger.debug({ modelCount: response.data.length, modelHubUrl: this.modelHubUrl }, 'Successfully fetched available models from Model Hub');
      return response.data;
    } catch (error: any) {
      const errorMessage = error.code === 'ECONNREFUSED' 
        ? `Cannot connect to Model Hub at ${this.modelHubUrl}. Please ensure Model Hub is running.`
        : error.code === 'ETIMEDOUT'
        ? `Connection to Model Hub timed out. Please check your network connection.`
        : error.response?.status === 404
        ? `Model Hub endpoint not found. Please check if Model Hub is running at ${this.modelHubUrl}`
        : error.message || 'Unknown error';
      
      logger.error({ 
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

  getInstalledModels(): Array<{ modelId: string; version: string; info: InstalledModelVersion }> {
    const result: Array<{ modelId: string; version: string; info: InstalledModelVersion }> = [];

    for (const [modelId, versions] of Object.entries(this.registry)) {
      for (const [version, info] of Object.entries(versions)) {
        result.push({ modelId, version, info });
      }
    }

    logger.debug({ 
      registrySize: Object.keys(this.registry).length,
      installedModelCount: result.length 
    }, 'getInstalledModels called');
    
    return result;
  }

  /**
   * 获取节点模型能力图（capability_state）
   * 返回所有模型的状态映射：model_id -> ModelStatus
   */
  async getCapabilityState(): Promise<Record<string, ModelStatus>> {
    const capabilityState: Record<string, ModelStatus> = {};

    try {
      // 获取所有可用模型
      const availableModels = await this.getAvailableModels();
      logger.debug({ modelCount: availableModels.length }, 'Building capability_state from available models');

      // 遍历所有可用模型，检查其状态
      for (const model of availableModels) {
        const defaultVersion = model.default_version;
        const installedVersion = this.registry[model.id]?.[defaultVersion];

        if (!installedVersion) {
          // 模型未安装
          capabilityState[model.id] = 'not_installed';
        } else {
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
      logger.info({ 
        totalModels: Object.keys(capabilityState).length,
        readyModels: readyCount,
        notInstalledModels: Object.values(capabilityState).filter(s => s === 'not_installed').length
      }, 'Capability state built successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to get capability_state');
    }

    return capabilityState;
  }

  /**
   * 将内部状态转换为 ModelStatus
   */
  private mapToModelStatus(status: InstalledModelVersion['status']): ModelStatus {
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

  async getModelPath(modelId: string, version?: string): Promise<string> {
    // 获取模型信息
    const models = await this.getAvailableModels();
    const model = models.find(m => m.id === modelId);

    if (!model) {
      throw new ModelNotAvailableError(modelId, version || 'latest', 'not_installed');
    }

    // 确定版本
    const targetVersion = version || model.default_version;

    // 检查是否已安装
    const installed = this.registry[modelId]?.[targetVersion];

    if (!installed) {
      throw new ModelNotAvailableError(modelId, targetVersion, 'not_installed');
    }

    if (installed.status !== 'ready') {
      throw new ModelNotAvailableError(modelId, targetVersion, installed.status as any);
    }

    // 返回模型目录路径
    return path.join(this.modelsDir, modelId, targetVersion);
  }

  // ===== 模型下载 =====

  async downloadModel(modelId: string, version?: string): Promise<void> {
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
      return this.downloadTasks.get(taskKey)!;
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
    } finally {
      this.downloadTasks.delete(taskKey);
      await this.lockManager.releaseTaskLock(modelId, targetVersion);
    }
  }

  private async performDownload(
    modelId: string,
    version: string,
    versionInfo: ModelVersion
  ): Promise<void> {
    try {
      // 更新状态为 downloading
      this.updateModelStatus(modelId, version, 'downloading');
      this.emitProgress(modelId, version, 0, versionInfo.size_bytes, 'downloading', {
        totalFiles: versionInfo.files.length,
        downloadedFiles: 0,
      });

      // 下载文件
      await this.downloader.downloadModelFiles(
        modelId,
        version,
        versionInfo,
        (progress) => {
          this.emit('progress', progress);
        }
      );

      // 验证文件
      this.updateModelStatus(modelId, version, 'verifying');
      this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'verifying', {
        currentFile: '正在验证文件...',
      });

      await this.verifier.verifyFiles(
        modelId,
        version,
        versionInfo,
        (progress) => {
          this.emit('progress', progress);
        }
      );

      // 安装（移动文件到正式目录）
      this.updateModelStatus(modelId, version, 'installing');
      this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'installing', {
        currentFile: '正在安装模型...',
      });

      await this.installer.installFiles(modelId, version, versionInfo, this.registry);

      // 完成
      this.updateModelStatus(modelId, version, 'ready');
      this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'ready');

    } catch (error) {
      this.updateModelStatus(modelId, version, 'error');
      this.emitError(modelId, version, error);
      throw error;
    }
  }

  private updateModelStatus(
    modelId: string,
    version: string,
    status: InstalledModelVersion['status']
  ): void {
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
    } else {
      this.registry[modelId][version].status = status;
    }

    // 异步保存，不阻塞
    this.registryManager.saveRegistry(this.registry).catch((error) =>
      logger.error({ error }, 'Failed to save registry')
    );

    // 如果状态发生变化，触发 capability_state 更新事件
    if (previousStatus !== status) {
      this.emit('capability-state-changed', { modelId, version, status });
    }
  }

  private emitProgress(
    modelId: string,
    version: string,
    downloadedBytes: number,
    totalBytes: number,
    state: ModelDownloadProgress['state'],
    extra?: Partial<ModelDownloadProgress>
  ): void {
    const progress: ModelDownloadProgress = {
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

  private emitError(modelId: string, version: string, error: any): void {
    const errorInfo: ModelDownloadError = {
      modelId,
      version,
      stage: getErrorStage(error),
      message: error instanceof Error ? error.message : String(error),
      canRetry: isRetryableError(error),
    };

    this.emit('error', errorInfo);
  }

  // ===== 模型卸载 =====

  async uninstallModel(modelId: string, version?: string): Promise<boolean> {
    try {
      if (version) {
        // 卸载指定版本
        const versionDir = path.join(this.modelsDir, modelId, version);
        if (await fileExists(versionDir)) {
          await fs.rm(versionDir, { recursive: true });
        }

        if (this.registry[modelId]?.[version]) {
          delete this.registry[modelId][version];
          if (Object.keys(this.registry[modelId]).length === 0) {
            delete this.registry[modelId];
          }
        }
      } else {
        // 卸载所有版本
        const modelDir = path.join(this.modelsDir, modelId);
        if (await fileExists(modelDir)) {
          await fs.rm(modelDir, { recursive: true });
        }

        delete this.registry[modelId];
      }

      await this.registryManager.saveRegistry(this.registry);
      return true;
    } catch (error) {
      logger.error({ error, modelId }, 'Failed to uninstall model');
      return false;
    }
  }
}
