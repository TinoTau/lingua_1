/**
 * TTS 任务路由 Opus 编码集成测试
 * 测试实际 TTS 任务场景中的 Opus 编码功能
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { TaskRouter } from './task-router';
import { parseWavFile, encodePcm16ToOpus, isOpusEncoderAvailable } from '../utils/opus-encoder';

describe('TaskRouter Opus Encoding Integration', () => {
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

  it('应该能够将 WAV 音频编码为 Opus 格式', () => {
    if (!isOpusEncoderAvailable()) {
      console.warn('⚠️ Opus encoder not available, skipping test');
      return;
    }

    // 创建测试 WAV 文件（模拟 TTS 服务返回）
    const wavBuffer = createTestWavBuffer(2.0, 16000); // 2秒音频，16kHz
    console.log(`📦 Created test WAV: ${wavBuffer.length} bytes`);

    // 解析 WAV 文件
    const { pcm16Data, sampleRate, channels } = parseWavFile(wavBuffer);
    console.log(`📊 Parsed WAV: ${pcm16Data.length} bytes PCM16, ${sampleRate}Hz, ${channels} channels`);

    // 编码为 Opus
    const opusData = encodePcm16ToOpus(pcm16Data, sampleRate, channels);
    console.log(`🎵 Encoded to Opus: ${opusData.length} bytes`);

    // 验证结果
    expect(opusData).toBeInstanceOf(Buffer);
    expect(opusData.length).toBeGreaterThan(0);
    expect(opusData.length).toBeLessThan(pcm16Data.length);

    const compressionRatio = pcm16Data.length / opusData.length;
    const sizeReduction = ((1 - opusData.length / pcm16Data.length) * 100).toFixed(1);
    
    console.log(`\n✅ Opus Encoding Results:`);
    console.log(`   Original WAV: ${wavBuffer.length} bytes`);
    console.log(`   PCM16 data: ${pcm16Data.length} bytes`);
    console.log(`   Opus data: ${opusData.length} bytes`);
    console.log(`   Compression ratio: ${compressionRatio.toFixed(2)}x`);
    console.log(`   Size reduction: ${sizeReduction}%`);

    // 转换为 base64（模拟实际传输）
    const opusBase64 = opusData.toString('base64');
    expect(opusBase64.length).toBeGreaterThan(0);
    console.log(`   Base64 length: ${opusBase64.length} characters`);

    // 验证压缩比应该合理（Opus 通常能达到 3-10x 压缩）
    expect(compressionRatio).toBeGreaterThan(3);
    expect(compressionRatio).toBeLessThan(20);
  });

  it('应该能够处理不同时长的音频', () => {
    if (!isOpusEncoderAvailable()) {
      console.warn('⚠️ Opus encoder not available, skipping test');
      return;
    }

    const durations = [0.5, 1.0, 2.0, 5.0]; // 不同时长

    for (const duration of durations) {
      const wavBuffer = createTestWavBuffer(duration, 16000);
      const { pcm16Data, sampleRate } = parseWavFile(wavBuffer);
      const opusData = encodePcm16ToOpus(pcm16Data, sampleRate, 1);

      const compressionRatio = pcm16Data.length / opusData.length;
      console.log(`Duration ${duration}s: ${pcm16Data.length} -> ${opusData.length} bytes (${compressionRatio.toFixed(2)}x)`);

      expect(opusData.length).toBeGreaterThan(0);
      expect(opusData.length).toBeLessThan(pcm16Data.length);
    }
  });

  it('应该能够处理不同采样率的音频', () => {
    if (!isOpusEncoderAvailable()) {
      console.warn('⚠️ Opus encoder not available, skipping test');
      return;
    }

    const sampleRates = [16000, 22050, 24000]; // 不同采样率

    for (const sampleRate of sampleRates) {
      const wavBuffer = createTestWavBuffer(1.0, sampleRate);
      const { pcm16Data, sampleRate: actualSampleRate } = parseWavFile(wavBuffer);
      
      // Opus 编码应该能够处理（可能会调整采样率）
      const opusData = encodePcm16ToOpus(pcm16Data, actualSampleRate, 1);

      console.log(`Sample rate ${actualSampleRate}Hz: ${pcm16Data.length} -> ${opusData.length} bytes`);

      expect(opusData.length).toBeGreaterThan(0);
    }
  });

  it('应该验证 Opus 数据的有效性', () => {
    if (!isOpusEncoderAvailable()) {
      console.warn('⚠️ Opus encoder not available, skipping test');
      return;
    }

    const wavBuffer = createTestWavBuffer(1.0, 16000);
    const { pcm16Data, sampleRate } = parseWavFile(wavBuffer);
    const opusData = encodePcm16ToOpus(pcm16Data, sampleRate, 1);

    // Opus 数据应该：
    // 1. 不是全零
    const hasNonZero = opusData.some(byte => byte !== 0);
    expect(hasNonZero).toBe(true);

    // 2. 有合理的长度（不应该太小或太大）
    expect(opusData.length).toBeGreaterThan(100); // 至少 100 字节
    expect(opusData.length).toBeLessThan(pcm16Data.length / 2); // 至少压缩 50%

    // 3. Base64 编码后可以解码
    const base64 = opusData.toString('base64');
    const decoded = Buffer.from(base64, 'base64');
    expect(Buffer.compare(opusData, decoded)).toBe(0);

    console.log('✅ Opus data validation passed');
  });
});

