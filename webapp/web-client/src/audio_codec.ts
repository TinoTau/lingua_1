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
  // Opus 特定配置（可选）
  frameSizeMs?: number; // 帧大小（毫秒），默认 20ms
  application?: string; // 应用类型："voip" | "audio" | "lowdelay"，默认 "voip"
  bitrate?: number; // 比特率（可选，单位：bps）
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
  private initPromise: Promise<void> | null = null;
  
  constructor(config: AudioCodecConfig) {
    this.config = config;
    // 异步初始化，但不阻塞构造函数
    this.initPromise = this.initialize();
  }
  
  private async initialize(): Promise<void> {
    try {
      // 验证采样率
      const validSampleRates = [8000, 12000, 16000, 24000, 48000];
      if (!validSampleRates.includes(this.config.sampleRate)) {
        throw new Error(`Invalid sample rate for Opus: ${this.config.sampleRate}. Valid rates: ${validSampleRates.join(', ')}`);
      }
      
      // 创建编码器实例
      // 使用协议规范中的 application（如果提供），否则使用默认值 VOIP
      // 注意：@minceraftmc/opus-encoder 可能只支持 VOIP 和 AUDIO
      const application = this.config.application === 'voip' 
        ? OpusApplication.VOIP 
        : this.config.application === 'audio'
        ? OpusApplication.AUDIO
        : OpusApplication.VOIP; // 默认使用 VOIP（lowdelay 不支持时回退到 VOIP）
      
      this.encoder = new OpusEncoder({
        sampleRate: this.config.sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
        application: application, // 使用协议规范中的 application
      });
      
      // 等待 WASM 编译完成
      await this.encoder.ready;
      
      // 设置比特率（如果配置中提供了）
      // 推荐：16-32 kbps for VOIP，24 kbps 是平衡质量和带宽的好选择
      let bitrateSet = false;
      let bitrateMethod = 'none';
      if (this.config.bitrate) {
        try {
          // @minceraftmc/opus-encoder 可能支持 setBitrate 方法
          if (typeof (this.encoder as any).setBitrate === 'function') {
            (this.encoder as any).setBitrate(this.config.bitrate);
            bitrateSet = true;
            bitrateMethod = 'setBitrate()';
            console.log(`[OpusEncoder] ✅ Bitrate set to ${this.config.bitrate} bps using setBitrate()`);
          } else if (typeof (this.encoder as any).bitrate !== 'undefined') {
            // 如果支持直接设置 bitrate 属性
            (this.encoder as any).bitrate = this.config.bitrate;
            bitrateSet = true;
            bitrateMethod = 'bitrate property';
            console.log(`[OpusEncoder] ✅ Bitrate set to ${this.config.bitrate} bps using bitrate property`);
          } else {
            console.warn(`[OpusEncoder] ⚠️ Does not support setting bitrate (no setBitrate() or bitrate property), using default`);
            console.warn(`[OpusEncoder] ⚠️ Encoder methods:`, Object.getOwnPropertyNames(this.encoder));
            console.warn(`[OpusEncoder] ⚠️ Encoder prototype methods:`, Object.getOwnPropertyNames(Object.getPrototypeOf(this.encoder)));
          }
        } catch (error) {
          console.error(`[OpusEncoder] ❌ Failed to set bitrate:`, error);
          bitrateMethod = 'error';
        }
      } else {
        console.log(`[OpusEncoder] ℹ️ No bitrate configured, using encoder default`);
      }
      
      this.isReady = true;
      console.log('[OpusEncoder] ✅ Initialized successfully', { 
        sampleRate: this.config.sampleRate,
        channelCount: this.config.channelCount,
        application: this.config.application,
        frameSizeMs: this.config.frameSizeMs || 20,
        bitrate: this.config.bitrate || 'default',
        bitrateSet: bitrateSet,
        bitrateMethod: bitrateMethod
      });
    } catch (error) {
      console.error('Failed to initialize OpusEncoder:', error);
      throw error;
    }
  }
  
  async encode(audioData: Float32Array): Promise<Uint8Array> {
    // 确保编码器已初始化
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
    
    if (!this.isReady || !this.encoder) {
      // 如果还没准备好，尝试重新初始化
      await this.initialize();
    }
    
    if (!this.encoder) {
      throw new Error('OpusEncoder not initialized');
    }
    
    try {
      // Opus 编码器需要固定大小的帧
      // 使用协议规范中的 frameSizeMs（如果提供），否则使用默认值 20ms
      const frameSizeMs = this.config.frameSizeMs || 20; // 默认 20ms
      const frameSize = Math.floor(this.config.sampleRate * frameSizeMs / 1000); // 转换为样本数
      const audioDurationMs = (audioData.length / this.config.sampleRate) * 1000;
      
      console.log(`[OpusEncoder] 📊 Encoding audio: input_samples=${audioData.length}, duration=${audioDurationMs.toFixed(2)}ms, frame_size=${frameSize} samples (${frameSizeMs}ms)`);
      
      // 如果数据长度小于等于帧大小，直接编码
      if (audioData.length <= frameSize) {
        // 如果数据长度不足，需要填充到帧大小
        if (audioData.length < frameSize) {
          const paddingSamples = frameSize - audioData.length;
          const paddingMs = (paddingSamples / this.config.sampleRate) * 1000;
          const paddedData = new Float32Array(frameSize);
          paddedData.set(audioData, 0);
          // 剩余部分填充为 0（静音）
          console.log(`[OpusEncoder] ⚠️ Input too short, padding: ${paddingSamples} samples (${paddingMs.toFixed(2)}ms) of silence`);
          const encoded = this.encoder.encodeFrame(paddedData);
          console.log(`[OpusEncoder] ✅ Encoded: input=${audioData.length} samples (${audioDurationMs.toFixed(2)}ms) + ${paddingSamples} padding → output=${encoded.length} bytes`);
          return encoded;
        }
        const encoded = this.encoder.encodeFrame(audioData);
        console.log(`[OpusEncoder] ✅ Encoded: input=${audioData.length} samples (${audioDurationMs.toFixed(2)}ms) → output=${encoded.length} bytes`);
        return encoded;
      }
      
      // 如果数据长度大于帧大小，需要分割成多个帧
      const encodedChunks: Uint8Array[] = [];
      let offset = 0;
      let fullFrames = 0;
      let paddedFrames = 0;
      let totalPaddingSamples = 0;
      
      while (offset < audioData.length) {
        const remaining = audioData.length - offset;
        const currentFrameSize = Math.min(frameSize, remaining);
        
        if (currentFrameSize === frameSize) {
          // 完整帧，直接编码
          const frame = audioData.slice(offset, offset + frameSize);
          const encodedFrame = this.encoder.encodeFrame(frame);
          encodedChunks.push(encodedFrame);
          offset += frameSize;
          fullFrames++;
        } else {
          // 最后一个不完整的帧，需要填充
          const paddingSamples = frameSize - currentFrameSize;
          totalPaddingSamples += paddingSamples;
          const paddedFrame = new Float32Array(frameSize);
          paddedFrame.set(audioData.slice(offset, offset + currentFrameSize), 0);
          // 剩余部分填充为 0（静音）
          const encodedFrame = this.encoder.encodeFrame(paddedFrame);
          encodedChunks.push(encodedFrame);
          offset += currentFrameSize;
          paddedFrames++;
        }
      }
      
      // 返回packet数组（用于Plan A格式）
      // 注意：为了保持向后兼容，仍然返回合并后的数组
      // 但可以通过encodePackets方法获取packet数组
      const totalLength = encodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let resultOffset = 0;
      for (const chunk of encodedChunks) {
        result.set(chunk, resultOffset);
        resultOffset += chunk.length;
      }
      
      const paddingMs = (totalPaddingSamples / this.config.sampleRate) * 1000;
      console.log(`[OpusEncoder] ✅ Encoded: input=${audioData.length} samples (${audioDurationMs.toFixed(2)}ms) → ${fullFrames} full frames + ${paddedFrames} padded frames (${totalPaddingSamples} samples/${paddingMs.toFixed(2)}ms padding) → output=${result.length} bytes (${encodedChunks.length} packets)`);
      
      return result;
    } catch (error) {
      console.error('Opus encoding error:', error, {
        audioDataLength: audioData.length,
        sampleRate: this.config.sampleRate,
        frameSize: Math.floor(this.config.sampleRate * 0.02)
      });
      throw error;
    }
  }
  
  async flush(): Promise<Uint8Array> {
    // Opus 编码器不需要 flush，返回空数组
    return new Uint8Array(0);
  }
  
  /**
   * 编码音频数据并返回packet数组（用于Plan A格式）
   * 每个packet对应一个20ms的音频帧
   * @param audioData 音频数据（Float32Array）
   * @returns packet数组，每个元素是一个Uint8Array（Opus packet）
   */
  async encodePackets(audioData: Float32Array): Promise<Uint8Array[]> {
    // 确保编码器已初始化
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
    
    if (!this.isReady || !this.encoder) {
      await this.initialize();
    }
    
    if (!this.encoder) {
      throw new Error('OpusEncoder not initialized');
    }
    
    try {
      const frameSizeMs = this.config.frameSizeMs || 20; // 默认 20ms
      const frameSize = Math.floor(this.config.sampleRate * frameSizeMs / 1000);
      
      const packets: Uint8Array[] = [];
      let offset = 0;
      
      while (offset < audioData.length) {
        const remaining = audioData.length - offset;
        const currentFrameSize = Math.min(frameSize, remaining);
        
        let frame: Float32Array;
        if (currentFrameSize === frameSize) {
          // 完整帧
          frame = audioData.slice(offset, offset + frameSize);
        } else {
          // 不完整的帧，需要填充
          frame = new Float32Array(frameSize);
          frame.set(audioData.slice(offset, offset + currentFrameSize), 0);
        }
        
        const encodedPacket = this.encoder.encodeFrame(frame);
        packets.push(encodedPacket);
        offset += currentFrameSize;
      }
      
      return packets;
    } catch (error) {
      console.error('Opus encoding error:', error);
      throw error;
    }
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
  private decoder: OpusDecoder<8000 | 12000 | 16000 | 24000 | 48000> | null = null;
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
      if (this.decoder) {
        await this.decoder.ready;
        this.isReady = true;
      }
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

