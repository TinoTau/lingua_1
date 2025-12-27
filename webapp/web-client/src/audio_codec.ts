/**
 * 音频编解码模块
 * Phase 2: 支持 Opus 编码
 * 
 * 主入口文件，导出所有公共接口
 */

// 导出类型和接口
export type { AudioCodec, AudioCodecConfig, AudioEncoder, AudioDecoder } from './audio_codec/types';

// 导出编解码器实现
export { PCM16Encoder, PCM16Decoder } from './audio_codec/pcm16_codec';
export { OpusEncoderImpl, OpusDecoderImpl } from './audio_codec/opus_codec';

// 导入编解码器实现
import { PCM16Encoder, PCM16Decoder } from './audio_codec/pcm16_codec';
import { OpusEncoderImpl, OpusDecoderImpl } from './audio_codec/opus_codec';
import type { AudioCodecConfig, AudioEncoder, AudioDecoder } from './audio_codec/types';

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

