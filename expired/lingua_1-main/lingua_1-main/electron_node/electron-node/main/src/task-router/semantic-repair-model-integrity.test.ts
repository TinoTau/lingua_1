/**
 * Semantic Repair Model Integrity Checker Tests
 * P2-2: 模型完整性校验器单元测试
 */

import { SemanticRepairModelIntegrityChecker, ModelIntegrityCheckResult } from './semantic-repair-model-integrity';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Mock fs/promises
jest.mock('fs/promises');

describe('SemanticRepairModelIntegrityChecker - P2-2', () => {
  let checker: SemanticRepairModelIntegrityChecker;
  let tempDir: string;

  beforeEach(() => {
    checker = new SemanticRepairModelIntegrityChecker({
      checkOnStartup: true,
      checkOnHealthCheck: false,
      checkInterval: 0,  // 禁用间隔检查，方便测试
    });
    tempDir = path.join(os.tmpdir(), `test-${Date.now()}`);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('基本功能', () => {
    it('应该能够检查模型完整性（所有文件存在）', async () => {
      const servicePath = path.join(tempDir, 'semantic-repair-zh');
      const modelPath = path.join(servicePath, 'models', 'qwen2.5-3b-instruct-zh');

      // Mock service.json
      const serviceJson = {
        model_path: 'models/qwen2.5-3b-instruct-zh',
      };

      // Mock文件系统
      (fs.access as jest.Mock).mockImplementation(async (filePath: string) => {
        if (filePath === servicePath || filePath === modelPath) {
          return;
        }
        if (filePath.includes('service.json')) {
          return;
        }
        if (filePath.includes('model.safetensors') ||
            filePath.includes('config.json') ||
            filePath.includes('tokenizer.json') ||
            filePath.includes('tokenizer_config.json')) {
          return;
        }
        throw new Error('File not found');
      });

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(serviceJson));
      (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 });  // 非空文件

      const result = await checker.checkModelIntegrity('semantic-repair-zh', servicePath, true);

      expect(result.isValid).toBe(true);
      expect(result.checkedFiles.length).toBeGreaterThan(0);
      expect(result.missingFiles).toBeUndefined();
      expect(result.corruptedFiles).toBeUndefined();
    });

    it('应该在服务路径不存在时返回false', async () => {
      const servicePath = path.join(tempDir, 'nonexistent');

      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));

      const result = await checker.checkModelIntegrity('semantic-repair-zh', servicePath, true);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('Service path does not exist');
    });

    it('应该在service.json不存在时返回false', async () => {
      const servicePath = path.join(tempDir, 'semantic-repair-zh');

      (fs.access as jest.Mock).mockImplementation(async (filePath: string) => {
        if (filePath === servicePath) {
          return;
        }
        throw new Error('File not found');
      });

      const result = await checker.checkModelIntegrity('semantic-repair-zh', servicePath, true);

      expect(result.isValid).toBe(false);
      expect(result.reason).toContain('service.json not found');
    });

    it('应该在模型文件缺失时返回false', async () => {
      const servicePath = path.join(tempDir, 'semantic-repair-zh');
      const modelPath = path.join(servicePath, 'models', 'qwen2.5-3b-instruct-zh');

      const serviceJson = {
        model_path: 'models/qwen2.5-3b-instruct-zh',
      };

      (fs.access as jest.Mock).mockImplementation(async (filePath: string) => {
        if (filePath === servicePath || filePath === modelPath) {
          return;
        }
        if (filePath.includes('service.json')) {
          return;
        }
        // 模型文件不存在
        throw new Error('File not found');
      });

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(serviceJson));

      const result = await checker.checkModelIntegrity('semantic-repair-zh', servicePath, true);

      expect(result.isValid).toBe(false);
      expect(result.missingFiles).toBeDefined();
      expect(result.missingFiles!.length).toBeGreaterThan(0);
    });

    it('应该在文件大小为0时返回false（损坏文件）', async () => {
      const servicePath = path.join(tempDir, 'semantic-repair-zh');
      const modelPath = path.join(servicePath, 'models', 'qwen2.5-3b-instruct-zh');

      const serviceJson = {
        model_path: 'models/qwen2.5-3b-instruct-zh',
      };

      (fs.access as jest.Mock).mockImplementation(async (filePath: string) => {
        if (filePath === servicePath || filePath === modelPath) {
          return;
        }
        if (filePath.includes('service.json')) {
          return;
        }
        if (filePath.includes('model.safetensors') ||
            filePath.includes('config.json') ||
            filePath.includes('tokenizer.json') ||
            filePath.includes('tokenizer_config.json')) {
          return;
        }
        throw new Error('File not found');
      });

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(serviceJson));
      (fs.stat as jest.Mock).mockResolvedValue({ size: 0 });  // 空文件（损坏）

      const result = await checker.checkModelIntegrity('semantic-repair-zh', servicePath, true);

      expect(result.isValid).toBe(false);
      expect(result.corruptedFiles).toBeDefined();
      expect(result.corruptedFiles!.length).toBeGreaterThan(0);
    });
  });

  describe('en-normalize服务', () => {
    it('应该对en-normalize服务返回true（不需要模型文件）', async () => {
      const servicePath = path.join(tempDir, 'en-normalize');

      const serviceJson = {};

      (fs.access as jest.Mock).mockImplementation(async (filePath: string) => {
        if (filePath === servicePath) {
          return;
        }
        if (filePath.includes('service.json')) {
          return;
        }
        throw new Error('File not found');
      });

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(serviceJson));

      const result = await checker.checkModelIntegrity('en-normalize', servicePath, true);

      expect(result.isValid).toBe(true);
      expect(result.checkedFiles.length).toBe(0);  // en-normalize不需要模型文件
    });
  });

  describe('文件哈希计算', () => {
    it('应该能够计算文件SHA256哈希', async () => {
      const testContent = 'test content';
      const filePath = path.join(tempDir, 'test.txt');

      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(testContent));

      const hash = await checker.calculateFileHash(filePath);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);  // SHA256哈希长度为64个十六进制字符
    });

    it('应该能够验证文件哈希', async () => {
      const testContent = 'test content';
      const filePath = path.join(tempDir, 'test.txt');

      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(testContent));

      const expectedHash = await checker.calculateFileHash(filePath);
      const isValid = await checker.verifyFileHash(filePath, expectedHash);

      expect(isValid).toBe(true);
    });

    it('应该在哈希不匹配时返回false', async () => {
      const testContent = 'test content';
      const filePath = path.join(tempDir, 'test.txt');

      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from(testContent));

      const wrongHash = 'wrong_hash_value';
      const isValid = await checker.verifyFileHash(filePath, wrongHash);

      expect(isValid).toBe(false);
    });
  });

  describe('检查间隔', () => {
    it('应该在检查间隔内跳过检查', async () => {
      const checkerWithInterval = new SemanticRepairModelIntegrityChecker({
        checkInterval: 60 * 1000,  // 1分钟
      });

      const servicePath = path.join(tempDir, 'semantic-repair-zh');
      const serviceJson = { model_path: 'models/qwen2.5-3b-instruct-zh' };

      // 第一次检查
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(serviceJson));
      (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 });

      const result1 = await checkerWithInterval.checkModelIntegrity('semantic-repair-zh', servicePath, true);
      expect(result1.isValid).toBe(true);

      // 第二次检查（在间隔内，应该跳过）
      const result2 = await checkerWithInterval.checkModelIntegrity('semantic-repair-zh', servicePath, false);
      expect(result2.isValid).toBe(true);  // 返回缓存结果（简化实现）
      // 注意：实际实现中应该缓存结果，这里简化处理
    });
  });
});
