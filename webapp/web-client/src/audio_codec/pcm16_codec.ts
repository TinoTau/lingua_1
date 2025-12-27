/**
 * PCM16 编解码器模块
 */

import { AudioEncoder, AudioDecoder } from './types';

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

