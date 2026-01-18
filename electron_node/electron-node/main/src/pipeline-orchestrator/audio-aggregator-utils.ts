/**
 * Audio Aggregator Utilities
 * 处理音频分析、分割等辅助方法
 */

import logger from '../logger';

export class AudioAggregatorUtils {
  private readonly SAMPLE_RATE = 16000; // 固定采样率
  private readonly BYTES_PER_SAMPLE = 2; // PCM16: 2 bytes per sample

  /**
   * 计算音频的RMS（均方根）值
   * 
   * @param audio PCM16音频数据
   * @returns RMS值
   */
  calculateRMS(audio: Buffer): number {
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
  calculateAdaptiveSilenceThreshold(rmsValues: number[]): number {
    if (rmsValues.length === 0) {
      return 500; // 默认值
    }

    const sorted = [...rmsValues].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    const ABS_MIN = 200; // 绝对最小值
    const RATIO = 0.3; // 相对比例（推荐范围：0.25-0.35）

    const adaptiveThreshold = Math.max(ABS_MIN, median * RATIO);

    return adaptiveThreshold;
  }

  /**
   * 找到最长停顿并分割音频
   * 
   * @param audio PCM16音频数据
   * @returns 分割结果，包含分割位置和最长停顿时长
   */
  findLongestPauseAndSplit(audio: Buffer): {
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

    // 记录找到的所有停顿和选择的切分点（用于调试）
    const audioDurationMs = (audio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const splitPositionMs = (splitPosition / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const longestPauseStartMs = (longestPause.start / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const longestPauseEndMs = (longestPause.end / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    
    logger.debug(
      {
        audioDurationMs,
        silenceSegmentsCount: silenceSegments.length,
        silenceSegments: silenceSegments.map(seg => ({
          startMs: (seg.start / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
          endMs: (seg.end / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000,
          durationMs: seg.duration,
        })),
        longestPause: {
          startMs: longestPauseStartMs,
          endMs: longestPauseEndMs,
          durationMs: longestPause.duration,
        },
        splitPositionMs,
        splitPositionBytes: splitPosition,
      },
      'AudioAggregatorUtils: [FindLongestPause] Found longest pause and split position'
    );

    return {
      splitPosition,
      longestPauseMs: longestPause.duration,
    };
  }

  /**
   * 兜底策略：寻找能量最低的连续区间（用于噪声环境）
   * 
   * @param audio PCM16音频数据
   * @param minIntervalMs 最小区间时长（默认300ms）
   * @param maxIntervalMs 最大区间时长（默认600ms）
   * @returns 能量最低区间的开始和结束位置
   */
  findLowestEnergyInterval(
    audio: Buffer,
    minIntervalMs: number = 300,
    maxIntervalMs: number = 600
  ): { start: number; end: number } | null {
    const WINDOW_SIZE_MS = 50; // 更细粒度的窗口：50ms
    const WINDOW_SIZE_SAMPLES = Math.floor((WINDOW_SIZE_MS / 1000) * this.SAMPLE_RATE);
    const WINDOW_SIZE_BYTES = WINDOW_SIZE_SAMPLES * this.BYTES_PER_SAMPLE;

    const MIN_INTERVAL_WINDOWS = Math.ceil(minIntervalMs / WINDOW_SIZE_MS);
    const MAX_INTERVAL_WINDOWS = Math.floor(maxIntervalMs / WINDOW_SIZE_MS);

    // 优化：更倾向于在音频中段（40%-60%）查找，避免在句子开头或结尾切分
    // 这样可以确保前半句和后半句都有足够的长度，减少不完整句子的概率
    let startSearchOffset = Math.floor(audio.length * 0.4);
    let endSearchOffset = Math.floor(audio.length * 0.6);

    if (endSearchOffset - startSearchOffset < MIN_INTERVAL_WINDOWS * WINDOW_SIZE_BYTES) {
      // 如果搜索区间太小，回退到30%-70%
      const fallbackStart = Math.floor(audio.length * 0.3);
      const fallbackEnd = Math.floor(audio.length * 0.7);
      if (fallbackEnd - fallbackStart < MIN_INTERVAL_WINDOWS * WINDOW_SIZE_BYTES) {
        return null;
      }
      // 使用回退区间
      startSearchOffset = fallbackStart;
      endSearchOffset = fallbackEnd;
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

    // 优化：寻找能量最低的连续区间，但优先选择靠近音频中点的位置
    const audioMidpoint = audio.length / 2;
    let lowestEnergy = Infinity;
    let bestStart = 0;
    let bestEnd = 0;
    let bestScore = Infinity; // 综合得分（能量 + 位置权重）

    for (let i = 0; i <= rmsValues.length - MIN_INTERVAL_WINDOWS; i++) {
      const intervalLength = Math.min(MAX_INTERVAL_WINDOWS, rmsValues.length - i);
      let sumEnergy = 0;

      for (let j = 0; j < intervalLength; j++) {
        sumEnergy += rmsValues[i + j];
      }

      const avgEnergy = sumEnergy / intervalLength;
      
      // 计算区间中心位置
      const intervalCenter = windowOffsets[i] + (intervalLength * WINDOW_SIZE_BYTES) / 2;
      // 位置权重：距离中点越近，权重越小（越优先）
      const positionWeight = Math.abs(intervalCenter - audioMidpoint) / audioMidpoint;
      // 综合得分：能量越低越好，位置越靠近中点越好
      const score = avgEnergy * (1 + positionWeight * 0.3); // 位置权重30%

      if (score < bestScore) {
        bestScore = score;
        lowestEnergy = avgEnergy;
        bestStart = windowOffsets[i];
        bestEnd = windowOffsets[Math.min(i + intervalLength - 1, windowOffsets.length - 1)] + WINDOW_SIZE_BYTES;
      }
    }

    if (lowestEnergy === Infinity) {
      return null;
    }

    return {
      start: bestStart,
      end: bestEnd,
    };
  }

  /**
   * 按能量切分音频为多段（递归切分，直到每段都足够短）
   * 
   * @param audio PCM16音频数据
   * @param maxSegmentDurationMs 单段最大时长（默认10秒）
   * @param minSegmentDurationMs 单段最小时长（默认2秒，避免切得太碎）
   * @param splitHangoverMs 切分点hangover（默认600ms）
   * @param depth 递归深度（防止栈溢出，默认最大10层）
   * @returns 切分后的音频段数组
   */
  splitAudioByEnergy(
    audio: Buffer,
    maxSegmentDurationMs: number = 10000,
    minSegmentDurationMs: number = 2000,
    splitHangoverMs: number = 600,
    depth: number = 0
  ): Buffer[] {
    const MAX_DEPTH = 10; // 最大递归深度，防止栈溢出

    // 防止递归过深
    if (depth >= MAX_DEPTH) {
      return [audio];
    }

    const totalDurationMs = (audio.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

    // 如果音频足够短，直接返回
    if (totalDurationMs <= maxSegmentDurationMs) {
      return [audio];
    }

    // 如果音频太短（小于最小时长），也直接返回（避免切得太碎）
    if (totalDurationMs < minSegmentDurationMs) {
      return [audio];
    }

    // 尝试找到最长停顿并切分
    const splitResult = this.findLongestPauseAndSplit(audio);

    if (!splitResult || splitResult.splitPosition <= 0 || splitResult.splitPosition >= audio.length) {
      // 找不到合适的切分点，直接返回整段
      logger.debug(
        {
          totalDurationMs,
          depth,
          reason: splitResult ? 'Invalid split position' : 'No pause found',
          splitPosition: splitResult?.splitPosition,
        },
        'AudioAggregatorUtils: [SplitByEnergy] No valid split point found, returning full audio'
      );
      return [audio];
    }

    // 应用hangover
    const hangoverBytes = Math.floor(
      (splitHangoverMs / 1000) * this.SAMPLE_RATE * this.BYTES_PER_SAMPLE
    );
    const hangoverEnd = Math.min(splitResult.splitPosition + hangoverBytes, audio.length);

    const firstHalf = audio.slice(0, hangoverEnd);
    const secondHalf = audio.slice(hangoverEnd);

    // 记录切分信息
    const splitPositionMs = (splitResult.splitPosition / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const hangoverEndMs = (hangoverEnd / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const firstHalfDurationMs = (firstHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
    const secondHalfDurationMs = (secondHalf.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;

    logger.info(
      {
        totalDurationMs,
        depth,
        longestPauseMs: splitResult.longestPauseMs,
        splitPositionMs,
        splitPositionBytes: splitResult.splitPosition,
        hangoverMs: splitHangoverMs,
        hangoverEndMs,
        firstHalfDurationMs,
        secondHalfDurationMs,
        reason: 'Split audio at longest pause with hangover',
      },
      'AudioAggregatorUtils: [SplitByEnergy] Split audio at pause'
    );

    // 检查切分后的两段是否都足够短，如果都足够短就不需要递归
    // 注意：firstHalfDurationMs 和 secondHalfDurationMs 已在上面声明

    if (firstHalfDurationMs <= maxSegmentDurationMs && secondHalfDurationMs <= maxSegmentDurationMs) {
      // 两段都足够短，直接返回
      return [firstHalf, secondHalf];
    }

    // 递归切分前后两段
    const firstSegments = this.splitAudioByEnergy(
      firstHalf,
      maxSegmentDurationMs,
      minSegmentDurationMs,
      splitHangoverMs,
      depth + 1
    );
    const secondSegments = this.splitAudioByEnergy(
      secondHalf,
      maxSegmentDurationMs,
      minSegmentDurationMs,
      splitHangoverMs,
      depth + 1
    );

    // 合并结果
    return [...firstSegments, ...secondSegments];
  }
}
