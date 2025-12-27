/**
 * OBS-1: ASR Metrics 单元测试
 */

// Mock logger before imports
jest.mock('../../main/src/logger', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock axios
jest.mock('axios', () => ({
  default: {
    create: jest.fn(() => ({
      post: jest.fn(),
    })),
  },
}));

// Mock bad-segment-detector
jest.mock('../../main/src/task-router/bad-segment-detector', () => ({
  detectBadSegment: jest.fn((result: any) => ({
    isBad: false,
    reasonCodes: [],
    qualityScore: 0.8,
  })),
}));

// Mock rerun-trigger
jest.mock('../../main/src/task-router/rerun-trigger', () => ({
  shouldTriggerRerun: jest.fn(() => ({
    shouldRerun: false,
    reason: '',
  })),
  getTop2LanguagesForRerun: jest.fn(() => []),
}));

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TaskRouter } from '../../main/src/task-router/task-router';
import axios from 'axios';
import { detectBadSegment } from '../../main/src/task-router/bad-segment-detector';
import { shouldTriggerRerun } from '../../main/src/task-router/rerun-trigger';
import { ASRTask } from '../../main/src/task-router/types';

describe('OBS-1: ASR Metrics', () => {
  let taskRouter: TaskRouter;
  let mockPythonServiceManager: any;
  let mockRustServiceManager: any;
  let mockServiceRegistryManager: any;
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPythonServiceManager = {
      getServiceStatus: jest.fn().mockReturnValue({
        running: true,
        port: 6007,
      }),
    };

    mockRustServiceManager = {
      getStatus: jest.fn().mockReturnValue({
        running: false,
      }),
    };

    mockServiceRegistryManager = {
      loadRegistry: jest.fn().mockResolvedValue(undefined),
      listInstalled: jest.fn().mockReturnValue([
        {
          service_id: 'faster-whisper-vad',
          version: '2.0.0',
        },
      ]),
    };

    mockAxiosInstance = {
      post: jest.fn(),
    };

    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    taskRouter = new TaskRouter(
      mockPythonServiceManager,
      mockRustServiceManager,
      mockServiceRegistryManager
    );
  });

  describe('getASRMetrics', () => {
    it('应该返回初始的 ASR 指标', () => {
      const metrics = taskRouter.getASRMetrics();

      expect(metrics).toEqual({
        latency: {
          p50: 0,
          p95: 0,
          p99: 0,
          count: 0,
        },
        languageConfidenceDistribution: {
          low: 0,
          medium: 0,
          high: 0,
          veryHigh: 0,
          total: 0,
        },
        badSegmentRate: {
          offline: {
            rate: 0,
            badSegments: 0,
            totalSegments: 0,
          },
          conference: {
            rate: 0,
            badSegments: 0,
            totalSegments: 0,
          },
        },
        rerunTriggerRate: {
          offline: {
            rate: 0,
            rerunCount: 0,
            totalJobs: 0,
          },
          conference: {
            rate: 0,
            rerunCount: 0,
            totalJobs: 0,
          },
        },
      });
    });

    it('应该返回指标的副本（不是引用）', () => {
      const metrics1 = taskRouter.getASRMetrics();
      const metrics2 = taskRouter.getASRMetrics();

      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });
  });

  describe('延迟统计', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该记录 ASR 任务延迟', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test-job-1',
      };

      // Mock ASR 响应
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.9,
          segments: [],
        },
      });

      // Mock bad segment detection
      (detectBadSegment as jest.Mock).mockReturnValue({
        isBad: false,
        reasonCodes: [],
        qualityScore: 0.8,
      });

      // Mock rerun trigger
      (shouldTriggerRerun as jest.Mock).mockReturnValue({
        shouldRerun: false,
        reason: '',
      });

      const startTime = Date.now();
      await taskRouter.routeASRTask(task);
      const endTime = Date.now();

      const metrics = taskRouter.getASRMetrics();
      
      expect(metrics.latency.count).toBe(1);
      expect(metrics.latency.p50).toBeGreaterThan(0);
      expect(metrics.latency.p50).toBeLessThanOrEqual(endTime - startTime);
    });

    it('应该计算延迟分位数（p50/p95/p99）', async () => {
      await taskRouter.initialize();

      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      mockAxiosInstance.post.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.9,
          segments: [],
        },
      });

      (detectBadSegment as jest.Mock).mockReturnValue({
        isBad: false,
        reasonCodes: [],
        qualityScore: 0.8,
      });

      (shouldTriggerRerun as jest.Mock).mockReturnValue({
        shouldRerun: false,
        reason: '',
      });

      // 执行多个任务，每个任务都会记录延迟
      // 注意：在测试环境中，mock 响应可能很快，延迟可能接近 0，这是正常的
      for (let i = 0; i < 10; i++) {
        await taskRouter.routeASRTask({
          ...task,
          job_id: `test-job-${i}`,
        });
      }

      const metrics = taskRouter.getASRMetrics();
      
      expect(metrics.latency.count).toBe(10);
      // 在测试环境中，延迟可能很小（接近 0），但分位数计算应该仍然正确
      expect(metrics.latency.p50).toBeGreaterThanOrEqual(0);
      // p95 应该大于等于 p50
      expect(metrics.latency.p95).toBeGreaterThanOrEqual(metrics.latency.p50);
      // p99 应该大于等于 p95
      expect(metrics.latency.p99).toBeGreaterThanOrEqual(metrics.latency.p95);
      // 如果所有延迟都是 0，分位数也应该是 0（这是正常的）
    });
  });

  describe('语言置信度分布统计', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该记录语言置信度分布', async () => {
      const testCases = [
        { prob: 0.3, expectedCategory: 'low' },
        { prob: 0.6, expectedCategory: 'medium' },
        { prob: 0.8, expectedCategory: 'high' },
        { prob: 0.95, expectedCategory: 'veryHigh' },
      ];

      mockAxiosInstance.post.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          segments: [],
        },
      });

      (detectBadSegment as jest.Mock).mockReturnValue({
        isBad: false,
        reasonCodes: [],
        qualityScore: 0.8,
      });

      (shouldTriggerRerun as jest.Mock).mockReturnValue({
        shouldRerun: false,
        reason: '',
      });

      for (let i = 0; i < testCases.length; i++) {
        const testCase = testCases[i];
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: {
            text: '测试文本',
            language: 'zh',
            language_probability: testCase.prob,
            segments: [],
          },
        });

        await taskRouter.routeASRTask({
          audio: 'base64_audio_data',
          audio_format: 'pcm16',
          sample_rate: 16000,
          src_lang: 'zh',
          job_id: `test-job-${i}`,
        });
      }

      const metrics = taskRouter.getASRMetrics();
      
      expect(metrics.languageConfidenceDistribution.total).toBe(testCases.length);
      expect(metrics.languageConfidenceDistribution.low).toBe(1);
      expect(metrics.languageConfidenceDistribution.medium).toBe(1);
      expect(metrics.languageConfidenceDistribution.high).toBe(1);
      expect(metrics.languageConfidenceDistribution.veryHigh).toBe(1);
    });

    it('应该忽略 undefined 或 null 的语言置信度', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          // 没有 language_probability
          segments: [],
        },
      });

      (detectBadSegment as jest.Mock).mockReturnValue({
        isBad: false,
        reasonCodes: [],
        qualityScore: 0.8,
      });

      (shouldTriggerRerun as jest.Mock).mockReturnValue({
        shouldRerun: false,
        reason: '',
      });

      await taskRouter.routeASRTask({
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test-job-1',
      });

      const metrics = taskRouter.getASRMetrics();
      
      expect(metrics.languageConfidenceDistribution.total).toBe(0);
    });
  });

  describe('坏段检测率统计', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
      // 重置 mock，确保每次测试都是干净的状态
      (detectBadSegment as jest.Mock).mockClear();
      (shouldTriggerRerun as jest.Mock).mockClear();
    });

    it('应该记录坏段检测', async () => {
      // 注意：detectBadSegment 在每个任务中会被调用两次：
      // 1. 临时检查（用于决定是否使用 context）
      // 2. 正式检测（用于记录指标）
      // 所以我们需要为每个任务提供两个 mock 返回值

      // 测试正常段 - 任务1
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.9,
          segments: [],
        },
      });

      // 任务1：临时检查 + 正式检测都返回正常段
      (detectBadSegment as jest.Mock)
        .mockReturnValueOnce({ isBad: false, reasonCodes: [], qualityScore: 0.8 }) // 临时检查
        .mockReturnValueOnce({ isBad: false, reasonCodes: [], qualityScore: 0.8 }); // 正式检测

      (shouldTriggerRerun as jest.Mock).mockReturnValueOnce({
        shouldRerun: false,
        reason: '',
      });

      await taskRouter.routeASRTask({
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test-job-1',
      });

      // 测试坏段 - 任务2
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.9,
          segments: [],
        },
      });

      // 任务2：临时检查 + 正式检测都返回坏段
      (detectBadSegment as jest.Mock)
        .mockReturnValueOnce({ isBad: true, reasonCodes: ['low_quality'], qualityScore: 0.3 }) // 临时检查
        .mockReturnValueOnce({ isBad: true, reasonCodes: ['low_quality'], qualityScore: 0.3 }); // 正式检测

      (shouldTriggerRerun as jest.Mock).mockReturnValueOnce({
        shouldRerun: false,
        reason: '',
      });

      await taskRouter.routeASRTask({
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test-job-2',
      });

      const metrics = taskRouter.getASRMetrics();
      
      expect(metrics.badSegmentRate.offline.totalSegments).toBe(2);
      expect(metrics.badSegmentRate.offline.badSegments).toBe(1);
      expect(metrics.badSegmentRate.offline.rate).toBe(0.5);
    });
  });

  describe('重跑触发率统计', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该记录重跑触发', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.9,
          segments: [],
        },
      });

      (detectBadSegment as jest.Mock).mockReturnValue({
        isBad: false,
        reasonCodes: [],
        qualityScore: 0.8,
      });

      // 测试不触发重跑
      (shouldTriggerRerun as jest.Mock).mockReturnValueOnce({
        shouldRerun: false,
        reason: '',
      });

      await taskRouter.routeASRTask({
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test-job-1',
      });

      // 测试触发重跑
      (shouldTriggerRerun as jest.Mock).mockReturnValueOnce({
        shouldRerun: true,
        reason: 'low_confidence',
      });

      await taskRouter.routeASRTask({
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test-job-2',
      });

      const metrics = taskRouter.getASRMetrics();
      
      expect(metrics.rerunTriggerRate.offline.totalJobs).toBe(2);
      expect(metrics.rerunTriggerRate.offline.rerunCount).toBe(1);
      expect(metrics.rerunTriggerRate.offline.rate).toBe(0.5);
    });
  });

  describe('综合测试', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该同时记录所有指标', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.85,
          segments: [],
        },
      });

      (detectBadSegment as jest.Mock).mockReturnValue({
        isBad: true,
        reasonCodes: ['low_quality'],
        qualityScore: 0.4,
      });

      (shouldTriggerRerun as jest.Mock).mockReturnValue({
        shouldRerun: true,
        reason: 'bad_segment',
      });

      await taskRouter.routeASRTask({
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        job_id: 'test-job-1',
      });

      const metrics = taskRouter.getASRMetrics();
      
      // 检查所有指标都已记录
      expect(metrics.latency.count).toBe(1);
      expect(metrics.languageConfidenceDistribution.total).toBe(1);
      expect(metrics.languageConfidenceDistribution.high).toBe(1); // 0.85 在 0.7-0.9 范围内
      expect(metrics.badSegmentRate.offline.totalSegments).toBe(1);
      expect(metrics.badSegmentRate.offline.badSegments).toBe(1);
      expect(metrics.rerunTriggerRate.offline.totalJobs).toBe(1);
      expect(metrics.rerunTriggerRate.offline.rerunCount).toBe(1);
    });
  });
});

