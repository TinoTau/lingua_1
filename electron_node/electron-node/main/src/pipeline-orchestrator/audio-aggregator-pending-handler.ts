/**
 * Audio Aggregator - Pending Second Half Handler
 * 处理保留的后半句音频
 */

import logger from '../logger';
import { JobAssignMessage } from '../../../../shared/protocols/messages';

export interface AudioBuffer {
  audioChunks: Buffer[];
  totalDurationMs: number;
  startTimeMs: number;
  lastChunkTimeMs: number;
  isManualCut: boolean;
  isPauseTriggered: boolean;
  isTimeoutTriggered: boolean;
  sessionId: string;
  utteranceIndex: number;
  pendingSecondHalf?: Buffer;
  pendingSecondHalfCreatedAt?: number;
  shortUtteranceWaitUntil?: number;
  shortUtteranceJobId?: string;
}

export interface PendingMergeResult {
  currentAudio: Buffer;
  durationMs: number;
}

/**
 * 处理保留的后半句音频
 */
export function handlePendingSecondHalf(
  job: JobAssignMessage,
  buffer: AudioBuffer,
  currentAudio: Buffer,
  currentDurationMs: number,
  sampleRate: number,
  bytesPerSample: number,
  pendingSecondHalfTtlMs: number,
  pendingSecondHalfMaxDurationMs: number,
  nowMs: number
): PendingMergeResult {
  const sessionId = job.session_id;
  
  // 如果有保留的后半句，先与当前音频合并
  if (buffer.pendingSecondHalf) {
    // 优化：检查TTL和长度上限
    const pendingAge = buffer.pendingSecondHalfCreatedAt
      ? nowMs - buffer.pendingSecondHalfCreatedAt
      : 0;
    const pendingDurationMs = (buffer.pendingSecondHalf.length / bytesPerSample / sampleRate) * 1000;

    const shouldFlushPending =
      pendingAge > pendingSecondHalfTtlMs ||
      pendingDurationMs > pendingSecondHalfMaxDurationMs;

    if (shouldFlushPending) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          pendingAge,
          pendingDurationMs,
          reason: pendingAge > pendingSecondHalfTtlMs ? 'TTL exceeded' : 'Max duration exceeded',
        },
        'AudioAggregator: Flushing pending second half due to TTL or max duration'
      );
      // 将pendingSecondHalf作为独立音频处理，不合并
      // 这里我们将其添加到当前音频之前
      const mergedAudio = Buffer.alloc(buffer.pendingSecondHalf.length + currentAudio.length);
      buffer.pendingSecondHalf.copy(mergedAudio, 0);
      currentAudio.copy(mergedAudio, buffer.pendingSecondHalf.length);
      currentAudio = mergedAudio;
      currentDurationMs = (currentAudio.length / bytesPerSample / sampleRate) * 1000;
      buffer.pendingSecondHalf = undefined;
      buffer.pendingSecondHalfCreatedAt = undefined;
    } else {
      logger.info(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          pendingSecondHalfLength: buffer.pendingSecondHalf.length,
          currentAudioLength: currentAudio.length,
          pendingAge,
        },
        'AudioAggregator: Merging pending second half with current audio'
      );
      // 将保留的后半句与当前音频合并
      const mergedAudio = Buffer.alloc(buffer.pendingSecondHalf.length + currentAudio.length);
      buffer.pendingSecondHalf.copy(mergedAudio, 0);
      currentAudio.copy(mergedAudio, buffer.pendingSecondHalf.length);
      currentAudio = mergedAudio;
      currentDurationMs = (currentAudio.length / bytesPerSample / sampleRate) * 1000;
      buffer.pendingSecondHalf = undefined; // 清空保留的后半句
      buffer.pendingSecondHalfCreatedAt = undefined;
    }
  }
  
  return {
    currentAudio,
    durationMs: currentDurationMs,
  };
}
