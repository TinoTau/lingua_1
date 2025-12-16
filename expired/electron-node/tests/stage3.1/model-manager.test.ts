/**
 * 阶段 3.1：ModelManager 单元测试
 * 
 * 测试 ModelManager 的核心功能：
 * - 模型列表获取
 * - 模型下载
 * - 断点续传
 * - 多文件并发下载
 * - SHA256 校验
 * - 模型安装和卸载
 * - getModelPath
 * - 锁机制
 * - registry.json 原子写入
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ModelManager, ModelNotAvailableError } from '../../main/src/model-manager/model-manager';

describe('ModelManager', () => {
  let modelManager: ModelManager;
  let testModelsDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testModelsDir = path.join(os.tmpdir(), `lingua-test-${Date.now()}`);
    process.env.USER_DATA = testModelsDir;
    process.env.MODEL_HUB_URL = 'http://localhost:5000';
    
    modelManager = new ModelManager();
    
    // 等待初始化完成
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testModelsDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('初始化', () => {
    it('应该正确初始化目录结构', async () => {
      const modelsDir = (modelManager as any).modelsDir;
      const tempDir = (modelManager as any).tempDir;
      const lockDir = (modelManager as any).lockDir;
      
      // 验证目录存在（不抛出错误）
      await expect(fs.access(modelsDir)).resolves.not.toThrow();
      await expect(fs.access(tempDir)).resolves.not.toThrow();
      await expect(fs.access(lockDir)).resolves.not.toThrow();
    });

    it('应该加载 registry.json（如果存在）', async () => {
      const registryPath = (modelManager as any).registryPath;
      const testRegistry = {
        'test-model': {
          '1.0.0': {
            status: 'ready',
            installed_at: new Date().toISOString(),
            size_bytes: 1000,
            checksum_sha256: 'test-hash',
          },
        },
      };
      
      await fs.writeFile(registryPath, JSON.stringify(testRegistry), 'utf-8');
      
      const newManager = new ModelManager();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const installed = newManager.getInstalledModels();
      expect(installed.length).toBe(1);
      expect(installed[0].modelId).toBe('test-model');
    });
  });

  describe('getAvailableModels', () => {
    it('应该从服务器获取模型列表（如果服务可用）', async () => {
      // 注意：这个测试需要模型库服务运行
      // 如果服务不可用，应该返回空数组而不是抛出错误
      const models = await modelManager.getAvailableModels();
      expect(Array.isArray(models)).toBe(true);
      // 如果服务不可用，返回空数组是预期的行为
    });
  });

  describe('getModelPath', () => {
    it('应该返回已安装模型的路径', async () => {
      // Mock getAvailableModels 返回测试模型
      const originalGetAvailableModels = modelManager.getAvailableModels.bind(modelManager);
      modelManager.getAvailableModels = jest.fn().mockResolvedValue([
        {
          id: 'test-model',
          name: 'Test Model',
          task: 'asr',
          languages: ['en'],
          default_version: '1.0.0',
          versions: [{
            version: '1.0.0',
            size_bytes: 1000,
            files: [],
            checksum_sha256: 'test-hash',
            updated_at: new Date().toISOString(),
          }],
        },
      ]);
      
      // 设置 registry
      (modelManager as any).registry = {
        'test-model': {
          '1.0.0': {
            status: 'ready',
            installed_at: new Date().toISOString(),
            size_bytes: 1000,
            checksum_sha256: 'test-hash',
          },
        },
      };
      
      const modelPath = await modelManager.getModelPath('test-model', '1.0.0');
      expect(modelPath).toContain('test-model');
      expect(modelPath).toContain('1.0.0');
      
      // 恢复原始方法
      modelManager.getAvailableModels = originalGetAvailableModels;
    });

    it('应该抛出 ModelNotAvailableError 如果模型未安装', async () => {
      // Mock getAvailableModels 返回空数组（模型不存在）
      const originalGetAvailableModels = modelManager.getAvailableModels.bind(modelManager);
      modelManager.getAvailableModels = jest.fn().mockResolvedValue([]);
      
      await expect(
        modelManager.getModelPath('non-existent-model', '1.0.0')
      ).rejects.toThrow(ModelNotAvailableError);
      
      // 恢复原始方法
      modelManager.getAvailableModels = originalGetAvailableModels;
    });

    it('应该抛出 ModelNotAvailableError 如果模型状态不是 ready', async () => {
      // Mock getAvailableModels
      const originalGetAvailableModels = modelManager.getAvailableModels.bind(modelManager);
      modelManager.getAvailableModels = jest.fn().mockResolvedValue([
        {
          id: 'test-model',
          name: 'Test Model',
          task: 'asr',
          languages: ['en'],
          default_version: '1.0.0',
          versions: [{
            version: '1.0.0',
            size_bytes: 1000,
            files: [],
            checksum_sha256: 'test-hash',
            updated_at: new Date().toISOString(),
          }],
        },
      ]);
      
      (modelManager as any).registry = {
        'test-model': {
          '1.0.0': {
            status: 'downloading',
            installed_at: new Date().toISOString(),
            size_bytes: 1000,
            checksum_sha256: 'test-hash',
          },
        },
      };
      
      await expect(
        modelManager.getModelPath('test-model', '1.0.0')
      ).rejects.toThrow(ModelNotAvailableError);
      
      // 恢复原始方法
      modelManager.getAvailableModels = originalGetAvailableModels;
    });
  });

  // 注意：锁机制、Registry 管理、文件操作等底层功能的测试
  // 已移至独立的测试文件：
  // - lock-manager.test.ts - 测试 LockManager
  // - registry-manager.test.ts - 测试 RegistryManager
  // - utils.test.ts - 测试工具方法
  // 
  // ModelManager 的测试专注于其公共接口和集成功能
});

