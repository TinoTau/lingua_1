/**
 * OriginalJobResultDispatcher 内部逻辑：排序、合并文本、构建 finalAsrData
 * 从 original-job-result-dispatcher.ts 迁出，仅迁移实现，不新增逻辑与调用路径。
 */

import type { OriginalJobASRData } from './original-job-result-dispatcher-types';
import type { SegmentInfo } from '../task-router/types';

/** 用于构建 finalAsrData 的最小 registration 形状 */
export interface RegistrationForMerge {
  accumulatedSegments: OriginalJobASRData[];
  accumulatedSegmentsList: SegmentInfo[];
}

function mergeLanguageProbabilities(
  segments: OriginalJobASRData[]
): Record<string, number> | undefined {
  if (segments.length === 0) {
    return undefined;
  }
  const lastSegment = segments[segments.length - 1];
  return lastSegment.languageProbabilities;
}

/**
 * 按已排序的 segments 合并文本、构建最终 ASR 数据（不触发回调）
 * 主文件先排序一次，再调用本函数，避免重复排序。
 */
export function buildFinalAsrDataFromSorted(
  reg: RegistrationForMerge,
  originalJobId: string,
  sortedSegments: OriginalJobASRData[]
): OriginalJobASRData {
  const nonMissingSegments = sortedSegments.filter(s => !s.missing);
  const fullText = nonMissingSegments.map(s => s.asrText).join(' ');
  return {
    originalJobId,
    asrText: fullText,
    asrSegments: reg.accumulatedSegmentsList,
    languageProbabilities: mergeLanguageProbabilities(nonMissingSegments),
  };
}
