/**
 * TONEStage 单元测试
 */

import { TONEStage } from './tone-stage';
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

describe('TONEStage', () => {
  let toneStage: TONEStage;
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockSequentialExecutor: any;
  let mockWithGpuLease: jest.MockedFunction<typeof withGpuLease>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTaskRouter = {
      routeTONETask: jest.fn(),
    } as any;

    mockSequentialExecutor = {
      execute: jest.fn(),
    };

    (getSequentialExecutor as jest.Mock).mockReturnValue(mockSequentialExecutor);

    mockWithGpuLease = withGpuLease as jest.MockedFunction<typeof withGpuLease>;
    mockWithGpuLease.mockImplementation(async (serviceType, fn) => {
      return await fn();
    });

    toneStage = new TONEStage(mockTaskRouter);
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

  describe('TONE 生成', () => {
    it('应该成功生成 TONE 音频', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: 'base64_tone_audio',
        audio_format: 'wav',
        speaker_id: 'test-speaker-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat, 'test-speaker-1');

      expect(result.toneAudio).toBe('base64_tone_audio');
      expect(result.toneFormat).toBe('wav');
      expect(result.speakerId).toBe('test-speaker-1');
      expect(result.toneTimeMs).toBeDefined();
      expect(mockTaskRouter.routeTONETask).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: 'base64_wav_audio',
          audio_format: 'wav',
          sample_rate: 16000,
          action: 'clone',
          speaker_id: 'test-speaker-1',
          job_id: 'test-job-1',
        })
      );
    });

    it('应该从 job 中提取 speaker_id（如果未提供）', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'job-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: 'base64_tone_audio',
        audio_format: 'wav',
        speaker_id: 'job-speaker-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.speakerId).toBe('job-speaker-1');
      expect(mockTaskRouter.routeTONETask).toHaveBeenCalledWith(
        expect.objectContaining({
          speaker_id: 'job-speaker-1',
        })
      );
    });

    it('应该优先使用提供的 speaker_id 参数', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'job-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: 'base64_tone_audio',
        audio_format: 'wav',
        speaker_id: 'param-speaker-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat, 'param-speaker-1');

      expect(result.speakerId).toBe('param-speaker-1');
      expect(mockTaskRouter.routeTONETask).toHaveBeenCalledWith(
        expect.objectContaining({
          speaker_id: 'param-speaker-1',
        })
      );
    });
  });

  describe('配置检查', () => {
    it('应该在 use_tone=false 时跳过 TONE', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: false,
        },
      });
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(result.toneFormat).toBeUndefined();
      expect(result.speakerId).toBeUndefined();
      expect(mockTaskRouter.routeTONETask).not.toHaveBeenCalled();
    });

    it('应该在 use_tone 未设置时跳过 TONE', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
        },
      });
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(mockTaskRouter.routeTONETask).not.toHaveBeenCalled();
    });
  });

  describe('空音频处理', () => {
    it('应该在 TTS 音频为空时跳过 TONE', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = '';
      const ttsFormat = 'wav';

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(mockTaskRouter.routeTONETask).not.toHaveBeenCalled();
    });

    it('应该在 TTS 音频只有空格时跳过 TONE', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = '   ';
      const ttsFormat = 'wav';

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(mockTaskRouter.routeTONETask).not.toHaveBeenCalled();
    });
  });

  describe('TaskRouter 检查', () => {
    it('应该在 TaskRouter 为 null 时返回空结果', async () => {
      const toneStageNull = new TONEStage(null);
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const result = await toneStageNull.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(result.toneFormat).toBeUndefined();
      expect(result.speakerId).toBeUndefined();
    });
  });

  describe('speaker_id 检查', () => {
    it('应该在缺少 speaker_id 时跳过 TONE', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
      });
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(result.speakerId).toBeUndefined();
      expect(mockTaskRouter.routeTONETask).not.toHaveBeenCalled();
    });

    it('应该支持从 voice_id 提取 speaker_id', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        voice_id: 'voice-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: 'base64_tone_audio',
        audio_format: 'wav',
        speaker_id: 'voice-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.speakerId).toBe('voice-1');
      expect(mockTaskRouter.routeTONETask).toHaveBeenCalledWith(
        expect.objectContaining({
          speaker_id: 'voice-1',
        })
      );
    });
  });

  describe('错误处理', () => {
    it('应该在 TONE 生成失败时返回空结果（不影响整体流程）', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });
      mockTaskRouter.routeTONETask.mockRejectedValue(new Error('TONE failed'));

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(result.toneFormat).toBeUndefined();
      expect(result.speakerId).toBe('test-speaker-1'); // 仍然返回 speaker_id
    });

    it('应该正确处理 GPU 租约获取失败', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      mockWithGpuLease.mockRejectedValue(new Error('GPU lease failed'));
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(result.speakerId).toBe('test-speaker-1');
    });
  });

  describe('顺序执行', () => {
    it('应该使用 SequentialExecutor 确保顺序执行', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: 'base64_tone_audio',
        audio_format: 'wav',
        speaker_id: 'test-speaker-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      await toneStage.process(job, ttsAudio, ttsFormat);

      expect(mockSequentialExecutor.execute).toHaveBeenCalledWith(
        'test-session',
        'TONE',
        0,
        expect.any(Function)
      );
    });
  });

  describe('性能监控', () => {
    it('应该记录 TONE 处理时间', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: 'base64_tone_audio',
        audio_format: 'wav',
        speaker_id: 'test-speaker-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneTimeMs).toBeDefined();
      expect(typeof result.toneTimeMs).toBe('number');
      expect(result.toneTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('音频格式处理', () => {
    it('应该使用与 TTS 相同的格式', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: 'base64_tone_audio',
        audio_format: 'wav',
        speaker_id: 'test-speaker-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneFormat).toBe('wav');
    });

    it('应该在 TONE 音频为空时返回 undefined format', async () => {
      const job = createJob({
        pipeline: {
          use_asr: true,
          use_nmt: true,
          use_tts: true,
          use_tone: true,
        },
        speaker_id: 'test-speaker-1',
      } as any);
      const ttsAudio = 'base64_wav_audio';
      const ttsFormat = 'wav';

      const mockTONEResult = {
        audio: undefined,
        audio_format: 'wav',
        speaker_id: 'test-speaker-1',
      };

      mockTaskRouter.routeTONETask.mockResolvedValue(mockTONEResult as any);
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, taskType, utteranceIndex, fn) => {
        return await fn();
      });

      const result = await toneStage.process(job, ttsAudio, ttsFormat);

      expect(result.toneAudio).toBeUndefined();
      expect(result.toneFormat).toBeUndefined();
    });
  });
});
