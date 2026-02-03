/**
 * 会话管理器 - 音频帧处理逻辑
 * 从 SessionManager 拆出，不改变接口与行为
 */

import { SessionState } from '../types';
import { StateMachine } from '../state_machine';
import { WebSocketClient } from '../websocket_client';
import { logger } from '../logger';

export interface ISessionManagerAudioFrameContext {
  readonly stateMachine: StateMachine;
  readonly wsClient: WebSocketClient;
  getState(): SessionState;
  getIsSessionActive(): boolean;
  getAudioFrameSkipCount(): number;
  setAudioFrameSkipCount(v: number): void;
  getPlaybackFinishedTimestamp(): number | null;
  setPlaybackFinishedTimestamp(v: number | null): void;
  getAudioBuffer(): Float32Array[];
  getFirstAudioFrameAfterPlaybackCallback(): ((timestamp: number) => void) | null;
  setFirstAudioFrameAfterPlaybackCallback(cb: ((timestamp: number) => void) | null): void;
  readonly PLAYBACK_FINISHED_DELAY_MS: number;
  getCurrentUtteranceIndex(): number;
  getHasSentAudioChunksForCurrentUtterance(): boolean;
  getPlaybackFinishedDelayBuffer(): Float32Array[];
  getPlaybackFinishedDelayEndTime(): number | null;
  setPlaybackFinishedDelayEndTime(v: number | null): void;
  getPlaybackFinishedDelayStartTime(): number | null;
  setPlaybackFinishedDelayStartTime(v: number | null): void;
  getCanSendChunks(): boolean;
  readonly TARGET_CHUNK_DURATION_MS: number;
  getSamplesPerFrame(): number | null;
  setSamplesPerFrame(v: number | null): void;
  getFramesPerChunk(): number;
  setFramesPerChunk(v: number): void;
  concatAudioBuffers(buffers: Float32Array[]): Float32Array;
  sendAudioChunk(data: Float32Array, isFinal: boolean): void;
  getSentChunkCountForCurrentUtterance(): number;
  setSentChunkCountForCurrentUtterance(v: number): void;
  setHasSentAudioChunksForCurrentUtterance(v: boolean): void;
}

/**
 * 处理单帧音频：状态检查、缓冲、延迟期、自动发送 chunk
 */
export function processAudioFrame(ctx: ISessionManagerAudioFrameContext, audioData: Float32Array): void {
  const audioFrameTimestamp = Date.now();
  const currentState = ctx.getState();

  if (currentState !== SessionState.INPUT_RECORDING) {
    const skipCount = ctx.getAudioFrameSkipCount() + 1;
    ctx.setAudioFrameSkipCount(skipCount);
    if (skipCount === 1 || skipCount % 100 === 0) {
      logger.warn('SessionManager', '收到音频帧，但状态不是 INPUT_RECORDING，跳过处理', {
        timestamp: audioFrameTimestamp,
        timestampIso: new Date(audioFrameTimestamp).toISOString(),
        currentState,
        isSessionActive: ctx.getIsSessionActive(),
        skippedFrames: skipCount,
      });
    }
    return;
  }

  if (ctx.getAudioFrameSkipCount() > 0) {
    logger.info('SessionManager', '状态已恢复为 INPUT_RECORDING，开始处理音频帧', {
      timestamp: audioFrameTimestamp,
      timestampIso: new Date(audioFrameTimestamp).toISOString(),
      previouslySkippedFrames: ctx.getAudioFrameSkipCount(),
      playbackFinishedTimestamp: ctx.getPlaybackFinishedTimestamp(),
      playbackFinishedTimestampIso: ctx.getPlaybackFinishedTimestamp() ? new Date(ctx.getPlaybackFinishedTimestamp()!).toISOString() : null,
      timeSincePlaybackFinishedMs: ctx.getPlaybackFinishedTimestamp() ? audioFrameTimestamp - ctx.getPlaybackFinishedTimestamp()! : null,
    });
    ctx.setAudioFrameSkipCount(0);
  }

  if (ctx.getPlaybackFinishedTimestamp() !== null && ctx.getAudioFrameSkipCount() === 0 && ctx.getAudioBuffer().length === 0) {
    const timeSincePlaybackFinishedMs = audioFrameTimestamp - ctx.getPlaybackFinishedTimestamp()!;
    logger.info('SessionManager', '🎙️ 播放完成后首次接收到音频帧', {
      audioFrameTimestamp,
      audioFrameTimestampIso: new Date(audioFrameTimestamp).toISOString(),
      playbackFinishedTimestamp: ctx.getPlaybackFinishedTimestamp(),
      playbackFinishedTimestampIso: ctx.getPlaybackFinishedTimestamp() ? new Date(ctx.getPlaybackFinishedTimestamp()!).toISOString() : null,
      timeSincePlaybackFinishedMs,
      timeSincePlaybackFinishedSeconds: (timeSincePlaybackFinishedMs / 1000).toFixed(2),
      expectedDelayMs: ctx.PLAYBACK_FINISHED_DELAY_MS,
      currentUtteranceIndex: ctx.getCurrentUtteranceIndex(),
      hasSentAudioChunks: ctx.getHasSentAudioChunksForCurrentUtterance(),
    });

    const cb = ctx.getFirstAudioFrameAfterPlaybackCallback();
    if (cb) {
      try {
        cb(audioFrameTimestamp);
      } catch (error) {
        logger.error('SessionManager', '首次音频帧回调执行失败', { error });
      }
      ctx.setFirstAudioFrameAfterPlaybackCallback(null);
    }
  }

  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  const rms = Math.sqrt(sum / audioData.length);

  const audioBuffer = ctx.getAudioBuffer();
  audioBuffer.push(new Float32Array(audioData));

  if (ctx.getSamplesPerFrame() === null) {
    ctx.setSamplesPerFrame(audioData.length);
    const frameDurationMs = ctx.getSamplesPerFrame()! / 16;
    const framesPerChunk = Math.max(1, Math.round(ctx.TARGET_CHUNK_DURATION_MS / frameDurationMs));
    ctx.setFramesPerChunk(framesPerChunk);
    logger.info('SessionManager', '初始化chunk切分参数', {
      samplesPerFrame: ctx.getSamplesPerFrame(),
      frameDurationMs: frameDurationMs.toFixed(2),
      targetChunkDurationMs: ctx.TARGET_CHUNK_DURATION_MS,
      framesPerChunk: ctx.getFramesPerChunk(),
    });
  }

  if (audioBuffer.length % 50 === 0) {
    logger.debug('SessionManager', '音频输入统计', {
      bufferLength: audioBuffer.length,
      totalSamples: audioBuffer.reduce((s, buf) => s + buf.length, 0),
      estimatedDurationMs: Math.round(audioBuffer.reduce((s, buf) => s + buf.length, 0) / 16),
      currentFrameRms: rms.toFixed(4),
      utteranceIndex: ctx.getCurrentUtteranceIndex(),
    });
  }

  const now = Date.now();
  if (ctx.getPlaybackFinishedDelayEndTime() !== null && now < ctx.getPlaybackFinishedDelayEndTime()!) {
    ctx.getPlaybackFinishedDelayBuffer().push(new Float32Array(audioData));

    if (ctx.getPlaybackFinishedDelayStartTime() === null) {
      ctx.setPlaybackFinishedDelayStartTime(now);
      const remainingDelayMs = ctx.getPlaybackFinishedDelayEndTime()! - now;
      logger.info('SessionManager', '开始播放完成延迟期间，缓存音频数据', {
        delayStartTime: now,
        delayStartTimeIso: new Date(now).toISOString(),
        delayEndTime: ctx.getPlaybackFinishedDelayEndTime(),
        delayEndTimeIso: ctx.getPlaybackFinishedDelayEndTime() ? new Date(ctx.getPlaybackFinishedDelayEndTime()!).toISOString() : null,
        delayMs: ctx.PLAYBACK_FINISHED_DELAY_MS,
        remainingDelayMs,
        playbackFinishedTimestamp: ctx.getPlaybackFinishedTimestamp(),
        playbackFinishedTimestampIso: ctx.getPlaybackFinishedTimestamp() ? new Date(ctx.getPlaybackFinishedTimestamp()!).toISOString() : null,
        currentUtteranceIndex: ctx.getCurrentUtteranceIndex(),
        hasSentAudioChunks: ctx.getHasSentAudioChunksForCurrentUtterance(),
      });
    }
    return;
  }

  if (ctx.getPlaybackFinishedDelayBuffer().length > 0) {
    const actualDelayMs = now - (ctx.getPlaybackFinishedDelayStartTime() || now);
    const totalCachedSamples = ctx.getPlaybackFinishedDelayBuffer().reduce((s, buf) => s + buf.length, 0);
    const estimatedCachedDurationMs = Math.round(totalCachedSamples / 16);

    logger.info('SessionManager', '播放完成延迟结束，发送缓存的音频数据', {
      delayStartTime: ctx.getPlaybackFinishedDelayStartTime(),
      delayStartTimeIso: ctx.getPlaybackFinishedDelayStartTime() ? new Date(ctx.getPlaybackFinishedDelayStartTime()!).toISOString() : null,
      delayEndTime: now,
      delayEndTimeIso: new Date(now).toISOString(),
      expectedDelayMs: ctx.PLAYBACK_FINISHED_DELAY_MS,
      actualDelayMs,
      cachedFrames: ctx.getPlaybackFinishedDelayBuffer().length,
      cachedSamples: totalCachedSamples,
      estimatedCachedDurationMs,
      audioBufferLengthBefore: audioBuffer.length,
      playbackFinishedTimestamp: ctx.getPlaybackFinishedTimestamp(),
      playbackFinishedTimestampIso: ctx.getPlaybackFinishedTimestamp() ? new Date(ctx.getPlaybackFinishedTimestamp()!).toISOString() : null,
      timeSincePlaybackFinishedMs: ctx.getPlaybackFinishedTimestamp() ? now - ctx.getPlaybackFinishedTimestamp()! : null,
      currentUtteranceIndex: ctx.getCurrentUtteranceIndex(),
      hasSentAudioChunks: ctx.getHasSentAudioChunksForCurrentUtterance(),
    });

    audioBuffer.unshift(...ctx.getPlaybackFinishedDelayBuffer());

    logger.debug('SessionManager', '缓存音频数据已合并到audioBuffer', {
      audioBufferLengthAfter: audioBuffer.length,
      mergedFrames: ctx.getPlaybackFinishedDelayBuffer().length,
    });

    ctx.getPlaybackFinishedDelayBuffer().length = 0;
    ctx.setPlaybackFinishedDelayEndTime(null);
    ctx.setPlaybackFinishedDelayStartTime(null);
  }

  if (!ctx.getCanSendChunks()) {
    return;
  }

  if (audioBuffer.length >= ctx.getFramesPerChunk()) {
    const framesPerChunk = ctx.getFramesPerChunk();
    const chunkFrames = audioBuffer.splice(0, framesPerChunk);
    const chunk = ctx.concatAudioBuffers(chunkFrames);
    const chunkSamples = chunk.length;
    const chunkEstimatedDurationMs = Math.round(chunkSamples / 16);

    ctx.setSentChunkCountForCurrentUtterance(ctx.getSentChunkCountForCurrentUtterance() + 1);

    const isFirstChunkAfterPlayback = !ctx.getHasSentAudioChunksForCurrentUtterance() && ctx.getPlaybackFinishedTimestamp() !== null;
    if (isFirstChunkAfterPlayback && ctx.getPlaybackFinishedTimestamp() !== null) {
      const delayFromPlaybackEndMs = now - ctx.getPlaybackFinishedTimestamp()!;
      const isAbnormalDelay = delayFromPlaybackEndMs > ctx.PLAYBACK_FINISHED_DELAY_MS * 2;
      logger.info('SessionManager', '🎤 首次发送音频chunk（播放结束后）', {
        playbackFinishedTimestamp: ctx.getPlaybackFinishedTimestamp(),
        playbackFinishedTimestampIso: new Date(ctx.getPlaybackFinishedTimestamp()!).toISOString(),
        firstChunkSentTimestamp: now,
        firstChunkSentTimestampIso: new Date(now).toISOString(),
        delayFromPlaybackEndMs,
        delayFromPlaybackEndSeconds: (delayFromPlaybackEndMs / 1000).toFixed(2),
        chunkSize: chunk.length,
        chunkSamples,
        chunkEstimatedDurationMs,
        utteranceIndex: ctx.getCurrentUtteranceIndex(),
        chunkIndexInUtterance: ctx.getSentChunkCountForCurrentUtterance(),
        expectedDelayMs: ctx.PLAYBACK_FINISHED_DELAY_MS,
        isAbnormalDelay,
        warning: isAbnormalDelay ? '⚠️ 延迟异常，可能是旧的 playbackFinishedTimestamp' : undefined,
      });
      ctx.setPlaybackFinishedTimestamp(null);
    }

    if (isFirstChunkAfterPlayback) {
      logger.info('SessionManager', '📤 发送第一批音频chunk到调度服务器', {
        chunkSize: chunk.length,
        chunkSamples,
        chunkEstimatedDurationMs,
        utteranceIndex: ctx.getCurrentUtteranceIndex(),
        timestamp: now,
        timestampIso: new Date(now).toISOString(),
        isFirstChunk: true,
        chunkIndexInUtterance: ctx.getSentChunkCountForCurrentUtterance(),
        playbackFinishedTimestamp: ctx.getPlaybackFinishedTimestamp(),
        playbackFinishedTimestampIso: ctx.getPlaybackFinishedTimestamp() ? new Date(ctx.getPlaybackFinishedTimestamp()!).toISOString() : null,
        timeSincePlaybackFinishedMs: ctx.getPlaybackFinishedTimestamp() ? now - ctx.getPlaybackFinishedTimestamp()! : null,
      });
    } else {
      logger.debug('SessionManager', '发送音频chunk', {
        chunkSize: chunk.length,
        chunkSamples,
        chunkEstimatedDurationMs,
        utteranceIndex: ctx.getCurrentUtteranceIndex(),
        chunkIndexInUtterance: ctx.getSentChunkCountForCurrentUtterance(),
        timestamp: now,
        timestampIso: new Date(now).toISOString(),
        remainingFramesInBuffer: audioBuffer.length,
      });
    }

    const sendChunkStartTimestamp = Date.now();
    ctx.sendAudioChunk(chunk, false);
    const sendChunkEndTimestamp = Date.now();
    if (isFirstChunkAfterPlayback) {
      logger.info('SessionManager', '✅ 第一批音频chunk已调用sendAudioChunk', {
        sendStartTimestamp: sendChunkStartTimestamp,
        sendEndTimestamp: sendChunkEndTimestamp,
        sendDurationMs: sendChunkEndTimestamp - sendChunkStartTimestamp,
        timestampIso: new Date(sendChunkEndTimestamp).toISOString(),
      });
    }
    ctx.setHasSentAudioChunksForCurrentUtterance(true);
  }
}
