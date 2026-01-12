/**
 * Opus 编解码器模块
 */

import { OpusEncoder, OpusApplication } from '@minceraftmc/opus-encoder';
import { OpusDecoder } from 'opus-decoder';
import { AudioEncoder, AudioDecoder, AudioCodecConfig } from './types';

/**
 * Opus 编码器（使用 @minceraftmc/opus-encoder）
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
      const application = this.config.application === 'voip' 
        ? OpusApplication.VOIP 
        : this.config.application === 'audio'
        ? OpusApplication.AUDIO
        : OpusApplication.VOIP; // 默认使用 VOIP
      
      this.encoder = new OpusEncoder({
        sampleRate: this.config.sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
        application: application,
      });
      
      // 等待 WASM 编译完成
      await this.encoder.ready;
      
      // 设置比特率（如果配置中提供了）
      let bitrateSet = false;
      let bitrateMethod = 'none';
      if (this.config.bitrate) {
        try {
          if (typeof (this.encoder as any).setBitrate === 'function') {
            (this.encoder as any).setBitrate(this.config.bitrate);
            bitrateSet = true;
            bitrateMethod = 'setBitrate()';
            console.log(`[OpusEncoder] ✅ Bitrate set to ${this.config.bitrate} bps using setBitrate()`);
          } else if (typeof (this.encoder as any).bitrate !== 'undefined') {
            (this.encoder as any).bitrate = this.config.bitrate;
            bitrateSet = true;
            bitrateMethod = 'bitrate property';
            console.log(`[OpusEncoder] ✅ Bitrate set to ${this.config.bitrate} bps using bitrate property`);
          } else {
            console.warn(`[OpusEncoder] ⚠️ Does not support setting bitrate, using default`);
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
      await this.initialize();
    }
    
    if (!this.encoder) {
      throw new Error('OpusEncoder not initialized');
    }
    
    try {
      const frameSizeMs = this.config.frameSizeMs || 20;
      const frameSize = Math.floor(this.config.sampleRate * frameSizeMs / 1000);
      const audioDurationMs = (audioData.length / this.config.sampleRate) * 1000;
      
      // 如果数据长度小于等于帧大小，直接编码
      if (audioData.length <= frameSize) {
        if (audioData.length < frameSize) {
          const paddingSamples = frameSize - audioData.length;
          const paddedData = new Float32Array(frameSize);
          paddedData.set(audioData, 0);
          const encoded = this.encoder.encodeFrame(paddedData);
          return encoded;
        }
        const encoded = this.encoder.encodeFrame(audioData);
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
          const frame = audioData.slice(offset, offset + frameSize);
          const encodedFrame = this.encoder.encodeFrame(frame);
          encodedChunks.push(encodedFrame);
          offset += frameSize;
          fullFrames++;
        } else {
          const paddingSamples = frameSize - currentFrameSize;
          totalPaddingSamples += paddingSamples;
          const paddedFrame = new Float32Array(frameSize);
          paddedFrame.set(audioData.slice(offset, offset + currentFrameSize), 0);
          const encodedFrame = this.encoder.encodeFrame(paddedFrame);
          encodedChunks.push(encodedFrame);
          offset += currentFrameSize;
          paddedFrames++;
        }
      }
      
      const totalLength = encodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let resultOffset = 0;
      for (const chunk of encodedChunks) {
        result.set(chunk, resultOffset);
        resultOffset += chunk.length;
      }
      
      return result;
    } catch (error) {
      console.error('Opus encoding error:', error);
      throw error;
    }
  }
  
  async flush(): Promise<Uint8Array> {
    return new Uint8Array(0);
  }

  /**
   * 编码音频数据并返回packet数组（用于Plan A格式）
   */
  async encodePackets(audioData: Float32Array): Promise<Uint8Array[]> {
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
      const frameSizeMs = this.config.frameSizeMs || 20;
      const frameSize = Math.floor(this.config.sampleRate * frameSizeMs / 1000);
      
      console.log(`[OpusEncoder] encodePackets:`, {
        input_samples: audioData.length,
        frame_size: frameSize,
        frame_size_ms: frameSizeMs,
        expected_frames: Math.ceil(audioData.length / frameSize),
      });
      
      const packets: Uint8Array[] = [];
      let offset = 0;
      let frameIndex = 0;
      
      while (offset < audioData.length) {
        const remaining = audioData.length - offset;
        const currentFrameSize = Math.min(frameSize, remaining);
        
        let frame: Float32Array;
        if (currentFrameSize === frameSize) {
          frame = audioData.slice(offset, offset + frameSize);
        } else {
          // 最后一帧不足，进行 padding
          frame = new Float32Array(frameSize);
          frame.set(audioData.slice(offset, offset + currentFrameSize), 0);
          console.log(`[OpusEncoder] Frame ${frameIndex}: padding ${frameSize - currentFrameSize} samples`);
        }
        
        const encodedPacket = this.encoder.encodeFrame(frame);
        
        if (encodedPacket.length === 0) {
          console.warn(`[OpusEncoder] Frame ${frameIndex} encoded to empty packet`);
        } else if (encodedPacket.length > 4000) {
          console.warn(`[OpusEncoder] Frame ${frameIndex} encoded to unusually large packet: ${encodedPacket.length} bytes`);
        }
        
        packets.push(encodedPacket);
        offset += currentFrameSize;
        frameIndex++;
      }
      
      console.log(`[OpusEncoder] encodePackets complete:`, {
        total_packets: packets.length,
        total_encoded_bytes: packets.reduce((sum, p) => sum + p.length, 0),
        packet_lengths: packets.map(p => p.length),
      });
      
      return packets;
    } catch (error) {
      console.error('[OpusEncoder] Encoding error:', error);
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
      const validSampleRates = [8000, 12000, 16000, 24000, 48000];
      if (!validSampleRates.includes(this.config.sampleRate)) {
        throw new Error(`Invalid sample rate for Opus: ${this.config.sampleRate}. Valid rates: ${validSampleRates.join(', ')}`);
      }
      
      this.decoder = new OpusDecoder({
        sampleRate: this.config.sampleRate as 8000 | 12000 | 16000 | 24000 | 48000,
        channels: this.config.channelCount,
      });
      
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
      await this.initialize();
    }
    
    if (!this.decoder) {
      throw new Error('OpusDecoder not initialized');
    }
    
    try {
      // 尝试使用 decode() 方法（如果支持多个帧）
      if (typeof (this.decoder as any).decode === 'function') {
        try {
          const decoded = (this.decoder as any).decode(encodedData);
          if (decoded && decoded.channelData && decoded.channelData.length > 0) {
            if (decoded.channelData.length === 1) {
              return decoded.channelData[0];
            }
            // 多声道合并
            const merged = new Float32Array(decoded.channelData[0].length);
            for (let i = 0; i < merged.length; i++) {
              let sum = 0;
              for (let ch = 0; ch < decoded.channelData.length; ch++) {
                sum += decoded.channelData[ch][i];
              }
              merged[i] = sum / decoded.channelData.length;
            }
            return merged;
          }
        } catch (e) {
          // decode() 方法不支持，回退到帧分割逻辑
          console.log('[OpusDecoder] decode() method not supported, using frame splitting');
        }
      }
      
      // 帧分割逻辑：节点端在每个 Opus 帧前添加了 2 字节的长度前缀（小端序）
      // 使用长度前缀来分割多个帧
      const decodedChunks: Float32Array[] = [];
      let offset = 0;
      let frameIndex = 0;
      const frameHeaderSize = 2; // 帧长度前缀的大小（字节）
      
      while (offset < encodedData.length) {
        // 检查是否有足够的数据读取帧长度前缀
        if (encodedData.length - offset < frameHeaderSize) {
          console.warn(`[OpusDecoder] Remaining data too small for frame header at offset ${offset}, skipping`);
          break;
        }
        
        // 读取帧长度前缀（2 字节，小端序）
        const frameSize = (encodedData[offset] | (encodedData[offset + 1] << 8));
        offset += frameHeaderSize;
        
        // 检查帧长度是否合理
        if (frameSize === 0 || frameSize > 65535) {
          console.warn(`[OpusDecoder] Invalid frame size: ${frameSize} at offset ${offset - frameHeaderSize}`);
          break;
        }
        
        // 检查是否有足够的数据读取帧数据
        if (encodedData.length - offset < frameSize) {
          console.warn(`[OpusDecoder] Not enough data for frame ${frameIndex}: need ${frameSize} bytes, have ${encodedData.length - offset} bytes`);
          break;
        }
        
        // 提取帧数据
        const frameData = encodedData.slice(offset, offset + frameSize);
        offset += frameSize;
        
        try {
          // 解码帧
          const decoded = this.decoder.decodeFrame(frameData);
          
          if (!decoded || !decoded.channelData || decoded.channelData.length === 0) {
            console.warn(`[OpusDecoder] Frame ${frameIndex} decoded to empty data`);
            continue;
          }
          
          // 提取解码后的音频数据
          let audioData: Float32Array;
          if (decoded.channelData.length === 1) {
            audioData = decoded.channelData[0];
          } else {
            // 多声道合并
            audioData = new Float32Array(decoded.channelData[0].length);
            for (let i = 0; i < audioData.length; i++) {
              let sum = 0;
              for (let ch = 0; ch < decoded.channelData.length; ch++) {
                sum += decoded.channelData[ch][i];
              }
              audioData[i] = sum / decoded.channelData.length;
            }
          }
          
          decodedChunks.push(audioData);
          frameIndex++;
        } catch (e) {
          console.error(`[OpusDecoder] Failed to decode frame ${frameIndex}:`, e);
          // 继续处理下一个帧
          continue;
        }
      }
      
      if (decodedChunks.length === 0) {
        throw new Error('No valid Opus frames found in data');
      }
      
      // 合并所有解码后的音频块
      const totalLength = decodedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const merged = new Float32Array(totalLength);
      let mergedOffset = 0;
      for (const chunk of decodedChunks) {
        merged.set(chunk, mergedOffset);
        mergedOffset += chunk.length;
      }
      
      console.log(`[OpusDecoder] Decoded ${decodedChunks.length} frames, total samples: ${merged.length}`);
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

