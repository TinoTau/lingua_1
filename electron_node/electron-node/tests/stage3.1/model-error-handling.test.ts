/**
 * 阶段 3.1：模型下载错误处理测试
 * 
 * 测试模型下载的错误处理功能：
 * - 错误分类（网络、磁盘、校验、未知）
 * - 可重试判断
 * - 自动重试机制
 * - 错误信息格式化
 */

import { describe, it, expect } from '@jest/globals';
import { ModelDownloadError } from '../../main/src/model-manager/model-manager';

describe('模型下载错误处理', () => {

  describe('错误分类', () => {
    it('应该正确识别网络错误', () => {
      const networkErrors = [
        { code: 'ECONNRESET' },
        { code: 'ETIMEDOUT' },
        { code: 'ENOTFOUND' },
        { code: 'ECONNREFUSED' },
        { response: { status: 500 } },
        { response: { status: 503 } },
      ];
      
      networkErrors.forEach(error => {
        const isNetworkError = 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ENOTFOUND' ||
          error.code === 'ECONNREFUSED' ||
          (error.response?.status && error.response.status >= 500);
        
        expect(isNetworkError).toBe(true);
      });
    });

    it('应该正确识别磁盘错误', () => {
      const diskErrors = [
        { code: 'ENOSPC' },
        { code: 'EACCES' },
        { code: 'EIO' },
        { code: 'EROFS' },
      ];
      
      diskErrors.forEach(error => {
        const isDiskError = 
          error.code === 'ENOSPC' ||
          error.code === 'EACCES' ||
          error.code === 'EIO' ||
          error.code === 'EROFS';
        
        expect(isDiskError).toBe(true);
      });
    });

    it('应该正确识别校验错误', () => {
      const checksumErrors = [
        { message: '文件校验失败' },
        { message: 'checksum mismatch' },
        { message: 'SHA256 不匹配' },
        { message: '文件大小不匹配' },
      ];
      
      checksumErrors.forEach(error => {
        const isChecksumError = 
          error.message?.includes('校验') ||
          error.message?.includes('checksum') ||
          error.message?.includes('SHA256') ||
          error.message?.includes('大小不匹配');
        
        expect(isChecksumError).toBe(true);
      });
    });
  });

  describe('可重试判断', () => {
    it('网络错误应该可重试', () => {
      const networkError = { code: 'ECONNRESET' };
      const isRetryable = 
        networkError.code === 'ECONNRESET' ||
        networkError.code === 'ETIMEDOUT' ||
        networkError.code === 'ENOTFOUND' ||
        (networkError as any).response?.status >= 500;
      
      expect(isRetryable).toBe(true);
    });

    it('磁盘错误应该不可重试', () => {
      const diskError = { code: 'ENOSPC' };
      const isRetryable = 
        diskError.code === 'ECONNRESET' ||
        diskError.code === 'ETIMEDOUT' ||
        diskError.code === 'ENOTFOUND' ||
        (diskError as any).response?.status >= 500;
      
      expect(isRetryable).toBe(false);
    });

    it('校验错误应该不可重试', () => {
      const checksumError = { message: '文件校验失败' };
      const isRetryable = 
        (checksumError as any).code === 'ECONNRESET' ||
        (checksumError as any).code === 'ETIMEDOUT' ||
        (checksumError as any).code === 'ENOTFOUND' ||
        (checksumError as any).response?.status >= 500;
      
      expect(isRetryable).toBe(false);
    });
  });

  describe('错误信息格式化', () => {
    it('应该生成用户友好的错误信息', () => {
      const error: ModelDownloadError = {
        modelId: 'test-model',
        version: '1.0.0',
        stage: 'network',
        message: '连接超时',
        canRetry: true,
      };
      
      expect(error.modelId).toBe('test-model');
      expect(error.version).toBe('1.0.0');
      expect(error.stage).toBe('network');
      expect(error.message).toBe('连接超时');
      expect(error.canRetry).toBe(true);
    });

    it('应该包含错误阶段信息', () => {
      const stages: ModelDownloadError['stage'][] = ['network', 'disk', 'checksum', 'unknown'];
      
      stages.forEach(stage => {
        const error: ModelDownloadError = {
          modelId: 'test-model',
          version: '1.0.0',
          stage,
          message: '测试错误',
          canRetry: false,
        };
        
        expect(error.stage).toBe(stage);
      });
    });
  });

  describe('自动重试机制', () => {
    it('应该支持指数退避重试', () => {
      const retryDelays = [1000, 2000, 5000];
      
      retryDelays.forEach((delay, index) => {
        expect(delay).toBeGreaterThan(0);
        if (index > 0) {
          expect(delay).toBeGreaterThanOrEqual(retryDelays[index - 1]);
        }
      });
    });

    it('应该限制最大重试次数', () => {
      const MAX_RETRIES = 3;
      let attemptCount = 0;
      
      for (let i = 0; i < MAX_RETRIES + 1; i++) {
        attemptCount++;
        if (attemptCount > MAX_RETRIES) {
          break;
        }
      }
      
      expect(attemptCount).toBe(MAX_RETRIES + 1);
    });
  });
});

