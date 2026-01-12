import { describe, it, expect } from 'vitest';
import {
  createAudioEncoder,
  createAudioDecoder,
  PCM16Encoder,
  PCM16Decoder,
  AudioCodecConfig,
  isOpusSupported,
} from '../../src/audio_codec';

describe('Audio Codec', () => {
  describe('PCM16Encoder', () => {
    it('should encode Float32Array to PCM16 correctly', async () => {
      const encoder = new PCM16Encoder();
      
      // 创建测试音频数据（正弦波）
      const sampleCount = 100;
      const audioData = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        audioData[i] = Math.sin((i / sampleCount) * Math.PI * 2);
      }
      
      const encoded = await encoder.encode(audioData);
      
      // 验证编码结果
      expect(encoded.length).toBe(sampleCount * 2); // PCM16 是 16-bit，每个样本 2 字节
      expect(encoded instanceof Uint8Array).toBe(true);
    });

    it('should handle silence correctly', async () => {
      const encoder = new PCM16Encoder();
      const silence = new Float32Array(100).fill(0);
      
      const encoded = await encoder.encode(silence);
      
      // 静音应该编码为全零（或接近零）
      expect(encoded.length).toBe(200); // 100 samples * 2 bytes
      const allZeros = encoded.every(byte => byte === 0 || byte === 0xFF);
      expect(allZeros).toBe(true); // 可能是 0x0000 或 0xFFFF（取决于实现）
    });

    it('should clamp values to valid range', async () => {
      const encoder = new PCM16Encoder();
      
      // 创建超出范围的值
      const audioData = new Float32Array([-2.0, -1.0, 0.0, 1.0, 2.0]);
      
      const encoded = await encoder.encode(audioData);
      
      // 应该成功编码，超出范围的值会被限制
      expect(encoded.length).toBe(10); // 5 samples * 2 bytes
    });

    it('should flush empty data', async () => {
      const encoder = new PCM16Encoder();
      const flushed = await encoder.flush();
      
      expect(flushed.length).toBe(0);
    });

    it('should reset and close without errors', () => {
      const encoder = new PCM16Encoder();
      
      expect(() => encoder.reset()).not.toThrow();
      expect(() => encoder.close()).not.toThrow();
    });
  });

  describe('PCM16Decoder', () => {
    it('should decode PCM16 to Float32Array correctly', async () => {
      const decoder = new PCM16Decoder();
      
      // 创建测试 PCM16 数据
      const pcm16Data = new Uint8Array(20); // 10 samples * 2 bytes
      const int16View = new Int16Array(pcm16Data.buffer);
      for (let i = 0; i < 10; i++) {
        int16View[i] = Math.sin((i / 10) * Math.PI * 2) * 16384; // 约 50% 音量
      }
      
      const decoded = await decoder.decode(pcm16Data);
      
      // 验证解码结果
      expect(decoded.length).toBe(10);
      expect(decoded instanceof Float32Array).toBe(true);
      
      // 验证值在合理范围内
      for (let i = 0; i < decoded.length; i++) {
        expect(decoded[i]).toBeGreaterThanOrEqual(-1);
        expect(decoded[i]).toBeLessThanOrEqual(1);
      }
    });

    it('should decode silence correctly', async () => {
      const decoder = new PCM16Decoder();
      const silence = new Uint8Array(20).fill(0); // 10 samples of silence
      
      const decoded = await decoder.decode(silence);
      
      expect(decoded.length).toBe(10);
      // 所有值应该接近 0
      const allZeros = decoded.every(sample => Math.abs(sample) < 0.001);
      expect(allZeros).toBe(true);
    });

    it('should handle empty data', async () => {
      const decoder = new PCM16Decoder();
      const empty = new Uint8Array(0);
      
      const decoded = await decoder.decode(empty);
      
      expect(decoded.length).toBe(0);
    });

    it('should reset and close without errors', () => {
      const decoder = new PCM16Decoder();
      
      expect(() => decoder.reset()).not.toThrow();
      expect(() => decoder.close()).not.toThrow();
    });
  });

  describe('round-trip encoding/decoding', () => {
    it('should preserve audio data through encode/decode cycle', async () => {
      const encoder = new PCM16Encoder();
      const decoder = new PCM16Decoder();
      
      // 创建测试音频数据
      const original = new Float32Array(100);
      for (let i = 0; i < 100; i++) {
        original[i] = Math.sin((i / 100) * Math.PI * 2) * 0.5;
      }
      
      const encoded = await encoder.encode(original);
      const decoded = await decoder.decode(encoded);
      
      // 验证长度
      expect(decoded.length).toBe(original.length);
      
      // 验证值接近（PCM16 有量化误差）
      for (let i = 0; i < decoded.length; i++) {
        const error = Math.abs(decoded[i] - original[i]);
        expect(error).toBeLessThan(0.01); // 允许小的量化误差
      }
    });
  });

  describe('createAudioEncoder', () => {
    it('should create PCM16 encoder', () => {
      const config: AudioCodecConfig = {
        codec: 'pcm16',
        sampleRate: 16000,
        channelCount: 1,
      };
      
      const encoder = createAudioEncoder(config);
      expect(encoder).toBeInstanceOf(PCM16Encoder);
    });

    it('should throw error for unsupported codec', () => {
      const config: AudioCodecConfig = {
        codec: 'unknown' as any,
        sampleRate: 16000,
        channelCount: 1,
      };
      
      expect(() => createAudioEncoder(config)).toThrow('Unsupported audio codec');
    });
  });

  describe('createAudioDecoder', () => {
    it('should create PCM16 decoder', () => {
      const config: AudioCodecConfig = {
        codec: 'pcm16',
        sampleRate: 16000,
        channelCount: 1,
      };
      
      const decoder = createAudioDecoder(config);
      expect(decoder).toBeInstanceOf(PCM16Decoder);
    });

    it('should throw error for unsupported codec', () => {
      const config: AudioCodecConfig = {
        codec: 'unknown' as any,
        sampleRate: 16000,
        channelCount: 1,
      };
      
      expect(() => createAudioDecoder(config)).toThrow('Unsupported audio codec');
    });
  });

  describe('isOpusSupported', () => {
    it('should return boolean', () => {
      const supported = isOpusSupported();
      expect(typeof supported).toBe('boolean');
    });
  });
});

