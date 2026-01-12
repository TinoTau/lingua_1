/**
 * CONF-3: 基于 segments 时间戳的断裂/异常检测（Bad Segment Detector）
 * 
 * 检测逻辑：
 * 1. 相邻 segments 之间时间间隔过大（文本断裂）
 * 2. segments 数异常（音频长但 segments 少）
 * 3. 平均 segment 时长异常
 */

import { SegmentInfo, ASRResult } from './types';
import logger from '../logger';

/**
 * 坏段检测结果
 */
export interface BadSegmentDetectionResult {
  /** 是否为坏段 */
  isBad: boolean;
  /** 原因代码列表 */
  reasonCodes: string[];
  /** 质量评分（0.0-1.0，越高越好） */
  qualityScore: number;
}

/**
 * RERUN-1: 坏段判定器 v1
 * 
 * 整合 CONF-3 的 segments 时间戳检测，并添加：
 * - 低置信/短文本检测
 * - 乱码检测
 * - 与上一段高度重叠检测
 * 
 * @param asrResult ASR 识别结果
 * @param audioDurationMs 音频时长（毫秒），用于检测 segments 数异常
 * @param previousText 上一段的文本（可选），用于检测重叠
 * @returns 坏段检测结果
 */
export function detectBadSegment(
  asrResult: ASRResult,
  audioDurationMs?: number,
  previousText?: string
): BadSegmentDetectionResult {
  const reasonCodes: string[] = [];
  let qualityScore = 1.0;

  // 如果没有 segments 信息，无法进行检测
  if (!asrResult.segments || asrResult.segments.length === 0) {
    // 如果没有 segments，但音频时长很长，可能是异常（统一使用SemanticRepairScorer的标准：16字符）
    if (audioDurationMs && audioDurationMs > 2000 && asrResult.text.trim().length < 16) {
      reasonCodes.push('NO_SEGMENTS_LONG_AUDIO_SHORT_TEXT');
      qualityScore = 0.3;
      return {
        isBad: true,
        reasonCodes,
        qualityScore,
      };
    }
    // 否则，无法判断，返回正常
    return {
      isBad: false,
      reasonCodes: [],
      qualityScore: 1.0,
    };
  }

  const segments = asrResult.segments;
  const segmentCount = segments.length;

  // 1. 检测相邻 segments 之间时间间隔过大（文本断裂）
  for (let i = 1; i < segments.length; i++) {
    const prevSegment = segments[i - 1];
    const currSegment = segments[i];

    // 需要两个 segment 都有时间戳（且不为 null）
    if (prevSegment.end !== undefined && prevSegment.end !== null &&
        currSegment.start !== undefined && currSegment.start !== null) {
      const gap = currSegment.start - prevSegment.end;
      
      // 间隔超过 1.0 秒视为断裂（确保 gap 是有效数字）
      if (!isNaN(gap) && isFinite(gap) && gap > 1.0) {
        reasonCodes.push(`SEGMENT_GAP_LARGE_${gap.toFixed(1)}s`);
        qualityScore = Math.max(0.0, qualityScore - 0.3);
        logger.debug(
          `Bad segment detected: large gap between segments ${i - 1} and ${i}: ${gap.toFixed(2)}s`
        );
      }
    }
  }

  // 2. 检测 segments 数异常（音频长但 segments 少）
  if (audioDurationMs !== undefined) {
    const audioDurationSec = audioDurationMs / 1000.0;
    const avgSegmentDuration = audioDurationSec / segmentCount;
    
    // 平均 segment 时长超过 5 秒视为异常（音频长但 segments 少）
    if (avgSegmentDuration > 5.0) {
      reasonCodes.push(`AVG_SEGMENT_DURATION_LONG_${avgSegmentDuration.toFixed(1)}s`);
      qualityScore = Math.max(0.0, qualityScore - 0.2);
      logger.debug(
        `Bad segment detected: average segment duration too long: ${avgSegmentDuration.toFixed(2)}s`
      );
    }

    // 音频时长 >= 1.5 秒但 segments 数 <= 1，可能是异常
    if (audioDurationSec >= 1.5 && segmentCount <= 1) {
      reasonCodes.push('LONG_AUDIO_FEW_SEGMENTS');
      qualityScore = Math.max(0.0, qualityScore - 0.3);
      logger.debug(
        `Bad segment detected: long audio (${audioDurationSec.toFixed(2)}s) but few segments (${segmentCount})`
      );
    }
  }

  // 3. 检测平均 segment 时长异常（过短或过长）
  if (segments.length > 0) {
    const segmentsWithTimestamps = segments.filter(
      seg => seg.start !== undefined && seg.start !== null &&
             seg.end !== undefined && seg.end !== null
    );

    if (segmentsWithTimestamps.length > 0) {
      const totalDuration = segmentsWithTimestamps.reduce(
        (sum, seg) => {
          const duration = (seg.end || 0) - (seg.start || 0);
          return sum + (isNaN(duration) || !isFinite(duration) ? 0 : duration);
        },
        0
      );
      const avgDuration = totalDuration / segmentsWithTimestamps.length;

      // 平均 segment 时长过短（< 0.1 秒）可能是异常（确保 avgDuration 是有效数字）
      if (!isNaN(avgDuration) && isFinite(avgDuration) && avgDuration < 0.1) {
        reasonCodes.push(`AVG_SEGMENT_DURATION_SHORT_${avgDuration.toFixed(2)}s`);
        qualityScore = Math.max(0.0, qualityScore - 0.2);
        logger.debug(
          `Bad segment detected: average segment duration too short: ${avgDuration.toFixed(2)}s`
        );
      }
    }
  }

  // 4. 检测 segments 时间戳覆盖范围异常
  if (segments.length > 0) {
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];

    if (firstSegment.start !== undefined && firstSegment.start !== null &&
        lastSegment.end !== undefined && lastSegment.end !== null) {
      const segmentsCoverage = lastSegment.end - firstSegment.start;
      
      // 如果音频时长已知，检查 segments 覆盖范围是否远小于音频时长
      if (audioDurationMs !== undefined && !isNaN(segmentsCoverage) && isFinite(segmentsCoverage)) {
        const audioDurationSec = audioDurationMs / 1000.0;
        const coverageRatio = segmentsCoverage / audioDurationSec;
        
        // 覆盖范围小于音频时长的 50%，可能是异常
        if (!isNaN(coverageRatio) && isFinite(coverageRatio) && coverageRatio < 0.5) {
          reasonCodes.push(`SEGMENTS_COVERAGE_LOW_${(coverageRatio * 100).toFixed(0)}%`);
          qualityScore = Math.max(0.0, qualityScore - 0.2);
          logger.debug(
            `Bad segment detected: segments coverage (${segmentsCoverage.toFixed(2)}s) is only ${(coverageRatio * 100).toFixed(0)}% of audio duration (${audioDurationSec.toFixed(2)}s)`
          );
        }
      }
    }
  }

  // 5. RERUN-1: 低置信 + 短文本检测
  // 方案要求：language_probability < 0.70 且音频 >= 1500ms 但文本 < 5 字符
  if (asrResult.language_probability !== undefined && asrResult.language_probability !== null) {
    const langProb = asrResult.language_probability;
    // 防御性检查：确保langProb是有效数字
    if (typeof langProb === 'number' && !isNaN(langProb) && isFinite(langProb)) {
      const textLen = asrResult.text.trim().length;
      
      // 检测低置信 + 短文本（需要 audioDurationMs）
      if (audioDurationMs !== undefined && langProb < 0.70 && audioDurationMs >= 1500 && textLen < 5) {
        reasonCodes.push(`LOW_CONFIDENCE_SHORT_TEXT_${langProb.toFixed(2)}_${textLen}chars`);
        qualityScore = Math.max(0.0, qualityScore - 0.4);
        logger.debug(
          `RERUN-1: Low confidence + short text detected: langProb=${langProb.toFixed(2)}, ` +
          `audioDuration=${audioDurationMs}ms, textLen=${textLen}`
        );
      }
      
      // 低语言置信度（< 0.70）会降低质量评分（即使不是短文本，也不依赖 audioDurationMs）
      if (langProb < 0.70) {
        qualityScore = Math.max(0.0, qualityScore - (0.70 - langProb));
        // 添加低置信度原因代码（阈值 < 0.70），但避免重复添加
        if (!reasonCodes.some(code => code.includes('LOW_CONFIDENCE_SHORT_TEXT'))) {
          reasonCodes.push(`LOW_LANGUAGE_CONFIDENCE_${(langProb * 100).toFixed(0)}%`);
        }
      }
    }
  }

  // 6. RERUN-1: 乱码检测
  // 方案要求：明显乱码或非法字符比例 > 10%
  const garbageRatio = countGarbageChars(asrResult.text) / Math.max(1, asrResult.text.length);
  if (garbageRatio > 0.1) {
    reasonCodes.push(`HIGH_GARBAGE_RATIO_${(garbageRatio * 100).toFixed(0)}%`);
    qualityScore = Math.max(0.0, qualityScore - 0.3);
    logger.debug(
      `RERUN-1: High garbage ratio detected: ${(garbageRatio * 100).toFixed(1)}%`
    );
  }

  // 7. RERUN-1: 与上一段高度重叠检测
  // 方案要求：与上一段文本重叠度 > 80%
  if (previousText && previousText.trim().length > 0) {
    const overlap = calculateTextOverlap(asrResult.text, previousText);
    if (overlap > 0.8) {
      reasonCodes.push(`HIGH_OVERLAP_WITH_PREVIOUS_${(overlap * 100).toFixed(0)}%`);
      qualityScore = Math.max(0.0, qualityScore - 0.3);
      logger.debug(
        `RERUN-1: High overlap with previous text detected: ${(overlap * 100).toFixed(1)}%`
      );
    }
  }

  // 判断是否为坏段
  // 如果有任何异常原因，或者质量评分 < 0.5，视为坏段
  const isBad = reasonCodes.length > 0 || qualityScore < 0.5;

  if (isBad) {
    logger.warn(
      {
        reasonCodes,
        qualityScore,
        segmentCount,
        audioDurationMs,
        languageProbability: asrResult.language_probability,
      },
      'RERUN-1: Bad segment detected (segments timestamps + low confidence + garbage + overlap)'
    );
  }

  // 防御性检查：确保qualityScore是有效数字，防止NaN
  let finalQualityScore = qualityScore;
  if (typeof finalQualityScore !== 'number' || isNaN(finalQualityScore) || !isFinite(finalQualityScore)) {
    logger.warn(
      {
        originalQualityScore: qualityScore,
        qualityScoreType: typeof qualityScore,
      },
      'Bad segment detector: qualityScore is invalid, using default 1.0'
    );
    finalQualityScore = 1.0;
  }

  return {
    isBad,
    reasonCodes,
    qualityScore: Math.max(0.0, Math.min(1.0, finalQualityScore)), // 限制在 0.0-1.0 范围
  };
}

/**
 * 计算文本中的乱码/非法字符比例
 * 
 * 乱码特征：
 * - Unicode 替换字符 (U+FFFD)
 * - 控制字符（除了常见的空格、换行等）
 * - 非打印字符
 * 
 * @param text 文本
 * @returns 乱码字符数量
 */
function countGarbageChars(text: string): number {
  let garbageCount = 0;
  
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    
    // Unicode 替换字符 (U+FFFD)
    if (codePoint === 0xFFFD) {
      garbageCount++;
      continue;
    }
    
    // 控制字符（除了常见的空格、制表符、换行符）
    if (codePoint < 0x20) {
      // 允许常见的空白字符
      if (codePoint !== 0x09 && codePoint !== 0x0A && codePoint !== 0x0D) {
        garbageCount++;
      }
      continue;
    }
    
    // 私有使用区（Private Use Area）
    if ((codePoint >= 0xE000 && codePoint <= 0xF8FF) ||
        (codePoint >= 0xF0000 && codePoint <= 0xFFFFD) ||
        (codePoint >= 0x100000 && codePoint <= 0x10FFFD)) {
      garbageCount++;
      continue;
    }
  }
  
  return garbageCount;
}

/**
 * 计算两个文本的重叠度
 * 
 * 使用最长公共子序列（LCS）的变体来计算重叠度
 * 
 * @param text1 文本1
 * @param text2 文本2
 * @returns 重叠度（0.0-1.0）
 */
function calculateTextOverlap(text1: string, text2: string): number {
  const t1 = text1.trim();
  const t2 = text2.trim();
  
  if (t1.length === 0 || t2.length === 0) {
    return 0.0;
  }
  
  // 简单方法：计算公共字符数 / 较长文本的长度
  // 更精确的方法可以使用编辑距离或 LCS
  const longer = t1.length > t2.length ? t1 : t2;
  const shorter = t1.length > t2.length ? t2 : t1;
  
  // 检查 shorter 是否包含在 longer 中（完全包含）
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }
  
  // 检查 longer 是否包含在 shorter 中（反向包含）
  if (shorter.includes(longer)) {
    return longer.length / shorter.length;
  }
  
  // 计算最长公共子串（LCS 的简化版本）
  // 使用滑动窗口方法查找最长公共子串
  let maxCommonLen = 0;
  for (let i = 0; i <= shorter.length; i++) {
    for (let j = i + 1; j <= shorter.length; j++) {
      const substr = shorter.substring(i, j);
      if (longer.includes(substr) && substr.length > maxCommonLen) {
        maxCommonLen = substr.length;
      }
    }
  }
  
  // 重叠度 = 最长公共子串长度 / 较长文本的长度
  return maxCommonLen / longer.length;
}

