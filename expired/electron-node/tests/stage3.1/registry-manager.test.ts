/**
 * RegistryManager 单元测试
 * 
 * 测试 Registry 管理器的核心功能：
 * - Registry 加载
 * - Registry 保存（原子写入）
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RegistryManager } from '../../main/src/model-manager/registry';
import { Registry } from '../../main/src/model-manager/types';

describe('RegistryManager', () => {
  let registryManager: RegistryManager;
  let testRegistryPath: string;
  let testDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = path.join(os.tmpdir(), `lingua-registry-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    testRegistryPath = path.join(testDir, 'registry.json');
    
    registryManager = new RegistryManager(testRegistryPath);
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('Registry 加载', () => {
    it('应该加载已存在的 registry.json', async () => {
      const testRegistry: Registry = {
        'test-model': {
          '1.0.0': {
            status: 'ready',
            installed_at: new Date().toISOString(),
            size_bytes: 1000,
            checksum_sha256: 'test-hash',
          },
        },
      };
      
      await fs.writeFile(testRegistryPath, JSON.stringify(testRegistry), 'utf-8');
      
      const loaded = await registryManager.loadRegistry();
      expect(loaded['test-model']['1.0.0'].status).toBe('ready');
    });

    it('应该返回空对象如果 registry.json 不存在', async () => {
      const loaded = await registryManager.loadRegistry();
      expect(loaded).toEqual({});
    });
  });

  describe('Registry 保存', () => {
    it('应该使用原子写入保存 registry', async () => {
      const testRegistry: Registry = {
        'test-model': {
          '1.0.0': {
            status: 'ready',
            installed_at: new Date().toISOString(),
            size_bytes: 1000,
            checksum_sha256: 'test-hash',
          },
        },
      };
      
      await registryManager.saveRegistry(testRegistry);
      
      // 验证文件存在且内容正确
      const content = await fs.readFile(testRegistryPath, 'utf-8');
      const registry = JSON.parse(content);
      expect(registry['test-model']['1.0.0'].status).toBe('ready');
      
      // 验证临时文件不存在
      const tempPath = testRegistryPath + '.tmp';
      await expect(fs.access(tempPath)).rejects.toThrow();
    });
  });
});

