/**
 * TTSStage 单元测试
 */

import { TTSStage } from './tts-stage';
import { TaskRouter } from '../../task-router/task-router';
import { JobAssignMessage } from '@shared/protocols/messages';
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';
import { withGpuLease } from '../../gpu-arbiter';

// Mock TaskRouter
jest.mock('../../task-router/task-router');

// Mock SequentialExecutor
jest.mock('../../sequential-executor/sequential-executor-factory', () => ({
  getSequentialExecutor: jest.fn(),
}));

// Mock GPU Arbiter
jest.mock('../../gpu-arbiter', () => ({
  withGpuLease: jest.fn(),
}));

// Mock text-validator
jest.mock('../../utils/text-validator', () => ({
  isMeaninglessWord: jest.fn((text: string) => {
    const trimmed = text.trim().toLowerCase();
    return ['the', 'a', 'an', 'this', 'that', 'it'].includes(trimmed);
  }),
  isEmptyText: jest.fn((text: string | null | undefined) => {
    return !text || text.trim().length === 0;
  }),
}));

describe('TTSStage', () => {
  let ttsStage: TTSStage;
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockSequentialExecutor: any;
  let mockWithGpuLease: jest.MockedFunction<typeof withGpuLease>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTaskRouter = {
      routeTTSTask: jest.fn(),
    } as any;

    mockSequentialExecutor = {
      execute: jest.fn(),
    };

    (getSequentialExecutor as jest.Mock).mockReturnValue(mockSequentialExecutor);

    mockWithGpuLease = withGpuLease as jest.MockedFunction<typeof withGpuLease>;
    mockWithGpuLease.mockImplementation(async (serviceType, fn) => {
      return await fn();
    });

    ttsStage = new TTSStage(mockTaskRouter);
  });

  const createJob = (overrides?: Partial<JobAssignMessage>): JobAssignMessage => ({
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
    audio: 'base64_opus_audio_data',
    audio_format: 'opus',
    sample_rate: 16000,
    trace_id: 'test-trace',
    ...overrides,
  });

  describe('TTS 生成', () => {
    it('应该成功生成 TTS 音频', async () => {
      const job = createJob();
      const translatedText = 'Hello World';

      const mockTTSResult = {
        audio: 'base64_wav_audio',
        audio_format: 'wav',
      };

      mockTaskRouter.routeTTSTask.mockResolvedValue(mockTTSResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, serviceType, fn) => {
        return await fn();
      });

      const result = await ttsStage.process(job, translatedText);

      expect(result.ttsAudio).toBe('base64_wav_audio');
      expect(result.ttsFormat).toBe('wav');
      expect(result.ttsTimeMs).toBeDefined();
      expect(mockTaskRouter.routeTTSTask).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello World',
          lang: 'en',
          sample_rate: 16000,
          job_id: 'test-job-1',
        })
      );
    });

    it('应该正确传递 voice_id 和 speaker_id', async () => {
      const job = createJob({
        voice_id: 'voice-1',
        speaker_id: 'speaker-1',
      } as any);
      const translatedText = 'Hello World';

      const mockTTSResult = {
        audio: 'base64_wav_audio',
        audio_format: 'wav',
      };

      mockTaskRouter.routeTTSTask.mockResolvedValue(mockTTSResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, serviceType, fn) => {
        return await fn();
      });

      await ttsStage.process(job, translatedText);

      expect(mockTaskRouter.routeTTSTask).toHaveBeenCalledWith(
        expect.objectContaining({
          voice_id: 'voice-1',
          speaker_id: 'speaker-1',
        })
      );
    });
  });

  describe('空文本处理', () => {
    it('应该在翻译文本为空时跳过 TTS', async () => {
      const job = createJob();
      const result = await ttsStage.process(job, '');

      expect(result.ttsAudio).toBe('');
      expect(result.ttsFormat).toBe('opus');
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });

    it('应该在翻译文本只有空格时跳过 TTS', async () => {
      const job = createJob();
      const result = await ttsStage.process(job, '   ');

      expect(result.ttsAudio).toBe('');
      expect(result.ttsFormat).toBe('opus');
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });
  });

  describe('无意义单词处理', () => {
    it('应该在翻译文本为无意义单词时跳过 TTS', async () => {
      const job = createJob();
      const result = await ttsStage.process(job, 'the');

      expect(result.ttsAudio).toBe('');
      expect(result.ttsFormat).toBe('opus');
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });

    it('应该处理其他无意义单词', async () => {
      const job = createJob();
      const result = await ttsStage.process(job, 'a');

      expect(result.ttsAudio).toBe('');
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });
  });

  describe('目标语言检查', () => {
    it('应该在缺少 tgt_lang 时跳过 TTS', async () => {
      const job = createJob({ tgt_lang: null });
      const result = await ttsStage.process(job, 'Hello World');

      expect(result.ttsAudio).toBe('');
      expect(result.ttsFormat).toBe('opus');
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });
  });

  describe('TaskRouter 检查', () => {
    it('应该在 TaskRouter 为 null 时返回空音频', async () => {
      const ttsStageNull = new TTSStage(null);
      const job = createJob();
      const result = await ttsStageNull.process(job, 'Hello World');

      expect(result.ttsAudio).toBe('');
      expect(result.ttsFormat).toBe('opus');
    });
  });

  describe('错误处理', () => {
    it('应该在 TTS 生成失败时返回空音频', async () => {
      const job = createJob();
      const translatedText = 'Hello World';

      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, serviceType, fn) => {
        return await fn();
      });
      mockTaskRouter.routeTTSTask.mockRejectedValue(new Error('TTS failed'));

      const result = await ttsStage.process(job, translatedText);

      expect(result.ttsAudio).toBe('');
      expect(result.ttsFormat).toBe('opus');
      expect(result.ttsTimeMs).toBeDefined();
    });

    it('应该正确处理 GPU 租约获取失败', async () => {
      const job = createJob();
      const translatedText = 'Hello World';

      mockWithGpuLease.mockRejectedValue(new Error('GPU lease failed'));
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, serviceType, fn) => {
        return await fn();
      });

      const result = await ttsStage.process(job, translatedText);

      expect(result.ttsAudio).toBe('');
      expect(result.ttsFormat).toBe('opus');
    });
  });

  describe('顺序执行', () => {
    it('应该使用 SequentialExecutor 确保顺序执行', async () => {
      const job = createJob();
      const translatedText = 'Hello World';

      const mockTTSResult = {
        audio: 'base64_wav_audio',
        audio_format: 'wav',
      };

      mockTaskRouter.routeTTSTask.mockResolvedValue(mockTTSResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, serviceType, fn) => {
        return await fn();
      });

      await ttsStage.process(job, translatedText);

      expect(mockSequentialExecutor.execute).toHaveBeenCalledWith(
        'test-session',
        0,
        'TTS',
        expect.any(Function),
        'test-job-1'
      );
    });
  });

  describe('性能监控', () => {
    it('应该记录 TTS 生成时间', async () => {
      const job = createJob();
      const translatedText = 'Hello World';

      const mockTTSResult = {
        audio: 'base64_wav_audio',
        audio_format: 'wav',
      };

      mockTaskRouter.routeTTSTask.mockResolvedValue(mockTTSResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, serviceType, fn) => {
        return await fn();
      });

      const result = await ttsStage.process(job, translatedText);

      expect(result.ttsTimeMs).toBeDefined();
      expect(typeof result.ttsTimeMs).toBe('number');
      expect(result.ttsTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('文本处理', () => {
    it('应该自动 trim 翻译文本', async () => {
      const job = createJob();
      const translatedText = '  Hello World  ';

      const mockTTSResult = {
        audio: 'base64_wav_audio',
        audio_format: 'wav',
      };

      mockTaskRouter.routeTTSTask.mockResolvedValue(mockTTSResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, serviceType, fn) => {
        return await fn();
      });

      await ttsStage.process(job, translatedText);

      expect(mockTaskRouter.routeTTSTask).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello World',
        })
      );
    });
  });
});
