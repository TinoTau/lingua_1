/**
 * Text Forward Merge Manager
 * 处理PostASR阶段的向前合并和去重逻辑
 * 
 * 策略：
 * 1. 如果下一句里有上一句的重复内容，删除重复部分
 * 2. 去重后的文本长度判断：
 *    - < 6个字符：直接丢弃
 *    - 6-20个字符：等待与下一句合并（3秒超时）
 *    - 20-40个字符：等待3秒确认是否有后续输入，如果没有后续输入，则发送给语义修复
 *    - > 40个字符：强制截断，直接发送给语义修复（避免用户不断输入导致文本累积过多）
 * 
 * /// Invariant 1: Gate 输出语义不变量
 * /// processText / decideGateAction 永远返回完整 mergedText。
 * /// 禁止返回裁剪片段（如 dedupResult.text）。
 * /// 所有 SEND/HOLD/DROP 决策必须基于完整 mergedText。
 */

import { dedupMergePrecise, DedupConfig, DEFAULT_DEDUP_CONFIG } from '../../aggregator/dedup';
import logger from '../../logger';
import { loadNodeConfig } from '../../node-config';
import { LengthDecisionConfig } from './text-forward-merge-length-decider';
import type { ForwardMergeResult } from './text-forward-merge-types';
import { decideGateAction as decideGateActionFn } from './text-forward-merge-gate';

export type { ForwardMergeResult };

export class TextForwardMergeManager {
  private pendingTexts: Map<string, {
    text: string;
    waitUntil: number;
    jobId: string;
    utteranceIndex: number;
  }> = new Map();

  private readonly lengthConfig: LengthDecisionConfig;
  private readonly dedupConfig: DedupConfig = DEFAULT_DEDUP_CONFIG;

  constructor() {
    // 从配置文件加载文本长度配置
    const nodeConfig = loadNodeConfig();
    const textLengthConfig = nodeConfig.textLength || {};

    this.lengthConfig = {
      minLengthToKeep: textLengthConfig.minLengthToKeep ?? 6,
      minLengthToSend: textLengthConfig.minLengthToSend ?? 20,
      maxLengthToWait: textLengthConfig.maxLengthToWait ?? 40,
      waitTimeoutMs: textLengthConfig.waitTimeoutMs ?? 3000,
    };
  }

  /**
   * 合并两个文本并去重（统一 Trim 逻辑）
   * @param base 基础文本（pending.text 或 previousText）
   * @param incoming 当前文本
   * @returns 合并结果（完整 mergedText，不是裁剪片段）
   */
  private mergeByTrim(base: string, incoming: string): {
    mergedText: string;
    deduped: boolean;
    overlapChars: number;
    isCompletelyContained?: boolean;
    /** 当前句 trim 后应写入本 job 的 delta（无重叠时为 incoming） */
    deltaForCurrent: string;
  } {
    const r = dedupMergePrecise(base, incoming, this.dedupConfig);
    return {
      mergedText: r.deduped ? (base + r.text) : (base + incoming),
      deduped: r.deduped,
      overlapChars: r.overlapChars,
      isCompletelyContained: r.isCompletelyContained,
      deltaForCurrent: r.deduped ? r.text : incoming,
    };
  }

  /**
   * 处理文本：向前合并和去重
   * @param sessionId 会话ID
   * @param currentText 当前ASR文本
   * @param previousText 上一个已提交的文本（用于去重）
   * @param jobId 当前任务ID
   * @param utteranceIndex 当前utterance索引
   * @param isManualCut 是否是手动发送（如果是，6-20字符的文本直接发送给语义修复，不等待合并）
   * @returns 处理结果
   */
  processText(
    sessionId: string,
    currentText: string,
    previousText: string | null,
    jobId: string,
    utteranceIndex: number,
    isManualCut: boolean = false,
    lastSentText?: string | null
  ): ForwardMergeResult {
    const nowMs = Date.now();

    // 检查是否有待合并的文本
    const pending = this.pendingTexts.get(sessionId);

    // 添加详细日志，用于调试合并问题
    if (pending) {
      logger.info(
        {
          sessionId,
          pendingText: pending.text.substring(0, 50),
          pendingLength: pending.text.length,
          pendingUtteranceIndex: pending.utteranceIndex,
          currentUtteranceIndex: utteranceIndex,
          currentText: currentText.substring(0, 50),
          currentLength: currentText.length,
          isManualCut,
          nowMs,
          waitUntil: pending.waitUntil,
          isTimeout: nowMs >= pending.waitUntil,
          willProcess: isManualCut || nowMs >= pending.waitUntil,
        },
        'TextForwardMergeManager: Checking pending text'
      );
    }

    // 修复：当手动截断时（isManualCut=true），无论pending是否超时，都应该立即处理pending文本
    // 这样可以确保手动截断时，前面的等待合并的文本能够被一起发送
    if (pending && (isManualCut || nowMs >= pending.waitUntil)) {
      // 等待超时或手动截断，需要处理待合并的文本
      // 但是，如果有当前的currentText，应该先尝试合并，而不是直接返回pendingText
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
          ? 'TextForwardMergeManager: Manual cut detected, will merge pending text with current text if available'
          : 'TextForwardMergeManager: Pending text wait timeout, will merge with current text if available'
      );

      // 如果有currentText，先尝试合并
      if (currentText && currentText.trim().length > 0) {
        // 统一 Trim 逻辑：使用 mergeByTrim 合并 pending.text 和 currentText
        const mergeResult = this.mergeByTrim(pending.text, currentText);
        const mergedText = mergeResult.mergedText;

        logger.info(
          {
            sessionId,
            pendingText: pending.text.substring(0, 50),
            currentText: currentText.substring(0, 50),
            mergedText: mergedText.substring(0, 100),
            pendingLength: pending.text.length,
            currentLength: currentText.length,
            mergedLength: mergedText.length,
            deduped: mergeResult.deduped,
            dedupChars: mergeResult.overlapChars,
            pendingUtteranceIndex: pending.utteranceIndex,
            currentUtteranceIndex: utteranceIndex,
            reason: isManualCut
              ? 'Manual cut, merged pending text with current text'
              : 'Pending text timeout, merged with current text',
          },
          isManualCut
            ? 'TextForwardMergeManager: Manual cut, merged pending text with current text'
            : 'TextForwardMergeManager: Pending text timeout, merged with current text'
        );

        // 清除待合并的文本
        this.pendingTexts.delete(sessionId);

        const gateDecision = decideGateActionFn({
          mergedText,
          sessionId,
          jobId,
          utteranceIndex,
          isManualCut,
          nowMs,
          deduped: mergeResult.deduped,
          dedupChars: mergeResult.overlapChars,
          mergedFromPendingUtteranceIndex: pending.utteranceIndex,
          prevCommittedLen: pending.text.length,
          lastSentLen: lastSentText?.length || 0,
          lengthConfig: this.lengthConfig,
        });
        if (gateDecision.pendingEntry) {
          this.pendingTexts.set(sessionId, gateDecision.pendingEntry);
        }
        // 与备份一致：合并后 SEND 时当前 job 带出完整合并句，避免 [4][5] 扣留后 [6] 只带增量导致大段丢失
        const segmentForCurrentJob =
          gateDecision.action === 'SEND' && gateDecision.result.processedText
            ? gateDecision.result.processedText
            : mergeResult.deltaForCurrent;
        return { ...gateDecision.result, segmentForCurrentJob };
      } else {
        // 没有currentText，直接处理pendingText
        this.pendingTexts.delete(sessionId);

        logger.info(
          {
            sessionId,
            pendingText: pending.text.substring(0, 50),
            pendingLength: pending.text.length,
            reason: 'Pending text wait timeout, no current text, sending to semantic repair regardless of length',
          },
          'TextForwardMergeManager: Pending text wait timeout, no current text, sending to semantic repair regardless of length'
        );
        return {
          processedText: pending.text,
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          deduped: false,
          dedupChars: 0,
          segmentForCurrentJob: pending.text,  // 修复 Job9~11：仅 flush pending 时也写本 job 原文，避免长句前半丢失
        };
      }
    }

    // 如果有待合并的文本且未超时，且不是手动截断，与当前文本合并
    // 注意：手动截断的情况已经在上面处理了
    if (pending && nowMs < pending.waitUntil && !isManualCut) {
      // 统一 Trim 逻辑：使用 mergeByTrim 合并 pending.text 和 currentText
      const mergeResult = this.mergeByTrim(pending.text, currentText);
      const mergedText = mergeResult.mergedText;

      logger.info(
        {
          sessionId,
          pendingText: pending.text.substring(0, 50),
          currentText: currentText.substring(0, 50),
          mergedText: mergedText.substring(0, 100),
          pendingLength: pending.text.length,
          currentLength: currentText.length,
          mergedLength: mergedText.length,
          deduped: mergeResult.deduped,
          dedupChars: mergeResult.overlapChars,
          pendingUtteranceIndex: pending.utteranceIndex,
          currentUtteranceIndex: utteranceIndex,
          reason: 'Merged pending text with current text, will notify GPU arbiter to cancel pending utterance tasks',
        },
        'TextForwardMergeManager: Merged pending text with current text, will notify GPU arbiter'
      );

      // 保存待合并文本的utterance索引（用于通知GPU仲裁器）
      const mergedFromPendingUtteranceIndex = pending.utteranceIndex;

      // 清除待合并的文本
      this.pendingTexts.delete(sessionId);

      const gateDecisionPending = decideGateActionFn({
        mergedText,
        sessionId,
        jobId,
        utteranceIndex,
        isManualCut,
        nowMs,
        deduped: mergeResult.deduped,
        dedupChars: mergeResult.overlapChars,
        mergedFromPendingUtteranceIndex,
        prevCommittedLen: pending.text.length,
        lastSentLen: lastSentText?.length || 0,
        lengthConfig: this.lengthConfig,
      });
      if (gateDecisionPending.pendingEntry) {
        this.pendingTexts.set(sessionId, gateDecisionPending.pendingEntry);
      }
      // 与备份一致：合并后 SEND 时当前 job 带出完整合并句，避免大段丢失
      const segmentForCurrentJob =
        gateDecisionPending.action === 'SEND' && gateDecisionPending.result.processedText
          ? gateDecisionPending.result.processedText
          : mergeResult.deltaForCurrent;
      return { ...gateDecisionPending.result, segmentForCurrentJob };
    }

    // 没有待合并的文本，处理当前文本
    // 统一 Trim 逻辑：选择 base（优先 pending.text，否则 previousText，否则 ""）
    // 注意：pending 分支已经在上面处理了，这里只处理 previousText 的情况
    const base = previousText || '';
    const mergeResult = this.mergeByTrim(base, currentText);
    const mergedText = mergeResult.mergedText;

    // 如果完全被包含，需要显式 DROP 并通知 GPU arbiter
    let mergedFromUtteranceIndex: number | undefined = undefined;
    if (previousText && mergeResult.isCompletelyContained) {
      // 假设utterance_index是连续的，上一个utterance的索引是当前索引-1
      mergedFromUtteranceIndex = utteranceIndex - 1;
      logger.info(
        {
          sessionId,
          previousText: previousText.substring(0, 50),
          currentText: currentText.substring(0, 50),
          mergedText: mergedText.substring(0, 100),
          dedupChars: mergeResult.overlapChars,
          previousUtteranceIndex: mergedFromUtteranceIndex,
          currentUtteranceIndex: utteranceIndex,
          reason: 'Current text merged into previous text (completely contained), will notify GPU arbiter to cancel previous utterance tasks',
        },
        'TextForwardMergeManager: Current text merged into previous (completely contained), will notify GPU arbiter'
      );
    } else if (previousText && mergeResult.deduped) {
      logger.info(
        {
          sessionId,
          previousText: previousText.substring(0, 50),
          currentText: currentText.substring(0, 50),
          mergedText: mergedText.substring(0, 100),
          dedupChars: mergeResult.overlapChars,
          reason: 'Deduped current text with previous text',
        },
        'TextForwardMergeManager: Deduped current text with previous text'
      );
    }

    // 判断合并后的文本长度（Gate 决策）
    // 如果完全被包含且 mergedText 为空或很短，显式 DROP
    if (mergeResult.isCompletelyContained && (mergedText.length === 0 || mergedText.length < this.lengthConfig.minLengthToKeep)) {
      return {
        processedText: '',
        shouldDiscard: true,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: false,
        deduped: mergeResult.deduped,
        dedupChars: mergeResult.overlapChars,
        mergedFromUtteranceIndex,  // 通知GPU仲裁器取消上一个utterance的任务
        segmentForCurrentJob: mergeResult.deltaForCurrent,
      };
    }

    const gateDecisionNoPending = decideGateActionFn({
      mergedText,
      sessionId,
      jobId,
      utteranceIndex,
      isManualCut,
      nowMs,
      deduped: mergeResult.deduped,
      dedupChars: mergeResult.overlapChars,
      mergedFromUtteranceIndex,
      prevCommittedLen: previousText?.length || 0,
      lastSentLen: lastSentText?.length || 0,
      lengthConfig: this.lengthConfig,
    });
    if (gateDecisionNoPending.pendingEntry) {
      this.pendingTexts.set(sessionId, gateDecisionNoPending.pendingEntry);
    }
    return { ...gateDecisionNoPending.result, segmentForCurrentJob: mergeResult.deltaForCurrent };
  }

  /**
   * 获取待合并的文本（用于调试）
   */
  getPendingText(sessionId: string): string | null {
    const pending = this.pendingTexts.get(sessionId);
    return pending ? pending.text : null;
  }

  /**
   * 清除待合并的文本（用于会话结束）
   */
  clearPendingText(sessionId: string): void {
    this.pendingTexts.delete(sessionId);
  }

  /**
   * 清除所有待合并的文本
   */
  clearAllPendingTexts(): void {
    this.pendingTexts.clear();
  }
}
