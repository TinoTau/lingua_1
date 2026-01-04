/**
 * 音频聚合器：在ASR之前聚合音频
 * 
 * 功能：
 * 1. 根据 is_manual_cut 和 is_pause_triggered 标识，将多个音频块聚合成完整句子
 * 2. 避免ASR识别不完整的短句，提高识别准确率
 * 3. 减少NMT翻译次数，提高处理效率
 */

import logger from '../logger';
import { JobAssignMessage } from '../../../../shared/protocols/messages';
import { decodeOpusToPcm16, encodePcm16ToOpusBuffer } from '../utils/opus-codec';
import { AudioAggregatorUtils } from './audio-aggregator-utils';

interface AudioBuffer {
  audioChunks: Buffer[];
  totalDurationMs: number;
  startTimeMs: number;
  lastChunkTimeMs: number;
  isManualCut: boolean;
  isPauseTriggered: boolean;
  isTimeoutTriggered: boolean;
  sessionId: string;
  utteranceIndex: number;
  // 保留的后半句音频（用于超时切割后的合并）
  pendingSecondHalf?: Buffer;
  // 保留的后半句创建时间（用于TTL检查）
  pendingSecondHalfCreatedAt?: number;
  // 延迟处理机制：短句等待合并
  shortUtteranceWaitUntil?: number; // 等待截止时间（毫秒时间戳）
  shortUtteranceJobId?: string; // 等待的job ID
}

export class AudioAggregator {
  private buffers: Map<string, AudioBuffer> = new Map();
  private readonly MAX_BUFFER_DURATION_MS = 20000; // 最大缓冲时长：20秒
  private readonly MIN_AUTO_PROCESS_DURATION_MS = 10000; // 最短自动处理时长：10秒（用户表达一个短句时也需要说够一定时间，10秒的音频应该足够ASR识别出正确的文本）
  private readonly SAMPLE_RATE = 16000; // 固定采样率
  private readonly BYTES_PER_SAMPLE = 2; // PCM16: 2 bytes per sample

  // 优化参数
  private readonly PENDING_SECOND_HALF_TTL_MS = 12000; // pendingSecondHalf TTL：12秒
  private readonly PENDING_SECOND_HALF_MAX_DURATION_MS = 12000; // pendingSecondHalf最大时长：12秒
  // 分割点Hangover：600ms
  // 作用：
  // 1. 避免在单词中间切断，提高ASR识别准确度
  // 2. 包含一个完整的词或短语（通常200-500ms一个词，600ms可以包含1-2个词）
  // 3. 制造更明显的重复内容，提高文本去重检测的成功率
  // 4. 即使有重复，后续的去重逻辑可以准确检测并移除
  private readonly SPLIT_HANGOVER_MS = 600; // 从200ms增加到600ms，提高去重检测成功率
  private readonly SECONDARY_SPLIT_THRESHOLD_MS = 10000; // 二级切割阈值：10秒
  // 短句延迟合并参数
  private readonly SHORT_UTTERANCE_THRESHOLD_MS = 6000; // 短句阈值：6秒（小于6秒认为是短句）
  private readonly SHORT_UTTERANCE_WAIT_MS = 2000; // 短句等待时间：2秒（等待下一个chunk到达）

  // 音频分析工具
  private readonly audioUtils = new AudioAggregatorUtils();

  /**
   * 处理音频块，根据标识决定是否聚合
   * 
   * @param job 任务消息
   * @returns 如果应该立即处理，返回聚合后的音频；否则返回null（继续缓冲）
   *          如果是超时切割，返回前半句音频，后半句保留在缓冲区
   */
  async processAudioChunk(job: JobAssignMessage): Promise<Buffer | null> {
    const sessionId = job.session_id;
    const isManualCut = (job as any).is_manual_cut || false;
    const isPauseTriggered = (job as any).is_pause_triggered || false;
    const isTimeoutTriggered = (job as any).is_timeout_triggered || false;
    const nowMs = Date.now();

    // 解码当前音频块（从Opus base64字符串解码为PCM16 Buffer）
    let currentAudio: Buffer;
    try {
      if (job.audio_format === 'opus') {
        // Opus格式：需要解码
        currentAudio = await decodeOpusToPcm16(job.audio, this.SAMPLE_RATE);
      } else if (job.audio_format === 'pcm16') {
        // PCM16格式：直接解码base64
        currentAudio = Buffer.from(job.audio, 'base64');
      } else {
        logger.error(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            audioFormat: job.audio_format,
          },
          'AudioAggregator: Unsupported audio format'
        );
        throw new Error(`Unsupported audio format: ${job.audio_format}`);
      }
      
      // 验证解码后的音频长度是否为2的倍数（PCM16要求）
      if (currentAudio.length % 2 !== 0) {
        logger.error(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            audioFormat: job.audio_format,
            audioLength: currentAudio.length,
            isOdd: currentAudio.length % 2 !== 0,
            audioBase64Length: job.audio.length,
          },
          '🚨 CRITICAL: Decoded audio chunk length is not a multiple of 2! This will cause ASR service to fail.'
        );
        // 修复：截断最后一个字节，确保长度是2的倍数
        const fixedLength = currentAudio.length - (currentAudio.length % 2);
        const fixedAudio = currentAudio.slice(0, fixedLength);
        logger.warn(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            originalLength: currentAudio.length,
            fixedLength: fixedAudio.length,
            bytesRemoved: currentAudio.length - fixedAudio.length,
          },
          'Fixed audio chunk length by truncating last byte(s)'
        );
        currentAudio = fixedAudio;
      }
      
      logger.debug(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          audioFormat: job.audio_format,
          audioLength: currentAudio.length,
          isLengthValid: currentAudio.length % 2 === 0,
          audioBase64Length: job.audio.length,
        },
        'AudioAggregator: Audio chunk decoded and validated'
      );
    } catch (error) {
      logger.error(
        {
          error,
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          audioFormat: job.audio_format,
          audioBase64Length: job.audio?.length || 0,
        },
        'AudioAggregator: Failed to decode audio chunk'
      );
      throw error;
    }

    let currentDurationMs = (currentAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

    // 获取或创建缓冲区
    let buffer = this.buffers.get(sessionId);
    if (!buffer) {
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
      };
      this.buffers.set(sessionId, buffer);
    }

    // 如果有保留的后半句，先与当前音频合并
    if (buffer.pendingSecondHalf) {
      // 优化：检查TTL和长度上限
      const pendingAge = buffer.pendingSecondHalfCreatedAt
        ? nowMs - buffer.pendingSecondHalfCreatedAt
        : 0;
      const pendingDurationMs = (buffer.pendingSecondHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

      const shouldFlushPending =
        pendingAge > this.PENDING_SECOND_HALF_TTL_MS ||
        pendingDurationMs > this.PENDING_SECOND_HALF_MAX_DURATION_MS;

      if (shouldFlushPending) {
        logger.warn(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            pendingAge,
            pendingDurationMs,
            reason: pendingAge > this.PENDING_SECOND_HALF_TTL_MS ? 'TTL exceeded' : 'Max duration exceeded',
          },
          'AudioAggregator: Flushing pending second half due to TTL or max duration'
        );
        // 将pendingSecondHalf作为独立音频处理，不合并
        // 这里我们将其添加到当前音频之前
        const mergedAudio = Buffer.alloc(buffer.pendingSecondHalf.length + currentAudio.length);
        buffer.pendingSecondHalf.copy(mergedAudio, 0);
        currentAudio.copy(mergedAudio, buffer.pendingSecondHalf.length);
        currentAudio = mergedAudio;
        currentDurationMs = (currentAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
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
        currentDurationMs = (currentAudio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        buffer.pendingSecondHalf = undefined; // 清空保留的后半句
        buffer.pendingSecondHalfCreatedAt = undefined;
      }
    }

    // 更新缓冲区
    buffer.audioChunks.push(currentAudio);
    buffer.totalDurationMs += currentDurationMs;
    buffer.lastChunkTimeMs = nowMs;
    buffer.isManualCut = buffer.isManualCut || isManualCut;
    buffer.isPauseTriggered = buffer.isPauseTriggered || isPauseTriggered;
    buffer.isTimeoutTriggered = buffer.isTimeoutTriggered || isTimeoutTriggered;

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
        hasPendingSecondHalf: !!buffer.pendingSecondHalf,
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
    // 6. 优化：短句延迟合并 - 如果当前音频很短（<6秒）且isManualCut=true，延迟处理等待下一个chunk
    
    // 检查是否在等待延迟合并期间（优先检查，避免重复设置等待）
    if (buffer.shortUtteranceWaitUntil) {
      if (nowMs < buffer.shortUtteranceWaitUntil) {
        // 还在等待期间，继续缓冲当前chunk
        logger.debug(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            waitUntil: buffer.shortUtteranceWaitUntil,
            nowMs,
            remainingMs: buffer.shortUtteranceWaitUntil - nowMs,
            totalDurationMs: buffer.totalDurationMs,
            reason: 'Still waiting for short utterance merge, buffering current chunk',
          },
          'AudioAggregator: Still waiting for short utterance merge, buffering current chunk'
        );
        return null; // 继续缓冲
      } else {
        // 等待超时，清除等待标志，继续正常处理
        logger.info(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            waitedJobId: buffer.shortUtteranceJobId,
            waitUntil: buffer.shortUtteranceWaitUntil,
            nowMs,
            elapsedMs: nowMs - (buffer.shortUtteranceWaitUntil - this.SHORT_UTTERANCE_WAIT_MS),
            totalDurationMs: buffer.totalDurationMs,
            reason: 'Short utterance wait timeout, processing now',
          },
          'AudioAggregator: Short utterance wait timeout, processing buffered audio'
        );
        buffer.shortUtteranceWaitUntil = undefined;
        buffer.shortUtteranceJobId = undefined;
        // 注意：等待超时后，继续执行下面的逻辑，因为 isManualCut 可能仍然为 true
      }
    }
    
    // 检查是否应该延迟合并（只在没有等待标志时设置）
    const isShortUtterance = buffer.totalDurationMs < this.SHORT_UTTERANCE_THRESHOLD_MS;
    const shouldDelayForMerge = isShortUtterance && isManualCut && !isPauseTriggered && !isTimeoutTriggered && !buffer.shortUtteranceWaitUntil;
    
    if (shouldDelayForMerge) {
      // 设置延迟等待，等待下一个chunk到达
      buffer.shortUtteranceWaitUntil = nowMs + this.SHORT_UTTERANCE_WAIT_MS;
      buffer.shortUtteranceJobId = job.job_id;
      logger.info(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          totalDurationMs: buffer.totalDurationMs,
          waitUntil: buffer.shortUtteranceWaitUntil,
          waitMs: this.SHORT_UTTERANCE_WAIT_MS,
          reason: 'Short utterance detected, waiting for potential merge with next chunk',
        },
        'AudioAggregator: Short utterance detected, delaying processing to wait for merge'
      );
      return null; // 继续缓冲，等待下一个chunk
    }
    
    const shouldProcessNow =
      isManualCut ||  // 手动截断：立即处理
      isPauseTriggered ||  // 3秒静音：立即处理（包括调度服务器的pause超时finalize）
      isTimeoutTriggered ||  // 修复：超时finalize（调度服务器检测到没有更多chunk），立即处理（即使时长小于10秒）
      buffer.totalDurationMs >= this.MAX_BUFFER_DURATION_MS ||  // 超过最大缓冲时长（20秒）：立即处理
      (buffer.totalDurationMs >= this.MIN_AUTO_PROCESS_DURATION_MS && !isTimeoutTriggered);  // 达到最短自动处理时长（10秒）且不是超时触发：立即处理

    // 特殊处理：超时标识（is_timeout_triggered）
    // 需要找到最长停顿，分割成前半句和后半句
    // 注意：如果之前有pendingSecondHalf，已经在上面合并到currentAudio了
    if (isTimeoutTriggered) {
      // 聚合所有音频块（包括之前保留的后半句，如果有的话，已经合并到currentAudio）
      const aggregatedAudio = this.aggregateAudioChunks(buffer.audioChunks);

      // 找到最长停顿并分割
      const splitResult = this.audioUtils.findLongestPauseAndSplit(aggregatedAudio);

      if (splitResult && splitResult.splitPosition > 0 && splitResult.splitPosition < aggregatedAudio.length) {
        // 优化：应用Hangover - 对前半句额外保留SPLIT_HANGOVER_MS的音频
        const hangoverBytes = Math.floor(
          (this.SPLIT_HANGOVER_MS / 1000) * this.SAMPLE_RATE * this.BYTES_PER_SAMPLE
        );
        const hangoverEnd = Math.min(splitResult.splitPosition + hangoverBytes, aggregatedAudio.length);
        const firstHalfWithHangover = aggregatedAudio.slice(0, hangoverEnd);
        const secondHalfAfterHangover = aggregatedAudio.slice(hangoverEnd);

        logger.info(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            originalSplitPosition: splitResult.splitPosition,
            hangoverMs: this.SPLIT_HANGOVER_MS,
            hangoverBytes,
            hangoverEnd,
            firstHalfDurationMs: (firstHalfWithHangover.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            secondHalfDurationMs: (secondHalfAfterHangover.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            longestPauseMs: splitResult.longestPauseMs,
            hadPendingSecondHalf: !!buffer.pendingSecondHalf,
            hangoverPurpose: 'Improve ASR accuracy and enable better text deduplication',
          },
          `AudioAggregator: Timeout triggered, split audio at longest pause with ${this.SPLIT_HANGOVER_MS}ms hangover. First half ready for ASR, second half buffered. Hangover helps ASR accuracy and creates overlap for deduplication.`
        );

        // 优化：检查前半句是否仍然过长，如果是则进行二级切割
        const firstHalfDurationMs = (firstHalfWithHangover.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
        let finalFirstHalf = firstHalfWithHangover;
        let finalSecondHalf = secondHalfAfterHangover;

        if (firstHalfDurationMs > this.SECONDARY_SPLIT_THRESHOLD_MS) {
          logger.info(
            {
              jobId: job.job_id,
              sessionId,
              utteranceIndex: job.utterance_index,
              firstHalfDurationMs,
              threshold: this.SECONDARY_SPLIT_THRESHOLD_MS,
            },
            'AudioAggregator: First half still too long, attempting secondary split'
          );

          const secondarySplit = this.audioUtils.findLongestPauseAndSplit(firstHalfWithHangover);
          if (secondarySplit && secondarySplit.splitPosition > 0 && secondarySplit.splitPosition < firstHalfWithHangover.length) {
            // 二级切割成功
            const secondaryFirstHalf = firstHalfWithHangover.slice(0, secondarySplit.splitPosition);
            const secondarySecondHalf = firstHalfWithHangover.slice(secondarySplit.splitPosition);

            logger.info(
              {
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                secondarySplitPosition: secondarySplit.splitPosition,
                secondaryFirstHalfDurationMs: (secondaryFirstHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
                secondarySecondHalfDurationMs: (secondarySecondHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
              },
              'AudioAggregator: Secondary split successful'
            );

            // 将二级切割的后半句也加入pendingSecondHalf（在原始后半句之前）
            if (secondHalfAfterHangover.length > 0) {
              const combinedSecondHalf = Buffer.alloc(secondarySecondHalf.length + secondHalfAfterHangover.length);
              secondarySecondHalf.copy(combinedSecondHalf, 0);
              secondHalfAfterHangover.copy(combinedSecondHalf, secondarySecondHalf.length);
              finalSecondHalf = combinedSecondHalf;
            } else {
              finalSecondHalf = secondarySecondHalf;
            }
            finalFirstHalf = secondaryFirstHalf;
          } else {
            // 二级切割失败，使用原始前半句
            logger.warn(
              {
                jobId: job.job_id,
                sessionId,
                utteranceIndex: job.utterance_index,
                reason: 'Secondary split failed, using original first half',
              },
              'AudioAggregator: Secondary split failed'
            );
          }
        }

        // 保留后半句在缓冲区（等待与后续utterance合并）
        buffer.pendingSecondHalf = finalSecondHalf;
        buffer.audioChunks = []; // 清空音频块列表
        buffer.totalDurationMs = 0; // 重置时长
        buffer.isTimeoutTriggered = false; // 重置超时标识（后半句等待后续utterance）
        buffer.pendingSecondHalfCreatedAt = nowMs; // 记录创建时间
        // 注意：不清空缓冲区，保留pendingSecondHalf

        logger.info(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            firstHalfDurationMs: (finalFirstHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            secondHalfDurationMs: (finalSecondHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            secondHalfLength: finalSecondHalf.length,
            pendingSecondHalfCreatedAt: nowMs,
          },
          'AudioAggregator: Timeout split completed, second half saved to pendingSecondHalf'
        );

        // 返回前半句，立即进行ASR识别（使用当前utterance_id）
        return finalFirstHalf;
      } else {
        // 优化：找不到静音段时，使用兜底策略 - 寻找能量最低的连续区间
        logger.warn(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            totalDurationMs: buffer.totalDurationMs,
            reason: 'No pause found in audio, attempting fallback split',
          },
          'AudioAggregator: Timeout triggered but no pause found, attempting fallback split'
        );

        const fallbackSplit = this.audioUtils.findLowestEnergyInterval(aggregatedAudio);
        if (fallbackSplit) {
          logger.info(
            {
              jobId: job.job_id,
              sessionId,
              utteranceIndex: job.utterance_index,
              fallbackSplitPosition: fallbackSplit.end,
              fallbackFirstHalfDurationMs: (fallbackSplit.end / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
              fallbackSecondHalfDurationMs: ((aggregatedAudio.length - fallbackSplit.end) / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            },
            'AudioAggregator: Fallback split successful'
          );

          const firstHalf = aggregatedAudio.slice(0, fallbackSplit.end);
          const secondHalf = aggregatedAudio.slice(fallbackSplit.end);

          // 保留后半句在缓冲区
          buffer.pendingSecondHalf = secondHalf;
          buffer.audioChunks = [];
          buffer.totalDurationMs = 0;
          buffer.isTimeoutTriggered = false;
          buffer.pendingSecondHalfCreatedAt = nowMs;

          logger.info(
            {
              jobId: job.job_id,
              sessionId,
              utteranceIndex: job.utterance_index,
              firstHalfDurationMs: (firstHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
              secondHalfDurationMs: (secondHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
              secondHalfLength: secondHalf.length,
              pendingSecondHalfCreatedAt: nowMs,
            },
            'AudioAggregator: Fallback split successful, second half saved to pendingSecondHalf'
          );

          return firstHalf;
        } else {
          // 兜底策略也失败，直接返回完整音频
          logger.warn(
            {
              jobId: job.job_id,
              sessionId,
              utteranceIndex: job.utterance_index,
              totalDurationMs: buffer.totalDurationMs,
              reason: 'Fallback split also failed, using full audio without splitting',
            },
            'AudioAggregator: Timeout triggered but fallback split failed, using full audio'
          );

          // 清空缓冲区
          this.buffers.delete(sessionId);
          return aggregatedAudio;
        }
      }
    }

    if (shouldProcessNow) {
      // 聚合所有音频块
      const aggregatedAudio = this.aggregateAudioChunks(buffer.audioChunks);

      logger.info(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          aggregatedDurationMs: buffer.totalDurationMs,
          chunkCount: buffer.audioChunks.length,
          isManualCut: buffer.isManualCut,
          isPauseTriggered: buffer.isPauseTriggered,
          aggregatedAudioLength: aggregatedAudio.length,
          hasPendingSecondHalf: !!buffer.pendingSecondHalf,
        },
        'AudioAggregator: Aggregated audio ready for ASR'
      );

      // 清除延迟等待标志（如果存在，因为音频已经处理）
      if (buffer.shortUtteranceWaitUntil) {
        buffer.shortUtteranceWaitUntil = undefined;
        buffer.shortUtteranceJobId = undefined;
      }
      
      // 修复：如果存在pendingSecondHalf，保留它；否则清空缓冲区
      if (buffer.pendingSecondHalf) {
        // 类型断言：在if检查后，pendingSecondHalf 应该是 Buffer 类型
        const pendingSecondHalf = buffer.pendingSecondHalf as Buffer;
        logger.info(
          {
            jobId: job.job_id,
            sessionId,
            utteranceIndex: job.utterance_index,
            pendingSecondHalfLength: pendingSecondHalf.length,
            pendingSecondHalfDurationMs: (pendingSecondHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
          },
          'AudioAggregator: Preserving pendingSecondHalf for next utterance'
        );
        // 保留pendingSecondHalf，只清空audioChunks和其他状态
        buffer.audioChunks = [];
        buffer.totalDurationMs = 0;
        buffer.isManualCut = false;
        buffer.isPauseTriggered = false;
        buffer.isTimeoutTriggered = false;
        // 注意：不清空pendingSecondHalf和pendingSecondHalfCreatedAt
        // 注意：shortUtteranceWaitUntil 已经在上面清除（第545-548行），因为音频已经处理
      } else {
        // 没有pendingSecondHalf，可以安全删除缓冲区
        this.buffers.delete(sessionId);
      }

      return aggregatedAudio;
    } else {
      // 继续缓冲
      logger.debug(
        {
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
          totalDurationMs: buffer.totalDurationMs,
          chunkCount: buffer.audioChunks.length,
        },
        'AudioAggregator: Audio chunk buffered, waiting for more chunks or trigger'
      );
      return null; // 返回null表示继续缓冲
    }
  }

  /**
   * 聚合多个音频块为一个完整的音频
   */
  private aggregateAudioChunks(chunks: Buffer[]): Buffer {
    if (chunks.length === 0) {
      throw new Error('AudioAggregator: No audio chunks to aggregate');
    }

    if (chunks.length === 1) {
      // 验证单个chunk的长度
      const chunk = chunks[0];
      if (chunk.length % 2 !== 0) {
        logger.error(
          {
            chunkLength: chunk.length,
            isOdd: chunk.length % 2 !== 0,
          },
          '🚨 CRITICAL: Single audio chunk length is not a multiple of 2!'
        );
        // 修复：截断最后一个字节
        const fixedLength = chunk.length - (chunk.length % 2);
        return chunk.slice(0, fixedLength);
      }
      return chunk;
    }

    // 验证每个chunk的长度并记录
    const chunkLengths = chunks.map((chunk, idx) => {
      const isValid = chunk.length % 2 === 0;
      if (!isValid) {
        logger.error(
          {
            chunkIndex: idx,
            chunkLength: chunk.length,
            isOdd: chunk.length % 2 !== 0,
          },
          '🚨 CRITICAL: Audio chunk length is not a multiple of 2!'
        );
      }
      return { index: idx, length: chunk.length, isValid };
    });

    // 计算总长度
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // 验证总长度是否为2的倍数
    if (totalLength % 2 !== 0) {
      logger.error(
        {
          totalLength,
          chunkCount: chunks.length,
          chunkLengths: chunkLengths.map(c => `${c.index}:${c.length}(${c.isValid ? 'valid' : 'INVALID'})`),
          isOdd: totalLength % 2 !== 0,
        },
        '🚨 CRITICAL: Aggregated audio total length is not a multiple of 2! This will cause ASR service to fail.'
      );
    }

    // 创建聚合后的音频缓冲区
    const aggregated = Buffer.alloc(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      chunk.copy(aggregated, offset);
      offset += chunk.length;
    }

    // 如果总长度不是2的倍数，修复它
    if (aggregated.length % 2 !== 0) {
      const fixedLength = aggregated.length - (aggregated.length % 2);
      const fixedBuffer = aggregated.slice(0, fixedLength);
      logger.warn(
        {
          originalLength: aggregated.length,
          fixedLength: fixedBuffer.length,
          bytesRemoved: aggregated.length - fixedBuffer.length,
          chunkCount: chunks.length,
        },
        'Fixed aggregated audio length by truncating last byte(s)'
      );
      return fixedBuffer;
    }

    logger.debug(
      {
        totalLength: aggregated.length,
        chunkCount: chunks.length,
        isLengthValid: aggregated.length % 2 === 0,
      },
      'AudioAggregator: Audio chunks aggregated successfully'
    );

    return aggregated;
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
   * 获取缓冲区状态（用于调试）
   */
  getBufferStatus(sessionId: string): {
    chunkCount: number;
    totalDurationMs: number;
    isManualCut: boolean;
    isPauseTriggered: boolean;
    isTimeoutTriggered: boolean;
    hasPendingSecondHalf: boolean;
    pendingSecondHalfDurationMs?: number;
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
      hasPendingSecondHalf: !!buffer.pendingSecondHalf,
      pendingSecondHalfDurationMs: buffer.pendingSecondHalf
        ? (buffer.pendingSecondHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000
        : undefined,
    };
  }
}

