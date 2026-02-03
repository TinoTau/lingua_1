/**
 * AudioAggregator buffer 生命周期：创建、删除、过期清理与空输入判定
 * 从 audio-aggregator.ts 抽离，不改变任何逻辑与返回值。
 */

import type { JobAssignMessage } from '@shared/protocols/messages';
import logger from '../logger';
import { AudioBuffer } from './audio-aggregator-types';

/**
 * 获取或创建缓冲区（从 audio-aggregator.processAudioChunk 迁出）
 * 若 buffer 处于 FINALIZING/CLOSED 则创建新 epoch 的 buffer。
 */
export function getOrCreateBuffer(
  buffers: Map<string, AudioBuffer>,
  bufferKey: string,
  job: JobAssignMessage,
  nowMs: number
): AudioBuffer {
  const sessionId = job.session_id;
  const utteranceIndex = job.utterance_index ?? 0;
  let buffer = buffers.get(bufferKey);

  if (!buffer) {
    logger.info(
      {
        jobId: job.job_id,
        bufferKey,
        sessionId,
        utteranceIndex,
        epoch: 0,
        state: 'OPEN',
        reason: 'Buffer not found, creating new buffer',
      },
      'AudioAggregator: Creating new buffer'
    );
    buffer = createEmptyBuffer(bufferKey, sessionId, utteranceIndex, nowMs, 0);
    buffers.set(bufferKey, buffer);
    return buffer;
  }

  if (buffer.state === 'FINALIZING' || buffer.state === 'CLOSED') {
    const newEpoch = buffer.epoch + 1;
    logger.warn(
      {
        jobId: job.job_id,
        bufferKey,
        oldEpoch: buffer.epoch,
        newEpoch,
        oldState: buffer.state,
        reason: 'Buffer in FINALIZING/CLOSED state, switching to new epoch',
      },
      'AudioAggregator: [StateMachine] Buffer in finalizing/closed state, switching epoch'
    );
    buffer = createEmptyBuffer(bufferKey, sessionId, utteranceIndex, nowMs, newEpoch);
    buffers.set(bufferKey, buffer);
    return buffer;
  }

  buffer.lastWriteAt = nowMs;
  logger.debug(
    {
      jobId: job.job_id,
      bufferKey,
      epoch: buffer.epoch,
      state: buffer.state,
      sessionId,
      utteranceIndex,
      hasPendingTimeoutAudio: !!buffer.pendingTimeoutAudio,
      hasPendingSmallSegments: buffer.pendingSmallSegments.length > 0,
      chunkCount: buffer.audioChunks.length,
      totalDurationMs: buffer.totalDurationMs,
      reason: 'Buffer found, checking state',
    },
    'AudioAggregator: [Debug] Buffer found, checking state'
  );
  return buffer;
}

/** 创建空 buffer（新建或新 epoch）的统一样式 */
export function createEmptyBuffer(
  bufferKey: string,
  sessionId: string,
  utteranceIndex: number,
  nowMs: number,
  epoch: number
): AudioBuffer {
  return {
    state: 'OPEN',
    epoch,
    bufferKey,
    audioChunks: [],
    totalDurationMs: 0,
    startTimeMs: nowMs,
    lastChunkTimeMs: nowMs,
    lastWriteAt: nowMs,
    isManualCut: false,
    isTimeoutTriggered: false,
    sessionId,
    utteranceIndex,
    pendingSmallSegments: [],
    pendingSmallSegmentsJobInfo: [],
    originalJobInfo: [],
  };
}

/**
 * 是否应因「当前为空且无 pending/buffer 音频」返回 EMPTY_INPUT
 * 与主流程中多处空音频检查条件一致，不改变分支与返回值。
 */
export function shouldReturnEmptyInput(
  buffer: AudioBuffer,
  currentAudio: Buffer,
  currentDurationMs: number
): boolean {
  if (currentAudio.length !== 0 || currentDurationMs !== 0) {
    return false;
  }
  const hasPendingTimeoutAudio = !!buffer.pendingTimeoutAudio;
  const hasPendingSmallSegments = buffer.pendingSmallSegments.length > 0;
  const hasBufferAudio = buffer.audioChunks.length > 0 || buffer.totalDurationMs > 0;
  return !hasPendingTimeoutAudio && !hasPendingSmallSegments && !hasBufferAudio;
}

/**
 * 从 Map 中删除 buffer 并打日志（与原 deleteBuffer 行为一致）
 */
export function deleteBufferFromMap(
  buffers: Map<string, AudioBuffer>,
  bufferKey: string,
  buffer: AudioBuffer | undefined,
  reason: string,
  nowMs: number
): void {
  const target = buffer ?? buffers.get(bufferKey);
  if (!target) {
    return;
  }

  const pendingTimeoutAudioLength = target.pendingTimeoutAudio?.length || 0;
  const pendingSmallSegmentsCount = target.pendingSmallSegments.length;

  logger.info(
    {
      bufferKey,
      epoch: target.epoch,
      state: target.state,
      reason,
      decisionBranch: 'DELETE_BUFFER',
      pendingTimeoutAudioLength,
      pendingSmallSegmentsCount,
      hasPendingTimeout: !!target.pendingTimeoutAudio,
      hasPendingSmallSegments: target.pendingSmallSegments.length > 0,
      lastWriteAt: target.lastWriteAt,
      lastFinalizeAt: target.lastFinalizeAt,
    },
    'AudioAggregator: [BufferDelete] Buffer deleted with reason and pending status'
  );

  target.state = 'CLOSED';
  buffers.delete(bufferKey);
}

export interface CleanupExpiredBuffersOptions {
  /** pending 超过 TTL 的倍数视为过期（实际比较 pendingAgeMs >= pendingTtlMs * 2） */
  pendingTtlMs: number;
  /** 缓冲区最大空闲时间（毫秒） */
  maxIdleMs: number;
}

/**
 * 清理过期 buffer（与原 cleanupExpiredBuffers 行为一致）
 */
export function cleanupExpiredBuffersFromMap(
  buffers: Map<string, AudioBuffer>,
  options: CleanupExpiredBuffersOptions
): void {
  const { pendingTtlMs, maxIdleMs } = options;
  const nowMs = Date.now();
  const expiredBufferKeys: string[] = [];

  for (const [bufferKey, buffer] of buffers.entries()) {
    const lastActivityMs = buffer.lastChunkTimeMs;
    const idleTimeMs = nowMs - lastActivityMs;

    let shouldCleanup = false;
    if (buffer.pendingTimeoutAudio && buffer.pendingTimeoutAudioCreatedAt) {
      const pendingAgeMs = nowMs - buffer.pendingTimeoutAudioCreatedAt;
      if (pendingAgeMs >= pendingTtlMs * 2) {
        shouldCleanup = true;
      }
    }
    if (idleTimeMs >= maxIdleMs) {
      shouldCleanup = true;
    }

    if (shouldCleanup) {
      expiredBufferKeys.push(bufferKey);
    }
  }

  for (const bufferKey of expiredBufferKeys) {
    const buffer = buffers.get(bufferKey);
    if (buffer) {
      const pendingTimeoutAudioLength = buffer.pendingTimeoutAudio?.length || 0;
      const pendingSmallSegmentsCount = buffer.pendingSmallSegments.length;
      const idleTimeMs = nowMs - buffer.lastChunkTimeMs;
      const pendingTimeoutAudioAge = buffer.pendingTimeoutAudioCreatedAt
        ? nowMs - buffer.pendingTimeoutAudioCreatedAt
        : 0;

      logger.info(
        {
          bufferKey,
          decisionBranch: 'CLEANUP_EXPIRED_BUFFER',
          idleTimeMs,
          pendingTimeoutAudioAge,
          pendingTimeoutAudioLength,
          pendingSmallSegmentsCount,
          chunkCount: buffer.audioChunks.length,
          totalDurationMs: buffer.totalDurationMs,
          reason: `Buffer expired (idle: ${idleTimeMs}ms, pendingTimeoutAudio age: ${pendingTimeoutAudioAge}ms)`,
        },
        'AudioAggregator: [BufferDelete] Expired buffer cleaned up'
      );
      buffers.delete(bufferKey);
    }
  }
}
