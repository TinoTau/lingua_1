/**
 * 音频聚合器 - MaxDuration 处理器
 * 
 * 功能：
 * 1. 处理 MaxDuration finalize：按能量切片，处理前5秒（及以上）音频，剩余部分缓存
 * 2. 处理连续的 MaxDuration finalize，合并音频后继续处理前5秒（及以上）
 * 3. 剩余部分缓存到 pendingMaxDurationAudio，等待下一个 job 合并
 * 
 * 设计：
 * - 无状态类，所有逻辑基于传入的参数
 * - 纯函数式设计，便于测试
 * - MaxDuration finalize 是默认任务形态，需要流式处理
 */

import logger from '../logger';
import { AudioBuffer, OriginalJobInfo } from './audio-aggregator-types';
import { JobAssignMessage } from '../../../../shared/protocols/messages';
import { SessionAffinityManager } from './session-affinity-manager';
import { AudioAggregatorUtils } from './audio-aggregator-utils';

interface MaxDurationFinalizeResult {
  shouldProcess: boolean;  // 是否应该处理（有≥5秒的音频）
  audioSegments?: string[];  // 处理后的音频段（base64编码）
  originalJobIds?: string[];  // 每个音频段对应的 originalJobId
  originalJobInfo?: OriginalJobInfo[];  // 原始job信息
  remainingAudio?: Buffer;  // 剩余音频（<5秒，需要缓存）
  remainingJobInfo?: OriginalJobInfo[];  // 剩余音频对应的job信息
  clearBuffer: boolean;
}

export class AudioAggregatorMaxDurationHandler {
  private readonly SAMPLE_RATE = 16000;
  private readonly BYTES_PER_SAMPLE = 2;
  private readonly MIN_ACCUMULATED_DURATION_FOR_ASR_MS = 5000;  // 最小累积时长：5秒

  private readonly sessionAffinityManager = SessionAffinityManager.getInstance();
  private readonly audioUtils = new AudioAggregatorUtils();

  /**
   * 处理 MaxDuration finalize
   * 策略：按能量切片，处理前5秒（及以上）音频，剩余部分缓存
   * 
   * 业务需求：
   * - 直到最后一个手动/Timeout finalize 出现之前，MaxDuration finalize 任务的每个 ASR 批次都应该使用第一个切片的 job 容器（当前 job 的容器）
   * - 剩余部分应该使用当前 job 的容器，而不是下一个 job 的容器
   */
  handleMaxDurationFinalize(
    buffer: AudioBuffer,
    job: JobAssignMessage,
    currentAudio: Buffer,
    nowMs: number,
    aggregateAudioChunks: (chunks: Buffer[]) => Buffer,
    createStreamingBatchesWithPending: (
      audioSegments: Buffer[],
      jobInfo: OriginalJobInfo[],
      shouldCacheRemaining: boolean
    ) => {
      batches: Buffer[];
      batchJobInfo: OriginalJobInfo[];
      remainingSmallSegments: Buffer[];
      remainingSmallSegmentsJobInfo: OriginalJobInfo[];
    }
  ): MaxDurationFinalizeResult {
    // 检查是否为空音频
    if (currentAudio.length === 0) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          reason: 'MaxDuration job with empty audio',
        },
        'AudioAggregatorMaxDurationHandler: MaxDuration job with empty audio'
      );
      return {
        shouldProcess: false,
        clearBuffer: true,
      };
    }

    // 合并之前的 pendingMaxDurationAudio（如果有）
    let audioToProcess: Buffer;
    let jobInfoToProcess: OriginalJobInfo[];
    const hasMergedPendingAudio = !!buffer.pendingMaxDurationAudio;

    if (buffer.pendingMaxDurationAudio) {
      const existingPendingAudio = buffer.pendingMaxDurationAudio;
      const existingPendingJobInfo = buffer.pendingMaxDurationJobInfo || [];
      const currentAggregated = aggregateAudioChunks(buffer.audioChunks);

      // 合并音频
      audioToProcess = Buffer.concat([existingPendingAudio, currentAggregated]);

      // 合并 job 信息（调整偏移）
      const currentJobInfo = buffer.originalJobInfo.map((info) => ({
        ...info,
        startOffset: info.startOffset + existingPendingAudio.length,
        endOffset: info.endOffset + existingPendingAudio.length,
      }));
      jobInfoToProcess = [...existingPendingJobInfo, ...currentJobInfo];

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          mergedAudioDurationMs: (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
          reason: 'Consecutive MaxDuration finalize, merged existing and current audio',
        },
        'AudioAggregatorMaxDurationHandler: Consecutive MaxDuration finalize, merged audio'
      );
    } else {
      // 没有之前的缓存，直接使用当前音频
      audioToProcess = aggregateAudioChunks(buffer.audioChunks);
      jobInfoToProcess = [...buffer.originalJobInfo];
    }

    const audioDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

    // 记录 session affinity
    const currentNodeId = this.sessionAffinityManager.getNodeId();
    this.sessionAffinityManager.recordMaxDurationFinalize(job.session_id);

    logger.info(
      {
        sessionId: job.session_id,
        nodeId: currentNodeId,
        jobId: job.job_id,
        utteranceIndex: job.utterance_index,
        audioDurationMs,
      },
      'AudioAggregatorMaxDurationHandler: Recorded MaxDuration finalize session mapping'
    );

    // 按能量切分
    // 优化：降低maxSegmentDurationMs从10秒到5秒，以便在MaxDuration finalize的长音频中识别自然停顿
    // 这样9秒的音频如果有自然停顿（如呼吸），就能被切分成多个段，最大化利用audio-aggregator的功能
    const audioSegments = this.audioUtils.splitAudioByEnergy(
      audioToProcess,
      5000, // maxSegmentDurationMs: 5秒（从10秒降低，以便识别自然停顿）
      2000,  // minSegmentDurationMs: 2秒
      600    // SPLIT_HANGOVER_MS
    );

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        inputAudioDurationMs: audioDurationMs,
        outputSegmentCount: audioSegments.length,
        reason: 'MaxDuration finalize: split audio by energy',
      },
      'AudioAggregatorMaxDurationHandler: Split audio by energy'
    );

    // 流式切分：组合成~5秒批次，处理前5秒（及以上），剩余部分缓存
    // 统一使用 AudioAggregator 的 createStreamingBatchesWithPending 方法
    // 该方法会返回每个 batch 的第一个片段对应的 jobInfo（用于头部对齐策略）
    const { batches, batchJobInfo, remainingSmallSegments, remainingSmallSegmentsJobInfo } =
      createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, true);

    // ✅ 调试日志：记录切分和批处理结果（用于排查测试用例）
    logger.info(
      {
        testCase: 'R0/R1',
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        inputAudioDurationMs: audioDurationMs,
        audioSegmentsCount: audioSegments.length,
        batchesCount: batches.length,
        remainingSmallSegmentsCount: remainingSmallSegments.length,
        batchesDurationMs: batches.map(batch => (batch.length / 2 / 16000) * 1000),
        remainingSmallSegmentsDurationMs: remainingSmallSegments.length > 0
          ? (remainingSmallSegments.reduce((sum, seg) => sum + seg.length, 0) / 2 / 16000) * 1000
          : 0,
        reason: 'MaxDuration finalize: split and batch processing result',
      },
      'AudioAggregatorMaxDurationHandler: [DEBUG] Split and batch processing result'
    );

    // 转换为base64字符串数组
    const audioSegmentsBase64 = batches.map(batch => batch.toString('base64'));

    // 分配originalJobIds
    // ✅ 架构设计：合并pending音频时，batch归属当前job（后一个job容器）
    // 原因：合并pending音频时，batch应该属于当前job（合并pending的job），而不是原始job（产生pending的job）
    // 设计：不修改createStreamingBatchesWithPending的逻辑，保持头部对齐策略的通用性
    // 只在合并pending音频时特殊处理：强制使用当前job的jobId
    const originalJobIds = hasMergedPendingAudio
      ? batches.map(() => job.job_id)  // 合并pending：归属当前job
      : batchJobInfo.map(info => info.jobId);  // 正常场景：头部对齐策略

    if (batches.length > 0) {
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          batchesCount: batches.length,
          originalJobIds,
          batchJobIds: batchJobInfo.map(info => info.jobId),
          hasMergedPendingAudio,
          reason: hasMergedPendingAudio
            ? 'MaxDuration finalize: batches assigned to current job (merged pendingMaxDurationAudio)'
            : 'MaxDuration finalize: batches assigned to job containers based on first segment (head alignment)',
        },
        hasMergedPendingAudio
          ? 'AudioAggregatorMaxDurationHandler: All batches assigned to current job (merged pendingMaxDurationAudio)'
          : 'AudioAggregatorMaxDurationHandler: All batches assigned to job containers based on head alignment'
      );
    }

    // 处理剩余部分（<5秒，需要缓存）
    // 业务需求：剩余部分应该使用当前 job 的容器（第一个切片的 job 容器）
    let remainingAudio: Buffer | undefined = undefined;
    let remainingJobInfo: OriginalJobInfo[] | undefined = undefined;

    if (remainingSmallSegments.length > 0) {
      remainingAudio = Buffer.concat(remainingSmallSegments);

      // 关键修复：剩余部分应该使用当前 job 的容器（第一个切片的 job 容器）
      // 而不是使用 remainingSmallSegmentsJobInfo（可能包含下一个 job 的信息）
      if (jobInfoToProcess.length > 0) {
        const firstJobInfo = jobInfoToProcess[0];
        // 计算剩余部分的偏移量
        // 剩余部分从已处理音频的结束位置开始（即 audioToProcess 的结束位置）
        const processedAudioLength = audioToProcess.length;
        const remainingStartOffset = processedAudioLength - remainingAudio.length;
        const remainingEndOffset = processedAudioLength;

        remainingJobInfo = [{
          jobId: firstJobInfo.jobId,
          startOffset: remainingStartOffset,
          endOffset: remainingEndOffset,
          utteranceIndex: firstJobInfo.utteranceIndex,
          expectedDurationMs: firstJobInfo.expectedDurationMs,
        }];

        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            firstJobId: firstJobInfo.jobId,
            remainingAudioDurationMs: (remainingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            remainingStartOffset,
            remainingEndOffset,
            reason: 'MaxDuration finalize: remaining audio uses first job container (current job)',
          },
          'AudioAggregatorMaxDurationHandler: Remaining audio assigned to first job container'
        );
      } else {
        remainingJobInfo = remainingSmallSegmentsJobInfo;
      }

      // 更新 pendingMaxDurationAudio
      buffer.pendingMaxDurationAudio = remainingAudio;
      buffer.pendingMaxDurationAudioCreatedAt = nowMs;
      buffer.pendingMaxDurationJobInfo = remainingJobInfo;

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          remainingAudioDurationMs: (remainingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
          processedBatchesCount: batches.length,
          reason: 'MaxDuration finalize: processed first 5+ seconds, cached remaining audio',
        },
        'AudioAggregatorMaxDurationHandler: Processed first 5+ seconds, cached remaining audio'
      );
    } else {
      // 没有剩余部分，清空 pendingMaxDurationAudio
      buffer.pendingMaxDurationAudio = undefined;
      buffer.pendingMaxDurationAudioCreatedAt = undefined;
      buffer.pendingMaxDurationJobInfo = undefined;

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          processedBatchesCount: batches.length,
          reason: 'MaxDuration finalize: all audio processed, no remaining audio to cache',
        },
        'AudioAggregatorMaxDurationHandler: All audio processed, no remaining audio to cache'
      );
    }

    return {
      shouldProcess: batches.length > 0,
      audioSegments: audioSegmentsBase64,
      originalJobIds,
      originalJobInfo: jobInfoToProcess,
      remainingAudio,
      remainingJobInfo,
      clearBuffer: false,
    };
  }
}
