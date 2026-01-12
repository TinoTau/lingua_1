/**
 * Opus 编码器单元测试
 * 测试 WAV 解析和 PCM16 到 Opus 编码功能
 */

import { describe, it, expect } from '@jest/globals';
import { parseWavFile, encodePcm16ToOpus, isOpusEncoderAvailable } from './opus-encoder';

describe('Opus Encoder', () => {
  /**
   * 创建测试用的 WAV 文件 Buffer
   * 生成一个简单的正弦波音频（1秒，440Hz，16kHz采样率，单声道）
   */
  function createTestWavBuffer(durationSeconds: number = 1.0, frequency: number = 440, sampleRate: number = 16000): Buffer {
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

  describe('parseWavFile', () => {
    it('应该正确解析有效的 WAV 文件', () => {
      const wavBuffer = createTestWavBuffer(0.1, 440, 16000);
      const result = parseWavFile(wavBuffer);

      expect(result.sampleRate).toBe(16000);
      expect(result.channels).toBe(1);
      expect(result.pcm16Data.length).toBeGreaterThan(0);
    });

    it('应该正确解析不同采样率的 WAV 文件', () => {
      const wavBuffer = createTestWavBuffer(0.1, 440, 22050);
      const result = parseWavFile(wavBuffer);

      expect(result.sampleRate).toBe(22050);
      expect(result.channels).toBe(1);
    });

    it('应该在 WAV 文件无效时抛出错误', () => {
      const invalidBuffer = Buffer.from('invalid data');
      
      expect(() => {
        parseWavFile(invalidBuffer);
      }).toThrow();
    });

    it('应该在 WAV 文件太短时抛出错误', () => {
      const shortBuffer = Buffer.alloc(20);
      
      expect(() => {
        parseWavFile(shortBuffer);
      }).toThrow('too short');
    });
  });

  describe('encodePcm16ToOpus', () => {
    it('应该检查 Opus 编码器是否可用', () => {
      const available = isOpusEncoderAvailable();
      console.log(`Opus encoder available: ${available}`);
      
      // 如果编码器不可用，跳过编码测试
      if (!available) {
        console.warn('Opus encoder not available, skipping encoding tests');
        return;
      }
    });

    it('应该将 PCM16 编码为 Opus 格式', () => {
      if (!isOpusEncoderAvailable()) {
        console.warn('Skipping: Opus encoder not available');
        return;
      }

      // 创建测试 WAV 文件
      const wavBuffer = createTestWavBuffer(0.5, 440, 16000);
      const { pcm16Data, sampleRate } = parseWavFile(wavBuffer);

      // 编码为 Opus
      const opusData = encodePcm16ToOpus(pcm16Data, sampleRate, 1);

      // 验证结果
      expect(opusData).toBeInstanceOf(Buffer);
      expect(opusData.length).toBeGreaterThan(0);
      expect(opusData.length).toBeLessThan(pcm16Data.length); // Opus 应该比 PCM16 小

      const compressionRatio = pcm16Data.length / opusData.length;
      console.log(`Compression ratio: ${compressionRatio.toFixed(2)}x`);
      console.log(`Original size: ${pcm16Data.length} bytes`);
      console.log(`Opus size: ${opusData.length} bytes`);
    });

    it('应该在采样率不支持时使用最接近的支持值', () => {
      if (!isOpusEncoderAvailable()) {
        console.warn('Skipping: Opus encoder not available');
        return;
      }

      // 创建 22050 Hz 的 WAV 文件（Opus 不支持，应该使用 24000）
      const wavBuffer = createTestWavBuffer(0.1, 440, 22050);
      const { pcm16Data, sampleRate } = parseWavFile(wavBuffer);

      // 编码应该成功（会自动调整采样率）
      const opusData = encodePcm16ToOpus(pcm16Data, sampleRate, 1);
      expect(opusData.length).toBeGreaterThan(0);
    });

    it('应该在编码器不可用时抛出错误', () => {
      // 这个测试需要模拟编码器不可用的情况
      // 由于我们无法轻易模拟，这里只测试错误消息
      if (isOpusEncoderAvailable()) {
        console.log('Opus encoder is available, cannot test error case');
        return;
      }

      const wavBuffer = createTestWavBuffer(0.1, 440, 16000);
      const { pcm16Data } = parseWavFile(wavBuffer);

      expect(() => {
        encodePcm16ToOpus(pcm16Data, 16000, 1);
      }).toThrow('Opus encoder is not available');
    });
  });

  describe('集成测试：WAV -> PCM16 -> Opus', () => {
    it('应该能够完整处理 WAV 文件到 Opus 的转换', () => {
      if (!isOpusEncoderAvailable()) {
        console.warn('Skipping: Opus encoder not available');
        return;
      }

      // 创建测试 WAV 文件
      const wavBuffer = createTestWavBuffer(1.0, 440, 16000);
      
      // 步骤1: 解析 WAV
      const { pcm16Data, sampleRate, channels } = parseWavFile(wavBuffer);
      expect(pcm16Data.length).toBeGreaterThan(0);
      expect(sampleRate).toBe(16000);
      expect(channels).toBe(1);

      // 步骤2: 编码为 Opus
      const opusData = encodePcm16ToOpus(pcm16Data, sampleRate, channels);
      expect(opusData.length).toBeGreaterThan(0);
      expect(opusData.length).toBeLessThan(pcm16Data.length);

      // 步骤3: 转换为 base64（模拟实际使用）
      const opusBase64 = opusData.toString('base64');
      expect(opusBase64.length).toBeGreaterThan(0);

      console.log('✅ Integration test passed:');
      console.log(`  WAV size: ${wavBuffer.length} bytes`);
      console.log(`  PCM16 size: ${pcm16Data.length} bytes`);
      console.log(`  Opus size: ${opusData.length} bytes`);
      console.log(`  Compression: ${(pcm16Data.length / opusData.length).toFixed(2)}x`);
      console.log(`  Base64 length: ${opusBase64.length} characters`);
    });
  });
});

