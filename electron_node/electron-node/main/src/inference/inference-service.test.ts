// InferenceService 单元测试

import { InferenceService } from './inference-service';
import { ModelManager } from '../model-manager/model-manager';
import { JobAssignMessage } from '@shared/protocols/messages';

describe('InferenceService', () => {
  let inferenceService: InferenceService;
  let mockModelManager: any;
  let mockPythonServiceManager: any;
  let mockRustServiceManager: any;
  let mockServiceRegistryManager: any;

  beforeEach(() => {
    mockModelManager = {
      getInstalledModels: jest.fn().mockReturnValue([]),
      getAvailableModels: jest.fn().mockResolvedValue([]),
    };

    mockPythonServiceManager = {
      getServiceStatus: jest.fn().mockReturnValue({ running: false }),
    };

    mockRustServiceManager = {
      getStatus: jest.fn().mockReturnValue({ running: false }),
    };

    mockServiceRegistryManager = {
      loadRegistry: jest.fn().mockResolvedValue({}),
      listInstalled: jest.fn().mockReturnValue([]),
    };

    // 新架构要求所有服务管理器都必须提供
    inferenceService = new InferenceService(
      mockModelManager,
      mockPythonServiceManager,
      mockRustServiceManager,
      mockServiceRegistryManager
    );
  });

  describe('processJob', () => {
    it('应该使用新架构处理任务', async () => {
      const job: JobAssignMessage = {
        type: 'job_assign',
        job_id: 'test-job-1',
        attempt_id: 1,
        session_id: 'test-session',
        utterance_index: 0,
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
        },
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        trace_id: 'test-trace',
      };

      const mockOrchestrator = {
        processJob: jest.fn().mockResolvedValue({
          text_asr: '你好世界',
          text_translated: 'Hello World',
          tts_audio: 'base64_tts_audio',
          tts_format: 'pcm16',
          extra: {},
        }),
      };

      // Mock TaskRouter
      const mockTaskRouter = {
        refreshServiceEndpoints: jest.fn().mockResolvedValue(undefined),
      };

      // 使用反射访问私有属性
      (inferenceService as any).pipelineOrchestrator = mockOrchestrator;
      (inferenceService as any).taskRouter = mockTaskRouter;

      const result = await inferenceService.processJob(job);

      expect(result.text_asr).toBe('你好世界');
      expect(result.text_translated).toBe('Hello World');
      expect(mockOrchestrator.processJob).toHaveBeenCalledWith(job, undefined);
      expect(mockTaskRouter.refreshServiceEndpoints).toHaveBeenCalled();
    });

    it('应该在处理失败时抛出错误', async () => {
      const job: JobAssignMessage = {
        type: 'job_assign',
        job_id: 'test-job-2',
        attempt_id: 1,
        session_id: 'test-session',
        utterance_index: 0,
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
        },
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        trace_id: 'test-trace',
      };

      const mockOrchestrator = {
        processJob: jest.fn().mockRejectedValue(new Error('Pipeline failed')),
      };

      const mockTaskRouter = {
        refreshServiceEndpoints: jest.fn().mockResolvedValue(undefined),
      };

      (inferenceService as any).pipelineOrchestrator = mockOrchestrator;
      (inferenceService as any).taskRouter = mockTaskRouter;

      await expect(inferenceService.processJob(job)).rejects.toThrow('Pipeline failed');
      expect(mockOrchestrator.processJob).toHaveBeenCalled();
    });
  });

  describe('getCurrentJobCount', () => {
    it('应该返回当前任务数量', () => {
      expect(inferenceService.getCurrentJobCount()).toBe(0);
    });
  });

  describe('cancelJob', () => {
    it('应该能够取消任务', () => {
      const jobId = 'test-job-1';
      const result = inferenceService.cancelJob(jobId);
      expect(result).toBe(false); // 没有运行的任务，返回 false
    });
  });
});

