/**
 * Text Forward Merge - Length Decider
 * 根据文本长度决定处理动作
 */

import logger from '../../logger';

export interface LengthDecisionConfig {
  minLengthToKeep: number;      // 最小保留长度
  minLengthToSend: number;       // 最小发送长度
  maxLengthToWait: number;       // 最大等待长度
  waitTimeoutMs: number;         // 等待超时时间
}

export interface LengthDecisionResult {
  shouldDiscard: boolean;
  shouldWaitForMerge: boolean;
  shouldSendToSemanticRepair: boolean;
  shouldSetPending: boolean;
  pendingWaitUntil?: number;
}

export class TextForwardMergeLengthDecider {
  constructor(
    private config: LengthDecisionConfig
  ) {}

  /**
   * 根据文本长度和是否手动截断决定处理动作
   */
  decide(
    text: string,
    isManualCut: boolean,
    sessionId: string,
    nowMs: number
  ): LengthDecisionResult {
    const length = text.length;

    // < minLengthToKeep：丢弃
    if (length < this.config.minLengthToKeep) {
      logger.info(
        {
          sessionId,
          text: text.substring(0, 50),
          length,
          minLengthToKeep: this.config.minLengthToKeep,
        },
        'TextForwardMergeLengthDecider: Text too short, discarding'
      );
      
      return {
        shouldDiscard: true,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: false,
        shouldSetPending: false,
      };
    }

    // minLengthToKeep - minLengthToSend：等待合并或手动发送
    if (length <= this.config.minLengthToSend) {
      if (isManualCut) {
        return {
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          shouldSetPending: false,
        };
      } else {
        return {
          shouldDiscard: false,
          shouldWaitForMerge: true,
          shouldSendToSemanticRepair: false,
          shouldSetPending: true,
          pendingWaitUntil: nowMs + this.config.waitTimeoutMs,
        };
      }
    }

    // minLengthToSend - maxLengthToWait：等待确认或手动发送
    if (length <= this.config.maxLengthToWait) {
      if (isManualCut) {
        return {
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          shouldSetPending: false,
        };
      } else {
        return {
          shouldDiscard: false,
          shouldWaitForMerge: true,
          shouldSendToSemanticRepair: false,
          shouldSetPending: true,
          pendingWaitUntil: nowMs + this.config.waitTimeoutMs,
        };
      }
    }

    // > maxLengthToWait：强制发送
    return {
      shouldDiscard: false,
      shouldWaitForMerge: false,
      shouldSendToSemanticRepair: true,
      shouldSetPending: false,
    };
  }
}
