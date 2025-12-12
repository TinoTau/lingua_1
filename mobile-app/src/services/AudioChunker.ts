/**
 * AudioChunk 打包器
 * 对应 iOS 文档中的 AudioChunker
 * 将 PCM 帧打包成 AudioChunk（每 200-250ms 一个包）
 */

import { AudioChunk } from '../models/AudioChunk';
import { LightweightVAD, VadResult } from './LightweightVAD';

export interface ChunkerConfig {
  chunkDurationMs?: number; // 默认 200ms
  frameDurationMs?: number; // 默认 20ms
  sampleRate?: number; // 默认 16000
}

export type ChunkReadyCallback = (chunk: AudioChunk) => void;

export class AudioChunker {
  private config: Required<ChunkerConfig>;
  private vad: LightweightVAD;
  private frameBuffer: Int16Array[] = [];
  private droppedSilenceMs: number = 0;
  private sequence: number = 0;
  private lastChunkTime: number = 0;
  private onChunkReadyCallback: ChunkReadyCallback | null = null;

  constructor(config: ChunkerConfig = {}) {
    this.config = {
      chunkDurationMs: config.chunkDurationMs || 200,
      frameDurationMs: config.frameDurationMs || 20,
      sampleRate: config.sampleRate || 16000,
    };

    this.vad = new LightweightVAD({
      frameMs: this.config.frameDurationMs,
    });
  }

  /**
   * 设置 chunk 就绪回调
   */
  setOnChunkReady(callback: ChunkReadyCallback | null) {
    this.onChunkReadyCallback = callback;
  }

  /**
   * 处理 PCM 帧
   * @param pcmData PCM 16-bit 数据
   */
  onPcmFrame(pcmData: Int16Array): void {
    const vadResult = this.vad.detect(pcmData);

    // 如果应该丢弃（长时间静音），记录丢弃时长
    if (this.vad.shouldDrop(vadResult)) {
      this.droppedSilenceMs += this.config.frameDurationMs;
      return;
    }

    // 添加到缓冲区
    this.frameBuffer.push(pcmData);

    // 检查是否应该打包
    const now = Date.now();
    const timeSinceLastChunk = now - this.lastChunkTime;

    if (timeSinceLastChunk >= this.config.chunkDurationMs) {
      this.flush();
    }
  }

  /**
   * 立即打包并发送当前缓冲区中的所有帧
   */
  flush(): void {
    if (this.frameBuffer.length === 0) {
      return;
    }

    // 计算总帧数
    const totalSamples = this.frameBuffer.reduce((sum, frame) => sum + frame.length, 0);

    // 合并所有帧
    const chunkData = new Int16Array(totalSamples);
    let offset = 0;
    for (const frame of this.frameBuffer) {
      chunkData.set(frame, offset);
      offset += frame.length;
    }

    // 转换为 Uint8Array（PCM 16-bit = 2 bytes per sample）
    const pcmBytes = new Uint8Array(chunkData.buffer);

    // 创建 AudioChunk
    const chunk: AudioChunk = {
      sequence: this.sequence++,
      timestampMs: Date.now(),
      pcmData: pcmBytes,
      droppedSilenceMs: this.droppedSilenceMs,
    };

    // 重置状态
    this.frameBuffer = [];
    this.droppedSilenceMs = 0;
    this.lastChunkTime = Date.now();

    // 调用回调
    if (this.onChunkReadyCallback) {
      this.onChunkReadyCallback(chunk);
    }
  }

  /**
   * 重置 chunker 状态
   */
  reset(): void {
    this.frameBuffer = [];
    this.droppedSilenceMs = 0;
    this.sequence = 0;
    this.lastChunkTime = 0;
    this.vad.reset();
  }

  /**
   * 获取配置
   */
  getConfig(): Required<ChunkerConfig> {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ChunkerConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    // 更新 VAD 配置
    this.vad.updateConfig({
      frameMs: this.config.frameDurationMs,
    });
  }
}

