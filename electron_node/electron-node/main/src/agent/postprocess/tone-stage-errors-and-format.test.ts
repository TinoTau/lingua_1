/**
 * TONEStage 单元测试：错误处理、顺序执行、性能监控、音频格式
 */

import { TONEStage } from './tone-stage';
import { TaskRouter } from '../../task-router/task-router';
import { JobAssignMessage } from '@shared/protocols/messages';
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';
import { withGpuLease } from '../../gpu-arbiter';

jest.mock('../../task-router/task-router');
jest.mock('../../sequential-executor/sequential-executor-factory', () => ({
  getSequentialExecutor: jest.fn(),
}));
jest.mock('../../gpu-arbiter', () => ({
  withGpuLease: jest.fn(),
}));

describe('TONEStage (错误处理与格式)', () => {
  let toneStage: TONEStage;
  let mockTaskRouter: jest.Mocked<TaskRouter>;
  let mockSequentialExecutor: any;
  let mockWithGpuLease: jest.MockedFunction<typeof withGpuLease>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTaskRouter = { routeTONETask: jest.fn() } as any;
    mockSequentialExecutor = { execute: jest.fn() };
    (getSequentialExecutor as jest.Mock).mockReturnValue(mockSequentialExecutor);
    mockWithGpuLease = withGpuLease as jest.MockedFunction<typeof withGpuLease>;
    mockWithGpuLease.mockImplementation(async (serviceType, fn) => await fn());
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
      expect(result.speakerId).toBe('test-speaker-1');
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
      mockSequentialExecutor.execute.mockImplementation(async (sessionId, utteranceIndex, taskType, fn) => {
        return await fn();
      });

      await toneStage.process(job, ttsAudio, ttsFormat);

      expect(mockSequentialExecutor.execute).toHaveBeenCalledWith(
        'test-session',
        0,
        'TTS',
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
