// ===== 模型下载 =====

import axios, { AxiosProgressEvent } from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createWriteStream } from 'fs';
import { ModelFileInfo, ModelVersion, ModelDownloadProgress } from './types';
import { fileExists, isRetryableError, sleep } from './utils';
import { EventEmitter } from 'events';

/**
 * 模型下载器
 */
export class ModelDownloader extends EventEmitter {
  constructor(
    private modelHubUrl: string,
    private tempDir: string,
    private maxConcurrentFiles: number = 3,
    private maxRetries: number = 3
  ) {
    super();
  }

  /**
   * 下载单个文件（带重试）
   */
  async downloadFileWithRetry(
    modelId: string,
    version: string,
    fileInfo: ModelFileInfo,
    onProgress: (bytes: number, fileSize: number) => void
  ): Promise<void> {
    const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
    const url = `${this.modelHubUrl}/storage/models/${modelId}/${version}/${fileInfo.path}`;
    
    let lastError: any;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await this.downloadFile(url, partPath, fileInfo.size_bytes, (bytes) => {
          onProgress(bytes, fileInfo.size_bytes);
        });
        return; // 成功
      } catch (error) {
        lastError = error;
        
        // 判断是否可重试
        if (!isRetryableError(error)) {
          throw error;
        }
        
        // 最后一次尝试失败
        if (attempt === this.maxRetries - 1) {
          throw error;
        }
        
        // 等待后重试（指数退避）
        const retryDelay = [1000, 2000, 5000][attempt];
        // 使用动态导入避免循环依赖
        const logger = (await import('../logger')).default;
        logger.warn({ 
          filePath: fileInfo.path, 
          attempt: attempt + 1, 
          maxRetries: this.maxRetries,
          retryDelay 
        }, 'File download failed, will retry');
        await sleep(retryDelay);
      }
    }
    
    throw lastError;
  }

  /**
   * 下载文件（支持断点续传）
   */
  private async downloadFile(
    url: string,
    filePath: string,
    totalSize: number,
    onProgress: (bytes: number) => void
  ): Promise<void> {
    // 检查断点
    let startByte = 0;
    if (await fileExists(filePath)) {
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

  /**
   * 下载模型的所有文件
   */
  async downloadModelFiles(
    modelId: string,
    version: string,
    versionInfo: ModelVersion,
    onProgress: (progress: ModelDownloadProgress) => void
  ): Promise<void> {
    const startTime = Date.now();
    let lastProgressTime = Date.now();
    let lastProgressBytes = 0;
    
    // 创建版本目录
    const versionDir = path.join(this.tempDir, '..', modelId, version);
    await fs.mkdir(versionDir, { recursive: true });
    
    // 下载所有文件（并发限制）
    const fileProgress: Map<string, number> = new Map();
    let totalDownloadedBytes = 0;
    let completedFiles = 0;
    
    // 初始化进度
    versionInfo.files.forEach(fileInfo => {
      fileProgress.set(fileInfo.path, 0);
    });
    
    // 分批下载，每批最多 maxConcurrentFiles 个文件
    for (let i = 0; i < versionInfo.files.length; i += this.maxConcurrentFiles) {
      const batch = versionInfo.files.slice(i, i + this.maxConcurrentFiles);
      
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
          
          onProgress({
            modelId,
            version,
            downloadedBytes: totalDownloadedBytes,
            totalBytes: versionInfo.size_bytes,
            percent: versionInfo.size_bytes > 0 ? (totalDownloadedBytes / versionInfo.size_bytes) * 100 : 0,
            state: 'downloading',
            currentFile: fileInfo.path,
            currentFileProgress,
            totalFiles: versionInfo.files.length,
            downloadedFiles: completedFiles,
            downloadSpeed,
            estimatedTimeRemaining,
          });
        }).then(() => {
          completedFiles++;
          // 文件下载完成后更新进度
          onProgress({
            modelId,
            version,
            downloadedBytes: totalDownloadedBytes,
            totalBytes: versionInfo.size_bytes,
            percent: versionInfo.size_bytes > 0 ? (totalDownloadedBytes / versionInfo.size_bytes) * 100 : 0,
            state: 'downloading',
            totalFiles: versionInfo.files.length,
            downloadedFiles: completedFiles,
          });
        })
      );
      
      await Promise.all(batchPromises);
    }
  }
}

