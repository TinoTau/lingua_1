/**
 * AudioAggregator finalize 路径：手动/timeout 时按能量切分并返回
 * 从 audio-aggregator.ts 迁出，仅迁移实现，不改变接口与逻辑。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import logger from '../logger';
import { AudioChunkResult, AudioBuffer, OriginalJobInfo } from './audio-aggregator-types';
import type { AudioAggregatorUtils } from './audio-aggregator-utils';
import type { AudioAggregatorStreamBatcher } from './audio-aggregator-stream-batcher';
import type { AudioAggregatorMerger } from './audio-aggregator-merger';
import type { AudioAggregatorFinalizeHandler } from './audio-aggregator-finalize-handler';

export interface AudioAggregatorFinalizeContext {
  audioUtils: AudioAggregatorUtils;
  streamBatcher: AudioAggregatorStreamBatcher;
  finalizeHandler: AudioAggregatorFinalizeHandler;
  audioMerger: AudioAggregatorMerger;
  BYTES_PER_SAMPLE: number;
  SAMPLE_RATE: number;
  SPLIT_HANGOVER_MS: number;
  deleteBuffer: (bufferKey: string, buffer: AudioBuffer | undefined, reason: string, nowMs: number) => void;
}

/**
 * 执行 finalize 路径：进入 FINALIZING、合并、按能量切分、流式批次、返回结果。
 * 会修改 currentBuffer 的状态与字段。
 */
export function executeFinalizeAndReturn(
  context: AudioAggregatorFinalizeContext,
  bufferKey: string,
  currentBuffer: AudioBuffer,
  job: JobAssignMessage,
  isManualCut: boolean,
  isTimeoutTriggered: boolean,
  nowMs: number
): AudioChunkResult {
  const sessionId = job.session_id;
  const {
    audioUtils,
    streamBatcher,
    finalizeHandler,
    audioMerger,
    BYTES_PER_SAMPLE,
    SAMPLE_RATE,
    SPLIT_HANGOVER_MS,
    deleteBuffer,
  } = context;

  currentBuffer.state = 'FINALIZING';
  currentBuffer.lastFinalizeAt = nowMs;
  logger.info(
    {
      jobId: job.job_id,
      bufferKey,
      epoch: currentBuffer.epoch,
      state: currentBuffer.state,
      reason: 'Starting finalize process (manual/timeout)',
    },
    'AudioAggregator: [StateMachine] Buffer state -> FINALIZING'
  );

  const currentAggregated = audioMerger.aggregateAudioChunks(currentBuffer.audioChunks);
  const finalizeResult = finalizeHandler.handleFinalize(
    currentBuffer,
    job,
    currentAggregated,
    nowMs,
    isManualCut,
    isTimeoutTriggered
  );

  let audioToProcess = finalizeResult.audioToProcess;
  let jobInfoToProcess = finalizeResult.jobInfoToProcess;
  const hasMergedPendingAudio = finalizeResult.hasMergedPendingAudio;

  if (hasMergedPendingAudio) {
    currentBuffer.pendingTimeoutAudio = undefined;
    currentBuffer.pendingTimeoutAudioCreatedAt = undefined;
    currentBuffer.pendingTimeoutJobInfo = undefined;
  }

  currentBuffer.pendingSmallSegments = [];
  currentBuffer.pendingSmallSegmentsJobInfo = [];

  const audioToProcessDurationMs = (audioToProcess.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  const audioSegments = audioUtils.splitAudioByEnergy(
    audioToProcess,
    5000,
    2000,
    SPLIT_HANGOVER_MS
  );

  logger.info(
    {
      jobId: job.job_id,
      bufferKey,
      epoch: currentBuffer.epoch,
      state: currentBuffer.state,
      sessionId,
      utteranceIndex: job.utterance_index,
      hasMergedPendingAudio,
      inputAudioDurationMs: audioToProcessDurationMs,
      outputSegmentCount: audioSegments.length,
    },
    hasMergedPendingAudio
      ? 'AudioAggregator: Merged pending audio, split by energy'
      : 'AudioAggregator: Audio split by energy completed'
  );

  const isIndependentUtterance = isManualCut || isTimeoutTriggered;
  const shouldCacheRemaining = !isIndependentUtterance;

  if (hasMergedPendingAudio) {
    const currentJobInfo: OriginalJobInfo = {
      jobId: job.job_id,
      utteranceIndex: job.utterance_index ?? 0,
      startOffset: 0,
      endOffset: audioToProcess.length,
    };
    jobInfoToProcess = [currentJobInfo];
  }

  const { batches: initialBatches, batchJobInfo: initialBatchJobInfo, remainingSmallSegments, remainingSmallSegmentsJobInfo } =
    streamBatcher.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining);

  let batches = initialBatches;
  let batchJobInfo = initialBatchJobInfo;
  if (isIndependentUtterance && remainingSmallSegments.length > 0) {
    const remainingBatch = Buffer.concat(remainingSmallSegments);
    batches = [...initialBatches, remainingBatch];
    if (remainingSmallSegmentsJobInfo.length > 0) {
      batchJobInfo = [...initialBatchJobInfo, remainingSmallSegmentsJobInfo[remainingSmallSegmentsJobInfo.length - 1]];
    } else if (jobInfoToProcess.length > 0) {
      batchJobInfo = [...initialBatchJobInfo, jobInfoToProcess[jobInfoToProcess.length - 1]];
    }
  }

  if (remainingSmallSegments.length > 0 && !isIndependentUtterance) {
    currentBuffer.pendingSmallSegments = remainingSmallSegments;
    currentBuffer.pendingSmallSegmentsJobInfo = remainingSmallSegmentsJobInfo;
  }

  const originalJobIds = hasMergedPendingAudio
    ? batches.map(() => job.job_id)
    : batchJobInfo.map(info => info.jobId);

  logger.info(
    {
      jobId: job.job_id,
      bufferKey,
      epoch: currentBuffer.epoch,
      batchesCount: batches.length,
      originalJobIds,
      assignStrategy: hasMergedPendingAudio ? 'force_current_job' : 'head_alignment',
      hasMergedPendingAudio,
    },
    hasMergedPendingAudio
      ? 'AudioAggregator: Batches assigned to current job (merged pendingTimeoutAudio)'
      : 'AudioAggregator: Batches assigned using head alignment'
  );

  const audioSegmentsBase64 = batches.map(batch => batch.toString('base64'));

  const audioDurationMs = batches.reduce((total, batch) => {
    return total + (batch.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
  }, 0);

  logger.info(
    {
      jobId: job.job_id,
      bufferKey,
      sessionId,
      utteranceIndex: job.utterance_index,
      ownerJobId: originalJobIds[0] || job.job_id,
      originalJobIds,
      originalJobIdsCount: originalJobIds.length,
      audioDurationMs,
      segmentsCount: batches.length,
    },
    'AudioAggregator: Sending audio segments to ASR'
  );

  if (batches.length === 0) {
    return {
      audioSegments: [],
      shouldReturnEmpty: true,
      reason: 'EMPTY_INPUT',
    };
  }

  const pendingTimeoutAudioLength = currentBuffer.pendingTimeoutAudio?.length || 0;
  const pendingSmallSegmentsCount = currentBuffer.pendingSmallSegments.length;

  if (currentBuffer.pendingTimeoutAudio) {
    currentBuffer.audioChunks = [];
    currentBuffer.totalDurationMs = 0;
    currentBuffer.originalJobInfo = [];
    currentBuffer.isManualCut = false;
    currentBuffer.isTimeoutTriggered = false;
    currentBuffer.state = 'PENDING_TIMEOUT';
    logger.info(
      {
        jobId: job.job_id,
        bufferKey,
        epoch: currentBuffer.epoch,
        state: currentBuffer.state,
        utteranceIndex: job.utterance_index,
        pendingTimeoutAudioLength,
        pendingSmallSegmentsCount,
      },
      'AudioAggregator: Buffer retained (pendingTimeoutAudio)'
    );
  } else {
    deleteBuffer(bufferKey, currentBuffer, 'No pending audio after finalize', nowMs);
  }

  return {
    audioSegments: audioSegmentsBase64,
    originalJobIds,
    originalJobInfo: jobInfoToProcess,
    shouldReturnEmpty: false,
    reason: 'NORMAL',
  };
}
