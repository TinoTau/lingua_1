/**
 * Utils 单元测试
 * 
 * 测试工具方法：
 * - 文件存在性检查
 * - 错误分类
 * - 可重试判断
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { fileExists, getErrorStage, isRetryableError } from '../../main/src/model-manager/utils';

describe('Utils', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `lingua-utils-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('fileExists', () => {
    it('应该正确检测文件存在', async () => {
      const testFile = path.join(testDir, 'test-file.txt');
      await fs.writeFile(testFile, 'test', 'utf-8');
      
      const exists = await fileExists(testFile);
      expect(exists).toBe(true);
    });

    it('应该正确检测文件不存在', async () => {
      const notExists = await fileExists(path.join(testDir, 'non-existent.txt'));
      expect(notExists).toBe(false);
    });
  });

  describe('getErrorStage', () => {
    it('应该正确识别网络错误', () => {
      expect(getErrorStage({ code: 'ECONNRESET' })).toBe('network');
      expect(getErrorStage({ code: 'ETIMEDOUT' })).toBe('network');
      expect(getErrorStage({ code: 'ENOTFOUND' })).toBe('network');
      expect(getErrorStage({ response: { status: 500 } })).toBe('network');
    });

    it('应该正确识别磁盘错误', () => {
      expect(getErrorStage({ code: 'ENOSPC' })).toBe('disk');
      expect(getErrorStage({ code: 'EACCES' })).toBe('disk');
      expect(getErrorStage({ code: 'EIO' })).toBe('disk');
    });

    it('应该正确识别校验错误', () => {
      expect(getErrorStage({ message: '校验失败' })).toBe('checksum');
      expect(getErrorStage({ message: 'checksum mismatch' })).toBe('checksum');
      expect(getErrorStage({ message: 'SHA256 不匹配' })).toBe('checksum');
    });

    it('应该返回 unknown 对于未知错误', () => {
      expect(getErrorStage({ code: 'UNKNOWN' })).toBe('unknown');
    });
  });

  describe('isRetryableError', () => {
    it('应该正确识别可重试的网络错误', () => {
      expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
      expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
      expect(isRetryableError({ code: 'ENOTFOUND' })).toBe(true);
      expect(isRetryableError({ response: { status: 500 } })).toBe(true);
    });

    it('应该正确识别不可重试的错误', () => {
      expect(isRetryableError({ code: 'ENOSPC' })).toBe(false);
      expect(isRetryableError({ code: 'EACCES' })).toBe(false);
    });
  });
});

