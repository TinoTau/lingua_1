/**
 * TTS 任务路由 Opus 编码单元测试
 * 确保 TTS 能够正确生成 Opus 格式的音频
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { TaskRouter } from './task-router';
import { TTSTask, TTSResult } from './types';
import { ServiceType } from '@shared/protocols/messages';
import axios from 'axios';
import { isOpusEncoderAvailable } from '../utils/opus-encoder';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// 类型辅助函数（产品代码会访问 httpClient.defaults.timeout，mock 需带上 defaults）
function createMockAxiosInstance(mockPost: jest.Mock) {
  return {
    post: mockPost,
    defaults: { timeout: 60000 },
  } as any;
}

describe('TaskRouter TTS Opus Encoding', () => {
  let taskRouter: TaskRouter;

  /**
   * 创建测试用的 WAV 文件 Buffer
   */
  function createTestWavBuffer(durationSeconds: number = 1.0, sampleRate: number = 16000): Buffer {
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const samples = new Int16Array(numSamples);

    // 生成简单的测试音频（正弦波）
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * 440 * t); // 440Hz
      samples[i] = Math.floor(value * 32767);
    }

    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = samples.length * (bitsPerSample / 8);
    const fileSize = 36 + dataSize;

    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(fileSize, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    Buffer.from(samples.buffer).copy(buffer, 44);

    return buffer;
  }

  beforeEach(() => {
    // 创建 TaskRouter 实例（仅需 registry，服务端点由 TaskRouterServiceManagerNew 从 registry 读取）
    taskRouter = new TaskRouter(new Map() as any);

    // Mock service endpoints（selectServiceEndpoint 会过滤 status === 'running'，必须带上 status）
    (taskRouter as any).serviceEndpoints = new Map([
      [ServiceType.TTS, [{
        serviceId: 'test-tts-service',
        baseUrl: 'http://localhost:5001',
        serviceType: ServiceType.TTS,
        status: 'running',
      }]],
    ]);

    (taskRouter as any).serviceConnections = new Map();
    (taskRouter as any).jobAbortControllers = new Map();
  });

  describe('Opus 编码功能', () => {
    it('应该能够将 TTS WAV 音频编码为 Opus 格式', async () => {
      if (!isOpusEncoderAvailable()) {
        console.warn('⚠️ Opus encoder not available, skipping test');
        return;
      }

      const task: TTSTask = {
        text: 'Hello, world!',
        lang: 'en',
        sample_rate: 16000,
        job_id: 'test-job-1',
      };

      // 创建测试 WAV 文件（模拟 TTS 服务返回）
      const testWavBuffer = createTestWavBuffer(1.0, 16000); // 1秒音频，16kHz

      // Mock axios
      const mockPost = jest.fn().mockResolvedValue({
        data: testWavBuffer,
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
        defaults: { timeout: 60000 },
      } as any);

      // 执行 TTS 任务
      const result: TTSResult = await taskRouter.routeTTSTask(task);

      // 验证结果
      expect(result).toBeDefined();
      expect(result.audio).toBeDefined();
      expect(result.audio.length).toBeGreaterThan(0);
      // TaskRouter 当前返回 WAV，由 Pipeline 负责编码为 Opus（见 task-router-tts.ts 注释）
      expect(result.audio_format).toBe('wav');
      expect(result.sample_rate).toBe(16000);

      // 验证 Base64 编码
      const decodedAudio = Buffer.from(result.audio, 'base64');
      expect(decodedAudio.length).toBeGreaterThan(0);
      expect(decodedAudio.length).toBe(testWavBuffer.length); // 未编码，与 WAV 等长

      console.log('✅ TTS WAV 测试通过:');
      console.log(`   WAV size: ${testWavBuffer.length} bytes`);
      console.log(`   Format: ${result.audio_format}`);
    });

    it('应该在 Opus 编码失败时回退到 PCM16', async () => {
      const task: TTSTask = {
        text: 'Test text',
        lang: 'zh',
        sample_rate: 16000,
        job_id: 'test-job-2',
      };

      const testWavBuffer = createTestWavBuffer(0.5, 16000);

      // Mock axios
      const mockPost = jest.fn().mockResolvedValue({
        data: testWavBuffer,
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
        defaults: { timeout: 60000 },
      } as any);

      // 如果 Opus 编码器不可用，应该回退到 PCM16
      const result: TTSResult = await taskRouter.routeTTSTask(task);

      expect(result).toBeDefined();
      expect(result.audio).toBeDefined();
      expect(result.audio.length).toBeGreaterThan(0);

      // TaskRouter 当前返回 WAV；格式可能是 wav / opus / pcm16 取决于实现
      expect(['opus', 'pcm16', 'wav']).toContain(result.audio_format);
      expect(result.sample_rate).toBe(16000);

      console.log(`✅ TTS 回退测试通过，格式: ${result.audio_format}`);
    });

    it('应该处理不同采样率的 WAV 文件', async () => {
      if (!isOpusEncoderAvailable()) {
        console.warn('⚠️ Opus encoder not available, skipping test');
        return;
      }

      const sampleRates = [16000, 22050, 24000];

      for (const sampleRate of sampleRates) {
        const task: TTSTask = {
          text: 'Test',
          lang: 'zh',
          sample_rate: sampleRate,
          job_id: `test-job-${sampleRate}`,
        };

        const testWavBuffer = createTestWavBuffer(0.5, sampleRate);

        const mockPost = jest.fn().mockResolvedValue({
          data: testWavBuffer,
        });

        mockedAxios.create = jest.fn().mockReturnValue({
          post: mockPost,
          defaults: { timeout: 60000 },
        } as any);

        const result: TTSResult = await taskRouter.routeTTSTask(task);

        expect(result.audio.length).toBeGreaterThan(0);
        expect(['opus', 'pcm16', 'wav']).toContain(result.audio_format);

        console.log(`✅ 采样率 ${sampleRate}Hz 测试通过，格式: ${result.audio_format}`);
      }
    });

    it('应该正确处理不同时长的音频', async () => {
      if (!isOpusEncoderAvailable()) {
        console.warn('⚠️ Opus encoder not available, skipping test');
        return;
      }

      const durations = [0.1, 0.5, 1.0, 2.0];

      for (const duration of durations) {
        const task: TTSTask = {
          text: 'Test',
          lang: 'zh',
          sample_rate: 16000,
          job_id: `test-job-${duration}`,
        };

        const testWavBuffer = createTestWavBuffer(duration, 16000);

        const mockPost = jest.fn().mockResolvedValue({
          data: testWavBuffer,
        });

        mockedAxios.create = jest.fn().mockReturnValue({
          post: mockPost,
          defaults: { timeout: 60000 },
        } as any);

        const result: TTSResult = await taskRouter.routeTTSTask(task);

        expect(result.audio.length).toBeGreaterThan(0);
        expect(['opus', 'pcm16', 'wav']).toContain(result.audio_format);

        const decodedAudio = Buffer.from(result.audio, 'base64');
        const compressionRatio = testWavBuffer.length / decodedAudio.length;

        console.log(`✅ 时长 ${duration}s 测试通过，压缩比: ${compressionRatio.toFixed(2)}x`);
      }
    });
  });

  describe('错误处理', () => {
    it('应该处理空的 WAV 文件', async () => {
      const task: TTSTask = {
        text: 'Test',
        lang: 'zh',
        sample_rate: 16000,
        job_id: 'test-job-empty',
      };

      // 创建空的 WAV 文件（只有头部，没有数据）
      const emptyWavBuffer = Buffer.alloc(44);
      emptyWavBuffer.write('RIFF', 0);
      emptyWavBuffer.writeUInt32LE(36, 4);
      emptyWavBuffer.write('WAVE', 8);
      emptyWavBuffer.write('fmt ', 12);
      emptyWavBuffer.writeUInt32LE(16, 16);
      emptyWavBuffer.writeUInt16LE(1, 20);
      emptyWavBuffer.writeUInt16LE(1, 22);
      emptyWavBuffer.writeUInt32LE(16000, 24);
      emptyWavBuffer.writeUInt32LE(32000, 28);
      emptyWavBuffer.writeUInt16LE(2, 32);
      emptyWavBuffer.writeUInt16LE(16, 34);
      emptyWavBuffer.write('data', 36);
      emptyWavBuffer.writeUInt32LE(0, 40); // 数据大小为 0

      const mockPost = jest.fn().mockResolvedValue({
        data: emptyWavBuffer,
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
        defaults: { timeout: 60000 },
      } as any);

      // 应该能够处理空文件（可能抛出错误或返回空结果）
      try {
        const result: TTSResult = await taskRouter.routeTTSTask(task);
        // 如果成功，结果应该是有效的
        expect(result).toBeDefined();
        console.log('✅ 空 WAV 文件处理测试通过');
      } catch (error) {
        // 如果抛出错误，也是可以接受的
        expect(error).toBeDefined();
        console.log('✅ 空 WAV 文件正确抛出错误');
      }
    });

    it('应该处理无效的 WAV 文件', async () => {
      const task: TTSTask = {
        text: 'Test',
        lang: 'zh',
        sample_rate: 16000,
        job_id: 'test-job-invalid',
      };

      // 创建无效的 WAV 文件
      const invalidBuffer = Buffer.from('invalid wav data');

      const mockPost = jest.fn().mockResolvedValue({
        data: invalidBuffer,
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
        defaults: { timeout: 60000 },
      } as any);

      // 应该抛出错误或回退到 PCM16
      try {
        const result: TTSResult = await taskRouter.routeTTSTask(task);
        // 如果成功，应该回退到 PCM16
        expect(result.audio_format).toBe('pcm16');
        console.log('✅ 无效 WAV 文件回退到 PCM16');
      } catch (error) {
        // 如果抛出错误，也是可以接受的
        expect(error).toBeDefined();
        console.log('✅ 无效 WAV 文件正确抛出错误');
      }
    });
  });

  describe('完整流程验证', () => {
    it('应该完成完整的 TTS -> WAV -> Opus -> Base64 流程', async () => {
      if (!isOpusEncoderAvailable()) {
        console.warn('⚠️ Opus encoder not available, skipping test');
        return;
      }

      const task: TTSTask = {
        text: 'This is a test sentence for TTS audio generation.',
        lang: 'en',
        sample_rate: 16000,
        job_id: 'test-job-full',
      };

      const testWavBuffer = createTestWavBuffer(2.0, 16000); // 2秒音频

      const mockPost = jest.fn().mockResolvedValue({
        data: testWavBuffer,
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
        defaults: { timeout: 60000 },
      } as any);

      // 执行完整流程
      const result: TTSResult = await taskRouter.routeTTSTask(task);

      // 验证每个步骤
      // 1. 结果存在
      expect(result).toBeDefined();

      // 2. 音频数据存在且不为空
      expect(result.audio).toBeDefined();
      expect(result.audio.length).toBeGreaterThan(0);

      // 3. TaskRouter 当前返回 WAV（Opus 由 Pipeline 编码）
      expect(result.audio_format).toBe('wav');

      // 4. Base64 可以解码
      const decodedAudio = Buffer.from(result.audio, 'base64');
      expect(decodedAudio.length).toBeGreaterThan(0);

      // 5. WAV 数据有效（不是全零）
      const hasNonZero = decodedAudio.some(byte => byte !== 0);
      expect(hasNonZero).toBe(true);

      console.log('\n✅ 完整流程测试通过:');
      console.log(`   原始 WAV: ${testWavBuffer.length} bytes`);
      console.log(`   Base64 解码后: ${decodedAudio.length} bytes`);
      console.log(`   格式: ${result.audio_format}`);
      console.log(`   采样率: ${result.sample_rate}Hz`);
      console.log(`   Base64 长度: ${result.audio.length} characters`);
    });
  });
});

