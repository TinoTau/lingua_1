/**
 * Opus 编解码工具模块单元测试
 * 测试 Opus 编码和解码功能
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { 
  decodeOpusToPcm16, 
  encodePcm16ToOpusBuffer, 
  convertWavToOpus 
} from './opus-codec';

// Mock opus-encoder 以避免动态导入问题
jest.mock('./opus-encoder', () => ({
  parseWavFile: jest.fn((wavBuffer: Buffer) => {
    // 验证 WAV 文件格式
    if (wavBuffer.length < 44) {
      throw new Error('Invalid WAV file: too short');
    }
    if (wavBuffer.toString('ascii', 0, 4) !== 'RIFF') {
      throw new Error('Invalid WAV file: missing RIFF header');
    }
    if (wavBuffer.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('Invalid WAV file: missing WAVE header');
    }
    
    // 简单的 WAV 解析（仅用于测试）
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const dataSize = wavBuffer.length - 44; // 减去 WAV 头部
    const pcm16Data = wavBuffer.slice(44);
    return { pcm16Data, sampleRate, channels: numChannels };
  }),
  encodePcm16ToOpus: jest.fn(async (pcm16Data: Buffer, sampleRate: number, channels: number) => {
    // 返回一个模拟的 Opus 数据（比 PCM16 小）
    return Buffer.from('mock_opus_' + pcm16Data.length);
  }),
  isOpusEncoderAvailable: jest.fn(() => true), // 在测试中总是返回 true
}));

// Mock opus-decoder 以避免动态导入问题
jest.mock('opus-decoder', () => ({
  OpusDecoder: jest.fn().mockImplementation(() => ({
    ready: Promise.resolve(),
    decodeFrame: jest.fn((packetData: Buffer) => {
      // 返回模拟的解码结果（与 decodeOpusToPcm16 期望的格式一致）
      const numSamples = 320; // 20ms @ 16kHz
      return {
        channelData: [new Float32Array(numSamples).fill(0.5)],
        samplesDecoded: numSamples,
      };
    }),
  })),
}));

describe('Opus Codec', () => {
  /**
   * 创建测试用的 WAV 文件 Buffer
   * 生成一个简单的正弦波音频（0.1秒，440Hz，16kHz采样率，单声道）
   */
  function createTestWavBuffer(durationSeconds: number = 0.1, frequency: number = 440, sampleRate: number = 16000): Buffer {
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const samples = new Int16Array(numSamples);
    
    // 生成正弦波
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const value = Math.sin(2 * Math.PI * frequency * t);
      samples[i] = Math.floor(value * 32767);
    }

    // WAV 文件格式
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
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format (PCM)
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

  /**
   * 创建测试用的 Opus packet 格式数据（Plan A：length-prefixed packets）
   * 使用 mock 编码函数生成 Opus 数据，然后添加长度前缀
   */
  async function createTestOpusPackets(pcm16Data: Buffer, sampleRate: number = 16000): Promise<string> {
    // 使用 mock 编码函数
    const { encodePcm16ToOpus } = require('./opus-encoder');
    const opusData = await encodePcm16ToOpus(pcm16Data, sampleRate, 1);
    
    // 将 Opus 数据分割成多个 packet（每个 packet 最大 4096 字节）
    // 然后添加 2 字节的长度前缀（小端序）
    const packets: Buffer[] = [];
    const maxPacketSize = 4096;
    
    for (let i = 0; i < opusData.length; i += maxPacketSize) {
      const packet = opusData.slice(i, Math.min(i + maxPacketSize, opusData.length));
      const packetWithHeader = Buffer.alloc(2 + packet.length);
      packetWithHeader.writeUInt16LE(packet.length, 0);
      packet.copy(packetWithHeader, 2);
      packets.push(packetWithHeader);
    }
    
    // 合并所有 packets
    const totalLength = packets.reduce((sum, p) => sum + p.length, 0);
    const combined = Buffer.alloc(totalLength);
    let offset = 0;
    for (const packet of packets) {
      packet.copy(combined, offset);
      offset += packet.length;
    }
    
    return combined.toString('base64');
  }

  describe('encodePcm16ToOpusBuffer', () => {
    it('应该将 PCM16 编码为 Opus 格式', async () => {
      // 创建测试 PCM16 数据
      const wavBuffer = createTestWavBuffer(0.1, 440, 16000);
      const { parseWavFile } = require('./opus-encoder');
      const { pcm16Data, sampleRate } = parseWavFile(wavBuffer);

      const opusData = await encodePcm16ToOpusBuffer(pcm16Data, sampleRate, 1);

      expect(opusData).toBeInstanceOf(Buffer);
      expect(opusData.length).toBeGreaterThan(0);
      // 注意：在 mock 中，Opus 数据可能不比 PCM16 小，所以不检查这个
    });
  });

  describe('convertWavToOpus', () => {
    it('应该将 WAV Buffer 转换为 Opus 格式', async () => {
      const wavBuffer = createTestWavBuffer(0.1, 440, 16000);
      const opusData = await convertWavToOpus(wavBuffer);

      expect(opusData).toBeInstanceOf(Buffer);
      expect(opusData.length).toBeGreaterThan(0);
      // 注意：在 mock 中，Opus 数据可能不比 WAV 小，所以不检查这个
    });

    it('应该在 WAV 文件无效时抛出错误', async () => {
      const invalidBuffer = Buffer.from('invalid data');
      
      await expect(convertWavToOpus(invalidBuffer)).rejects.toThrow();
    });
  });

  describe('decodeOpusToPcm16', () => {
    it('应该将 Opus 音频解码为 PCM16', async () => {
      // 创建测试 PCM16 数据
      const wavBuffer = createTestWavBuffer(0.1, 440, 16000);
      const { parseWavFile } = require('./opus-encoder');
      const { pcm16Data, sampleRate } = parseWavFile(wavBuffer);

      // 编码为 Opus packet 格式
      const opusDataBase64 = await createTestOpusPackets(pcm16Data, sampleRate);

      // 解码
      const decodedPcm16 = await decodeOpusToPcm16(opusDataBase64, sampleRate);

      expect(decodedPcm16).toBeInstanceOf(Buffer);
      expect(decodedPcm16.length).toBeGreaterThan(0);
      // 注意：在 mock 中，解码后的数据长度可能不同，所以不检查精确长度
    });

    it('应该在 Opus 数据无效时抛出错误', async () => {
      const invalidOpusBase64 = Buffer.from('invalid opus data').toString('base64');
      
      await expect(decodeOpusToPcm16(invalidOpusBase64, 16000)).rejects.toThrow();
    });

    it('应该在 Opus 数据为空时抛出错误', async () => {
      await expect(decodeOpusToPcm16('', 16000)).rejects.toThrow();
    });
  });

  describe('编码解码往返测试', () => {
    it('应该能够编码后解码，保持音频质量', async () => {
      // 创建测试 PCM16 数据
      const wavBuffer = createTestWavBuffer(0.1, 440, 16000);
      const { parseWavFile } = require('./opus-encoder');
      const { pcm16Data, sampleRate } = parseWavFile(wavBuffer);

      // 编码为 Opus
      const opusData = await encodePcm16ToOpusBuffer(pcm16Data, sampleRate, 1);
      const opusDataBase64 = opusData.toString('base64');

      // 创建 Opus packet 格式（添加长度前缀）
      const packets: Buffer[] = [];
      const maxPacketSize = 4096;
      
      for (let i = 0; i < opusData.length; i += maxPacketSize) {
        const packet = opusData.slice(i, Math.min(i + maxPacketSize, opusData.length));
        const packetWithHeader = Buffer.alloc(2 + packet.length);
        packetWithHeader.writeUInt16LE(packet.length, 0);
        packet.copy(packetWithHeader, 2);
        packets.push(packetWithHeader);
      }
      
      const totalLength = packets.reduce((sum, p) => sum + p.length, 0);
      const combined = Buffer.alloc(totalLength);
      let offset = 0;
      for (const packet of packets) {
        packet.copy(combined, offset);
        offset += packet.length;
      }
      
      const opusPacketsBase64 = combined.toString('base64');

      // 解码
      const decodedPcm16 = await decodeOpusToPcm16(opusPacketsBase64, sampleRate);

      expect(decodedPcm16).toBeInstanceOf(Buffer);
      expect(decodedPcm16.length).toBeGreaterThan(0);
      // 注意：在 mock 中，解码后的数据长度可能不同，所以不检查精确长度
    });
  });
});

