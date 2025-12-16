// ===== 模型安装 =====

import * as fs from 'fs/promises';
import * as path from 'path';
import { ModelVersion, InstalledModelVersion, Registry } from './types';
import { RegistryManager } from './registry';

/**
 * 模型安装器
 */
export class ModelInstaller {
  constructor(
    private modelsDir: string,
    private tempDir: string,
    private registryManager: RegistryManager
  ) {}

  /**
   * 安装模型文件
   */
  async installFiles(
    modelId: string,
    version: string,
    versionInfo: ModelVersion,
    registry: Registry
  ): Promise<void> {
    const versionDir = path.join(this.modelsDir, modelId, version);
    
    for (const fileInfo of versionInfo.files) {
      const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
      const finalPath = path.join(versionDir, fileInfo.path);
      
      // 确保目标目录存在
      const finalDir = path.dirname(finalPath);
      await fs.mkdir(finalDir, { recursive: true });
      
      // 移动文件
      await fs.rename(partPath, finalPath);
    }
    
    // 更新 registry
    if (!registry[modelId]) {
      registry[modelId] = {};
    }
    
    registry[modelId][version] = {
      status: 'ready',
      installed_at: new Date().toISOString(),
      size_bytes: versionInfo.size_bytes,
      checksum_sha256: versionInfo.checksum_sha256,
    };
    
    await this.registryManager.saveRegistry(registry);
  }
}

