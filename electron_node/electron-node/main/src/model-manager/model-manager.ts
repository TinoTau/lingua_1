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
    this.modelHubUrl = process.env.MODEL_HUB_URL || 'http://localhost:5000';

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
    try {
      // 创建必要的目录
      await fs.mkdir(this.modelsDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.mkdir(this.lockDir, { recursive: true });

      // 加载 registry
      this.registry = await this.registryManager.loadRegistry();

      // 清理孤儿锁
      await this.lockManager.cleanupOrphanLocks();
    } catch (error) {
      logger.error({ error }, '初始化 ModelManager 失败');
    }
  }

  // ===== 模型列表获取 =====

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const response = await axios.get<ModelInfo[]>(`${this.modelHubUrl}/api/models`);
      return response.data;
    } catch (error) {
      logger.error({ error }, '获取可用模型列表失败');
      return [];
    }
  }

  getInstalledModels(): Array<{ modelId: string; version: string; info: InstalledModelVersion }> {
    const result: Array<{ modelId: string; version: string; info: InstalledModelVersion }> = [];

    for (const [modelId, versions] of Object.entries(this.registry)) {
      for (const [version, info] of Object.entries(versions)) {
        result.push({ modelId, version, info });
      }
    }

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
    } catch (error) {
      logger.error({ error }, '获取 capability_state 失败');
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
      throw new Error(`模型不存在: ${modelId}`);
    }

    const targetVersion = version || model.default_version;
    const versionInfo = model.versions.find(v => v.version === targetVersion);

    if (!versionInfo) {
      throw new Error(`版本不存在: ${modelId}@${targetVersion}`);
    }

    const taskKey = `${modelId}_${targetVersion}`;

    // 检查是否已有下载任务
    if (this.downloadTasks.has(taskKey)) {
      return this.downloadTasks.get(taskKey)!;
    }

    // 尝试获取任务锁
    const lockAcquired = await this.lockManager.acquireTaskLock(modelId, targetVersion);
    if (!lockAcquired) {
      throw new Error('模型正在下载中');
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
      logger.error({ error }, '保存 registry 失败')
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
      logger.error({ error, modelId }, '卸载模型失败');
      return false;
    }
  }
}
