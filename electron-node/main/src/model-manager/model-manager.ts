import axios, { AxiosProgressEvent } from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { EventEmitter } from 'events';
import { createWriteStream } from 'fs';
import { app } from 'electron';

// ===== v3 方案数据模型 =====

export interface ModelFileInfo {
  path: string;
  size_bytes: number;
}

export interface ModelVersion {
  version: string;
  size_bytes: number;
  files: ModelFileInfo[];
  checksum_sha256: string;
  updated_at: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  task: string;
  languages: string[];
  default_version: string;
  versions: ModelVersion[];
}

export interface InstalledModelVersion {
  status: 'ready' | 'downloading' | 'verifying' | 'installing' | 'error';
  installed_at: string;
  size_bytes: number;
  checksum_sha256: string;
  files?: Array<{ path: string; sha256: string }>;
  extra?: Record<string, unknown>;
}

export interface Registry {
  [modelId: string]: {
    [version: string]: InstalledModelVersion;
  };
}

export interface LockFile {
  pid: number;
  timestamp: number;
  modelId: string;
  version: string;
  timeout: number;
}

export interface ModelDownloadProgress {
  modelId: string;
  version: string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  state: 'checking' | 'downloading' | 'verifying' | 'installing' | 'ready';
  currentFile?: string; // 当前下载的文件名
  currentFileProgress?: number; // 当前文件进度百分比
  downloadedFiles?: number; // 已下载文件数
  totalFiles?: number; // 总文件数
  downloadSpeed?: number; // 下载速度（字节/秒）
  estimatedTimeRemaining?: number; // 预计剩余时间（秒）
}

export interface ModelDownloadError {
  modelId: string;
  version: string;
  stage: 'network' | 'disk' | 'checksum' | 'unknown';
  message: string;
  canRetry: boolean;
}

// ===== 错误类型 =====

export class ModelNotAvailableError extends Error {
  constructor(
    public modelId: string,
    public version: string,
    public reason: 'not_installed' | 'downloading' | 'verifying' | 'error'
  ) {
    super(`Model ${modelId}@${version} unavailable: ${reason}`);
    this.name = 'ModelNotAvailableError';
  }
}

// ===== ModelManager 类 =====

export class ModelManager extends EventEmitter {
  private modelHubUrl: string;
  private modelsDir: string;
  private registryPath: string;
  private tempDir: string;
  private lockDir: string;
  private registry: Registry = {};
  private downloadTasks: Map<string, Promise<void>> = new Map();
  private readonly MAX_CONCURRENT_FILES = 3;
  private readonly MAX_RETRIES = 3;
  private readonly TASK_LOCK_TIMEOUT = 30 * 60 * 1000; // 30 分钟
  private readonly FILE_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 分钟

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
        const alternativePath = this.findAlternativePath();
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
    
    this.initialize();
  }

  private findAlternativePath(): string | null {
    if (os.platform() === 'win32') {
      const fs = require('fs');
      const drives = ['D', 'E', 'F', 'G', 'H'];
      for (const drive of drives) {
        const testPath = `${drive}:\\LinguaNode`;
        try {
          if (!fs.existsSync(testPath)) {
            fs.mkdirSync(testPath, { recursive: true });
          }
          return testPath;
        } catch {
          // 继续尝试下一个盘
        }
      }
    }
    return null;
  }

  private async initialize(): Promise<void> {
    try {
      // 创建必要的目录
      await fs.mkdir(this.modelsDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });
      await fs.mkdir(this.lockDir, { recursive: true });
      
      // 加载 registry
      await this.loadRegistry();
      
      // 清理孤儿锁
      await this.cleanupOrphanLocks();
    } catch (error) {
      console.error('初始化 ModelManager 失败:', error);
    }
  }

  // ===== Registry 管理 =====

  private async loadRegistry(): Promise<void> {
    try {
      if (await this.fileExists(this.registryPath)) {
        const content = await fs.readFile(this.registryPath, 'utf-8');
        this.registry = JSON.parse(content);
      } else {
        this.registry = {};
      }
    } catch (error) {
      console.error('加载 registry 失败:', error);
      this.registry = {};
    }
  }

  private async saveRegistry(): Promise<void> {
    try {
      // 原子写入：先写临时文件，再重命名
      const tempPath = this.registryPath + '.tmp';
      await fs.writeFile(tempPath, JSON.stringify(this.registry, null, 2), 'utf-8');
      
      // fsync 确保数据写入磁盘
      const fd = await fs.open(tempPath, 'r+');
      await fd.sync();
      await fd.close();
      
      // 原子重命名
      await fs.rename(tempPath, this.registryPath);
    } catch (error) {
      console.error('保存 registry 失败:', error);
      throw error;
    }
  }

  // ===== 锁管理 =====

  private getTaskLockPath(modelId: string, version: string): string {
    return path.join(this.lockDir, `${modelId}_${version}.lock`);
  }

  private getFileLockPath(modelId: string, version: string, fileName: string): string {
    return path.join(this.tempDir, `${modelId}_${version}.${fileName}.part.lock`);
  }

  private async acquireTaskLock(modelId: string, version: string): Promise<boolean> {
    const lockPath = this.getTaskLockPath(modelId, version);
    
    // 检查锁是否存在且有效
    if (await this.fileExists(lockPath)) {
      try {
        const lockContent = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockFile;
        
        // 检查是否超时
        if (Date.now() - lockContent.timestamp > lockContent.timeout) {
          // 锁已超时，删除
          await fs.unlink(lockPath);
        } else {
          // 检查进程是否还在运行
          if (await this.isProcessAlive(lockContent.pid)) {
            return false; // 锁有效，任务正在运行
          } else {
            // 进程不存在，删除孤儿锁
            await fs.unlink(lockPath);
          }
        }
      } catch {
        // 锁文件损坏，删除
        await fs.unlink(lockPath).catch(() => {});
      }
    }
    
    // 创建新锁
    const lock: LockFile = {
      pid: process.pid,
      timestamp: Date.now(),
      modelId,
      version,
      timeout: this.TASK_LOCK_TIMEOUT,
    };
    
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2));
    return true;
  }

  private async releaseTaskLock(modelId: string, version: string): Promise<void> {
    const lockPath = this.getTaskLockPath(modelId, version);
    await fs.unlink(lockPath).catch(() => {});
  }

  private async isProcessAlive(pid: number): Promise<boolean> {
    try {
      // Windows 使用 tasklist，Linux/Mac 使用 kill -0
      if (os.platform() === 'win32') {
        const { exec } = require('child_process');
        return new Promise((resolve) => {
          exec(`tasklist /FI "PID eq ${pid}"`, (error: any, stdout: string) => {
            resolve(stdout.includes(String(pid)));
          });
        });
      } else {
        process.kill(pid, 0);
        return true;
      }
    } catch {
      return false;
    }
  }

  private async cleanupOrphanLocks(): Promise<void> {
    try {
      const locks = await fs.readdir(this.lockDir);
      const now = Date.now();
      
      for (const lockFile of locks) {
        const lockPath = path.join(this.lockDir, lockFile);
        try {
          const lockContent = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as LockFile;
          
          // 检查是否超时（超过 1 小时）
          if (now - lockContent.timestamp > 60 * 60 * 1000) {
            await fs.unlink(lockPath);
            continue;
          }
          
          // 检查进程是否还在运行
          if (!(await this.isProcessAlive(lockContent.pid))) {
            await fs.unlink(lockPath);
          }
        } catch {
          // 锁文件损坏，删除
          await fs.unlink(lockPath).catch(() => {});
        }
      }
    } catch (error) {
      console.error('清理孤儿锁失败:', error);
    }
  }

  // ===== 文件操作 =====

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ===== 模型列表获取 =====

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      const response = await axios.get<ModelInfo[]>(`${this.modelHubUrl}/api/models`);
      return response.data;
    } catch (error) {
      console.error('获取可用模型列表失败:', error);
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
    const lockAcquired = await this.acquireTaskLock(modelId, targetVersion);
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
      await this.releaseTaskLock(modelId, targetVersion);
    }
  }

  private async performDownload(
    modelId: string,
    version: string,
    versionInfo: ModelVersion
  ): Promise<void> {
    const startTime = Date.now();
    let lastProgressTime = Date.now();
    let lastProgressBytes = 0;
    
    try {
      // 更新状态为 downloading
      this.updateModelStatus(modelId, version, 'downloading');
      this.emitProgress(modelId, version, 0, versionInfo.size_bytes, 'downloading', {
        totalFiles: versionInfo.files.length,
        downloadedFiles: 0,
      });
      
      // 创建版本目录
      const versionDir = path.join(this.modelsDir, modelId, version);
      await fs.mkdir(versionDir, { recursive: true });
      
      // 下载所有文件（并发限制为 3）
      const fileProgress: Map<string, number> = new Map();
      let totalDownloadedBytes = 0;
      let completedFiles = 0;
      
      // 初始化进度
      versionInfo.files.forEach(fileInfo => {
        fileProgress.set(fileInfo.path, 0);
      });
      
      // 分批下载，每批最多 3 个文件
      for (let i = 0; i < versionInfo.files.length; i += this.MAX_CONCURRENT_FILES) {
        const batch = versionInfo.files.slice(i, i + this.MAX_CONCURRENT_FILES);
        
        const batchPromises = batch.map(fileInfo => 
          this.downloadFileWithRetry(modelId, version, fileInfo, (bytesDownloaded, fileSize) => {
            // 更新该文件的进度
            const previousBytes = fileProgress.get(fileInfo.path) || 0;
            const newBytes = bytesDownloaded;
            fileProgress.set(fileInfo.path, newBytes);
            
            // 计算总进度
            totalDownloadedBytes = totalDownloadedBytes - previousBytes + newBytes;
            
            // 计算下载速度和剩余时间
            const now = Date.now();
            const timeDelta = (now - lastProgressTime) / 1000; // 秒
            const bytesDelta = totalDownloadedBytes - lastProgressBytes;
            
            let downloadSpeed = 0;
            let estimatedTimeRemaining = 0;
            
            if (timeDelta > 0.5) { // 每 0.5 秒更新一次速度
              downloadSpeed = bytesDelta / timeDelta;
              const remainingBytes = versionInfo.size_bytes - totalDownloadedBytes;
              estimatedTimeRemaining = downloadSpeed > 0 ? remainingBytes / downloadSpeed : 0;
              
              lastProgressTime = now;
              lastProgressBytes = totalDownloadedBytes;
            }
            
            // 计算当前文件进度
            const currentFileProgress = fileSize > 0 ? (bytesDownloaded / fileSize) * 100 : 0;
            
            this.emitProgress(
              modelId,
              version,
              totalDownloadedBytes,
              versionInfo.size_bytes,
              'downloading',
              {
                currentFile: fileInfo.path,
                currentFileProgress,
                totalFiles: versionInfo.files.length,
                downloadedFiles: completedFiles,
                downloadSpeed,
                estimatedTimeRemaining,
              }
            );
          }).then(() => {
            completedFiles++;
            // 文件下载完成后更新进度
            this.emitProgress(
              modelId,
              version,
              totalDownloadedBytes,
              versionInfo.size_bytes,
              'downloading',
              {
                totalFiles: versionInfo.files.length,
                downloadedFiles: completedFiles,
              }
            );
          })
        );
        
        await Promise.all(batchPromises);
      }
      
      // 验证文件
      this.updateModelStatus(modelId, version, 'verifying');
      this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'verifying', {
        currentFile: '正在验证文件...',
      });
      
      await this.verifyFiles(modelId, version, versionInfo);
      
      // 安装（移动文件到正式目录）
      this.updateModelStatus(modelId, version, 'installing');
      this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'installing', {
        currentFile: '正在安装模型...',
      });
      
      await this.installFiles(modelId, version, versionInfo);
      
      // 完成
      this.updateModelStatus(modelId, version, 'ready');
      this.emitProgress(modelId, version, versionInfo.size_bytes, versionInfo.size_bytes, 'ready');
      
    } catch (error) {
      this.updateModelStatus(modelId, version, 'error');
      this.emitError(modelId, version, error);
      throw error;
    }
  }

  private async downloadFileWithRetry(
    modelId: string,
    version: string,
    fileInfo: ModelFileInfo,
    onProgress: (bytes: number, fileSize: number) => void
  ): Promise<void> {
    const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
    const url = `${this.modelHubUrl}/storage/models/${modelId}/${version}/${fileInfo.path}`;
    
    let lastError: any;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        await this.downloadFile(url, partPath, fileInfo.size_bytes, (bytes) => {
          onProgress(bytes, fileInfo.size_bytes);
        });
        return; // 成功
      } catch (error) {
        lastError = error;
        
        // 判断是否可重试
        if (!this.isRetryableError(error)) {
          throw error;
        }
        
        // 最后一次尝试失败
        if (attempt === this.MAX_RETRIES - 1) {
          throw error;
        }
        
        // 等待后重试（指数退避）
        const retryDelay = [1000, 2000, 5000][attempt];
        console.log(`文件 ${fileInfo.path} 下载失败，${retryDelay}ms 后重试 (${attempt + 1}/${this.MAX_RETRIES})`);
        await this.sleep(retryDelay);
      }
    }
    
    throw lastError;
  }

  private async downloadFile(
    url: string,
    filePath: string,
    totalSize: number,
    onProgress: (bytes: number) => void
  ): Promise<void> {
    // 检查断点
    let startByte = 0;
    if (await this.fileExists(filePath)) {
      const stats = await fs.stat(filePath);
      startByte = stats.size;
    }
    
    // 使用流式下载
    const response = await axios.get(url, {
      headers: startByte > 0 ? { Range: `bytes=${startByte}-` } : {},
      responseType: 'stream',
      onDownloadProgress: (progressEvent: AxiosProgressEvent) => {
        // 计算已下载的总字节数（包括断点前的）
        const loaded = (progressEvent.loaded || 0) + startByte;
        onProgress(loaded - startByte); // 只报告本次下载的字节数
      },
    });
    
    // 追加写入流
    const writer = createWriteStream(filePath, { flags: 'a' });
    
    // 使用 Promise 包装流式写入
    await new Promise<void>((resolve, reject) => {
      response.data.pipe(writer);
      response.data.on('error', reject);
      writer.on('error', reject);
      writer.on('finish', resolve);
    });
  }

  private isRetryableError(error: any): boolean {
    return error.code === 'ECONNRESET' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ENOTFOUND' ||
           error.response?.status >= 500;
  }

  private async verifyFiles(
    modelId: string,
    version: string,
    versionInfo: ModelVersion
  ): Promise<void> {
    const versionDir = path.join(this.modelsDir, modelId, version);
    const checksumPath = path.join(versionDir, 'checksum.sha256');
    
    // 下载 checksum 文件
    const checksumUrl = `${this.modelHubUrl}/storage/models/${modelId}/${version}/checksum.sha256`;
    let checksumData: Record<string, string> | null = null;
    
    try {
      const checksumResponse = await axios.get(checksumUrl);
      checksumData = checksumResponse.data;
      await fs.writeFile(checksumPath, JSON.stringify(checksumData, null, 2), 'utf-8');
    } catch (error) {
      // 如果服务器没有 checksum 文件，使用版本信息中的
      console.warn(`无法下载 checksum 文件，将仅验证文件大小: ${error}`);
    }
    
    // 验证每个文件
    for (let i = 0; i < versionInfo.files.length; i++) {
      const fileInfo = versionInfo.files[i];
      const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
      
      // 更新验证进度
      this.emitProgress(
        modelId,
        version,
        versionInfo.size_bytes,
        versionInfo.size_bytes,
        'verifying',
        {
          currentFile: `验证文件 ${i + 1}/${versionInfo.files.length}: ${fileInfo.path}`,
          currentFileProgress: ((i + 1) / versionInfo.files.length) * 100,
        }
      );
      
      // 检查文件是否存在
      if (!(await this.fileExists(partPath))) {
        throw new Error(`文件不存在: ${fileInfo.path}`);
      }
      
      // 验证文件大小
      const stats = await fs.stat(partPath);
      if (stats.size !== fileInfo.size_bytes) {
        throw new Error(`文件大小不匹配: ${fileInfo.path} (期望: ${fileInfo.size_bytes}, 实际: ${stats.size})`);
      }
      
      // 如果 checksum 数据可用，验证 SHA256
      if (checksumData && checksumData[fileInfo.path]) {
        const fileHash = await this.calculateFileHash(partPath);
        const expectedHash = checksumData[fileInfo.path];
        
        if (fileHash !== expectedHash) {
          throw new Error(`文件校验失败: ${fileInfo.path} (SHA256 不匹配)`);
        }
      }
    }
  }

  private async calculateFileHash(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const fileBuffer = await fs.readFile(filePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
  }

  private async installFiles(
    modelId: string,
    version: string,
    versionInfo: ModelVersion
  ): Promise<void> {
    const versionDir = path.join(this.modelsDir, modelId, version);
    
    for (const fileInfo of versionInfo.files) {
      const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
      const finalPath = path.join(versionDir, fileInfo.path);
      
      // 移动文件
      await fs.rename(partPath, finalPath);
    }
    
    // 更新 registry
    if (!this.registry[modelId]) {
      this.registry[modelId] = {};
    }
    
    this.registry[modelId][version] = {
      status: 'ready',
      installed_at: new Date().toISOString(),
      size_bytes: versionInfo.size_bytes,
      checksum_sha256: versionInfo.checksum_sha256,
    };
    
    await this.saveRegistry();
  }

  private updateModelStatus(
    modelId: string,
    version: string,
    status: InstalledModelVersion['status']
  ): void {
    if (!this.registry[modelId]) {
      this.registry[modelId] = {};
    }
    
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
    this.saveRegistry().catch(console.error);
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
      stage: this.getErrorStage(error),
      message: error instanceof Error ? error.message : String(error),
      canRetry: this.isRetryableError(error),
    };
    
    this.emit('error', errorInfo);
  }

  private getErrorStage(error: any): ModelDownloadError['stage'] {
    // 网络错误
    if (error.code === 'ECONNRESET' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.response?.status >= 500) {
      return 'network';
    }
    
    // 磁盘错误
    if (error.code === 'ENOSPC' || 
        error.code === 'EACCES' ||
        error.code === 'EIO' ||
        error.code === 'EROFS') {
      return 'disk';
    }
    
    // 校验错误
    if (error.message?.includes('校验') || 
        error.message?.includes('checksum') ||
        error.message?.includes('SHA256') ||
        error.message?.includes('大小不匹配')) {
      return 'checksum';
    }
    
    return 'unknown';
  }

  // ===== 模型卸载 =====

  async uninstallModel(modelId: string, version?: string): Promise<boolean> {
    try {
      if (version) {
        // 卸载指定版本
        const versionDir = path.join(this.modelsDir, modelId, version);
        if (await this.fileExists(versionDir)) {
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
        if (await this.fileExists(modelDir)) {
          await fs.rm(modelDir, { recursive: true });
        }
        
        delete this.registry[modelId];
      }
      
      await this.saveRegistry();
      return true;
    } catch (error) {
      console.error('卸载模型失败:', error);
      return false;
    }
  }

  // ===== 工具方法 =====

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
