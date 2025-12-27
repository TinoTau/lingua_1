/**
 * PCM16 编解码器单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PCM16Encoder, PCM16Decoder } from '../../src/audio_codec/pcm16_codec';

describe('PCM16Encoder', () => {
  let encoder: PCM16Encoder;

  beforeEach(() => {
    encoder = new PCM16Encoder();
  });

  it('应该能够编码音频数据', async () => {
    const audioData = new Float32Array([0.5, -0.5, 0.0, 1.0, -1.0]);
    const encoded = await encoder.encode(audioData);
    
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBe(audioData.length * 2); // PCM16 每个样本2字节
  });

  it('应该能够刷新编码器', async () => {
    const flushed = await encoder.flush();
    expect(flushed).toBeInstanceOf(Uint8Array);
    expect(flushed.length).toBe(0);
  });

  it('应该能够重置编码器', () => {
    expect(() => encoder.reset()).not.toThrow();
  });

  it('应该能够关闭编码器', () => {
    expect(() => encoder.close()).not.toThrow();
  });
});

describe('PCM16Decoder', () => {
  let decoder: PCM16Decoder;

  beforeEach(() => {
    decoder = new PCM16Decoder();
  });

  it('应该能够解码音频数据', async () => {
    // 创建测试用的 PCM16 数据
    const int16Array = new Int16Array([16384, -16384, 0, 32767, -32768]);
    const encodedData = new Uint8Array(int16Array.buffer);
    
    const decoded = await decoder.decode(encodedData);
    
    expect(decoded).toBeInstanceOf(Float32Array);
    expect(decoded.length).toBe(int16Array.length);
    expect(decoded[0]).toBeCloseTo(0.5, 2);
    expect(decoded[1]).toBeCloseTo(-0.5, 2);
  });

  it('应该能够重置解码器', () => {
    expect(() => decoder.reset()).not.toThrow();
  });

  it('应该能够关闭解码器', () => {
    expect(() => decoder.close()).not.toThrow();
  });
});

