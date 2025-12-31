// PipelineOrchestrator 单元测试

import { PipelineOrchestrator } from './pipeline-orchestrator';
import { TaskRouter } from '../task-router/task-router';
import { JobAssignMessage } from '@shared/protocols/messages';
import { ASRResult, NMTResult, TTSResult } from '../task-router/types';

// Mock TaskRouter
jest.mock('../task-router/task-router');

// Mock node-config
jest.mock('../node-config', () => ({
  loadNodeConfig: jest.fn(() => ({
    features: {
      enableS1PromptBias: false,
    },
  })),
}));

// Mock opus-codec 以避免动态导入问题
jest.mock('../utils/opus-codec', () => ({
  convertWavToOpus: jest.fn(async (wavBuffer: Buffer) => {
    // 返回一个模拟的 Opus 数据（比 WAV 小）
    return Buffer.from('mock_opus_data_' + wavBuffer.length);
  }),
  decodeOpusToPcm16: jest.fn(async (opusDataBase64: string, sampleRate: number) => {
    // 如果数据是 'invalid_opus_data'，抛出错误（用于测试解码失败）
    if (opusDataBase64 === 'invalid_opus_data') {
      throw new Error('Invalid Opus data format');
    }
    // 返回一个模拟的 PCM16 数据
    return Buffer.from('mock_pcm16_data');
  }),
  encodePcm16ToOpusBuffer: jest.fn(async (pcm16Data: Buffer, sampleRate: number, channels: number) => {
    // 返回一个模拟的 Opus 数据
    return Buffer.from('mock_opus_data_' + pcm16Data.length);
  }),
}));

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
    // 注意：PipelineOrchestrator 现在只处理 ASR，NMT/TTS 由 PostProcessCoordinator 处理
    orchestrator = new PipelineOrchestrator(mockTaskRouter as any);
  });

  describe('processJob', () => {
    it('应该只处理 ASR，NMT/TTS 由 PostProcess 处理', async () => {
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
        audio: 'base64_opus_audio_data', // Opus 格式的 base64 数据
        audio_format: 'opus', // 强制使用 Opus 格式
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

      // 创建一个有效的 WAV 文件 Buffer（简单的正弦波）
      function createTestWavBuffer(): Buffer {
        const sampleRate = 16000;
        const duration = 0.1; // 0.1 秒
        const numSamples = Math.floor(sampleRate * duration);
        const samples = new Int16Array(numSamples);
        
        for (let i = 0; i < numSamples; i++) {
          const t = i / sampleRate;
          const value = Math.sin(2 * Math.PI * 440 * t); // 440Hz 正弦波
          samples[i] = Math.floor(value * 32767);
        }

        const numChannels = 1;
        const bitsPerSample = 16;
        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const dataSize = samples.length * (bitsPerSample / 8);
        const fileSize = 36 + dataSize;

        const buffer = Buffer.alloc(44 + dataSize);
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(fileSize, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(numChannels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(byteRate, 28);
        buffer.writeUInt16LE(blockAlign, 32);
        buffer.writeUInt16LE(bitsPerSample, 34);
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);
        Buffer.from(samples.buffer).copy(buffer, 44);

        return buffer;
      }

      const wavBuffer = createTestWavBuffer();
      const wavBase64 = wavBuffer.toString('base64');

      // Mock TTS 结果（返回 WAV 格式，Pipeline 会编码为 Opus）
      const ttsResult: TTSResult = {
        audio: wavBase64, // 有效的 WAV 格式的 base64 数据
        audio_format: 'wav', // Pipeline 会将其编码为 Opus
        sample_rate: 16000,
      };

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);
      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);
      mockTaskRouter.routeTTSTask.mockResolvedValue(ttsResult);

      const result = await orchestrator.processJob(job);

      expect(result.text_asr).toBe('你好世界');
      // Pipeline 现在只处理 ASR，NMT/TTS 由 PostProcessCoordinator 处理
      expect(result.text_translated).toBe('');
      expect(result.tts_audio).toBe('');
      expect(result.tts_format).toBe('pcm16');

      // 验证只有 ASR 被调用（NMT/TTS 由 PostProcess 处理）
      expect(mockTaskRouter.routeASRTask).toHaveBeenCalled();
      expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
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
        audio: 'base64_opus_audio_data', // Opus 格式的 base64 数据
        audio_format: 'opus', // 强制使用 Opus 格式
        sample_rate: 16000,
        trace_id: 'test-trace',
      };

      mockTaskRouter.routeASRTask.mockRejectedValue(new Error('ASR service unavailable'));

      await expect(orchestrator.processJob(job)).rejects.toThrow('ASR service unavailable');
      expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });

    // NMT/TTS 失败测试已移除，因为 Pipeline 现在只处理 ASR，NMT/TTS 由 PostProcessCoordinator 处理
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
        audio: 'base64_opus_audio_data', // Opus 格式的 base64 数据
        audio_format: 'opus', // 强制使用 Opus 格式
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

  // processNMTOnly 和 processTTSOnly 已移除，NMT/TTS 由 PostProcessCoordinator 处理

  describe('Opus 编解码功能', () => {
    it('应该在输入是 Opus 格式时解码为 PCM16', async () => {
      const job: JobAssignMessage = {
        type: 'job_assign',
        job_id: 'test-job-opus',
        attempt_id: 1,
        session_id: 'test-session',
        utterance_index: 0,
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        pipeline: {
          use_asr: true,
          use_nmt: true, // 启用 NMT 以测试完整流程
          use_tts: true,
        },
        audio: 'base64_opus_audio', // Opus 格式的 base64 数据
        audio_format: 'opus', // Pipeline 会将其解码为 PCM16
        sample_rate: 16000,
        trace_id: 'test-trace',
      };

      const asrResult: ASRResult = {
        text: '测试文本',
        confidence: 0.95,
        language: 'zh',
        is_final: true,
      };

      const nmtResult: NMTResult = {
        text: 'Test Text',
        confidence: 0.9,
      };

      // 创建有效的 WAV 数据
      function createTestWavBuffer(): Buffer {
        const sampleRate = 16000;
        const duration = 0.1;
        const numSamples = Math.floor(sampleRate * duration);
        const samples = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const t = i / sampleRate;
          const value = Math.sin(2 * Math.PI * 440 * t);
          samples[i] = Math.floor(value * 32767);
        }
        const numChannels = 1;
        const bitsPerSample = 16;
        const dataSize = samples.length * (bitsPerSample / 8);
        const fileSize = 36 + dataSize;
        const buffer = Buffer.alloc(44 + dataSize);
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(fileSize, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(numChannels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
        buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
        buffer.writeUInt16LE(bitsPerSample, 34);
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);
        Buffer.from(samples.buffer).copy(buffer, 44);
        return buffer;
      }

      const wavBuffer = createTestWavBuffer();
      const wavBase64 = wavBuffer.toString('base64');

      const ttsResult: TTSResult = {
        audio: wavBase64,
        audio_format: 'wav',
        sample_rate: 16000,
      };

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);
      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);
      mockTaskRouter.routeTTSTask.mockResolvedValue(ttsResult);

      const result = await orchestrator.processJob(job);

      // 验证 ASR 被调用（使用解码后的 PCM16）
      expect(mockTaskRouter.routeASRTask).toHaveBeenCalled();
      expect(result.text_asr).toBe('测试文本');
      // Pipeline 现在只处理 ASR，NMT/TTS 由 PostProcessCoordinator 处理
      expect(result.text_translated).toBe('');
      expect(result.tts_audio).toBe('');
      expect(result.tts_format).toBe('pcm16');
      // 验证 NMT/TTS 没有被调用（由 PostProcess 处理）
      expect(mockTaskRouter.routeNMTTask).not.toHaveBeenCalled();
      expect(mockTaskRouter.routeTTSTask).not.toHaveBeenCalled();
    });

    it('应该在 Opus 解码失败时抛出错误（不再回退）', async () => {
      const job: JobAssignMessage = {
        type: 'job_assign',
        job_id: 'test-job-opus-fallback',
        attempt_id: 1,
        session_id: 'test-session',
        utterance_index: 0,
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        pipeline: {
          use_asr: true,
          use_nmt: true, // 启用 NMT 以测试完整流程
          use_tts: true,
        },
        audio: 'invalid_opus_data', // 无效的 Opus 数据（会导致解码失败，mock 会抛出错误）
        audio_format: 'opus',
        sample_rate: 16000,
        trace_id: 'test-trace',
      };

      const asrResult: ASRResult = {
        text: '测试文本',
        confidence: 0.95,
        language: 'zh',
        is_final: true,
      };

      const nmtResult: NMTResult = {
        text: 'Test Text',
        confidence: 0.9,
      };

      // 创建有效的 WAV 数据
      function createTestWavBuffer(): Buffer {
        const sampleRate = 16000;
        const duration = 0.1;
        const numSamples = Math.floor(sampleRate * duration);
        const samples = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const t = i / sampleRate;
          const value = Math.sin(2 * Math.PI * 440 * t);
          samples[i] = Math.floor(value * 32767);
        }
        const numChannels = 1;
        const bitsPerSample = 16;
        const dataSize = samples.length * (bitsPerSample / 8);
        const fileSize = 36 + dataSize;
        const buffer = Buffer.alloc(44 + dataSize);
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(fileSize, 4);
        buffer.write('WAVE', 8);
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16);
        buffer.writeUInt16LE(1, 20);
        buffer.writeUInt16LE(numChannels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
        buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
        buffer.writeUInt16LE(bitsPerSample, 34);
        buffer.write('data', 36);
        buffer.writeUInt32LE(dataSize, 40);
        Buffer.from(samples.buffer).copy(buffer, 44);
        return buffer;
      }

      const wavBuffer = createTestWavBuffer();
      const wavBase64 = wavBuffer.toString('base64');

      const ttsResult: TTSResult = {
        audio: wavBase64,
        audio_format: 'wav',
        sample_rate: 16000,
      };

      mockTaskRouter.routeASRTask.mockResolvedValue(asrResult);
      mockTaskRouter.routeNMTTask.mockResolvedValue(nmtResult);
      mockTaskRouter.routeTTSTask.mockResolvedValue(ttsResult);

      // Opus 解码失败时应该直接抛出错误（不再回退）
      await expect(orchestrator.processJob(job)).rejects.toThrow('Opus decoding failed');
      
      // 验证 ASR 不会被调用（因为解码失败）
      expect(mockTaskRouter.routeASRTask).not.toHaveBeenCalled();
    });
  });
});

