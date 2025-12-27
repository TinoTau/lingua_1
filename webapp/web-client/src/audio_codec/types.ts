/**
 * 音频编解码类型定义
 */

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

