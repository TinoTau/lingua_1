/**
 * Text Forward Merge - Pending Handler
 * 处理待合并文本的逻辑
 */

import { dedupMergePrecise, DedupConfig } from '../../aggregator/dedup';
import logger from '../../logger';
import { LengthDecisionConfig } from './text-forward-merge-length-decider';
import { ForwardMergeResult } from './text-forward-merge-manager';

interface PendingText {
  text: string;
  waitUntil: number;
  jobId: string;
  utteranceIndex: number;
}

export class TextForwardMergePendingHandler {
  private pendingTexts: Map<string, PendingText> = new Map();

  constructor(
    private dedupConfig: DedupConfig,
    private lengthConfig: LengthDecisionConfig
  ) {}

  /**
   * 检查是否有待合并的文本
   */
  getPending(sessionId: string): PendingText | undefined {
    return this.pendingTexts.get(sessionId);
  }

  /**
   * 设置待合并的文本
   */
  setPending(sessionId: string, pending: PendingText): void {
    this.pendingTexts.set(sessionId, pending);
  }

  /**
   * 清除待合并的文本
   */
  clearPending(sessionId: string): void {
    this.pendingTexts.delete(sessionId);
  }

  /**
   * 处理超时或手动截断的pending文本
   */
  handleTimeoutOrManualCut(
    pending: PendingText,
    currentText: string,
    sessionId: string,
    nowMs: number,
    isManualCut: boolean
  ): {
    mergedText: string;
    deduped: boolean;
    dedupChars: number;
    mergedFromPendingUtteranceIndex: number;
  } {
    logger.info(
      {
        sessionId,
        pendingText: pending.text.substring(0, 50),
        pendingLength: pending.text.length,
        currentText: currentText.substring(0, 50),
        currentLength: currentText.length,
        isManualCut,
        waitTimeout: !isManualCut && nowMs >= pending.waitUntil,
        reason: isManualCut 
          ? 'Manual cut detected, will merge pending text with current text if available'
          : 'Pending text wait timeout, will merge with current text if available',
      },
      isManualCut
        ? 'TextForwardMergePendingHandler: Manual cut detected, merging'
        : 'TextForwardMergePendingHandler: Pending text timeout, merging'
    );

    // 与当前文本去重合并
    const dedupResult = dedupMergePrecise(pending.text, currentText, this.dedupConfig);
    const mergedText = dedupResult.deduped 
      ? pending.text + dedupResult.text
      : pending.text + currentText;

    logger.info(
      {
        sessionId,
        pendingText: pending.text.substring(0, 50),
        currentText: currentText.substring(0, 50),
        mergedText: mergedText.substring(0, 100),
        pendingLength: pending.text.length,
        currentLength: currentText.length,
        mergedLength: mergedText.length,
        deduped: dedupResult.deduped,
        dedupChars: dedupResult.overlapChars,
        pendingUtteranceIndex: pending.utteranceIndex,
      },
      'TextForwardMergePendingHandler: Merged pending text with current text'
    );

    return {
      mergedText,
      deduped: dedupResult.deduped,
      dedupChars: dedupResult.overlapChars,
      mergedFromPendingUtteranceIndex: pending.utteranceIndex,
    };
  }

  /**
   * 处理待合并文本（未超时）
   */
  handlePendingMerge(
    pending: PendingText,
    currentText: string,
    sessionId: string
  ): {
    mergedText: string;
    deduped: boolean;
    dedupChars: number;
    mergedFromPendingUtteranceIndex: number;
  } {
    const dedupResult = dedupMergePrecise(pending.text, currentText, this.dedupConfig);
    const mergedText = dedupResult.deduped 
      ? pending.text + dedupResult.text
      : pending.text + currentText;

    logger.info(
      {
        sessionId,
        pendingText: pending.text.substring(0, 50),
        currentText: currentText.substring(0, 50),
        mergedText: mergedText.substring(0, 100),
        pendingLength: pending.text.length,
        currentLength: currentText.length,
        mergedLength: mergedText.length,
        deduped: dedupResult.deduped,
        dedupChars: dedupResult.overlapChars,
        pendingUtteranceIndex: pending.utteranceIndex,
        reason: 'Merged pending text with current text, will notify GPU arbiter to cancel pending utterance tasks',
      },
      'TextForwardMergePendingHandler: Merged pending text with current text'
    );

    return {
      mergedText,
      deduped: dedupResult.deduped,
      dedupChars: dedupResult.overlapChars,
      mergedFromPendingUtteranceIndex: pending.utteranceIndex,
    };
  }

  /**
   * 清除所有待合并的文本
   */
  clearAllPending(): void {
    this.pendingTexts.clear();
  }
}
