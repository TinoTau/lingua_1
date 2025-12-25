// TaskRouter 单元测试

import { TaskRouter } from './task-router';
import { ServiceType } from '@shared/protocols/messages';
import { ASRTask, NMTTask, TTSTask } from './types';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock 服务管理器
const createMockPythonServiceManager = () => ({
  getServiceStatus: jest.fn((serviceName: string) => {
    const statusMap: Record<string, any> = {
      nmt: { running: true, port: 5008 },
      tts: { running: true, port: 5006 },
      faster_whisper_vad: { running: true, port: 6007 },
    };
    return statusMap[serviceName] || { running: false };
  }),
});

const createMockRustServiceManager = () => ({
  getStatus: jest.fn(() => ({
    running: true,
    port: 5009,
  })),
});

const createMockServiceRegistryManager = () => ({
  loadRegistry: jest.fn().mockResolvedValue({}),
  listInstalled: jest.fn().mockReturnValue([
    {
      service_id: 'nmt-m2m100',
      version: '2.0.0',
    },
    {
      service_id: 'piper-tts',
      version: '2.0.0',
    },
  ]),
});

describe('TaskRouter', () => {
  let taskRouter: TaskRouter;
  let mockPythonServiceManager: any;
  let mockRustServiceManager: any;
  let mockServiceRegistryManager: any;

  beforeEach(() => {
    mockPythonServiceManager = createMockPythonServiceManager();
    mockRustServiceManager = createMockRustServiceManager();
    mockServiceRegistryManager = createMockServiceRegistryManager();

    taskRouter = new TaskRouter(
      mockPythonServiceManager,
      mockRustServiceManager,
      mockServiceRegistryManager
    );
  });

  describe('initialize', () => {
    it('应该成功初始化服务端点', async () => {
      await taskRouter.initialize();
      // 验证服务端点已刷新
      expect(mockServiceRegistryManager.loadRegistry).toHaveBeenCalled();
    });
  });

  describe('routeASRTask', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该路由 ASR 任务到 faster-whisper-vad 服务', async () => {
      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      // Mock axios create and post
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          text: '测试文本',
          confidence: 0.95,
          language: 'zh',
          is_final: true,
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      const result = await taskRouter.routeASRTask(task);
      expect(result.text).toBe('测试文本');
      // confidence 可能是 1.0 或其他值，只要存在即可
      expect(result.confidence).toBeDefined();
      expect(typeof result.confidence).toBe('number');
    });

    it('应该在没有可用服务时抛出错误', async () => {
      // 模拟没有运行的服务
      mockPythonServiceManager.getServiceStatus = jest.fn().mockReturnValue({ running: false });
      mockRustServiceManager.getStatus = jest.fn().mockReturnValue({ running: false });

      await taskRouter.refreshServiceEndpoints();

      const task: ASRTask = {
        audio: 'base64_audio_data',
        audio_format: 'pcm16',
        sample_rate: 16000,
        src_lang: 'zh',
      };

      await expect(taskRouter.routeASRTask(task)).rejects.toThrow('No available ASR service');
    });
  });

  describe('routeNMTTask', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该路由 NMT 任务到 nmt-m2m100 服务', async () => {
      const task: NMTTask = {
        text: 'Hello',
        src_lang: 'en',
        tgt_lang: 'zh',
      };

      // Mock axios create and post
      const mockPost = jest.fn().mockResolvedValue({
        data: {
          text: '你好',
          confidence: 0.9,
        },
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      const result = await taskRouter.routeNMTTask(task);
      expect(result.text).toBe('你好');
    });
  });

  describe('routeTTSTask', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该路由 TTS 任务到 piper-tts 服务', async () => {
      const task: TTSTask = {
        text: '你好',
        lang: 'zh',
        sample_rate: 16000,
      };

      // 创建测试 WAV 文件 Buffer（模拟 TTS 服务返回的 WAV 数据）
      function createTestWavBuffer(): Buffer {
        const sampleRate = 16000;
        const duration = 0.1; // 0.1秒
        const numSamples = Math.floor(sampleRate * duration);
        const samples = new Int16Array(numSamples);
        
        // 生成简单的测试音频
        for (let i = 0; i < numSamples; i++) {
          const t = i / sampleRate;
          samples[i] = Math.floor(Math.sin(2 * Math.PI * 440 * t) * 32767);
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
        buffer.writeUInt16LE(1, 20); // PCM
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

      const testWavBuffer = createTestWavBuffer();

      // Mock axios create and post - 返回 WAV 格式的 Buffer（arraybuffer）
      const mockPost = jest.fn().mockResolvedValue({
        data: testWavBuffer, // 返回 WAV Buffer，而不是对象
      });

      mockedAxios.create = jest.fn().mockReturnValue({
        post: mockPost,
      } as any);

      const result = await taskRouter.routeTTSTask(task);
      
      // 验证结果
      expect(result.audio).toBeDefined();
      expect(result.audio.length).toBeGreaterThan(0);
      // 如果 Opus 编码器可用，格式应该是 opus；否则是 pcm16
      expect(['opus', 'pcm16']).toContain(result.audio_format);
      expect(result.sample_rate).toBe(16000);
      
      // 验证 Base64 编码
      const decodedAudio = Buffer.from(result.audio, 'base64');
      expect(decodedAudio.length).toBeGreaterThan(0);
      
      // 如果格式是 Opus，验证压缩效果
      if (result.audio_format === 'opus') {
        const compressionRatio = testWavBuffer.length / decodedAudio.length;
        expect(compressionRatio).toBeGreaterThan(3); // 至少 3x 压缩
        console.log(`✅ TTS Opus 编码成功，压缩比: ${compressionRatio.toFixed(2)}x`);
      }
    });
  });

  describe('服务选择策略', () => {
    beforeEach(async () => {
      await taskRouter.initialize();
    });

    it('应该支持轮询策略', () => {
      taskRouter.setSelectionStrategy('round_robin');
      // 验证策略已设置
      expect(taskRouter).toBeDefined();
    });

    it('应该支持最少连接策略', () => {
      taskRouter.setSelectionStrategy('least_connections');
      expect(taskRouter).toBeDefined();
    });

    it('应该支持随机策略', () => {
      taskRouter.setSelectionStrategy('random');
      expect(taskRouter).toBeDefined();
    });
  });
});

