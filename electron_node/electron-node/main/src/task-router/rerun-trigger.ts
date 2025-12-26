/**
 * P0.5-SH-1: 坏段触发条件封装
 * 
 * 定义坏段触发重跑的条件判断逻辑
 */

import { ASRResult, ASRTask } from './types';
import logger from '../logger';

/**
 * 坏段触发重跑的条件
 */
export interface RerunTriggerCondition {
  /** 是否触发重跑 */
  shouldRerun: boolean;
  /** 触发原因 */
  reason?: string;
}

/**
 * P0.5-SH-1: 判断是否应该触发 Top-2 语言重跑
 * 
 * 触发条件（保守策略）:
 * - isBad == true
 * - language_probability < 0.60
 * - audioDurationMs >= 1500
 * - rerun_count < max_rerun_count (P0.5-SH-4: 限频)
 * 
 * @param asrResult ASR 识别结果
 * @param audioDurationMs 音频时长（毫秒）
 * @param task ASR 任务（包含 rerun_count 和 max_rerun_count）
 * @returns 是否应该触发重跑
 */
export function shouldTriggerRerun(
  asrResult: ASRResult,
  audioDurationMs?: number,
  task?: ASRTask
): RerunTriggerCondition {
  const rerunCount = task?.rerun_count ?? 0;
  const maxRerunCount = task?.max_rerun_count ?? 2; // P0.5-SH-4: 默认最大重跑 2 次
  // 检查坏段检测结果
  if (!asrResult.badSegmentDetection || !asrResult.badSegmentDetection.isBad) {
    return { shouldRerun: false };
  }

  // 条件 1: 语言置信度 < 0.60
  const langProb = asrResult.language_probability ?? 0;
  if (langProb >= 0.60) {
    return {
      shouldRerun: false,
      reason: `Language probability too high: ${langProb.toFixed(2)} >= 0.60`,
    };
  }

  // 条件 2: 音频时长 >= 1500ms
  if (audioDurationMs !== undefined && audioDurationMs < 1500) {
    return {
      shouldRerun: false,
      reason: `Audio duration too short: ${audioDurationMs}ms < 1500ms`,
    };
  }

  // 条件 3: 重跑次数检查（P0.5-SH-4: 限频）
  if (rerunCount >= maxRerunCount) {
    return {
      shouldRerun: false,
      reason: `Rerun count exceeded: ${rerunCount} >= ${maxRerunCount}`,
    };
  }

  // 条件 4: 必须有 language_probabilities 才能获取 Top-2
  if (!asrResult.language_probabilities || Object.keys(asrResult.language_probabilities).length < 2) {
    return {
      shouldRerun: false,
      reason: 'Insufficient language probabilities for Top-2 rerun',
    };
  }

  // 所有条件满足，触发重跑
  logger.info(
    {
      jobId: (asrResult as any).job_id,
      languageProbability: langProb,
      audioDurationMs,
      rerunCount,
      reasonCodes: asrResult.badSegmentDetection.reasonCodes,
      qualityScore: asrResult.badSegmentDetection.qualityScore,
    },
    'P0.5-SH-1: Rerun trigger condition met'
  );

  return {
    shouldRerun: true,
    reason: `Bad segment detected: langProb=${langProb.toFixed(2)}, duration=${audioDurationMs}ms, qualityScore=${asrResult.badSegmentDetection.qualityScore.toFixed(2)}`,
  };
}

/**
 * 获取 Top-2 语言列表（用于重跑）
 * 
 * @param languageProbabilities 语言概率字典
 * @param currentLanguage 当前检测到的语言
 * @returns Top-2 语言列表（排除当前语言）
 */
export function getTop2LanguagesForRerun(
  languageProbabilities: Record<string, number>,
  currentLanguage?: string
): string[] {
  // 按概率排序
  const sorted = Object.entries(languageProbabilities)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);

  // 排除当前语言，取前 2 个
  const top2 = sorted
    .filter(lang => lang !== currentLanguage)
    .slice(0, 2);

  logger.debug(
    {
      languageProbabilities,
      currentLanguage,
      top2,
    },
    'P0.5-SH-1: Top-2 languages for rerun'
  );

  return top2;
}

