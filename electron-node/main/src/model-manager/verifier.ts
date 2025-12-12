// ===== 模型验证 =====

import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { ModelFileInfo, ModelVersion, ModelDownloadProgress } from './types';
import { fileExists } from './utils';

/**
 * 模型验证器
 */
export class ModelVerifier {
  constructor(
    private modelHubUrl: string,
    private modelsDir: string,
    private tempDir: string
  ) {}

  /**
   * 验证模型文件
   */
  async verifyFiles(
    modelId: string,
    version: string,
    versionInfo: ModelVersion,
    onProgress: (progress: ModelDownloadProgress) => void
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
      // 使用动态导入避免循环依赖
      const logger = (await import('../logger')).default;
      logger.warn({ error }, '无法下载 checksum 文件，将仅验证文件大小');
    }
    
    // 验证每个文件
    for (let i = 0; i < versionInfo.files.length; i++) {
      const fileInfo = versionInfo.files[i];
      const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
      
      // 更新验证进度
      onProgress({
        modelId,
        version,
        downloadedBytes: versionInfo.size_bytes,
        totalBytes: versionInfo.size_bytes,
        percent: 100,
        state: 'verifying',
        currentFile: `验证文件 ${i + 1}/${versionInfo.files.length}: ${fileInfo.path}`,
        currentFileProgress: ((i + 1) / versionInfo.files.length) * 100,
      });
      
      // 检查文件是否存在
      if (!(await fileExists(partPath))) {
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

  /**
   * 计算文件 SHA256 哈希
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    const fileBuffer = await fs.readFile(filePath);
    hash.update(fileBuffer);
    return hash.digest('hex');
  }
}

