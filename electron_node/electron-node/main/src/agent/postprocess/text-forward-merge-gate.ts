/**
 * Text Forward Merge Gate 决策
 * 根据 mergedText 长度决定 SEND/HOLD/DROP，从 TextForwardMergeManager 拆出以控制主文件行数。
 * 不改变任何接口与逻辑，仅迁移代码。
 */

import logger from '../../logger';
import type {
  ForwardMergeResult,
  GateDecisionParams,
  GateDecisionResult,
  PendingEntry,
} from './text-forward-merge-types';

export function decideGateAction(params: GateDecisionParams): GateDecisionResult {
  const {
    mergedText,
    sessionId,
    jobId,
    utteranceIndex,
    isManualCut,
    nowMs,
    deduped,
    dedupChars,
    mergedFromUtteranceIndex,
    mergedFromPendingUtteranceIndex,
    prevCommittedLen = 0,
    lastSentLen = 0,
    lengthConfig,
  } = params;

  if (mergedText.length < lengthConfig.minLengthToKeep) {
    logger.info(
      {
        sessionId,
        action: 'DROP',
        mergedText: mergedText.substring(0, 50),
        mergedLen: mergedText.length,
        prevCommittedLen,
        lastSentLen,
        reason: 'Merged text too short, discarding (DROP)',
      },
      'TextForwardMergeManager: Merged text too short, discarding (DROP)'
    );
    return {
      action: 'DROP',
      result: {
        processedText: '',
        shouldDiscard: true,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: false,
        deduped,
        dedupChars,
        mergedFromUtteranceIndex,
        mergedFromPendingUtteranceIndex,
      },
    };
  }

  if (mergedText.length <= lengthConfig.minLengthToSend) {
    if (isManualCut) {
      logger.info(
        {
          sessionId,
          action: 'SEND',
          mergedText: mergedText.substring(0, 50),
          mergedLen: mergedText.length,
          prevCommittedLen,
          lastSentLen,
          reason: 'Merged text length 6-20, but isManualCut=true, sending to semantic repair directly (SEND)',
        },
        'TextForwardMergeManager: Merged text length 6-20, but isManualCut=true, sending to semantic repair directly (SEND)'
      );
      return {
        action: 'SEND',
        result: {
          processedText: mergedText,
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          deduped,
          dedupChars,
          mergedFromUtteranceIndex,
          mergedFromPendingUtteranceIndex,
        },
      };
    }
    const pendingEntry: PendingEntry = {
      text: mergedText,
      waitUntil: nowMs + lengthConfig.waitTimeoutMs,
      jobId,
      utteranceIndex,
    };
    logger.info(
      {
        sessionId,
        action: 'HOLD',
        mergedText: mergedText.substring(0, 50),
        mergedLen: mergedText.length,
        prevCommittedLen,
        lastSentLen,
        waitUntil: pendingEntry.waitUntil,
        waitMs: lengthConfig.waitTimeoutMs,
        reason: 'Merged text length 6-20, waiting for merge with next utterance (HOLD)',
      },
      'TextForwardMergeManager: Merged text length 6-20, waiting for merge (HOLD)'
    );
    return {
      action: 'HOLD',
      result: {
        processedText: '',
        shouldDiscard: false,
        shouldWaitForMerge: true,
        shouldSendToSemanticRepair: false,
        deduped,
        dedupChars,
        mergedFromUtteranceIndex,
        mergedFromPendingUtteranceIndex,
      },
      pendingEntry,
    };
  }

  if (mergedText.length <= lengthConfig.maxLengthToWait) {
    if (isManualCut) {
      logger.info(
        {
          sessionId,
          action: 'SEND',
          mergedText: mergedText.substring(0, 50),
          mergedLen: mergedText.length,
          prevCommittedLen,
          lastSentLen,
          reason: 'Merged text length 20-40, but isManualCut=true, sending to semantic repair directly (SEND)',
        },
        'TextForwardMergeManager: Merged text length 20-40, but isManualCut=true, sending to semantic repair directly (SEND)'
      );
      return {
        action: 'SEND',
        result: {
          processedText: mergedText,
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          deduped,
          dedupChars,
          mergedFromUtteranceIndex,
          mergedFromPendingUtteranceIndex,
        },
      };
    }
    const pendingEntry: PendingEntry = {
      text: mergedText,
      waitUntil: nowMs + lengthConfig.waitTimeoutMs,
      jobId,
      utteranceIndex,
    };
    logger.info(
      {
        sessionId,
        action: 'HOLD',
        mergedText: mergedText.substring(0, 50),
        mergedLen: mergedText.length,
        prevCommittedLen,
        lastSentLen,
        waitUntil: pendingEntry.waitUntil,
        waitMs: lengthConfig.waitTimeoutMs,
        reason: 'Merged text length 20-40, waiting 3 seconds to confirm if there is subsequent input (HOLD)',
      },
      'TextForwardMergeManager: Merged text length 20-40, waiting 3 seconds (HOLD)'
    );
    return {
      action: 'HOLD',
      result: {
        processedText: '',
        shouldDiscard: false,
        shouldWaitForMerge: true,
        shouldSendToSemanticRepair: false,
        deduped,
        dedupChars,
        mergedFromUtteranceIndex,
        mergedFromPendingUtteranceIndex,
      },
      pendingEntry,
    };
  }

  logger.info(
    {
      sessionId,
      action: 'SEND',
      mergedText: mergedText.substring(0, 50),
      mergedLen: mergedText.length,
      prevCommittedLen,
      lastSentLen,
      maxLengthToWait: lengthConfig.maxLengthToWait,
      reason: 'Merged text length > 40, sending this batch to semantic repair (SEND); subsequent content will merge in next call',
    },
    'TextForwardMergeManager: Merged text length > 40, sending this batch (SEND)'
  );
  return {
    action: 'SEND',
    result: {
      processedText: mergedText,
      shouldDiscard: false,
      shouldWaitForMerge: false,
      shouldSendToSemanticRepair: true,
      deduped,
      dedupChars,
      mergedFromUtteranceIndex,
      mergedFromPendingUtteranceIndex,
      segmentForCurrentJob: mergedText,
    },
  };
}
