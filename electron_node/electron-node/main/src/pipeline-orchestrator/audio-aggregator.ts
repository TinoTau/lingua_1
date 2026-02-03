/**
 * 音频聚合器：在ASR之前聚合音频
 * 
 * 功能：
 * 1. 根据 is_manual_cut 和 is_timeout_triggered 标识，将多个音频块聚合成完整句子
 * 2. 避免ASR识别不完整的短句，提高识别准确率
 * 3. 减少NMT翻译次数，提高处理效率
 * 4. 流式切分：长音频按能量切分，组合成~5秒批次发送给ASR
 * 
 * 设计：
 * - 使用依赖注入方式创建实例（通过 ServicesBundle 传递）
 * - 支持热插拔：每次 InferenceService 创建时都有新的干净实例
 * - Buffer key：turn_id|tgt_lang（同一 turn 同语言共 buffer）；无 turn_id 退化为 job_id
 * 
 * @see AUDIO_AGGREGATOR_ARCHITECTURE.md 详细架构文档
 */

import logger from '../logger';
import { JobAssignMessage } from '../../../../shared/protocols/messages';
import { AudioAggregatorUtils } from './audio-aggregator-utils';
import { decodeAudioChunk } from './audio-aggregator-decoder';
import { AudioChunkResult, OriginalJobInfo, AudioBuffer, BufferState } from './audio-aggregator-types';
import { AudioAggregatorStreamBatcher } from './audio-aggregator-stream-batcher';
import { AudioAggregatorMerger } from './audio-aggregator-merger';
import { AudioAggregatorTimeoutHandler } from './audio-aggregator-timeout-handler';
import { AudioAggregatorFinalizeHandler } from './audio-aggregator-finalize-handler';
import { buildBufferKey } from './audio-aggregator-buffer-key';
import {
  getOrCreateBuffer,
  shouldReturnEmptyInput,
  deleteBufferFromMap,
  cleanupExpiredBuffersFromMap,
} from './audio-aggregator-buffer-lifecycle';
import { executeFinalizeAndReturn } from './audio-aggregator-process-finalize';


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
  /** pendingTimeoutAudio TTL：10秒（如果10秒内没有手动/pause cut，强制处理） */
  private readonly PENDING_TIMEOUT_AUDIO_TTL_MS = 10000;

  // 音频分析工具
  private readonly audioUtils = new AudioAggregatorUtils();

  // 流式批次处理器
  private readonly streamBatcher = new AudioAggregatorStreamBatcher();

  // 音频合并器
  private readonly audioMerger = new AudioAggregatorMerger();

  // 超时处理器
  private readonly timeoutHandler = new AudioAggregatorTimeoutHandler();

  // Finalize 处理器（manual/timeout 时合并并输出）
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
    // is_pause_triggered 已废弃（pause finalize 已删除），不再使用
    const isTimeoutTriggered = (job as any).is_timeout_triggered || false;
    const nowMs = Date.now();

    // 构建 bufferKey（唯一、稳定、显式）
    const bufferKey = buildBufferKey(job);

    logger.info(
      {
        jobId: job.job_id,
        bufferKey,
        sessionId,
        utteranceIndex: job.utterance_index,
        isManualCut,
        isTimeoutTriggered,
      },
      'AudioAggregator: [BufferKey] Processing audio chunk - bufferKey check'
    );

    // 解码当前音频块
    const decodeResult = await decodeAudioChunk(job, this.SAMPLE_RATE, this.BYTES_PER_SAMPLE);
    let currentAudio = decodeResult.audio;
    let currentDurationMs = decodeResult.durationMs;

    const currentBuffer = getOrCreateBuffer(this.buffers, bufferKey, job, nowMs);

    // ✅ R4修复：检查是否为空音频（在更新缓冲区之前）
    if (shouldReturnEmptyInput(currentBuffer, currentAudio, currentDurationMs)) {
      this.deleteBuffer(bufferKey, currentBuffer, 'Empty audio input', nowMs);
      return {
        audioSegments: [],
        shouldReturnEmpty: true,
        reason: 'EMPTY_INPUT',
      };
    }

    // 检查 pendingTimeoutAudio 是否超过 TTL（10秒），超时则强制执行 finalize+ASR

    const ttlCheckResult = this.timeoutHandler.checkTimeoutTTL(currentBuffer, job, currentAudio, nowMs);

    if (ttlCheckResult) {
      if (ttlCheckResult.clearPendingTimeout) {
        currentBuffer.pendingTimeoutAudio = undefined;
        currentBuffer.pendingTimeoutAudioCreatedAt = undefined;
        currentBuffer.pendingTimeoutJobInfo = undefined;
      }

      if (ttlCheckResult.shouldProcess) {
        // 转换为base64字符串数组
        const audioSegmentsBase64 = ttlCheckResult.audioSegments.map(seg => seg.toString('base64'));

        return {
          audioSegments: audioSegmentsBase64,
          originalJobIds: ttlCheckResult.originalJobIds,
          shouldReturnEmpty: false,
          reason: 'NORMAL',
        };
      }
    }

    // 更新缓冲区（先更新，再处理 finalize，与备份代码一致）
    currentBuffer.audioChunks.push(currentAudio);
    currentBuffer.totalDurationMs += currentDurationMs;
    currentBuffer.lastChunkTimeMs = nowMs;
    currentBuffer.isManualCut = currentBuffer.isManualCut || isManualCut;
    currentBuffer.isTimeoutTriggered = currentBuffer.isTimeoutTriggered || isTimeoutTriggered;

    // 记录当前job在聚合音频中的字节偏移范围（用于originalJobIds分配）
    // ✅ 性能优化：只计算长度，不聚合完整Buffer（避免不必要的Buffer合并）
    const aggregatedAudioLength = currentBuffer.audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const currentJobStartOffset = aggregatedAudioLength - currentAudio.length;
    const currentJobEndOffset = aggregatedAudioLength;

    // 获取expectedDurationMs（从job消息中，如果没有则使用当前时长的1.2倍作为估算）
    const expectedDurationMs = (job as any).expected_duration_ms ||
      Math.ceil(currentDurationMs * 1.2); // 如果没有，使用当前时长的1.2倍作为估算

    currentBuffer.originalJobInfo.push({
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
        totalDurationMs: currentBuffer.totalDurationMs,
        chunkCount: currentBuffer.audioChunks.length,
        isManualCut,
        isTimeoutTriggered,
        bufferIsManualCut: currentBuffer.isManualCut,
        bufferIsTimeoutTriggered: currentBuffer.isTimeoutTriggered,
      },
      'AudioAggregator: Audio chunk added to buffer'
    );

    // 判断是否应该立即处理（聚合并返回）
    // 按照现在的设计，所有音频都在ASR之前等待处理标识：
    // 1. 手动截断（isManualCut）
    // 2. 超时finalize（isTimeoutTriggered，有特殊处理逻辑）
    // 3. 10秒自动处理：达到 MIN_AUTO_PROCESS_DURATION_MS 即输出，按能量切分+~5s 批次送 ASR，降低首包延迟
    // 4. 修复：isTimeoutTriggered 时即使时长小于10秒也立即处理（调度检测到没有更多 chunk）

    // 检查是否为空音频（在 shouldProcessNow 之前）
    if (shouldReturnEmptyInput(currentBuffer, currentAudio, currentDurationMs)) {
      this.deleteBuffer(bufferKey, currentBuffer, 'Empty audio input', nowMs);
      return {
        audioSegments: [],
        shouldReturnEmpty: true,
        reason: 'EMPTY_INPUT',
      };
    }

    const shouldProcessNow =
      isManualCut ||
      isTimeoutTriggered ||
      currentBuffer.totalDurationMs >= this.MAX_BUFFER_DURATION_MS ||
      (currentBuffer.totalDurationMs >= this.MIN_AUTO_PROCESS_DURATION_MS && !isTimeoutTriggered);

    if (shouldProcessNow) {
      return executeFinalizeAndReturn(
        {
          audioUtils: this.audioUtils,
          streamBatcher: this.streamBatcher,
          finalizeHandler: this.finalizeHandler,
          audioMerger: this.audioMerger,
          BYTES_PER_SAMPLE: this.BYTES_PER_SAMPLE,
          SAMPLE_RATE: this.SAMPLE_RATE,
          SPLIT_HANGOVER_MS: this.SPLIT_HANGOVER_MS,
          deleteBuffer: (key, buf, reason, t) => this.deleteBuffer(key, buf, reason, t),
        },
        bufferKey,
        currentBuffer,
        job,
        isManualCut,
        isTimeoutTriggered,
        nowMs
      );
    }

    // 继续缓冲
    return {
      audioSegments: [],
      shouldReturnEmpty: true,
      reason: 'NORMAL', // 正常缓冲，等待更多音频
    };
  }

  /**
   * 聚合多个音频块为一个完整的音频
   */
  private aggregateAudioChunks(chunks: Buffer[]): Buffer {
    return this.audioMerger.aggregateAudioChunks(chunks);
  }


  /**
   * 按 bufferKey（turn_id|tgt_lang）清空该 turn 的缓冲区。
   * 调用点仅两处：turn 内 segment 失败（job-pipeline catch）、turn 结束且最后一个 job 结果返回后（job-pipeline 正常返回前）。
   */
  clearBufferByKey(bufferKey: string): void {
    const buffer = this.buffers.get(bufferKey);
    if (buffer) {
      this.deleteBuffer(bufferKey, buffer, 'Turn clear (segment failed or turn ended)', Date.now());
    }
  }

  /**
   * 删除缓冲区（带删除原因和 pending 状态日志）
   */
  private deleteBuffer(
    bufferKey: string,
    buffer: AudioBuffer | undefined,
    reason: string,
    nowMs: number
  ): void {
    deleteBufferFromMap(this.buffers, bufferKey, buffer, reason, nowMs);
  }

  /**
   * 清理所有过期缓冲区（用于防止内存泄漏）
   * 清理条件：pendingTimeoutAudio 超过 TTL 的 2 倍，或缓冲区空闲超过 5 分钟
   */
  cleanupExpiredBuffers(): void {
    cleanupExpiredBuffersFromMap(this.buffers, {
      pendingTtlMs: this.PENDING_TIMEOUT_AUDIO_TTL_MS,
      maxIdleMs: 5 * 60 * 1000,
    });
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
    batchJobInfo: OriginalJobInfo[];
    remainingSmallSegments: Buffer[];
    remainingSmallSegmentsJobInfo: OriginalJobInfo[];
  } {
    return this.streamBatcher.createStreamingBatchesWithPending(audioSegments, jobInfo, shouldCacheRemaining);
  }


  /**
   * 获取缓冲区（bufferKey = buildBufferKey(job)）
   */
  getBuffer(job: JobAssignMessage): AudioBuffer | undefined {
    const bufferKey = buildBufferKey(job);
    return this.buffers.get(bufferKey);
  }

  /**
   * 按 bufferKey 获取缓冲区状态（用于调试）
   */
  getBufferStatusByKey(bufferKey: string): {
    bufferKey: string;
    epoch: number;
    state: BufferState;
    chunkCount: number;
    totalDurationMs: number;
    isManualCut: boolean;
    isTimeoutTriggered: boolean;
    hasPendingTimeoutAudio: boolean;
    pendingTimeoutAudioDurationMs?: number;
    pendingSmallSegmentsCount: number;
  } | null {
    const buffer = this.buffers.get(bufferKey);
    if (!buffer) {
      return null;
    }

    return {
      bufferKey: buffer.bufferKey,
      epoch: buffer.epoch,
      state: buffer.state,
      chunkCount: buffer.audioChunks.length,
      totalDurationMs: buffer.totalDurationMs,
      isManualCut: buffer.isManualCut,
      isTimeoutTriggered: buffer.isTimeoutTriggered,
      hasPendingTimeoutAudio: !!buffer.pendingTimeoutAudio,
      pendingTimeoutAudioDurationMs: buffer.pendingTimeoutAudio
        ? (buffer.pendingTimeoutAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
        : undefined,
      pendingSmallSegmentsCount: buffer.pendingSmallSegments.length,
    };
  }
}

