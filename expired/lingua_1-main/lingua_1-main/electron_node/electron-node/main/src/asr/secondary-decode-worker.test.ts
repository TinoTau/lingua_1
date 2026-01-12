/* S2-6: SecondaryDecodeWorker 单元测试 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { SecondaryDecodeWorker, SecondaryDecodeConfig } from './secondary-decode-worker';
import { TaskRouter } from '../task-router/task-router';
import { ASRTask, ASRResult } from '../task-router/types';
import { AudioRef } from './audio-ring-buffer';

// Mock TaskRouter
class MockTaskRouter {
  async routeASRTask(task: ASRTask): Promise<ASRResult> {
    // 模拟二次解码返回不同的结果
    if (task.job_id?.includes('secondary')) {
      return {
        text: 'secondary decode result',
        language: 'zh',
        language_probability: 0.95,
      };
    }
    return {
      text: 'primary result',
      language: 'zh',
      language_probability: 0.90,
    };
  }
}

describe('SecondaryDecodeWorker', () => {
  let worker: SecondaryDecodeWorker;
  let mockTaskRouter: MockTaskRouter;

  beforeEach(() => {
    mockTaskRouter = new MockTaskRouter() as any;
    worker = new SecondaryDecodeWorker(
      mockTaskRouter as any,
      {
        beamSize: 15,
        patience: 2.0,
        temperature: 0.0,
        bestOf: 5,
      },
      1,  // maxConcurrency
      3   // maxQueueLength
    );
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const defaultWorker = new SecondaryDecodeWorker(mockTaskRouter as any);
      const stats = defaultWorker.getStats();
      expect(stats.maxConcurrency).toBe(1);
      expect(stats.maxQueueLength).toBe(3);
    });

    it('should initialize with custom config', () => {
      const customConfig: Partial<SecondaryDecodeConfig> = {
        beamSize: 20,
        patience: 3.0,
      };
      const customWorker = new SecondaryDecodeWorker(
        mockTaskRouter as any,
        customConfig,
        2,  // maxConcurrency
        5   // maxQueueLength
      );
      const stats = customWorker.getStats();
      expect(stats.maxConcurrency).toBe(2);
      expect(stats.maxQueueLength).toBe(5);
    });
  });

  describe('canDecode', () => {
    it('should return true when available', () => {
      expect(worker.canDecode()).toBe(true);
    });

    it('should return false when concurrency limit reached', async () => {
      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };
      const primaryTask: ASRTask = {
        audio: '',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test_job',
      };

      // 启动一个解码任务（不等待完成）
      worker.decode(audioRef, primaryTask).catch(() => {});

      // 立即检查（应该返回false，因为并发数已达到上限）
      expect(worker.canDecode()).toBe(false);
    });
  });

  describe('decode', () => {
    it('should decode audio and return result', async () => {
      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };
      const primaryTask: ASRTask = {
        audio: '',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test_job',
      };

      const result = await worker.decode(audioRef, primaryTask);

      expect(result).not.toBeNull();
      expect(result?.text).toBe('secondary decode result');
      expect(result?.score).toBe(0.95);
      // latencyMs可能为0（如果执行很快），所以只检查存在
      expect(result?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should return null if no audio reference', async () => {
      const audioRef: AudioRef = {
        audio: '',  // 空音频
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };
      const primaryTask: ASRTask = {
        audio: '',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test_job',
      };

      const result = await worker.decode(audioRef, primaryTask);

      expect(result).toBeNull();
    });

    it('should return null if concurrency limit reached', async () => {
      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };
      const primaryTask: ASRTask = {
        audio: '',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test_job',
      };

      // 启动第一个任务（不等待完成）
      worker.decode(audioRef, primaryTask).catch(() => {});

      // 立即尝试第二个任务（应该被拒绝）
      const result = await worker.decode(audioRef, primaryTask);

      expect(result).toBeNull();
    });

    it('should return null if queue limit reached', async () => {
      // 创建一个队列长度限制为1的worker
      const limitedWorker = new SecondaryDecodeWorker(
        mockTaskRouter as any,
        undefined,
        1,  // maxConcurrency
        1   // maxQueueLength
      );

      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };
      const primaryTask: ASRTask = {
        audio: '',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test_job',
      };

      // 启动第一个任务（不等待完成）
      limitedWorker.decode(audioRef, primaryTask).catch(() => {});

      // 立即尝试第二个任务（应该被拒绝，因为队列已满）
      const result = await limitedWorker.decode(audioRef, primaryTask);

      expect(result).toBeNull();
    });

    it('should handle timeout', async () => {
      // 创建一个会超时的mock router
      class TimeoutTaskRouter {
        async routeASRTask(task: ASRTask): Promise<ASRResult> {
          await new Promise(resolve => setTimeout(resolve, 6000));  // 6秒，超过5秒超时
          return { text: 'timeout result', language: 'zh' };
        }
      }

      const timeoutWorker = new SecondaryDecodeWorker(
        new TimeoutTaskRouter() as any,
        undefined,
        1,
        3
      );

      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };
      const primaryTask: ASRTask = {
        audio: '',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test_job',
      };

      const result = await timeoutWorker.decode(audioRef, primaryTask, 5000);

      expect(result).toBeNull();
    }, 10000);

    it('should use conservative config parameters', async () => {
      const audioRef: AudioRef = {
        audio: Buffer.from('test audio').toString('base64'),
        sampleRate: 16000,
        audioFormat: 'pcm16',
      };
      const primaryTask: ASRTask = {
        audio: '',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test_job',
      };

      // 检查TaskRouter是否接收到正确的参数
      const routeASRTaskSpy = jest.spyOn(mockTaskRouter, 'routeASRTask');
      
      await worker.decode(audioRef, primaryTask);

      expect(routeASRTaskSpy).toHaveBeenCalled();
      const calledTask = routeASRTaskSpy.mock.calls[0][0];
      expect(calledTask.beam_size).toBe(15);
      expect(calledTask.patience).toBe(2.0);
      expect(calledTask.temperature).toBe(0.0);
      expect(calledTask.best_of).toBe(5);
      expect(calledTask.job_id).toContain('secondary');
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      const stats = worker.getStats();
      expect(stats.currentConcurrency).toBe(0);
      expect(stats.maxConcurrency).toBe(1);
      expect(stats.queueLength).toBe(0);
      expect(stats.maxQueueLength).toBe(3);
    });
  });
});

