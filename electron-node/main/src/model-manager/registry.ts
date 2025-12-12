// ===== Registry 管理 =====

import * as fs from 'fs/promises';
import { Registry } from './types';
import { fileExists } from './utils';

/**
 * Registry 管理器
 */
export class RegistryManager {
  constructor(private registryPath: string) {}

  /**
   * 加载 registry
   */
  async loadRegistry(): Promise<Registry> {
    try {
      if (await fileExists(this.registryPath)) {
        const content = await fs.readFile(this.registryPath, 'utf-8');
        return JSON.parse(content);
      } else {
        return {};
      }
    } catch (error) {
      console.error('加载 registry 失败:', error);
      return {};
    }
  }

  /**
   * 保存 registry（原子写入）
   */
  async saveRegistry(registry: Registry): Promise<void> {
    try {
      // 原子写入：先写临时文件，再重命名
      const tempPath = this.registryPath + '.tmp';
      await fs.writeFile(tempPath, JSON.stringify(registry, null, 2), 'utf-8');
      
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
}

