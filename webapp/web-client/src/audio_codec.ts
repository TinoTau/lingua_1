/**
 * 音频编解码模块
 * Phase 2: 支持 Opus 编码
 */

import { OpusEncoder, OpusApplication } from '@minceraftmc/opus-encoder';
import { OpusDecoder } from 'opus-decoder';

export type AudioCodec = 'pcm16' | 'opus';

export interface AudioCodecConfig {
  codec: AudioCodec;
  sampleRate: number;
  channelCount: number;
  bitrate?: number; // Opus 比特率（可选）
}

/**
 * 音频编码器接口
 */
export interface AudioEncoder {
  /**
   * 编码音频数据
   * @param audioData Float32Array 格式的音频数据
   * @returns 编码后的 Uint8Array
   */
  encode(audioData: Float32Array): Promise<Uint8Array>;
  
  /**
   * 刷新编码器，获取剩余数据
   * @returns 剩余的编码数据
   */
  flush(): Promise<Uint8Array>;
  
  /**
   * 重置编码器
   */
  reset(): void;
  
  /**
   * 关闭编码器
   */
  close(): void;
}

/**
 * 音频解码器接口
 */
export interface AudioDecoder {
  /**
   * 解码音频数据
   * @param encodedData 编码后的音频数据
   * @returns 解码后的 Float32Array
   */
  decode(encodedData: Uint8Array): Promise<Float32Array>;
  
  /**
   * 重置解码器
   */
  reset(): void;
  
  /**
   * 关闭解码器
   */
  close(): void;
}

/**
 * PCM16 编码器（无压缩，直接转换）
 */
export class PCM16Encoder implements AudioEncoder {
  async encode(audioData: Float32Array): Promise<Uint8Array> {
    // 将 Float32Array 转换为 Int16Array (PCM16)
    const int16Array = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // 转换为 Uint8Array
    return new Uint8Array(int16Array.buffer);
  }
  
  async flush(): Promise<Uint8Array> {
    return new Uint8Array(0);
  }
  
  reset(): void {
    // PCM16 无需状态
  }
  
  close(): void {
    // PCM16 无需清理
  }
}

/**
 * PCM16 解码器
 */
export class PCM16Decoder implements AudioDecoder {
  async decode(encodedData: Uint8Array): Promise<Float32Array> {
    // 转换为 Int16Array
    const int16Array = new Int16Array(encodedData.buffer);
    
    // 转换为 Float32Array
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    
    return float32Array;
  }
  
  reset(): void {
    // PCM16 无需状态
  }
  
  close(): void {
    // PCM16 无需清理
  }
}

/**
 * Opus 编码器（使用 @minceraftmc/opus-encoder）
 * 注意：这个类主要用于测试，生产环境应该使用 createAudioEncoder
 */
export class OpusEncoderImpl implements AudioEncoder {
  private encoder: OpusEncoder<8000 | 12000 | 16000 | 24000 | 48000> | null = null;
  private config: AudioCodecConfig;
  private isReady: boolean = false;
  
  constructor(config: AudioCodecConfig) {
    this.config = config;
    this.initialize();
  }
  
  private async initialize(): Promise<void> {
    try {
      // 验证采样率
      const validSampleRates = [8000, 12000, 16000, 24000, 48000];
      if (!validSampleRates.includes(this.config.sampleRate)) {
        throw new Error(`Invalid sample rate for Opus: ${this.config.sampleRate}. Valid rates: ${validSampleRates.join(', ')}`);
      }
      
      // 创建编码器实例
      this.encoder = new OpusEncoder({
        sampleRate: this.config.sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
        application: OpusApplication.VOIP, // 使用 VOIP 模式，适合实时语音
      });
      
      // 等待 WASM 编译完成
      await this.encoder.ready;
      this.isReady = true;
      console.log('OpusEncoder initialized', { sampleRate: this.config.sampleRate });
    } catch (error) {
      console.error('Failed to initialize OpusEncoder:', error);
      throw error;
    }
  }
  
  async encode(audioData: Float32Array): Promise<Uint8Array> {
    if (!this.isReady || !this.encoder) {
      // 如果还没准备好，等待初始化
      await this.initialize();
    }
    
    if (!this.encoder) {
      throw new Error('OpusEncoder not initialized');
    }
    
    try {
      // 使用 encodeFrame 方法编码
      const encodedFrame = this.encoder.encodeFrame(audioData);
      return encodedFrame;
    } catch (error) {
      console.error('Opus encoding error:', error);
      throw error;
    }
  }
  
  async flush(): Promise<Uint8Array> {
    // Opus 编码器不需要 flush，返回空数组
    return new Uint8Array(0);
  }
  
  reset(): void {
    if (this.encoder) {
      this.encoder.reset().catch(error => {
        console.error('Failed to reset OpusEncoder:', error);
      });
    }
  }
  
  close(): void {
    if (this.encoder) {
      this.encoder.free();
      this.encoder = null;
      this.isReady = false;
    }
  }
}

/**
 * Opus 解码器（使用 opus-decoder）
 * 注意：这个类主要用于测试，生产环境应该使用 createAudioDecoder
 */
export class OpusDecoderImpl implements AudioDecoder {
  private decoder: OpusDecoder | null = null;
  private config: AudioCodecConfig;
  private isReady: boolean = false;
  
  constructor(config: AudioCodecConfig) {
    this.config = config;
    this.initialize();
  }
  
  private async initialize(): Promise<void> {
    try {
      // 验证采样率
      const validSampleRates = [8000, 12000, 16000, 24000, 48000];
      if (!validSampleRates.includes(this.config.sampleRate)) {
        throw new Error(`Invalid sample rate for Opus: ${this.config.sampleRate}. Valid rates: ${validSampleRates.join(', ')}`);
      }
      
      // 创建解码器实例
      this.decoder = new OpusDecoder({
        sampleRate: this.config.sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
        channels: this.config.channelCount,
      });
      
      // 等待 WASM 编译完成
      await this.decoder.ready;
      this.isReady = true;
      console.log('OpusDecoder initialized', { 
        sampleRate: this.config.sampleRate,
        channelCount: this.config.channelCount,
      });
    } catch (error) {
      console.error('Failed to initialize OpusDecoder:', error);
      throw error;
    }
  }
  
  async decode(encodedData: Uint8Array): Promise<Float32Array> {
    if (!this.isReady || !this.decoder) {
      // 如果还没准备好，等待初始化
      await this.initialize();
    }
    
    if (!this.decoder) {
      throw new Error('OpusDecoder not initialized');
    }
    
    try {
      // 使用 decodeFrame 方法解码
      const decoded = this.decoder.decodeFrame(encodedData);
      
      // 返回第一个通道的数据（单声道）或合并所有通道
      if (decoded.channelData.length === 0) {
        throw new Error('No channel data decoded');
      }
      
      // 如果是单声道，直接返回
      if (decoded.channelData.length === 1) {
        return decoded.channelData[0];
      }
      
      // 如果是多声道，合并为单声道（取平均值）
      const merged = new Float32Array(decoded.channelData[0].length);
      for (let i = 0; i < merged.length; i++) {
        let sum = 0;
        for (let ch = 0; ch < decoded.channelData.length; ch++) {
          sum += decoded.channelData[ch][i];
        }
        merged[i] = sum / decoded.channelData.length;
      }
      return merged;
    } catch (error) {
      console.error('Opus decoding error:', error);
      throw error;
    }
  }
  
  reset(): void {
    if (this.decoder) {
      this.decoder.reset().catch(error => {
        console.error('Failed to reset OpusDecoder:', error);
      });
    }
  }
  
  close(): void {
    if (this.decoder) {
      this.decoder.free();
      this.decoder = null;
      this.isReady = false;
    }
  }
}

/**
 * 创建音频编码器
 */
export function createAudioEncoder(config: AudioCodecConfig): AudioEncoder {
  switch (config.codec) {
    case 'pcm16':
      return new PCM16Encoder();
    case 'opus':
      return new OpusEncoderImpl(config);
    default:
      throw new Error(`Unsupported audio codec: ${config.codec}`);
  }
}

/**
 * 创建音频解码器
 */
export function createAudioDecoder(config: AudioCodecConfig): AudioDecoder {
  switch (config.codec) {
    case 'pcm16':
      return new PCM16Decoder();
    case 'opus':
      return new OpusDecoderImpl(config);
    default:
      throw new Error(`Unsupported audio codec: ${config.codec}`);
  }
}

/**
 * 检查浏览器是否支持 Opus
 */
export function isOpusSupported(): boolean {
  // 检查 MediaRecorder 是否支持 Opus
  if (typeof MediaRecorder === 'undefined') {
    return false;
  }
  
  // 检查是否支持 opus 编码格式
  const mimeTypes = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/opus',
  ];
  
  return mimeTypes.some(mimeType => MediaRecorder.isTypeSupported(mimeType));
}

