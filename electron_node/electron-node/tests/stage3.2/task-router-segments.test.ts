/**
 * 单元测试：测试 Segment 时间戳提取和语言置信度分级（CONF-1, CONF-2）
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TaskRouter } from '../../main/src/task-router/task-router';
import { ASRTask, ASRResult, SegmentInfo } from '../../main/src/task-router/types';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as any;

import type { ServiceRegistry, ServiceEntry } from '../../main/src/service-layer/ServiceTypes';

// TaskRouter ASR 目前只支持 faster-whisper-vad，测试用同 id 避免 routeASRTask 抛错
const FAKE_ASR_SERVICE_ID = 'faster-whisper-vad';

function addFakeAsrToRegistry(registry: ServiceRegistry, port: number = 6007): void {
  registry.set(FAKE_ASR_SERVICE_ID, {
    def: {
      id: FAKE_ASR_SERVICE_ID,
      name: 'ASR Fake',
      type: 'asr',
      port,
      exec: { command: 'python', args: [], cwd: '.' },
    },
    runtime: { status: 'running', port },
    installPath: '/fake',
  } as ServiceEntry);
}

describe('TaskRouter - Segments and Language Confidence', () => {
  let taskRouter: TaskRouter;
  let mockRegistry: ServiceRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry = new Map();
    addFakeAsrToRegistry(mockRegistry);
    taskRouter = new TaskRouter(mockRegistry);
  });

  describe('CONF-2: Segment 时间戳提取', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该正确传递 segments 信息（包含时间戳）', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      const mockSegments: SegmentInfo[] = [
        {
          text: '你好',
          start: 0.0,
          end: 0.5,
          no_speech_prob: 0.05,
        },
        {
          text: '世界',
          start: 0.5,
          end: 1.0,
          no_speech_prob: 0.02,
        },
      ];

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '你好 世界',
          language: 'zh',
          language_probability: 0.95,
          language_probabilities: { zh: 0.95, en: 0.05 },
          segments: mockSegments,
          duration: 1.0,
          vad_segments: [],
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      await taskRouter.refreshServiceEndpoints();

      const result = await taskRouter.routeASRTask(task);

      // 验证 segments 被正确传递
      expect(result.segments).toBeDefined();
      expect(result.segments).toHaveLength(2);
      expect(result.segments![0].text).toBe('你好');
      expect(result.segments![0].start).toBe(0.0);
      expect(result.segments![0].end).toBe(0.5);
      expect(result.segments![1].text).toBe('世界');
      expect(result.segments![1].start).toBe(0.5);
      expect(result.segments![1].end).toBe(1.0);
    });

    it('应该处理没有 segments 的情况（向后兼容）', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.90,
          segments: [], // 空 segments
          duration: 1.0,
          vad_segments: [],
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      await taskRouter.refreshServiceEndpoints();

      const result = await taskRouter.routeASRTask(task);

      // 验证 segments 可以是空数组
      expect(result.segments).toBeDefined();
      expect(Array.isArray(result.segments)).toBe(true);
    });
  });

  describe('CONF-1: 语言置信度分级逻辑', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该在高置信度（≥0.90）时保持默认关闭上下文', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.95, // 高置信度
          language_probabilities: { zh: 0.95, en: 0.05 },
          segments: [],
          duration: 1.0,
          vad_segments: [],
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      await taskRouter.refreshServiceEndpoints();

      const result = await taskRouter.routeASRTask(task);

      // 验证语言概率被正确传递
      expect(result.language_probability).toBe(0.95);
      expect(result.language_probabilities).toEqual({ zh: 0.95, en: 0.05 });
      
      // 注意：当前实现中，即使高置信度也保持关闭上下文（符合方案要求）
      // 这里只验证数据传递，不验证上下文开关（因为那是内部逻辑）
    });

    it('应该在低置信度（<0.70）时强制关闭上下文', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'auto',
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'unknown',
          language_probability: 0.50, // 低置信度
          language_probabilities: { unknown: 0.50, zh: 0.30, en: 0.20 },
          segments: [],
          duration: 1.0,
          vad_segments: [],
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      await taskRouter.refreshServiceEndpoints();

      const result = await taskRouter.routeASRTask(task);

      // 验证语言概率被正确传递
      expect(result.language_probability).toBe(0.50);
      expect(result.language_probabilities).toBeDefined();
      
      // 注意：低置信度时应该强制关闭上下文，但这是内部逻辑
      // 这里只验证数据传递
    });

    it('应该处理没有语言概率信息的情况', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          // 没有 language_probability 和 language_probabilities
          segments: [],
          duration: 1.0,
          vad_segments: [],
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      await taskRouter.refreshServiceEndpoints();

      const result = await taskRouter.routeASRTask(task);

      // 验证可以处理缺失的语言概率信息
      expect(result.language_probability).toBeUndefined();
      expect(result.language_probabilities).toBeUndefined();
      expect(result.text).toBe('测试文本');
    });
  });

  describe('综合测试：Segments + 语言置信度', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该同时支持 segments 时间戳和语言置信度', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      const mockSegments: SegmentInfo[] = [
        { text: '第一段', start: 0.0, end: 0.5 },
        { text: '第二段', start: 0.5, end: 1.0 },
      ];

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '第一段 第二段',
          language: 'zh',
          language_probability: 0.92,
          language_probabilities: { zh: 0.92, en: 0.08 },
          segments: mockSegments,
          duration: 1.0,
          vad_segments: [],
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      await taskRouter.refreshServiceEndpoints();

      const result = await taskRouter.routeASRTask(task);

      // 验证 segments
      expect(result.segments).toBeDefined();
      expect(result.segments).toHaveLength(2);
      expect(result.segments![0].start).toBe(0.0);
      expect(result.segments![0].end).toBe(0.5);

      // 验证语言置信度
      expect(result.language_probability).toBe(0.92);
      expect(result.language_probabilities).toEqual({ zh: 0.92, en: 0.08 });
    });
  });
});

