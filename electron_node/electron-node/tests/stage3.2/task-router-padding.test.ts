/**
 * 单元测试：测试 EDGE-4 Padding 参数传递（CONF-1, CONF-2, EDGE-4）
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TaskRouter } from '../../main/src/task-router/task-router';
import { ASRTask, ASRResult } from '../../main/src/task-router/types';
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

describe('TaskRouter - EDGE-4: Padding 参数传递', () => {
  let taskRouter: TaskRouter;
  let mockRegistry: ServiceRegistry;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry = new Map();
    addFakeAsrToRegistry(mockRegistry);
    taskRouter = new TaskRouter(mockRegistry);
  });

  describe('EDGE-4: padding_ms 参数传递', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该正确传递 padding_ms 参数到 ASR 服务（手动截断：280ms）', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        padding_ms: 280, // 手动截断的 padding
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.95,
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

      await taskRouter.routeASRTask(task);

      // 验证 padding_ms 被传递到请求体
      expect(mockPost).toHaveBeenCalled();
      const requestBody = mockPost.mock.calls[0][1];
      expect(requestBody.padding_ms).toBe(280);
    });

    it('应该正确传递 padding_ms 参数到 ASR 服务（自动 finalize：220ms）', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        padding_ms: 220, // 自动 finalize 的 padding
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.90,
          language_probabilities: { zh: 0.90, en: 0.10 },
          segments: [],
          duration: 1.0,
          vad_segments: [],
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      await taskRouter.refreshServiceEndpoints();

      await taskRouter.routeASRTask(task);

      // 验证 padding_ms 被传递到请求体
      expect(mockPost).toHaveBeenCalled();
      const requestBody = mockPost.mock.calls[0][1];
      expect(requestBody.padding_ms).toBe(220);
    });

    it('应该处理 padding_ms 未提供的情况（undefined）', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        // padding_ms 未提供
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.95,
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

      await taskRouter.routeASRTask(task);

      // 验证 padding_ms 可以是 undefined
      expect(mockPost).toHaveBeenCalled();
      const requestBody = mockPost.mock.calls[0][1];
      expect(requestBody.padding_ms).toBeUndefined();
    });

    it('应该处理 padding_ms = 0 的情况（不添加 padding）', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        padding_ms: 0, // 不添加 padding
      };

      const mockPost = jest.fn() as any;
      mockPost.mockResolvedValue({
        data: {
          text: '测试文本',
          language: 'zh',
          language_probability: 0.95,
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

      await taskRouter.routeASRTask(task);

      // 验证 padding_ms = 0 被传递
      expect(mockPost).toHaveBeenCalled();
      const requestBody = mockPost.mock.calls[0][1];
      expect(requestBody.padding_ms).toBe(0);
    });

    it('应该同时支持 padding_ms 和 segments 参数', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
        padding_ms: 220,
      };

      const mockSegments = [
        { text: '第一段', start: 0.0, end: 0.5, no_speech_prob: 0.05 },
        { text: '第二段', start: 0.5, end: 1.0, no_speech_prob: 0.02 },
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

      // 验证 padding_ms 被传递
      expect(mockPost).toHaveBeenCalled();
      const requestBody = mockPost.mock.calls[0][1];
      expect(requestBody.padding_ms).toBe(220);

      // 验证 segments 被正确返回
      expect(result.segments).toBeDefined();
      expect(result.segments).toHaveLength(2);
    });
  });
});

