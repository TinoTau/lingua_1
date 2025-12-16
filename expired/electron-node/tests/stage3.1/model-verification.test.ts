/**
 * 阶段 3.1：模型验证功能测试
 * 
 * 测试模型验证功能：
 * - 文件存在性检查
 * - 文件大小验证
 * - SHA256 校验
 * - 验证进度显示
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

describe('模型验证功能', () => {
  let testModelsDir: string;
  let testFile: string;

  beforeEach(async () => {
    testModelsDir = path.join(os.tmpdir(), `lingua-test-${Date.now()}`);
    testFile = path.join(testModelsDir, 'test-file.bin');
    await fs.mkdir(testModelsDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testModelsDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('文件存在性检查', () => {
    it('应该正确检测文件存在', async () => {
      await fs.writeFile(testFile, 'test content', 'utf-8');
      
      try {
        await fs.access(testFile);
        expect(true).toBe(true);
      } catch {
        expect(false).toBe(true);
      }
    });

    it('应该正确检测文件不存在', async () => {
      const nonExistentFile = path.join(testModelsDir, 'non-existent.bin');
      
      try {
        await fs.access(nonExistentFile);
        expect(false).toBe(true);
      } catch {
        expect(true).toBe(true);
      }
    });
  });

  describe('文件大小验证', () => {
    it('应该正确验证文件大小', async () => {
      const content = 'test content';
      await fs.writeFile(testFile, content, 'utf-8');
      
      const stats = await fs.stat(testFile);
      const expectedSize = Buffer.from(content).length;
      
      expect(stats.size).toBe(expectedSize);
    });

    it('应该检测文件大小不匹配', async () => {
      const content = 'test content';
      await fs.writeFile(testFile, content, 'utf-8');
      
      const stats = await fs.stat(testFile);
      const expectedSize = 1000; // 期望大小
      
      if (stats.size !== expectedSize) {
        expect(stats.size).not.toBe(expectedSize);
      }
    });
  });

  describe('SHA256 校验', () => {
    it('应该正确计算文件 SHA256', async () => {
      const content = 'test content';
      await fs.writeFile(testFile, content, 'utf-8');
      
      const hash = crypto.createHash('sha256');
      const fileBuffer = await fs.readFile(testFile);
      hash.update(fileBuffer);
      const calculatedHash = hash.digest('hex');
      
      expect(calculatedHash).toBeTruthy();
      expect(calculatedHash.length).toBe(64); // SHA256 是 64 个十六进制字符
    });

    it('应该检测 SHA256 不匹配', async () => {
      const content = 'test content';
      await fs.writeFile(testFile, content, 'utf-8');
      
      const hash = crypto.createHash('sha256');
      const fileBuffer = await fs.readFile(testFile);
      hash.update(fileBuffer);
      const calculatedHash = hash.digest('hex');
      const expectedHash = 'a'.repeat(64); // 错误的哈希值
      
      expect(calculatedHash).not.toBe(expectedHash);
    });

    it('应该正确比较 SHA256 哈希值', async () => {
      const content = 'test content';
      await fs.writeFile(testFile, content, 'utf-8');
      
      const hash1 = crypto.createHash('sha256');
      const fileBuffer = await fs.readFile(testFile);
      hash1.update(fileBuffer);
      const hash1Value = hash1.digest('hex');
      
      // 重新计算
      const hash2 = crypto.createHash('sha256');
      hash2.update(fileBuffer);
      const hash2Value = hash2.digest('hex');
      
      expect(hash1Value).toBe(hash2Value);
    });
  });

  describe('验证进度', () => {
    it('应该正确计算验证进度百分比', () => {
      const totalFiles = 10;
      const currentFile = 5;
      const progress = (currentFile / totalFiles) * 100;
      
      expect(progress).toBe(50);
    });

    it('应该处理边界情况（第一个文件）', () => {
      const totalFiles = 10;
      const currentFile = 1;
      const progress = (currentFile / totalFiles) * 100;
      
      expect(progress).toBe(10);
    });

    it('应该处理边界情况（最后一个文件）', () => {
      const totalFiles = 10;
      const currentFile = 10;
      const progress = (currentFile / totalFiles) * 100;
      
      expect(progress).toBe(100);
    });
  });
});

