/**
 * Aggregator Middleware Audio Handler
 * 处理音频缓存相关的逻辑
 */

import logger from '../logger';
import { AudioRingBuffer } from '../asr/audio-ring-buffer';

export class AudioHandler {
  private audioBuffers: Map<string, AudioRingBuffer> = new Map();

  /**
   * 缓存音频
   */
  cacheAudio(
    sessionId: string,
    audio: string,
    audioFormat: string = 'pcm16',
    sampleRate: number = 16000
  ): void {
    try {
      // 获取或创建音频缓冲区
      let buffer = this.audioBuffers.get(sessionId);
      if (!buffer) {
        buffer = new AudioRingBuffer(15000, 10000);  // 15秒缓存，10秒TTL
        this.audioBuffers.set(sessionId, buffer);
      }

      // 估算音频时长（简化：假设是PCM16格式）
      // 实际应该根据音频格式和长度计算
      let durationMs = 0;
      if (audioFormat === 'pcm16' && audio.length > 0) {
        // base64解码后的字节数
        const decodedLength = Buffer.from(audio, 'base64').length;
        // PCM16: 2字节/样本，单声道
        const samples = decodedLength / 2;
        durationMs = (samples / sampleRate) * 1000;
      } else {
        // 其他格式：使用估算值（100ms）
        durationMs = 100;
      }

      // 添加音频块
      buffer.addChunk(audio, durationMs, sampleRate, audioFormat);
    } catch (error) {
      logger.warn(
        {
          error,
          sessionId,
          audioLength: audio?.length || 0,
        },
        'S2-5: Failed to cache audio'
      );
    }
  }

  /**
   * 获取音频引用（用于二次解码）
   */
  getAudioRef(sessionId: string): import('../asr/audio-ring-buffer').AudioRef | null {
    const buffer = this.audioBuffers.get(sessionId);
    if (!buffer) {
      return null;
    }

    // 获取最近5秒的音频（用于二次解码）
    return buffer.getRecentAudioRef(5);
  }

  /**
   * 清理音频缓存
   */
  clearAudio(sessionId: string): void {
    this.audioBuffers.delete(sessionId);
  }

  /**
   * 清理所有音频缓存
   */
  clearAllAudio(): void {
    this.audioBuffers.clear();
  }
}
