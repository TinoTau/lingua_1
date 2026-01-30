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
import { SessionAffinityManager } from './session-affinity-manager';

interface FinalizeResult {
  audioToProcess: Buffer;
  jobInfoToProcess: OriginalJobInfo[];
  hasMergedPendingAudio: boolean;
  shouldCachePendingTimeout?: boolean;  // 是否应该缓存短音频到 pendingTimeoutAudio
  shouldHoldPendingMaxDur?: boolean;  // 是否应该继续等待pendingMaxDurationAudio（合并后仍<5秒）
  reason?: 'NORMAL_MERGE' | 'PENDING_MAXDUR_HOLD' | 'FORCE_FLUSH_PENDING_MAXDUR_TTL' | 'FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE';  // 处理原因
}

export class AudioAggregatorFinalizeHandler {
  private readonly SAMPLE_RATE = 16000;
  private readonly BYTES_PER_SAMPLE = 2;
  private readonly SPLIT_HANGOVER_MS = 600;
  private readonly SHORT_AUDIO_THRESHOLD_MS = 1000;
  private readonly MIN_ACCUMULATED_DURATION_FOR_ASR_MS = 5000; // 最小累积时长：5秒
  private readonly PENDING_MAXDUR_TTL_MS = 10000; // MaxDuration pending TTL：10秒

  private readonly audioUtils = new AudioAggregatorUtils();
  private readonly sessionAffinityManager = SessionAffinityManager.getInstance();

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
    let shouldCachePendingTimeout = false;

    // 1. 处理pendingTimeoutAudio（如果有）
    if (buffer.pendingTimeoutAudio) {
      const mergeResult = this.mergePendingTimeoutAudio(
        buffer,
        job,
        currentAggregated,
        nowMs
      );

      if (mergeResult.shouldMerge) {
        audioToProcess = mergeResult.mergedAudio!;
        jobInfoToProcess = mergeResult.mergedJobInfo!;
        hasMergedPendingAudio = true;

        // 清除session affinity映射
        this.sessionAffinityManager.clearSessionMapping(job.session_id);
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
          'AudioAggregatorFinalizeHandler: Cleared session mapping (manual/timeout finalize)'
        );
      }
    }

    // ✅ 修复：处理pendingMaxDurationAudio（如果有）- 手动或timeout finalize时可以合并MaxDuration缓存的音频
    if (buffer.pendingMaxDurationAudio) {
      const mergeResult = this.mergePendingMaxDurationAudio(
        buffer,
        job,
        audioToProcess,
        nowMs,
        isManualCut,
        isTimeoutTriggered
      );

      if (mergeResult.shouldMerge) {
        audioToProcess = mergeResult.mergedAudio!;
        jobInfoToProcess = mergeResult.mergedJobInfo!;
        hasMergedPendingAudio = true;

        // 清除MaxDuration session affinity映射
        this.sessionAffinityManager.clearMaxDurationSessionMapping(job.session_id);

        // ✅ P2增强：记录详细的日志信息
        // 注意：mergedDurationMs已在mergePendingMaxDurationAudio中计算并记录，这里只记录合并成功的信息
        const ownerJobId = jobInfoToProcess[0]?.jobId || job.job_id;
        const mergeReason = mergeResult.reason || 'NORMAL_MERGE';

        logger.info(
          {
            sessionId: job.session_id,
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            isManualCut,
            isTimeoutTriggered,
            action: 'merge',
            pendingMergeType: 'maxdur',
            ownerJobId,
            reason: mergeReason,
          },
          'AudioAggregatorFinalizeHandler: Cleared MaxDuration session mapping (manual/timeout finalize merged MaxDuration audio)'
        );

        // ✅ 修复：返回reason字段，以便audio-aggregator.ts可以正确设置result.reason
        const finalizeResult: FinalizeResult = {
          audioToProcess,
          jobInfoToProcess,
          hasMergedPendingAudio,
          shouldCachePendingTimeout,
          shouldHoldPendingMaxDur: false,
          reason: mergeReason,
        };
        // ✅ T3(2): handleFinalize 出口 - shouldMerge === true
        logger.info(
          {
            testCase: 'R0/R1',
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            finalizeResultReason: finalizeResult.reason,
            finalizeResultShouldHoldPendingMaxDur: finalizeResult.shouldHoldPendingMaxDur,
            finalizeResultHasMergedPendingAudio: finalizeResult.hasMergedPendingAudio,
            reason: 'T3(2): handleFinalize 出口 - shouldMerge === true',
          },
          'AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口'
        );
        return finalizeResult;
      } else if (mergeResult.reason === 'PENDING_MAXDUR_HOLD') {
        // ✅ P2增强：记录hold状态的日志
        // 注意：详细的mergedDurationMs等信息已在mergePendingMaxDurationAudio中记录
        logger.info(
          {
            sessionId: job.session_id,
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            isManualCut,
            isTimeoutTriggered,
            action: 'hold',
            pendingMergeType: 'maxdur',
            reason: 'PENDING_MAXDUR_HOLD',
          },
          'AudioAggregatorFinalizeHandler: PendingMaxDurationAudio held (merged audio still < 5s)'
        );

        // ✅ P0修复：如果pendingMaxDurationAudio需要继续等待，直接返回，不继续处理
        const finalizeResult: FinalizeResult = {
          audioToProcess: Buffer.alloc(0), // 空音频，表示不处理
          jobInfoToProcess: [],
          hasMergedPendingAudio: false,
          shouldHoldPendingMaxDur: true,
          reason: 'PENDING_MAXDUR_HOLD',
        };
        // ✅ T3(2): handleFinalize 出口 - PENDING_MAXDUR_HOLD
        logger.info(
          {
            testCase: 'R0/R1',
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            finalizeResultReason: finalizeResult.reason,
            finalizeResultShouldHoldPendingMaxDur: finalizeResult.shouldHoldPendingMaxDur,
            finalizeResultHasMergedPendingAudio: finalizeResult.hasMergedPendingAudio,
            reason: 'T3(2): handleFinalize 出口 - PENDING_MAXDUR_HOLD',
          },
          'AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口'
        );
        return finalizeResult;
      } else {
        // ✅ 修复：如果mergeResult.shouldMerge === false 但 reason 不是 'PENDING_MAXDUR_HOLD'（例如 utteranceIndexDiff > 2 或 === 0），
        // 说明pendingMaxDurationAudio被清除了，应该继续处理当前音频（不合并pending）
        logger.info(
          {
            sessionId: job.session_id,
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            mergeResultReason: mergeResult.reason,
            action: 'skip_merge',
            pendingMergeType: 'maxdur',
            reason: 'PendingMaxDurationAudio cleared (utteranceIndex mismatch)',
          },
          'AudioAggregatorFinalizeHandler: PendingMaxDurationAudio cleared, processing current audio only'
        );
        // 继续处理当前音频（不合并pending），reason保持为undefined，audio-aggregator.ts会使用'NORMAL'
      }
    }

    // 2. 如果当前timeout音频短且还没有缓存，保存到pendingTimeoutAudio
    // 类似 pause finalize 的逻辑：只缓存短音频（< 1秒）
    if (!hasMergedPendingAudio && !buffer.pendingTimeoutAudio && isTimeoutTriggered) {
      const currentDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

      // ✅ 关键：只有短音频（< 1秒）才缓存
      if (currentDurationMs < this.SHORT_AUDIO_THRESHOLD_MS) {
        shouldCachePendingTimeout = true;

        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            currentAudioDurationMs: currentDurationMs,
          },
          'AudioAggregatorFinalizeHandler: Caching short timeout audio to pendingTimeoutAudio'
        );
      }
    }

    // 4. 处理pendingSmallSegments（仅在非独立utterance时）
    const isIndependentUtterance = isManualCut || isTimeoutTriggered;
    if (!isIndependentUtterance && buffer.pendingSmallSegments.length > 0) {
      const mergeResult = this.mergePendingSmallSegments(
        buffer,
        job,
        audioToProcess,
        jobInfoToProcess
      );

      if (mergeResult.shouldMerge) {
        audioToProcess = mergeResult.mergedAudio!;
        jobInfoToProcess = mergeResult.mergedJobInfo!;
      }
    }

    // ✅ 修复：最终返回时也包含reason字段（如果没有pendingMaxDurationAudio合并，reason为undefined，使用'NORMAL'）
    const finalizeResult: FinalizeResult = {
      audioToProcess,
      jobInfoToProcess,
      hasMergedPendingAudio,
      shouldCachePendingTimeout,
      shouldHoldPendingMaxDur: false,
      reason: undefined, // 没有pendingMaxDurationAudio合并时，reason为undefined，audio-aggregator.ts会使用'NORMAL'
    };
    // ✅ T3(2): handleFinalize 出口 - 最终返回（无pendingMaxDurationAudio合并）
    logger.info(
      {
        testCase: 'R0/R1',
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        finalizeResultReason: finalizeResult.reason,
        finalizeResultShouldHoldPendingMaxDur: finalizeResult.shouldHoldPendingMaxDur,
        finalizeResultHasMergedPendingAudio: finalizeResult.hasMergedPendingAudio,
        reason: 'T3(2): handleFinalize 出口 - 最终返回（无pendingMaxDurationAudio合并）',
      },
      'AudioAggregatorFinalizeHandler: [T3(2)] handleFinalize 出口'
    );
    return finalizeResult;
  }

  /**
   * 合并pendingMaxDurationAudio
   */
  private mergePendingMaxDurationAudio(
    buffer: AudioBuffer,
    job: JobAssignMessage,
    currentAggregated: Buffer,
    nowMs: number,
    isManualCut: boolean,
    isTimeoutTriggered: boolean
  ): { shouldMerge: boolean; mergedAudio?: Buffer; mergedJobInfo?: OriginalJobInfo[]; reason?: 'NORMAL_MERGE' | 'PENDING_MAXDUR_HOLD' | 'FORCE_FLUSH_PENDING_MAXDUR_TTL' | 'FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE' } {
    // ✅ T2: 确认 mergePendingMaxDurationAudio 是否被调用，以及 mergedDurationMs 是否符合预期
    const hasPending = !!buffer.pendingMaxDurationAudio;
    const pendingDurationMsForLog = buffer.pendingMaxDurationAudio
      ? (buffer.pendingMaxDurationAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
      : 0;
    const incomingDurationMs = (currentAggregated.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

    logger.info(
      {
        testCase: 'R0/R1',
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        hasPending,
        pendingDurationMs: pendingDurationMsForLog,
        incomingDurationMs,
        reason: 'T2: mergePendingMaxDurationAudio 入口检查',
      },
      'AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 入口'
    );

    // 检查utteranceIndex
    const pendingUtteranceIndex = buffer.pendingMaxDurationJobInfo && buffer.pendingMaxDurationJobInfo.length > 0
      ? buffer.pendingMaxDurationJobInfo[0].utteranceIndex
      : buffer.utteranceIndex;

    // ✅ 修复：允许连续的utteranceIndex合并（MaxDuration finalize的正常场景）
    // - 如果currentIndex = pendingIndex + 1，说明是MaxDuration finalize后的下一个job，应该合并
    // - 只有当跳跃太大（差值>2）时，才说明中间有其他独立utterance，这时才清除
    const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;

    // ✅ 超界处理策略：差值>2时，强制 finalize pending（不允许静默失败）
    if (utteranceIndexDiff > 2) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          pendingUtteranceIndex: pendingUtteranceIndex,
          currentUtteranceIndex: job.utterance_index,
          utteranceIndexDiff,
          action: 'force_finalize_pending',
          reason: 'UtteranceIndex跳跃太大（>2），说明中间有其他独立utterance，强制finalize pendingMaxDurationAudio',
        },
        'AudioAggregatorFinalizeHandler: PendingMaxDurationAudio跳跃太大，强制finalize pending'
      );

      // 超界处理：强制 finalize pending（丢弃 pending，不合并）
      buffer.pendingMaxDurationAudio = undefined;
      buffer.pendingMaxDurationAudioCreatedAt = undefined;
      buffer.pendingMaxDurationJobInfo = undefined;

      return { shouldMerge: false };
    }

    if (utteranceIndexDiff === 0) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          pendingUtteranceIndex: pendingUtteranceIndex,
          currentUtteranceIndex: job.utterance_index,
          reason: 'UtteranceIndex相同，说明是同一个utterance的重复job，清除pendingMaxDurationAudio',
        },
        'AudioAggregatorFinalizeHandler: UtteranceIndex相同，清除pendingMaxDurationAudio'
      );

      return { shouldMerge: false };
    }

    // utteranceIndexDiff === 1 或 2，允许合并（MaxDuration finalize的正常场景）
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        pendingUtteranceIndex,
        currentUtteranceIndex: job.utterance_index,
        utteranceIndexDiff,
        action: 'merge',
        pendingMergeType: 'maxdur',
        reason: '连续的utteranceIndex，允许合并（MaxDuration finalize的正常场景）',
      },
      'AudioAggregatorFinalizeHandler: 连续utteranceIndex，允许合并pendingMaxDurationAudio'
    );

    const pendingAudio = buffer.pendingMaxDurationAudio!;
    const pendingDurationMs = (pendingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const currentDurationMs = (currentAggregated.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const mergedAudio = Buffer.concat([pendingAudio, currentAggregated]);
    const mergedDurationMs = (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const ageMs = nowMs - (buffer.pendingMaxDurationAudioCreatedAt || nowMs);

    // ✅ T2: 记录合并后的音频时长
    logger.info(
      {
        testCase: 'R0/R1',
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        pendingDurationMs,
        incomingDurationMs: currentDurationMs,
        mergedDurationMs,
        shouldMerge: mergedDurationMs >= this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS,
        mergeReason: mergedDurationMs >= this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS ? 'NORMAL_MERGE' : 'PENDING_MAXDUR_HOLD',
        reason: 'T2: mergePendingMaxDurationAudio 合并后时长计算',
      },
      'AudioAggregatorFinalizeHandler: [T2] mergePendingMaxDurationAudio 合并后时长'
    );

    // ✅ P0修复：检查合并后的音频时长
    // 如果合并后仍然<5秒，继续等待下一个job，不立即处理
    // ✅ 架构设计：如果当前job是手动或timeout finalize，应该强制处理pendingMaxDurationAudio，即使 < 5秒
    // 原因：根据设计，最后一个job一定是以手动或timeout finalize收尾的，所以不应该继续等待下一个job
    if (mergedDurationMs < this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS) {
      // ✅ 架构设计：手动或timeout finalize时强制处理，即使 < 5秒
      const isManualOrTimeoutFinalize = isManualCut || isTimeoutTriggered;
      
      if (isManualOrTimeoutFinalize) {
        // 手动或timeout finalize：强制处理，即使 < 5秒
        // 因为根据设计，最后一个job一定是以手动或timeout finalize收尾的
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            pendingAudioDurationMs: pendingDurationMs,
            currentAudioDurationMs: currentDurationMs,
            mergedAudioDurationMs: mergedDurationMs,
            isManualCut,
            isTimeoutTriggered,
            minRequiredMs: this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS,
            reason: 'FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE',
          },
          'AudioAggregatorFinalizeHandler: Manual or timeout finalize, force flushing pendingMaxDurationAudio (< 5s)'
        );

        // 强制flush：清除pending并返回合并后的音频
        const pendingJobInfo = buffer.pendingMaxDurationJobInfo || [];
        const currentJobInfo = buffer.originalJobInfo.map((info: OriginalJobInfo) => ({
          ...info,
          startOffset: info.startOffset + pendingAudio.length,
          endOffset: info.endOffset + pendingAudio.length,
        }));
        const mergedJobInfo = [...pendingJobInfo, ...currentJobInfo];

        buffer.pendingMaxDurationAudio = undefined;
        buffer.pendingMaxDurationAudioCreatedAt = undefined;
        buffer.pendingMaxDurationJobInfo = undefined;

        return {
          shouldMerge: true,
          mergedAudio,
          mergedJobInfo,
          reason: 'FORCE_FLUSH_MANUAL_OR_TIMEOUT_FINALIZE' as const,
        };
      }

      // 检查TTL：如果超过TTL，强制flush（即使<5秒）
      const shouldForceFlush = ageMs >= this.PENDING_MAXDUR_TTL_MS;

      if (shouldForceFlush) {
        // TTL到期，强制flush
        logger.warn(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            pendingAudioDurationMs: pendingDurationMs,
            currentAudioDurationMs: currentDurationMs,
            mergedAudioDurationMs: mergedDurationMs,
            ageMs,
            minRequiredMs: this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS,
            reason: 'FORCE_FLUSH_PENDING_MAXDUR_TTL',
          },
          'AudioAggregatorFinalizeHandler: TTL expired, force flushing pendingMaxDurationAudio (< 5s)'
        );

        // 强制flush：清除pending并返回合并后的音频
        const pendingJobInfo = buffer.pendingMaxDurationJobInfo || [];
        const currentJobInfo = buffer.originalJobInfo.map((info: OriginalJobInfo) => ({
          ...info,
          startOffset: info.startOffset + pendingAudio.length,
          endOffset: info.endOffset + pendingAudio.length,
        }));
        const mergedJobInfo = [...pendingJobInfo, ...currentJobInfo];

        buffer.pendingMaxDurationAudio = undefined;
        buffer.pendingMaxDurationAudioCreatedAt = undefined;
        buffer.pendingMaxDurationJobInfo = undefined;

        return {
          shouldMerge: true,
          mergedAudio,
          mergedJobInfo,
          reason: 'FORCE_FLUSH_PENDING_MAXDUR_TTL' as const,
        };
      } else {
        // 合并后仍然<5秒且未超TTL，继续等待
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            pendingAudioDurationMs: pendingDurationMs,
            currentAudioDurationMs: currentDurationMs,
            mergedAudioDurationMs: mergedDurationMs,
            ageMs,
            minRequiredMs: this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS,
            reason: 'PENDING_MAXDUR_HOLD',
          },
          'AudioAggregatorFinalizeHandler: Merged audio still < 5 seconds, keeping pendingMaxDurationAudio (waiting for next job)'
        );

        // 更新pendingMaxDurationAudio为合并后的音频（等待下一个job继续合并）
        buffer.pendingMaxDurationAudio = mergedAudio;
        buffer.pendingMaxDurationAudioCreatedAt = buffer.pendingMaxDurationAudioCreatedAt || nowMs; // 保持原始创建时间
        // 更新jobInfo（合并后的）
        const pendingJobInfo = buffer.pendingMaxDurationJobInfo || [];
        const currentJobInfo = buffer.originalJobInfo.map((info: OriginalJobInfo) => ({
          ...info,
          startOffset: info.startOffset + pendingAudio.length,
          endOffset: info.endOffset + pendingAudio.length,
        }));
        buffer.pendingMaxDurationJobInfo = [...pendingJobInfo, ...currentJobInfo];

        // ✅ T3(1): mergePendingMaxDurationAudio 出口 - PENDING_MAXDUR_HOLD
        const mergeResult = {
          shouldMerge: false,
          reason: 'PENDING_MAXDUR_HOLD' as const,
        };
        logger.info(
          {
            testCase: 'R0/R1',
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            mergeResultShouldMerge: mergeResult.shouldMerge,
            mergeResultReason: mergeResult.reason,
            mergedDurationMs,
            reason: 'T3(1): mergePendingMaxDurationAudio 出口 - PENDING_MAXDUR_HOLD',
          },
          'AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口'
        );
        return mergeResult;
      }
    }

    // 合并后≥5秒，正常处理
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        pendingAudioDurationMs: pendingDurationMs,
        currentAudioDurationMs: currentDurationMs,
        mergedAudioDurationMs: mergedDurationMs,
        ageMs,
        reason: 'NORMAL_MERGE',
      },
      'AudioAggregatorFinalizeHandler: Merging pendingMaxDurationAudio with current audio (≥5s)'
    );

    // 合并job信息
    const pendingJobInfo = buffer.pendingMaxDurationJobInfo || [];
    const currentJobInfo = buffer.originalJobInfo.map((info: OriginalJobInfo) => ({
      ...info,
      startOffset: info.startOffset + pendingAudio.length,
      endOffset: info.endOffset + pendingAudio.length,
    }));
    const mergedJobInfo = [...pendingJobInfo, ...currentJobInfo];

    // 清除pendingMaxDurationAudio
    buffer.pendingMaxDurationAudio = undefined;
    buffer.pendingMaxDurationAudioCreatedAt = undefined;
    buffer.pendingMaxDurationJobInfo = undefined;

    // ✅ T3(1): mergePendingMaxDurationAudio 出口 - NORMAL_MERGE
    const mergeResult = {
      shouldMerge: true,
      mergedAudio,
      mergedJobInfo,
      reason: 'NORMAL_MERGE' as const,
    };
    logger.info(
      {
        testCase: 'R0/R1',
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        mergeResultShouldMerge: mergeResult.shouldMerge,
        mergeResultReason: mergeResult.reason,
        mergedDurationMs,
        reason: 'T3(1): mergePendingMaxDurationAudio 出口 - NORMAL_MERGE',
      },
      'AudioAggregatorFinalizeHandler: [T3(1)] mergePendingMaxDurationAudio 出口'
    );
    return mergeResult;
  }

  /**
   * 合并pendingTimeoutAudio
   */
  private mergePendingTimeoutAudio(
    buffer: AudioBuffer,
    job: JobAssignMessage,
    currentAggregated: Buffer,
    nowMs: number
  ): { shouldMerge: boolean; mergedAudio?: Buffer; mergedJobInfo?: OriginalJobInfo[] } {
    // 检查utteranceIndex
    const pendingUtteranceIndex = buffer.pendingTimeoutJobInfo && buffer.pendingTimeoutJobInfo.length > 0
      ? buffer.pendingTimeoutJobInfo[0].utteranceIndex
      : buffer.utteranceIndex;

    // ✅ 修复：允许连续的utteranceIndex合并（超时finalize的正常场景）
    // - 如果currentIndex = pendingIndex + 1，说明是超时finalize后的下一个job，应该合并
    // - 只有当跳跃太大（差值>2）时，才说明中间有其他独立utterance，这时才清除
    const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;

    // ✅ 超界处理策略：差值>2时，强制 finalize pending（不允许静默失败）
    if (utteranceIndexDiff > 2) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          pendingUtteranceIndex: pendingUtteranceIndex,
          currentUtteranceIndex: job.utterance_index,
          utteranceIndexDiff,
          action: 'force_finalize_pending',
          reason: 'UtteranceIndex跳跃太大（>2），说明中间有其他独立utterance，强制finalize pendingTimeoutAudio',
        },
        'AudioAggregatorFinalizeHandler: PendingTimeoutAudio跳跃太大，强制finalize pending'
      );

      // 超界处理：强制 finalize pending（丢弃 pending，不合并）
      // 注意：这里不合并，但也不保留 pending，直接丢弃
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
          pendingUtteranceIndex: pendingUtteranceIndex,
          currentUtteranceIndex: job.utterance_index,
          reason: 'UtteranceIndex相同，说明是同一个utterance的重复job，清除pendingTimeoutAudio',
        },
        'AudioAggregatorFinalizeHandler: UtteranceIndex相同，清除pendingTimeoutAudio'
      );

      return { shouldMerge: false };
    }

    // utteranceIndexDiff === 1 或 2，允许合并（超时finalize的正常场景）
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
    const pendingDurationMs = (pendingAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const currentDurationMs = (currentAggregated.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const mergedDurationMs = (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
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

    // 合并job信息
    const pendingJobInfo = buffer.pendingTimeoutJobInfo || [];
    const currentJobInfo = buffer.originalJobInfo.map((info: OriginalJobInfo) => ({
      ...info,
      startOffset: info.startOffset + pendingAudio.length,
      endOffset: info.endOffset + pendingAudio.length,
    }));
    const mergedJobInfo = [...pendingJobInfo, ...currentJobInfo];

    return {
      shouldMerge: true,
      mergedAudio,
      mergedJobInfo,
    };
  }


  /**
   * 合并pendingSmallSegments
   */
  private mergePendingSmallSegments(
    buffer: AudioBuffer,
    job: JobAssignMessage,
    currentAudio: Buffer,
    currentJobInfo: OriginalJobInfo[]
  ): { shouldMerge: boolean; mergedAudio?: Buffer; mergedJobInfo?: OriginalJobInfo[] } {
    // 检查utteranceIndex
    const pendingSmallSegmentsUtteranceIndex = buffer.pendingSmallSegmentsJobInfo && buffer.pendingSmallSegmentsJobInfo.length > 0
      ? buffer.pendingSmallSegmentsJobInfo[0].utteranceIndex
      : buffer.utteranceIndex;

    // ✅ 修复：允许连续的utteranceIndex合并
    // - 如果currentIndex = pendingIndex + 1，说明是正常延续，应该合并
    // - 只有当跳跃太大（差值>2）时，才说明中间有其他独立utterance，这时才清除
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

    // utteranceIndexDiff === 1 或 2，允许合并
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
    const smallSegmentsDurationMs = (smallSegmentsAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        smallSegmentsCount: buffer.pendingSmallSegments.length,
        smallSegmentsDurationMs,
        mergedAudioDurationMs: (mergedAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
      },
      'AudioAggregatorFinalizeHandler: Merged pendingSmallSegments with current audio'
    );

    // 合并job信息
    const mergedJobInfo = [
      ...buffer.pendingSmallSegmentsJobInfo,
      ...currentJobInfo.map((info: OriginalJobInfo) => ({
        ...info,
        startOffset: info.startOffset + smallSegmentsAudio.length,
        endOffset: info.endOffset + smallSegmentsAudio.length,
      })),
    ];

    return {
      shouldMerge: true,
      mergedAudio,
      mergedJobInfo,
    };
  }
}
