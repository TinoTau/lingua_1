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
  private readonly SPLIT_HANGOVER_MS = 200; // 分割点Hangover：200ms
  private readonly SECONDARY_SPLIT_THRESHOLD_MS = 10000; // 二级切割阈值：10秒

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
    } catch (error) {
      logger.error(
        {
          error,
          jobId: job.job_id,
          sessionId,
          utteranceIndex: job.utterance_index,
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

    logger.info(
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
      const splitResult = this.findLongestPauseAndSplit(aggregatedAudio);

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
            hangoverBytes,
            hangoverEnd,
            firstHalfDurationMs: (firstHalfWithHangover.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            secondHalfDurationMs: (secondHalfAfterHangover.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
            longestPauseMs: splitResult.longestPauseMs,
            hadPendingSecondHalf: !!buffer.pendingSecondHalf,
          },
          'AudioAggregator: Timeout triggered, split audio at longest pause with hangover. First half ready for ASR, second half buffered.'
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

          const secondarySplit = this.findLongestPauseAndSplit(firstHalfWithHangover);
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

        const fallbackSplit = this.findLowestEnergyInterval(aggregatedAudio);
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
      return chunks[0];
    }

    // 计算总长度
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // 创建聚合后的音频缓冲区
    const aggregated = Buffer.alloc(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      chunk.copy(aggregated, offset);
      offset += chunk.length;
    }

    return aggregated;
  }

  /**
   * 找到最长停顿并分割音频
   * 
   * @param audio PCM16音频数据
   * @returns 分割结果，包含分割位置和最长停顿时长
   */
  private findLongestPauseAndSplit(audio: Buffer): {
    splitPosition: number;
    longestPauseMs: number;
  } | null {
    const WINDOW_SIZE_MS = 100; // 分析窗口：100ms
    const WINDOW_SIZE_SAMPLES = Math.floor((WINDOW_SIZE_MS / 1000) * this.SAMPLE_RATE);
    const WINDOW_SIZE_BYTES = WINDOW_SIZE_SAMPLES * this.BYTES_PER_SAMPLE;

    const MIN_PAUSE_MS = 200; // 最小停顿时长：200ms

    if (audio.length < WINDOW_SIZE_BYTES * 2) {
      // 音频太短，无法分割
      return null;
    }

    // 计算每个窗口的RMS值
    const rmsValues: number[] = [];
    for (let offset = 0; offset <= audio.length - WINDOW_SIZE_BYTES; offset += WINDOW_SIZE_BYTES) {
      const window = audio.slice(offset, offset + WINDOW_SIZE_BYTES);
      const rms = this.calculateRMS(window);
      rmsValues.push(rms);
    }

    // 优化：使用相对阈值而非固定阈值
    const SILENCE_THRESHOLD = this.calculateAdaptiveSilenceThreshold(rmsValues);

    // 找到静音段（RMS值低于阈值的连续窗口）
    const silenceSegments: Array<{ start: number; end: number; duration: number }> = [];
    let silenceStart: number | null = null;

    for (let i = 0; i < rmsValues.length; i++) {
      if (rmsValues[i] < SILENCE_THRESHOLD) {
        if (silenceStart === null) {
          silenceStart = i;
        }
      } else {
        if (silenceStart !== null) {
          const duration = (i - silenceStart) * WINDOW_SIZE_MS;
          if (duration >= MIN_PAUSE_MS) {
            silenceSegments.push({
              start: silenceStart * WINDOW_SIZE_BYTES,
              end: i * WINDOW_SIZE_BYTES,
              duration,
            });
          }
          silenceStart = null;
        }
      }
    }

    // 处理最后一个静音段
    if (silenceStart !== null) {
      const duration = (rmsValues.length - silenceStart) * WINDOW_SIZE_MS;
      if (duration >= MIN_PAUSE_MS) {
        silenceSegments.push({
          start: silenceStart * WINDOW_SIZE_BYTES,
          end: audio.length,
          duration,
        });
      }
    }

    if (silenceSegments.length === 0) {
      // 没有找到静音段
      return null;
    }

    // 找到最长的静音段
    const longestPause = silenceSegments.reduce((longest, segment) =>
      segment.duration > longest.duration ? segment : longest
    );

    // 在最长静音段的中点或结束位置分割
    // 选择结束位置，因为这样可以保留更多上下文
    const splitPosition = longestPause.end;

    logger.info(
      {
        totalSegments: silenceSegments.length,
        longestPauseMs: longestPause.duration,
        longestPauseStart: longestPause.start,
        longestPauseEnd: longestPause.end,
        splitPosition,
        audioLength: audio.length,
      },
      'AudioAggregator: Found longest pause and split position'
    );

    return {
      splitPosition,
      longestPauseMs: longestPause.duration,
    };
  }

  /**
   * 计算音频的RMS（均方根）值
   * 
   * @param audio PCM16音频数据
   * @returns RMS值
   */
  private calculateRMS(audio: Buffer): number {
    if (audio.length === 0) {
      return 0;
    }

    let sumSquares = 0;
    const sampleCount = audio.length / this.BYTES_PER_SAMPLE;

    for (let i = 0; i < audio.length; i += this.BYTES_PER_SAMPLE) {
      // 读取16位有符号整数（little-endian）
      const sample = audio.readInt16LE(i);
      // 归一化到[-1, 1]范围
      const normalized = sample / 32768.0;
      sumSquares += normalized * normalized;
    }

    return Math.sqrt(sumSquares / sampleCount) * 32768; // 转换回原始范围
  }

  /**
   * 计算自适应静音阈值（相对值）
   * 
   * @param rmsValues RMS值数组
   * @returns 自适应阈值
   */
  private calculateAdaptiveSilenceThreshold(rmsValues: number[]): number {
    if (rmsValues.length === 0) {
      return 500; // 默认值
    }

    const sorted = [...rmsValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    const ABS_MIN = 200; // 绝对最小值
    const RATIO = 0.3; // 相对比例（推荐范围：0.25-0.35）

    const adaptiveThreshold = Math.max(ABS_MIN, median * RATIO);

    logger.debug(
      {
        median,
        adaptiveThreshold,
        absMin: ABS_MIN,
        ratio: RATIO,
      },
      'AudioAggregator: Calculated adaptive silence threshold'
    );

    return adaptiveThreshold;
  }

  /**
   * 兜底策略：寻找能量最低的连续区间（用于噪声环境）
   * 
   * @param audio PCM16音频数据
   * @param minIntervalMs 最小区间时长（默认300ms）
   * @param maxIntervalMs 最大区间时长（默认600ms）
   * @returns 能量最低区间的开始和结束位置
   */
  private findLowestEnergyInterval(
    audio: Buffer,
    minIntervalMs: number = 300,
    maxIntervalMs: number = 600
  ): { start: number; end: number } | null {
    const WINDOW_SIZE_MS = 50; // 更细粒度的窗口：50ms
    const WINDOW_SIZE_SAMPLES = Math.floor((WINDOW_SIZE_MS / 1000) * this.SAMPLE_RATE);
    const WINDOW_SIZE_BYTES = WINDOW_SIZE_SAMPLES * this.BYTES_PER_SAMPLE;

    const MIN_INTERVAL_WINDOWS = Math.ceil(minIntervalMs / WINDOW_SIZE_MS);
    const MAX_INTERVAL_WINDOWS = Math.floor(maxIntervalMs / WINDOW_SIZE_MS);

    // 只在音频中段（30%-70%）查找，避免切在开头或结尾
    const startSearchOffset = Math.floor(audio.length * 0.3);
    const endSearchOffset = Math.floor(audio.length * 0.7);

    if (endSearchOffset - startSearchOffset < MIN_INTERVAL_WINDOWS * WINDOW_SIZE_BYTES) {
      return null;
    }

    // 计算每个窗口的RMS值
    const rmsValues: number[] = [];
    const windowOffsets: number[] = [];

    for (let offset = startSearchOffset; offset <= endSearchOffset - WINDOW_SIZE_BYTES; offset += WINDOW_SIZE_BYTES) {
      const window = audio.slice(offset, offset + WINDOW_SIZE_BYTES);
      const rms = this.calculateRMS(window);
      rmsValues.push(rms);
      windowOffsets.push(offset);
    }

    if (rmsValues.length < MIN_INTERVAL_WINDOWS) {
      return null;
    }

    // 寻找能量最低的连续区间
    let lowestEnergy = Infinity;
    let bestStart = 0;
    let bestEnd = 0;

    for (let i = 0; i <= rmsValues.length - MIN_INTERVAL_WINDOWS; i++) {
      const intervalLength = Math.min(MAX_INTERVAL_WINDOWS, rmsValues.length - i);
      let sumEnergy = 0;

      for (let j = 0; j < intervalLength; j++) {
        sumEnergy += rmsValues[i + j];
      }

      const avgEnergy = sumEnergy / intervalLength;

      if (avgEnergy < lowestEnergy) {
        lowestEnergy = avgEnergy;
        bestStart = windowOffsets[i];
        bestEnd = windowOffsets[Math.min(i + intervalLength - 1, windowOffsets.length - 1)] + WINDOW_SIZE_BYTES;
      }
    }

    if (lowestEnergy === Infinity) {
      return null;
    }

    logger.info(
      {
        lowestEnergy,
        bestStart,
        bestEnd,
        intervalDurationMs: ((bestEnd - bestStart) / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
      },
      'AudioAggregator: Found lowest energy interval for fallback split'
    );

    return {
      start: bestStart,
      end: bestEnd,
    };
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

