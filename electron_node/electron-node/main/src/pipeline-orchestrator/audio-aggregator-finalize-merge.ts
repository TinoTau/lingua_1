/**
 * Finalize 合并逻辑：pendingTimeoutAudio、pendingSmallSegments
 */

import logger from '../logger';
import { AudioBuffer, OriginalJobInfo } from './audio-aggregator-types';
import { JobAssignMessage } from '../../../../shared/protocols/messages';

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;

export function mergePendingTimeoutAudio(
  buffer: AudioBuffer,
  job: JobAssignMessage,
  currentAggregated: Buffer,
  nowMs: number
): { shouldMerge: boolean; mergedAudio?: Buffer; mergedJobInfo?: OriginalJobInfo[] } {
  const pendingUtteranceIndex = buffer.pendingTimeoutJobInfo && buffer.pendingTimeoutJobInfo.length > 0
    ? buffer.pendingTimeoutJobInfo[0].utteranceIndex
    : buffer.utteranceIndex;
  const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;

  if (utteranceIndexDiff > 2) {
    logger.warn(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        pendingUtteranceIndex,
        currentUtteranceIndex: job.utterance_index,
        utteranceIndexDiff,
        action: 'force_finalize_pending',
        reason: 'UtteranceIndex跳跃太大（>2），说明中间有其他独立utterance，强制finalize pendingTimeoutAudio',
      },
      'AudioAggregatorFinalizeHandler: PendingTimeoutAudio跳跃太大，强制finalize pending'
    );
    buffer.pendingTimeoutAudio = undefined;
    buffer.pendingTimeoutAudioCreatedAt = undefined;
    buffer.pendingTimeoutJobInfo = undefined;
    return { shouldMerge: false };
  }

  if (utteranceIndexDiff === 0) {
    logger.warn(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        pendingUtteranceIndex,
        currentUtteranceIndex: job.utterance_index,
        reason: 'UtteranceIndex相同，说明是同一个utterance的重复job，清除pendingTimeoutAudio',
      },
      'AudioAggregatorFinalizeHandler: UtteranceIndex相同，清除pendingTimeoutAudio'
    );
    return { shouldMerge: false };
  }

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      pendingUtteranceIndex,
      currentUtteranceIndex: job.utterance_index,
      utteranceIndexDiff,
      reason: '连续的utteranceIndex，允许合并（超时finalize的正常场景）',
    },
    'AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingTimeoutAudio'
  );

  const pendingAudio = buffer.pendingTimeoutAudio!;
  const mergedAudio = Buffer.concat([pendingAudio, currentAggregated]);
  const pendingDurationMs = (pendingAudio.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  const currentDurationMs = (currentAggregated.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  const mergedDurationMs = (mergedAudio.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  const ageMs = nowMs - (buffer.pendingTimeoutAudioCreatedAt || nowMs);

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      pendingAudioDurationMs: pendingDurationMs,
      currentAudioDurationMs: currentDurationMs,
      mergedAudioDurationMs: mergedDurationMs,
      ageMs,
    },
    'AudioAggregatorFinalizeHandler: Merging pendingTimeoutAudio with current audio'
  );

  const pendingJobInfo = buffer.pendingTimeoutJobInfo || [];
  const currentJobInfo = buffer.originalJobInfo.map((info: OriginalJobInfo) => ({
    ...info,
    startOffset: info.startOffset + pendingAudio.length,
    endOffset: info.endOffset + pendingAudio.length,
  }));
  const mergedJobInfo = [...pendingJobInfo, ...currentJobInfo];
  return { shouldMerge: true, mergedAudio, mergedJobInfo };
}

export function mergePendingSmallSegments(
  buffer: AudioBuffer,
  job: JobAssignMessage,
  currentAudio: Buffer,
  currentJobInfo: OriginalJobInfo[]
): { shouldMerge: boolean; mergedAudio?: Buffer; mergedJobInfo?: OriginalJobInfo[] } {
  const pendingSmallSegmentsUtteranceIndex = buffer.pendingSmallSegmentsJobInfo && buffer.pendingSmallSegmentsJobInfo.length > 0
    ? buffer.pendingSmallSegmentsJobInfo[0].utteranceIndex
    : buffer.utteranceIndex;
  const utteranceIndexDiff = job.utterance_index - pendingSmallSegmentsUtteranceIndex;

  if (utteranceIndexDiff > 2) {
    logger.warn(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        pendingUtteranceIndex: pendingSmallSegmentsUtteranceIndex,
        currentUtteranceIndex: job.utterance_index,
        utteranceIndexDiff,
        reason: 'UtteranceIndex跳跃太大（>2），清除pendingSmallSegments',
      },
      'AudioAggregatorFinalizeHandler: UtteranceIndex跳跃太大，清除pendingSmallSegments'
    );
    return { shouldMerge: false };
  }

  if (utteranceIndexDiff === 0) {
    logger.warn(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        pendingUtteranceIndex: pendingSmallSegmentsUtteranceIndex,
        currentUtteranceIndex: job.utterance_index,
        reason: 'UtteranceIndex相同（重复job），清除pendingSmallSegments',
      },
      'AudioAggregatorFinalizeHandler: UtteranceIndex相同，清除pendingSmallSegments'
    );
    return { shouldMerge: false };
  }

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      pendingUtteranceIndex: pendingSmallSegmentsUtteranceIndex,
      currentUtteranceIndex: job.utterance_index,
      utteranceIndexDiff,
      reason: '连续的utteranceIndex，允许合并',
    },
    'AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingSmallSegments'
  );

  const smallSegmentsAudio = Buffer.concat(buffer.pendingSmallSegments);
  const mergedAudio = Buffer.concat([smallSegmentsAudio, currentAudio]);
  const smallSegmentsDurationMs = (smallSegmentsAudio.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;

  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      utteranceIndex: job.utterance_index,
      smallSegmentsCount: buffer.pendingSmallSegments.length,
      smallSegmentsDurationMs,
      mergedAudioDurationMs: (mergedAudio.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000,
    },
    'AudioAggregatorFinalizeHandler: Merged pendingSmallSegments with current audio'
  );

  const mergedJobInfo = [
    ...buffer.pendingSmallSegmentsJobInfo,
    ...currentJobInfo.map((info: OriginalJobInfo) => ({
      ...info,
      startOffset: info.startOffset + smallSegmentsAudio.length,
      endOffset: info.endOffset + smallSegmentsAudio.length,
    })),
  ];
  return { shouldMerge: true, mergedAudio, mergedJobInfo };
}

