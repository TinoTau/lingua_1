/**
 * 音频管线 Hook
 * 整合音频采集、VAD、Chunker 和 WebSocket 发送
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { AudioCaptureService, AudioFrame } from '../services/AudioCaptureService';
import { LightweightVAD } from '../services/LightweightVAD';
import { AudioChunker, ChunkReadyCallback } from '../services/AudioChunker';
import { AudioChunk } from '../models/AudioChunk';
import { RealtimeClient } from '../services/RealtimeClient';

export interface UseAudioPipelineConfig {
  enabled?: boolean;
  onChunkReady?: (chunk: AudioChunk) => void;
  realtimeClient?: RealtimeClient | null;
}

export function useAudioPipeline(config: UseAudioPipelineConfig = {}) {
  const { enabled = false, onChunkReady, realtimeClient } = config;

  const [isRunning, setIsRunning] = useState(false);
  const captureServiceRef = useRef<AudioCaptureService | null>(null);
  const vadRef = useRef<LightweightVAD | null>(null);
  const chunkerRef = useRef<AudioChunker | null>(null);

  // 初始化服务
  useEffect(() => {
    const captureService = new AudioCaptureService({
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
      frameDurationMs: 20,
    });

    const vad = new LightweightVAD({
      frameMs: 20,
      silenceThresholdDb: -50.0,
      minSilenceMsToDrop: 200,
    });

    const chunker = new AudioChunker({
      chunkDurationMs: 200,
      frameDurationMs: 20,
      sampleRate: 16000,
    });

    captureServiceRef.current = captureService;
    vadRef.current = vad;
    chunkerRef.current = chunker;

    // 设置音频采集回调
    captureService.setOnPcmFrame((frame: AudioFrame) => {
      // 转换为 Int16Array（如果还不是）
      const pcmData = frame.data instanceof Int16Array 
        ? frame.data 
        : new Int16Array(frame.data);

      // VAD 检测
      const vadResult = vad.detect(pcmData);

      // 如果应该保留，传递给 chunker
      if (!vad.shouldDrop(vadResult)) {
        chunker.onPcmFrame(pcmData);
      }
    });

    // 设置 chunker 回调
    const chunkCallback: ChunkReadyCallback = (chunk: AudioChunk) => {
      // 调用外部回调
      if (onChunkReady) {
        onChunkReady(chunk);
      }

      // 如果提供了 realtimeClient，自动发送
      if (realtimeClient && realtimeClient.getIsConnected()) {
        realtimeClient.sendAudioChunk(chunk, false);
      }
    };

    chunker.setOnChunkReady(chunkCallback);

    return () => {
      captureService.stop();
      captureService.setOnPcmFrame(null);
      chunker.setOnChunkReady(null);
    };
  }, [onChunkReady, realtimeClient]);

  // 启动音频管线
  const start = useCallback(async () => {
    if (isRunning) {
      console.warn('音频管线已在运行');
      return;
    }

    try {
      const captureService = captureServiceRef.current;
      if (!captureService) {
        throw new Error('音频采集服务未初始化');
      }

      await captureService.start();
      setIsRunning(true);
      console.log('音频管线已启动');
    } catch (error) {
      console.error('启动音频管线失败:', error);
      throw error;
    }
  }, [isRunning]);

  // 停止音频管线
  const stop = useCallback(async () => {
    if (!isRunning) {
      return;
    }

    try {
      const captureService = captureServiceRef.current;
      const chunker = chunkerRef.current;

      if (captureService) {
        await captureService.stop();
      }

      // 刷新剩余的 chunk
      if (chunker) {
        chunker.flush();
      }

      setIsRunning(false);
      console.log('音频管线已停止');
    } catch (error) {
      console.error('停止音频管线失败:', error);
      throw error;
    }
  }, [isRunning]);

  // 手动截断（立即发送当前 chunk）
  const flush = useCallback(() => {
    const chunker = chunkerRef.current;
    if (chunker) {
      chunker.flush();
    }
  }, []);

  // 根据 enabled 状态自动启动/停止
  useEffect(() => {
    if (enabled && !isRunning) {
      start().catch(console.error);
    } else if (!enabled && isRunning) {
      stop().catch(console.error);
    }
  }, [enabled, isRunning, start, stop]);

  return {
    start,
    stop,
    flush,
    isRunning,
  };
}

