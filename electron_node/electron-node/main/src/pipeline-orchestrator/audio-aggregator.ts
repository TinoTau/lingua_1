/**
 * 音频聚合器：在ASR之前聚合音频
 * 
 * 功能：
 * 1. 根据 is_manual_cut 和 is_pause_triggered 标识，将多个音频块聚合成完整句子
 * 2. 避免ASR识别不完整的短句，提高识别准确率
 * 3. 减少NMT翻译次数，提高处理效率
 * 4. 流式切分：长音频按能量切分，组合成~5秒批次发送给ASR
 * 5. Session Affinity：超时finalize时记录sessionId->nodeId映射
 * 
 * 设计：
 * - 使用依赖注入方式创建实例（通过 ServicesBundle 传递）
 * - 支持热插拔：每次 InferenceService 创建时都有新的干净实例
 * - Session 隔离：使用 sessionId 作为 key，确保不同 session 的缓冲区完全隔离
 * 
 * @see AUDIO_AGGREGATOR_ARCHITECTURE.md 详细架构文档
 */

import logger from '../logger';
import { JobAssignMessage } from '../../../../shared/protocols/messages';
import { decodeOpusToPcm16, encodePcm16ToOpusBuffer } from '../utils/opus-codec';
import { AudioAggregatorUtils } from './audio-aggregator-utils';
import { decodeAudioChunk } from './audio-aggregator-decoder';
import { AudioChunkResult, OriginalJobInfo, JobContainer, AudioBuffer } from './audio-aggregator-types';
import { SessionAffinityManager } from './session-affinity-manager';
import { AudioAggregatorStreamBatcher } from './audio-aggregator-stream-batcher';
import { AudioAggregatorJobContainer } from './audio-aggregator-job-container';
import { AudioAggregatorMerger } from './audio-aggregator-merger';
import { AudioAggregatorTimeoutHandler } from './audio-aggregator-timeout-handler';
import { AudioAggregatorPauseHandler } from './audio-aggregator-pause-handler';
import { AudioAggregatorFinalizeHandler } from './audio-aggregator-finalize-handler';


export class AudioAggregator {
  private buffers: Map<string, AudioBuffer> = new Map();
  private readonly MAX_BUFFER_DURATION_MS = 20000; // 最大缓冲时长：20秒
  private readonly MIN_AUTO_PROCESS_DURATION_MS = 10000; // 最短自动处理时长：10秒（用户表达一个短句时也需要说够一定时间，10秒的音频应该足够ASR识别出正确的文本）
  private readonly SAMPLE_RATE = 16000; // 固定采样率
  private readonly BYTES_PER_SAMPLE = 2; // PCM16: 2 bytes per sample

  // 优化参数
  // 分割点Hangover：600ms
  // 作用：
  // 1. 避免在单词中间切断，提高ASR识别准确度
  // 2. 包含一个完整的词或短语（通常200-500ms一个词，600ms可以包含1-2个词）
  // 3. 制造更明显的重复内容，提高文本去重检测的成功率
  // 4. 即使有重复，后续的去重逻辑可以准确检测并移除
  private readonly SPLIT_HANGOVER_MS = 600; // 从200ms增加到600ms，提高去重检测成功率
  private readonly SECONDARY_SPLIT_THRESHOLD_MS = 10000; // 二级切割阈值：10秒

  // 流式切分参数
  /** 最小累积时长：5秒（用于ASR流式批次） */
  private readonly MIN_ACCUMULATED_DURATION_FOR_ASR_MS = 5000;
  /** pendingTimeoutAudio TTL：10秒（如果10秒内没有手动/pause cut，强制处理） */
  private readonly PENDING_TIMEOUT_AUDIO_TTL_MS = 10000;

  // 音频分析工具
  private readonly audioUtils = new AudioAggregatorUtils();

  // Session Affinity管理器
  private readonly sessionAffinityManager = SessionAffinityManager.getInstance();

  // 流式批次处理器
  private readonly streamBatcher = new AudioAggregatorStreamBatcher();

  // Job容器管理器
  private readonly jobContainer = new AudioAggregatorJobContainer();

  // 音频合并器
  private readonly audioMerger = new AudioAggregatorMerger();

  // 超时处理器
  private readonly timeoutHandler = new AudioAggregatorTimeoutHandler();

  // Pause处理器
  private readonly pauseHandler = new AudioAggregatorPauseHandler();

  // Finalize处理器
  private readonly finalizeHandler = new AudioAggregatorFinalizeHandler();

  /**
   * 处理音频块，根据标识决定是否聚合
   * 
   * @param job 任务消息
   * @returns AudioChunkResult，包含切分后的多段音频（如果只一段，数组长度为1）
   *          - 超时截断：返回空数组 + shouldReturnEmpty=true，音频缓存等待下一个job
   *          - 手动/pause截断：立即按能量切分，返回多段音频
   */
  async processAudioChunk(job: JobAssignMessage): Promise<AudioChunkResult> {
    const sessionId = job.session_id;
    const isManualCut = (job as any).is_manual_cut || false;
    const isPauseTriggered = (job as any).is_pause_triggered || false;
    const isTimeoutTriggered = (job as any).is_timeout_triggered || false;
    const nowMs = Date.now();

    // 解码当前音频块
    const decodeResult = await decodeAudioChunk(job, this.SAMPLE_RATE, this.BYTES_PER_SAMPLE);
    let currentAudio = decodeResult.audio;
    let currentDurationMs = decodeResult.durationMs;

    // 获取或创建缓冲区
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
      // 如果缓冲区不存在，创建一个新的
      // 注意：如果之前有pendingTimeoutAudio，这里会丢失（应该不会发生，因为pendingTimeoutAudio存在时缓冲区应该被保留）
      logger.warn(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          reason: 'Buffer not found, creating new buffer (this should not happen if pendingTimeoutAudio exists)',
        },
        'AudioAggregator: [Warning] Buffer not found, creating new buffer'
      );
      buffer = {
        audioChunks: [],
        totalDurationMs: 0,
        startTimeMs: nowMs,
        lastChunkTimeMs: nowMs,
        isManualCut: false,
        isPauseTriggered: false,
        isTimeoutTriggered: false,
        sessionId,
        utteranceIndex: job.utterance_index,
        pendingSmallSegments: [],
        pendingSmallSegmentsJobInfo: [],
        originalJobInfo: [],
        pendingPauseAudio: undefined,
        pendingPauseAudioCreatedAt: undefined,
        pendingPauseJobInfo: undefined,
      };
      this.buffers.set(sessionId, buffer);
    } else {
      // 调试日志：检查缓冲区状态
      logger.debug(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          hasPendingTimeoutAudio: !!buffer.pendingTimeoutAudio,
          hasPendingSmallSegments: buffer.pendingSmallSegments.length > 0,
          chunkCount: buffer.audioChunks.length,
          totalDurationMs: buffer.totalDurationMs,
          reason: 'Buffer found, checking state',
        },
        'AudioAggregator: [Debug] Buffer found, checking state'
      );
    }

    // ============================================================
    // 关键：检查 pendingTimeoutAudio 是否超过 TTL（10秒）
    // 如果超过10秒且没有后续手动/静音切断，强制执行 finalize+ASR
    // ============================================================
    const ttlCheckResult = this.timeoutHandler.checkTimeoutTTL(buffer, job, currentAudio, nowMs);

    if (ttlCheckResult) {
      if (ttlCheckResult.clearPendingTimeout) {
        buffer.pendingTimeoutAudio = undefined;
        buffer.pendingTimeoutAudioCreatedAt = undefined;
        buffer.pendingTimeoutJobInfo = undefined;
      }

      if (ttlCheckResult.shouldProcess) {
        // 转换为base64字符串数组
        const audioSegmentsBase64 = ttlCheckResult.audioSegments.map(seg => seg.toString('base64'));

        return {
          audioSegments: audioSegmentsBase64,
          originalJobIds: ttlCheckResult.originalJobIds,
          shouldReturnEmpty: false,
        };
      }
    }

    // 更新缓冲区
    buffer.audioChunks.push(currentAudio);
    buffer.totalDurationMs += currentDurationMs;
    buffer.lastChunkTimeMs = nowMs;
    buffer.isManualCut = buffer.isManualCut || isManualCut;
    buffer.isPauseTriggered = buffer.isPauseTriggered || isPauseTriggered;
    buffer.isTimeoutTriggered = buffer.isTimeoutTriggered || isTimeoutTriggered;

    // 记录当前job在聚合音频中的字节偏移范围（用于originalJobIds分配）
    const aggregatedAudioLength = this.aggregateAudioChunks(buffer.audioChunks).length;
    const currentJobStartOffset = aggregatedAudioLength - currentAudio.length;
    const currentJobEndOffset = aggregatedAudioLength;

    // 获取expectedDurationMs（从job消息中，如果没有则使用当前时长的1.2倍作为估算）
    const expectedDurationMs = (job as any).expected_duration_ms ||
      Math.ceil(currentDurationMs * 1.2); // 如果没有，使用当前时长的1.2倍作为估算

    buffer.originalJobInfo.push({
      jobId: job.job_id,
      startOffset: currentJobStartOffset,
      endOffset: currentJobEndOffset,
      utteranceIndex: job.utterance_index,
      expectedDurationMs: expectedDurationMs,
    });

    // 降低音频块添加日志级别为debug，减少终端输出（每个音频块都会触发，非常频繁）
    logger.debug(
      {
        jobId: job.job_id,
        sessionId,
        utteranceIndex: job.utterance_index,
        currentDurationMs,
        totalDurationMs: buffer.totalDurationMs,
        chunkCount: buffer.audioChunks.length,
        isManualCut,
        isPauseTriggered,
        isTimeoutTriggered,
        bufferIsManualCut: buffer.isManualCut,
        bufferIsPauseTriggered: buffer.isPauseTriggered,
        bufferIsTimeoutTriggered: buffer.isTimeoutTriggered,
      },
      'AudioAggregator: Audio chunk added to buffer'
    );

    // 判断是否应该立即处理（聚合并返回）
    // 按照现在的设计，所有音频都在ASR之前等待处理标识：
    // 1. 手动截断（isManualCut）
    // 2. 3秒静音（isPauseTriggered）
    // 3. 20秒超时（isTimeoutTriggered，有特殊处理逻辑）
    // 4. 10秒自动处理（如果用户说够10秒，应该足够ASR识别出正确的文本）
    // 5. 修复：如果isTimeoutTriggered为true（调度服务器的超时finalize），即使时长小于10秒也应该处理
    //    因为这是调度服务器检测到没有更多chunk后触发的finalize，说明这是最后一句话


    const shouldProcessNow =
      isManualCut ||  // 手动截断：立即处理
      isPauseTriggered ||  // 3秒静音：立即处理（包括调度服务器的pause超时finalize）
      isTimeoutTriggered ||  // 修复：超时finalize（调度服务器检测到没有更多chunk），立即处理（即使时长小于10秒）
      buffer.totalDurationMs >= this.MAX_BUFFER_DURATION_MS ||  // 超过最大缓冲时长（20秒）：立即处理
      (buffer.totalDurationMs >= this.MIN_AUTO_PROCESS_DURATION_MS && !isTimeoutTriggered);  // 达到最短自动处理时长（10秒）且不是超时触发：立即处理

    // ============================================================
    // 特殊处理：超时标识（is_timeout_triggered）
    // 策略：缓存到pendingTimeoutAudio，等待下一个job合并
    // ============================================================
    if (isTimeoutTriggered) {
      const timeoutResult = this.timeoutHandler.handleTimeoutFinalize(
        buffer,
        job,
        currentAudio,
        nowMs,
        this.aggregateAudioChunks.bind(this)
      );

      if (!timeoutResult.shouldCache) {
        // 空音频，删除缓冲区
        if (timeoutResult.clearBuffer) {
          this.buffers.delete(sessionId);
        }

        return {
          audioSegments: [],
          shouldReturnEmpty: true,
          isTimeoutPending: true,
        };
      }

      // 清空当前缓冲区（但保留pendingTimeoutAudio）
      buffer.audioChunks = [];
      buffer.totalDurationMs = 0;
      buffer.originalJobInfo = [];
      buffer.isTimeoutTriggered = false;

      return {
        audioSegments: [],
        shouldReturnEmpty: true,
        isTimeoutPending: true,
      };
    }

    // ============================================================
    // 手动/pause finalize：立即按能量切分，发送给ASR
    // ============================================================
    if (shouldProcessNow) {
      // 聚合当前音频
      const currentAggregated = this.aggregateAudioChunks(buffer.audioChunks);

      // 使用finalizeHandler处理合并逻辑
      const finalizeResult = this.finalizeHandler.handleFinalize(
        buffer,
        job,
        currentAggregated,
        nowMs,
        isManualCut,
        isPauseTriggered
      );

      let audioToProcess = finalizeResult.audioToProcess;
      let jobInfoToProcess = finalizeResult.jobInfoToProcess;
      const hasMergedPendingAudio = finalizeResult.hasMergedPendingAudio;

      // 清空pendingTimeoutAudio和pendingPauseAudio（已在finalizeHandler中处理）
      buffer.pendingTimeoutAudio = undefined;
      buffer.pendingTimeoutAudioCreatedAt = undefined;
      buffer.pendingTimeoutJobInfo = undefined;

      // 如果需要缓存pendingPauseAudio
      if (finalizeResult.shouldCachePendingPause) {
        buffer.pendingPauseAudio = audioToProcess;
        buffer.pendingPauseAudioCreatedAt = nowMs;
        buffer.pendingPauseJobInfo = [...jobInfoToProcess];
      } else {
        buffer.pendingPauseAudio = undefined;
        buffer.pendingPauseAudioCreatedAt = undefined;
        buffer.pendingPauseJobInfo = undefined;
      }

      // 清理长pause音频的pendingPauseAudio
      if (isPauseTriggered) {
        this.pauseHandler.clearLongPauseAudio(buffer, job, audioToProcess);
      }

      // 清空pendingSmallSegments（已在finalizeHandler中处理）
      buffer.pendingSmallSegments = [];
      buffer.pendingSmallSegmentsJobInfo = [];

      const audioToProcessDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

      let audioSegments: Buffer[];

      if (hasMergedPendingAudio) {
        // Hotfix分支：合并后的整段音频不再走流式切分，直接作为一个批次交给ASR
        audioSegments = [audioToProcess];

        logger.info(
          {
            jobId: job.job_id,
            sessionId,
            hasMergedPendingAudio: true,
            segmentCount: 1,
            audioDurationMs: audioToProcessDurationMs,
          },
          'AudioAggregator: Merged pending audio, sending as single batch'
        );
      } else {
        // 正常流式切分逻辑
        audioSegments = this.audioUtils.splitAudioByEnergy(
          audioToProcess,
          10000, // maxSegmentDurationMs: 10秒
          2000,  // minSegmentDurationMs: 2秒
          this.SPLIT_HANGOVER_MS
        );

        logger.info(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            inputAudioDurationMs: audioToProcessDurationMs,
            outputSegmentCount: audioSegments.length,
          },
          'AudioAggregator: Audio split by energy completed'
        );
      }

      // 流式切分：组合成~5秒批次，处理pendingSmallSegments
      // 独立utterance（手动发送或pause finalize）时，不应该缓存剩余片段，应该全部处理
      const isIndependentUtterance = isManualCut || isPauseTriggered;
      const shouldCacheRemaining = !isIndependentUtterance;

      const { batches: initialBatches, remainingSmallSegments, remainingSmallSegmentsJobInfo } =
        this.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining);

      // 手动发送或pause finalize时，将剩余片段也加入到batches中（确保完整处理）
      let batches = initialBatches;
      if (isIndependentUtterance && remainingSmallSegments.length > 0) {
        const remainingBatch = Buffer.concat(remainingSmallSegments);
        batches = [...initialBatches, remainingBatch];
      }

      // 如果有剩余的小片段，缓存到pendingSmallSegments（等待下一个job合并）
      if (remainingSmallSegments.length > 0 && !isIndependentUtterance) {
        buffer.pendingSmallSegments = remainingSmallSegments;
        buffer.pendingSmallSegmentsJobInfo = remainingSmallSegmentsJobInfo;
      }

      // 分配originalJobIds
      let originalJobIds: string[];

      if (isIndependentUtterance && jobInfoToProcess.length === 1) {
        // 独立utterance且单个job：所有batch都分配给当前job
        originalJobIds = batches.map(() => job.job_id);
      } else if (jobInfoToProcess.length > 1) {
        // 多个job：使用容器分配算法
        originalJobIds = this.assignOriginalJobIdsForBatches(batches, jobInfoToProcess);
      } else {
        // 单个job：直接分配
        originalJobIds = batches.map(() => job.job_id);
      }

      // 转换为base64字符串数组
      const audioSegmentsBase64 = batches.map(batch => batch.toString('base64'));

      // 如果没有任何批次，保留缓冲区
      if (batches.length === 0) {
        return {
          audioSegments: [],
          shouldReturnEmpty: true,
        };
      }

      // 删除或清理缓冲区
      if (buffer.pendingTimeoutAudio || buffer.pendingPauseAudio) {
        // 保留pending音频，只清空已处理的状态
        buffer.audioChunks = [];
        buffer.totalDurationMs = 0;
        buffer.originalJobInfo = [];
        buffer.isManualCut = false;
        buffer.isPauseTriggered = false;
        buffer.isTimeoutTriggered = false;
      } else {
        // 可以安全删除缓冲区
        this.buffers.delete(sessionId);
      }

      return {
        audioSegments: audioSegmentsBase64,
        originalJobIds,
        originalJobInfo: jobInfoToProcess,
        shouldReturnEmpty: false,
      };
    }

    // 继续缓冲
    return {
      audioSegments: [],
      shouldReturnEmpty: true,
    };
  }

  /**
   * 聚合多个音频块为一个完整的音频
   */
  private aggregateAudioChunks(chunks: Buffer[]): Buffer {
    return this.audioMerger.aggregateAudioChunks(chunks);
  }


  /**
   * 清空指定会话的缓冲区（用于错误处理或会话结束）
   */
  clearBuffer(sessionId: string): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer) {
      logger.info(
        {
          sessionId,
          chunkCount: buffer.audioChunks.length,
          totalDurationMs: buffer.totalDurationMs,
        },
        'AudioAggregator: Buffer cleared'
      );
      this.buffers.delete(sessionId);
    }
  }

  /**
   * 清理所有过期缓冲区（用于防止内存泄漏）
   * 清理条件：
   * 1. pendingTimeoutAudio 超过 TTL（10秒）且没有后续活动
   * 2. 缓冲区超过最大空闲时间（5分钟）
   */
  cleanupExpiredBuffers(): void {
    const nowMs = Date.now();
    const MAX_IDLE_TIME_MS = 5 * 60 * 1000; // 5分钟
    const expiredSessionIds: string[] = [];

    for (const [sessionId, buffer] of this.buffers.entries()) {
      const lastActivityMs = buffer.lastChunkTimeMs;
      const idleTimeMs = nowMs - lastActivityMs;

      // 检查 pendingTimeoutAudio TTL
      let shouldCleanup = false;
      if (buffer.pendingTimeoutAudio && buffer.pendingTimeoutAudioCreatedAt) {
        const pendingAgeMs = nowMs - buffer.pendingTimeoutAudioCreatedAt;
        if (pendingAgeMs >= this.PENDING_TIMEOUT_AUDIO_TTL_MS * 2) {
          // 超过 TTL 的2倍，说明已经没有后续活动，可以清理
          shouldCleanup = true;
        }
      }

      // 检查缓冲区空闲时间
      if (idleTimeMs >= MAX_IDLE_TIME_MS) {
        shouldCleanup = true;
      }

      if (shouldCleanup) {
        expiredSessionIds.push(sessionId);
      }
    }

    // 清理过期缓冲区
    for (const sessionId of expiredSessionIds) {
      logger.info(
        {
          sessionId,
          reason: 'Buffer expired, cleaning up to prevent memory leak',
        },
        'AudioAggregator: Cleaning up expired buffer'
      );
      this.buffers.delete(sessionId);
    }
  }

  /**
   * 创建流式批次：将音频段组合成~5秒批次
   * 
   * @param audioSegments 切分后的音频段数组
   * @param jobInfo 原始job信息映射
   * @param shouldCacheRemaining 是否缓存剩余小片段（手动发送时应该为false）
   * @returns 批次数组和剩余小片段
   */
  private createStreamingBatchesWithPending(
    audioSegments: Buffer[],
    jobInfo: OriginalJobInfo[],
    shouldCacheRemaining: boolean = true
  ): {
    batches: Buffer[];
    remainingSmallSegments: Buffer[];
    remainingSmallSegmentsJobInfo: OriginalJobInfo[];
  } {
    return this.streamBatcher.createStreamingBatchesWithPending(audioSegments, jobInfo, shouldCacheRemaining);
  }

  /**
   * 构建Job容器
   * 
   * @param jobInfo 原始job信息映射
   * @returns Job容器数组
   */
  private buildContainers(jobInfo: OriginalJobInfo[]): JobContainer[] {
    return this.jobContainer.buildContainers(jobInfo);
  }

  /**
   * 容器分配算法：将batch分配给job容器
   * 
   * @param batches 批次数组
   * @param containers 容器数组
   * @returns 分配后的容器数组
   */
  private assignBatchesToContainers(
    batches: Buffer[],
    containers: JobContainer[]
  ): JobContainer[] {
    return this.jobContainer.assignBatchesToContainers(batches, containers);
  }

  /**
   * 为批次分配originalJobIds（容器分配算法）
   * 
   * 策略：根据expectedDurationMs判断容器是否装满，容器装满后切换到下一个容器
   * 这样做的优势：
   * 1. 确保最终输出文本段数 ≤ Job数量
   * 2. 容器装满后自动切换，避免碎片化输出
   * 3. 空容器发送空核销结果
   * 
   * @param batches 批次数组
   * @param jobInfo 原始job信息映射
   * @returns 每个批次对应的originalJobId数组
   */
  private assignOriginalJobIdsForBatches(
    batches: Buffer[],
    jobInfo: OriginalJobInfo[]
  ): string[] {
    return this.jobContainer.assignOriginalJobIdsForBatches(batches, jobInfo);
  }

  /**
   * 为音频段分配originalJobIds
   * 
   * @param audioSegments 音频片段数组
   * @param originalJobInfo 原始job信息映射
   * @param aggregatedAudioStartOffset 聚合音频的起始偏移
   * @returns 每个片段对应的originalJobId数组
   */
  private assignOriginalJobIds(
    audioSegments: Buffer[],
    originalJobInfo: OriginalJobInfo[],
    aggregatedAudioStartOffset: number = 0
  ): string[] {
    return this.jobContainer.assignOriginalJobIds(audioSegments, originalJobInfo, aggregatedAudioStartOffset);
  }

  /**
   * 获取缓冲区状态（用于调试）
   */
  getBufferStatus(sessionId: string): {
    chunkCount: number;
    totalDurationMs: number;
    isManualCut: boolean;
    isPauseTriggered: boolean;
    isTimeoutTriggered: boolean;
    hasPendingTimeoutAudio: boolean;
    pendingTimeoutAudioDurationMs?: number;
    pendingSmallSegmentsCount: number;
  } | null {
    const buffer = this.buffers.get(sessionId);
    if (!buffer) {
      return null;
    }

    return {
      chunkCount: buffer.audioChunks.length,
      totalDurationMs: buffer.totalDurationMs,
      isManualCut: buffer.isManualCut,
      isPauseTriggered: buffer.isPauseTriggered,
      isTimeoutTriggered: buffer.isTimeoutTriggered,
      hasPendingTimeoutAudio: !!buffer.pendingTimeoutAudio,
      pendingTimeoutAudioDurationMs: buffer.pendingTimeoutAudio
        ? (buffer.pendingTimeoutAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
        : undefined,
      pendingSmallSegmentsCount: buffer.pendingSmallSegments.length,
    };
  }
}

