/**
 * OriginalJobResultDispatcher 合并并触发回调的共享逻辑
 * 从 original-job-result-dispatcher.ts 迁出，供 addASRSegment 与 forceFinalizePartial 共用。
 */

import type { OriginalJobRegistration } from './original-job-result-dispatcher-types';
import { buildFinalAsrDataFromSorted } from './original-job-result-dispatcher-internal';
import logger from '../logger';

export interface FinalizeOptions {
  /** 会话 ID（用于日志） */
  sessionId?: string;
  /** 触发原因（如 registration_ttl / force_complete） */
  reason?: string;
  /** 触发路径（如 forceFinalizePartial） */
  triggerPath?: string;
}

/**
 * 对已累积的 registration 排序、合并文本、打日志并执行 callback；不修改 registrations 映射。
 */
export async function executeFinalizeAndCallback(
  registration: OriginalJobRegistration,
  originalJobId: string,
  options: FinalizeOptions = {}
): Promise<void> {
  const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
    const aIndex = a.batchIndex ?? 0;
    const bIndex = b.batchIndex ?? 0;
    return aIndex - bIndex;
  });
  const finalAsrData = buildFinalAsrDataFromSorted(registration, originalJobId, sortedSegments);
  const fullText = finalAsrData.asrText;

  logger.info(
    {
      sessionId: options.sessionId,
      originalJobId,
      operation: 'mergeASRText',
      triggerPath: options.triggerPath,
      reason: options.reason,
      batchCount: sortedSegments.length,
      missingCount: registration.missingCount,
      receivedCount: registration.receivedCount,
      expectedSegmentCount: registration.expectedSegmentCount,
      isPartial: options.reason != null || registration.missingCount > 0,
      batchTexts: sortedSegments.map((s, idx) => ({
        batchIndex: s.batchIndex ?? idx,
        isMissing: s.missing || false,
        textLength: s.asrText.length,
        textPreview: s.asrText.substring(0, options.reason != null ? 30 : 50),
        note: s.missing
          ? 'Missing segment (ASR failed/timeout) - excluded from final text'
          : (s.asrText.length === 0
            ? 'Empty result (audio quality rejection or ASR returned empty) - included in final text but will be empty'
            : 'Normal segment with text'),
      })),
      mergedTextLength: fullText.length,
      mergedTextPreview: fullText.substring(0, 100),
      note: registration.missingCount > 0
        ? `Has ${registration.missingCount} missing segment(s) - these were excluded from final text merge`
        : (options.reason != null ? undefined : 'No missing segments - all batches processed successfully'),
    },
    options.reason != null
      ? 'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text (forceFinalizePartial path)'
      : 'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text'
  );

  if (options.reason != null) {
    logger.info(
      {
        sessionId: options.sessionId,
        originalJobId,
        batchCount: registration.accumulatedSegments.length,
        receivedCount: registration.receivedCount,
        expectedSegmentCount: registration.expectedSegmentCount,
        missingCount: registration.missingCount,
        reason: options.reason,
        note: 'Force finalize partial triggered (TTL or timeout)',
      },
      'OriginalJobResultDispatcher: [SRTrigger] Force finalize partial triggered, triggering semantic repair'
    );
  }

  await registration.callback(finalAsrData, registration.originalJob);
}
