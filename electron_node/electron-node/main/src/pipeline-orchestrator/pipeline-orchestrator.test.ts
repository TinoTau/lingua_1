// PipelineOrchestrator 单元测试

import { PipelineOrchestrator } from './pipeline-orchestrator';
import { TaskRouter } from '../task-router/task-router';
import { JobAssignMessage } from '@shared/protocols/messages';
import { ASRResult, NMTResult, TTSResult } from '../task-router/types';

// Mock TaskRouter
jest.mock('../task-router/task-router');

// Mock TaskRouter
const createMockTaskRouter = () => {
  const mockRouter = {
    routeASRTask: jest.fn(),
    routeNMTTask: jest.fn(),
    routeTTSTask: jest.fn(),
  };
  return mockRouter;
};

describe('PipelineOrchestrator', () => {
  let orchestrator: PipelineOrchestrator;
  let mockTaskRouter: any;

  beforeEach(() => {
    mockTaskRouter = createMockTaskRouter();
    orchestrator = new PipelineOrchestrator(mockTaskRouter as any);
  });

  describe('processJob', () => {
    it('应该处理完整的 ASR -> NMT -> TTS 流程', async () => {
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

      // Mock ASR 结果
      const asrResult: ASRResult = {
        text: '你好世界',
        confidence: 0.95,
        language: 'zh',
        is_final: true,
      };

      // Mock NMT 结果
      const nmtResult: NMTResult = {
        text: 'Hello World',
        confidence: 0.9,
      };

      // Mock TTS 结果
      const ttsResult: TTSResult = {
        audio: 'base64_tts_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
      };

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);
      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);
      mockTaskRouter.routeTTSTask.mockResolvedValue(ttsResult);

      const result = await orchestrator.processJob(job);

      expect(result.text_asr).toBe('你好世界');
      expect(result.text_translated).toBe('Hello World');
      expect(result.tts_audio).toBe('base64_tts_audio');
      expect(result.tts_format).toBe('pcm16');

      // 验证调用顺序 - 使用调用次数验证
      expect(mockTaskRouter.routeASRTask).toHaveBeenCalled();
      expect(mockTaskRouter.routeNMTTask).toHaveBeenCalled();
      expect(mockTaskRouter.routeTTSTask).toHaveBeenCalled();
      
      // 验证 ASR 在 NMT 之前调用
      const asrCallOrder = (mockTaskRouter.routeASRTask as jest.Mock).mock.invocationCallOrder[0];
      const nmtCallOrder = (mockTaskRouter.routeNMTTask as jest.Mock).mock.invocationCallOrder[0];
      const ttsCallOrder = (mockTaskRouter.routeTTSTask as jest.Mock).mock.invocationCallOrder[0];
      expect(asrCallOrder).toBeLessThan(nmtCallOrder);
      expect(nmtCallOrder).toBeLessThan(ttsCallOrder);
    });

    it('应该在 ASR 失败时抛出错误', async () => {
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

      mockTaskRouter.routeASRTask.mockRejectedValue(new Error('ASR service unavailable'));

      await expect(orchestrator.processJob(job)).rejects.toThrow('ASR service unavailable');
      expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });

    it('应该在 NMT 失败时抛出错误', async () => {
      const job: JobAssignMessage = {
        type: 'job_assign',
        job_id: 'test-job-3',
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

      const asrResult: ASRResult = {
        text: '你好世界',
        confidence: 0.95,
        language: 'zh',
        is_final: true,
      };

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);
      mockTaskRouter.routeNMTTask.mockRejectedValue(new Error('NMT service unavailable'));

      await expect(orchestrator.processJob(job)).rejects.toThrow('NMT service unavailable');
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });
  });

  describe('processASROnly', () => {
    it('应该只处理 ASR 任务', async () => {
      const job: JobAssignMessage = {
        type: 'job_assign',
        job_id: 'test-job-4',
        attempt_id: 1,
        session_id: 'test-session',
        utterance_index: 0,
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        pipeline: {
          use_asr: true,
          use_nmt: false,
          use_tts: false,
        },
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        trace_id: 'test-trace',
      };

      const asrResult: ASRResult = {
        text: '你好世界',
        confidence: 0.95,
        language: 'zh',
        is_final: true,
      };

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);

      const result = await orchestrator.processASROnly(job);

      expect(result.text_asr).toBe('你好世界');
      expect(mockTaskRouter.routeASRTask).toHaveBeenCalledTimes(1);
      expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });
  });

  describe('processNMTOnly', () => {
    it('应该只处理 NMT 任务', async () => {
      const nmtResult: NMTResult = {
        text: 'Hello World',
        confidence: 0.9,
      };

      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);

      const result = await orchestrator.processNMTOnly('你好世界', 'zh', 'en');

      expect(result.text_translated).toBe('Hello World');
      expect(mockTaskRouter.routeNMTTask).toHaveBeenCalledTimes(1);
      expect(mockTaskRouter.routeASRTask).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });
  });

  describe('processTTSOnly', () => {
    it('应该只处理 TTS 任务', async () => {
      const ttsResult: TTSResult = {
        audio: 'base64_tts_audio',
        audio_format: 'pcm16',
        sample_rate: 16000,
      };

      mockTaskRouter.routeTTSTask.mockResolvedValue(ttsResult);

      const result = await orchestrator.processTTSOnly('Hello World', 'en');

      expect(result.tts_audio).toBe('base64_tts_audio');
      expect(result.tts_format).toBe('pcm16');
      expect(mockTaskRouter.routeTTSTask).toHaveBeenCalledTimes(1);
      expect(mockTaskRouter.routeASRTask).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
    });
  });
});

