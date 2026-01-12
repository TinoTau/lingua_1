/* S2-5: Audio Ring Buffer - 音频环形缓冲区
   用于缓存最近音频，支持二次解码
*/

import logger from '../logger';

export interface AudioChunk {
  audio: string;  // base64 encoded audio
  timestamp: number;  // 时间戳（毫秒）
  startMs: number;  // 音频开始时间（相对于会话开始）
  endMs: number;  // 音频结束时间（相对于会话开始）
  sampleRate: number;  // 采样率
  audioFormat: string;  // 音频格式
}

export interface AudioRef {
  audio: string;  // base64 encoded audio
  startMs?: number;
  endMs?: number;
  sampleRate?: number;
  audioFormat?: string;
}

/**
 * Audio Ring Buffer
 * 缓存最近 5-15 秒的音频，TTL 10 秒
 */
export class AudioRingBuffer {
  private chunks: AudioChunk[] = [];
  private maxDurationMs: number;  // 最大缓存时长（毫秒）
  private ttlMs: number;  // TTL（毫秒）
  private sessionStartTime: number;  // 会话开始时间

  constructor(maxDurationMs: number = 15000, ttlMs: number = 10000) {
    this.maxDurationMs = maxDurationMs;
    this.ttlMs = ttlMs;
    this.sessionStartTime = Date.now();
  }

  /**
   * 添加音频块
   */
  addChunk(
    audio: string,
    durationMs: number,
    sampleRate: number = 16000,
    audioFormat: string = 'pcm16'
  ): void {
    const now = Date.now();
    const relativeTime = now - this.sessionStartTime;
    
    // 计算音频的开始和结束时间
    const startMs = relativeTime;
    const endMs = relativeTime + durationMs;

    const chunk: AudioChunk = {
      audio,
      timestamp: now,
      startMs,
      endMs,
      sampleRate,
      audioFormat,
    };

    this.chunks.push(chunk);

    // 清理过期和超长的音频
    this.cleanup();
  }

  /**
   * 获取指定时间范围的音频引用
   */
  getAudioRef(startMs: number, endMs: number): AudioRef | null {
    // 清理过期音频
    this.cleanup();

    // 查找覆盖指定时间范围的音频块
    const relevantChunks = this.chunks.filter(
      chunk => chunk.startMs <= endMs && chunk.endMs >= startMs
    );

    if (relevantChunks.length === 0) {
      logger.debug(
        {
          requestedStartMs: startMs,
          requestedEndMs: endMs,
          availableChunks: this.chunks.length,
        },
        'S2-5: No audio chunks found for requested time range'
      );
      return null;
    }

    // 如果只有一个块，直接返回
    if (relevantChunks.length === 1) {
      const chunk = relevantChunks[0];
      return {
        audio: chunk.audio,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        sampleRate: chunk.sampleRate,
        audioFormat: chunk.audioFormat,
      };
    }

    // 多个块需要拼接（这里简化处理，返回第一个块）
    // TODO: 如果需要拼接多个块，需要实现音频拼接逻辑
    const firstChunk = relevantChunks[0];
    const lastChunk = relevantChunks[relevantChunks.length - 1];
    
    logger.debug(
      {
        requestedStartMs: startMs,
        requestedEndMs: endMs,
        chunksFound: relevantChunks.length,
        firstChunkStart: firstChunk.startMs,
        lastChunkEnd: lastChunk.endMs,
      },
      'S2-5: Multiple audio chunks found, returning first chunk (simplified)'
    );

    return {
      audio: firstChunk.audio,
      startMs: firstChunk.startMs,
      endMs: lastChunk.endMs,
      sampleRate: firstChunk.sampleRate,
      audioFormat: firstChunk.audioFormat,
    };
  }

  /**
   * 获取最近的音频引用（用于二次解码）
   * 返回最近 N 秒的音频
   */
  getRecentAudioRef(durationSeconds: number = 5): AudioRef | null {
    const now = Date.now();
    const relativeTime = now - this.sessionStartTime;
    const startMs = Math.max(0, relativeTime - durationSeconds * 1000);
    const endMs = relativeTime;

    return this.getAudioRef(startMs, endMs);
  }

  /**
   * 清理过期和超长的音频
   */
  private cleanup(): void {
    const now = Date.now();
    const relativeTime = now - this.sessionStartTime;

    // 1. 清理过期的音频（超过 TTL）
    this.chunks = this.chunks.filter(
      chunk => now - chunk.timestamp < this.ttlMs
    );

    // 2. 清理超长的音频（超过最大缓存时长）
    const oldestAllowedTime = relativeTime - this.maxDurationMs;
    this.chunks = this.chunks.filter(chunk => chunk.endMs >= oldestAllowedTime);

    // 3. 如果仍然超过最大时长，删除最旧的块
    if (this.chunks.length > 0) {
      const oldestTime = Math.min(...this.chunks.map(c => c.startMs));
      const newestTime = Math.max(...this.chunks.map(c => c.endMs));
      const totalDuration = newestTime - oldestTime;

      if (totalDuration > this.maxDurationMs) {
        // 删除最旧的块，直到总时长在限制内
        this.chunks.sort((a, b) => a.startMs - b.startMs);
        while (this.chunks.length > 0) {
          const currentDuration = 
            Math.max(...this.chunks.map(c => c.endMs)) - 
            Math.min(...this.chunks.map(c => c.startMs));
          if (currentDuration <= this.maxDurationMs) {
            break;
          }
          this.chunks.shift();
        }
      }
    }
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.chunks = [];
    this.sessionStartTime = Date.now();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    chunkCount: number;
    totalDurationMs: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    if (this.chunks.length === 0) {
      return {
        chunkCount: 0,
        totalDurationMs: 0,
        oldestTimestamp: null,
        newestTimestamp: null,
      };
    }

    const oldest = Math.min(...this.chunks.map(c => c.startMs));
    const newest = Math.max(...this.chunks.map(c => c.endMs));

    return {
      chunkCount: this.chunks.length,
      totalDurationMs: newest - oldest,
      oldestTimestamp: oldest,
      newestTimestamp: newest,
    };
  }
}

