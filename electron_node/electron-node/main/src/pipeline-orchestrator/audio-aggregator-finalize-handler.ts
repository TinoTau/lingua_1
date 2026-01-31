/**
 * 音频聚合器 - Finalize处理器
 * 
 * 功能：
 * 1. 处理手动/timeout finalize，合并pending音频
 * 2. 处理pendingTimeoutAudio的合并
 * 3. 处理pendingSmallSegments的合并
 * 4. 按能量切分音频，创建流式批次
 * 
 * 设计：
 * - 无状态类，所有逻辑基于传入的参数
 * - 纯函数式设计，便于测试
 */

import logger from '../logger';
import { AudioAggregatorUtils } from './audio-aggregator-utils';
import { OriginalJobInfo, AudioBuffer } from './audio-aggregator-types';
import { JobAssignMessage } from '../../../../shared/protocols/messages';
import { mergePendingTimeoutAudio, mergePendingSmallSegments } from './audio-aggregator-finalize-merge';

interface FinalizeResult {
  audioToProcess: Buffer;
  jobInfoToProcess: OriginalJobInfo[];
  hasMergedPendingAudio: boolean;
}

export class AudioAggregatorFinalizeHandler {
  private readonly SAMPLE_RATE = 16000;
  private readonly BYTES_PER_SAMPLE = 2;
  private readonly SPLIT_HANGOVER_MS = 600;
  private readonly MIN_ACCUMULATED_DURATION_FOR_ASR_MS = 5000; // 最小累积时长：5秒

  private readonly audioUtils = new AudioAggregatorUtils();

  /**
   * 处理手动/timeout finalize
   * 合并pendingTimeoutAudio和pendingSmallSegments
   */
  handleFinalize(
    buffer: AudioBuffer,
    job: JobAssignMessage,
    currentAggregated: Buffer,
    nowMs: number,
    isManualCut: boolean,
    isTimeoutTriggered: boolean = false
  ): FinalizeResult {
    let audioToProcess: Buffer = currentAggregated;
    let jobInfoToProcess: OriginalJobInfo[] = [...buffer.originalJobInfo];
    let hasMergedPendingAudio = false;

    // 1. 处理pendingTimeoutAudio（如果有）
    if (buffer.pendingTimeoutAudio) {
      const mergeResult = mergePendingTimeoutAudio(buffer, job, currentAggregated, nowMs);

      if (mergeResult.shouldMerge) {
        audioToProcess = mergeResult.mergedAudio!;
        jobInfoToProcess = mergeResult.mergedJobInfo!;
        hasMergedPendingAudio = true;
        logger.info(
          {
            sessionId: job.session_id,
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            isManualCut,
            isTimeoutTriggered,
            action: 'merge',
            pendingMergeType: 'timeout',
          },
          'AudioAggregatorFinalizeHandler: Merged pendingTimeoutAudio (manual/timeout finalize)'
        );
      }
    }

    // 2. timeout finalize 与 manual 一致：不再缓存短句到 pendingTimeoutAudio，直接输出并清理
    // （已移除：短 timeout 音频缓存逻辑，避免等待下一 job 合并，简化流程）

    // 3. 处理pendingSmallSegments（仅在非独立utterance时）
    const isIndependentUtterance = isManualCut || isTimeoutTriggered;
    if (!isIndependentUtterance && buffer.pendingSmallSegments.length > 0) {
      const mergeResult = mergePendingSmallSegments(buffer, job, audioToProcess, jobInfoToProcess);

      if (mergeResult.shouldMerge) {
        audioToProcess = mergeResult.mergedAudio!;
        jobInfoToProcess = mergeResult.mergedJobInfo!;
      }
    }

    return {
      audioToProcess,
      jobInfoToProcess,
      hasMergedPendingAudio,
    };
  }
}
