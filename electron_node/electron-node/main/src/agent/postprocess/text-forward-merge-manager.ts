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
 */

import { dedupMergePrecise, DedupConfig, DEFAULT_DEDUP_CONFIG } from '../../aggregator/dedup';
import logger from '../../logger';
import { loadNodeConfig } from '../../node-config';

export interface ForwardMergeResult {
  processedText: string;
  shouldDiscard: boolean;  // 是否应该丢弃（< 6字符）
  shouldWaitForMerge: boolean;  // 是否应该等待合并（6-10字符）
  shouldSendToSemanticRepair: boolean;  // 是否应该发送给语义修复（> 10字符）
  deduped: boolean;
  dedupChars: number;
  mergedFromUtteranceIndex?: number;  // 如果合并了前一个utterance，这里存储前一个utterance的索引（用于通知GPU仲裁器）
  mergedFromPendingUtteranceIndex?: number;  // 如果合并了待合并的文本，这里存储待合并文本的utterance索引（用于通知GPU仲裁器）
}

export class TextForwardMergeManager {
  private pendingTexts: Map<string, {
    text: string;
    waitUntil: number;
    jobId: string;
    utteranceIndex: number;
  }> = new Map();

  private readonly MIN_LENGTH_TO_KEEP: number;
  private readonly MIN_LENGTH_TO_SEND: number;
  private readonly MAX_LENGTH_TO_WAIT: number;
  private readonly WAIT_TIMEOUT_MS: number;
  private readonly dedupConfig: DedupConfig = DEFAULT_DEDUP_CONFIG;

  constructor() {
    // 从配置文件加载文本长度配置
    const nodeConfig = loadNodeConfig();
    const textLengthConfig = nodeConfig.textLength || {};
    this.MIN_LENGTH_TO_KEEP = textLengthConfig.minLengthToKeep ?? 6;  // 最小保留长度：6个字符（太短的文本直接丢弃）
    this.MIN_LENGTH_TO_SEND = textLengthConfig.minLengthToSend ?? 20;  // 最小发送长度：20个字符（6-20字符之间的文本等待合并）
    this.MAX_LENGTH_TO_WAIT = textLengthConfig.maxLengthToWait ?? 40;  // 最大等待长度：40个字符（20-40字符之间的文本等待3秒确认是否有后续输入，超过40字符强制截断）
    this.WAIT_TIMEOUT_MS = textLengthConfig.waitTimeoutMs ?? 3000;  // 等待超时：3秒
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
    isManualCut: boolean = false
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
        // 与当前文本去重合并
        const dedupResult = dedupMergePrecise(pending.text, currentText, this.dedupConfig);
        // 修复：dedupMergePrecise 只返回 currentText 去掉重叠后的剩余部分
        // 需要将 pending.text 和去重后的 currentText 合并
        const mergedText = dedupResult.deduped 
          ? pending.text + dedupResult.text  // 如果有去重，合并 pending.text 和去重后的 currentText
          : pending.text + currentText;  // 如果没有去重，直接合并
        
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
        
        // 判断合并后的文本长度
        if (mergedText.length < this.MIN_LENGTH_TO_KEEP) {
          // < 6字符：丢弃
          return {
            processedText: '',
            shouldDiscard: true,
            shouldWaitForMerge: false,
            shouldSendToSemanticRepair: false,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex: pending.utteranceIndex,
          };
        } else if (mergedText.length <= this.MIN_LENGTH_TO_SEND) {
          // 6-20字符：如果是手动发送，直接发送给语义修复；否则继续等待
          if (isManualCut) {
            return {
              processedText: mergedText,
              shouldDiscard: false,
              shouldWaitForMerge: false,
              shouldSendToSemanticRepair: true,
              deduped: dedupResult.deduped,
              dedupChars: dedupResult.overlapChars,
              mergedFromPendingUtteranceIndex: pending.utteranceIndex,
            };
          } else {
            // 非手动发送：继续等待
            this.pendingTexts.set(sessionId, {
              text: mergedText,
              waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
              jobId,
              utteranceIndex,
            });
            return {
              processedText: '',
              shouldDiscard: false,
              shouldWaitForMerge: true,
              shouldSendToSemanticRepair: false,
              deduped: dedupResult.deduped,
              dedupChars: dedupResult.overlapChars,
              mergedFromPendingUtteranceIndex: pending.utteranceIndex,
            };
          }
        } else if (mergedText.length <= this.MAX_LENGTH_TO_WAIT) {
          // 20-40字符：等待3秒确认是否有后续输入，如果没有后续输入，则发送给语义修复
          if (isManualCut) {
            return {
              processedText: mergedText,
              shouldDiscard: false,
              shouldWaitForMerge: false,
              shouldSendToSemanticRepair: true,
              deduped: dedupResult.deduped,
              dedupChars: dedupResult.overlapChars,
              mergedFromPendingUtteranceIndex: pending.utteranceIndex,
            };
          } else {
            // 非手动发送：等待3秒确认是否有后续输入
            this.pendingTexts.set(sessionId, {
              text: mergedText,
              waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
              jobId,
              utteranceIndex,
            });
            return {
              processedText: '',
              shouldDiscard: false,
              shouldWaitForMerge: true,
              shouldSendToSemanticRepair: false,
              deduped: dedupResult.deduped,
              dedupChars: dedupResult.overlapChars,
              mergedFromPendingUtteranceIndex: pending.utteranceIndex,
            };
          }
        } else {
          // > 40字符：强制截断，直接发送给语义修复（避免用户不断输入导致文本累积过多）
          return {
            processedText: mergedText,
            shouldDiscard: false,
            shouldWaitForMerge: false,
            shouldSendToSemanticRepair: true,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex: pending.utteranceIndex,
          };
        }
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
          // 注意：超时处理时，不需要通知GPU仲裁器，因为任务可能已经完成
        };
      }
    }

    // 如果有待合并的文本且未超时，且不是手动截断，与当前文本合并
    // 注意：手动截断的情况已经在上面处理了
    if (pending && nowMs < pending.waitUntil && !isManualCut) {
      // 与当前文本去重合并
      const dedupResult = dedupMergePrecise(pending.text, currentText, this.dedupConfig);
      // 修复：dedupMergePrecise 只返回 currentText 去掉重叠后的剩余部分
      // 需要将 pending.text 和去重后的 currentText 合并
      const mergedText = dedupResult.deduped 
        ? pending.text + dedupResult.text  // 如果有去重，合并 pending.text 和去重后的 currentText
        : pending.text + currentText;  // 如果没有去重，直接合并
      
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
          currentUtteranceIndex: utteranceIndex,
          reason: 'Merged pending text with current text, will notify GPU arbiter to cancel pending utterance tasks',
        },
        'TextForwardMergeManager: Merged pending text with current text, will notify GPU arbiter'
      );
      
      // 保存待合并文本的utterance索引（用于通知GPU仲裁器）
      const mergedFromPendingUtteranceIndex = pending.utteranceIndex;
      
      // 清除待合并的文本
      this.pendingTexts.delete(sessionId);
      
      // 判断合并后的文本长度
      if (mergedText.length < this.MIN_LENGTH_TO_KEEP) {
        // < 6字符：丢弃
        return {
          processedText: '',
          shouldDiscard: true,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: false,
          deduped: dedupResult.deduped,
          dedupChars: dedupResult.overlapChars,
          mergedFromPendingUtteranceIndex,  // 通知GPU仲裁器取消待合并文本的任务
        };
      } else if (mergedText.length <= this.MIN_LENGTH_TO_SEND) {
        // 6-20字符：如果是手动发送，直接发送给语义修复；否则继续等待
        if (isManualCut) {
          // 手动发送：直接发送给语义修复，不等待合并
          logger.info(
            {
              sessionId,
              mergedText: mergedText.substring(0, 50),
              length: mergedText.length,
              reason: 'Merged text length 6-20, but isManualCut=true, sending to semantic repair directly',
            },
            'TextForwardMergeManager: Merged text length 6-20, but isManualCut=true, sending to semantic repair directly'
          );
          return {
            processedText: mergedText,
            shouldDiscard: false,
            shouldWaitForMerge: false,
            shouldSendToSemanticRepair: true,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex,  // 通知GPU仲裁器取消待合并文本的任务
          };
        } else {
          // 非手动发送：继续等待（6-20字符之间的文本等待合并）
          this.pendingTexts.set(sessionId, {
            text: mergedText,
            waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
            jobId,
            utteranceIndex,
          });
          return {
            processedText: '',
            shouldDiscard: false,
            shouldWaitForMerge: true,
            shouldSendToSemanticRepair: false,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex,  // 通知GPU仲裁器取消待合并文本的任务
          };
        }
      } else if (mergedText.length <= this.MAX_LENGTH_TO_WAIT) {
        // 20-40字符：等待3秒确认是否有后续输入，如果没有后续输入，则发送给语义修复
        if (isManualCut) {
          return {
            processedText: mergedText,
            shouldDiscard: false,
            shouldWaitForMerge: false,
            shouldSendToSemanticRepair: true,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex,  // 通知GPU仲裁器取消待合并文本的任务
          };
        } else {
          // 非手动发送：等待3秒确认是否有后续输入
          this.pendingTexts.set(sessionId, {
            text: mergedText,
            waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
            jobId,
            utteranceIndex,
          });
          return {
            processedText: '',
            shouldDiscard: false,
            shouldWaitForMerge: true,
            shouldSendToSemanticRepair: false,
            deduped: dedupResult.deduped,
            dedupChars: dedupResult.overlapChars,
            mergedFromPendingUtteranceIndex,  // 通知GPU仲裁器取消待合并文本的任务
          };
        }
      } else {
        // > 40字符：强制截断，直接发送给语义修复（避免用户不断输入导致文本累积过多）
        return {
          processedText: mergedText,
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          deduped: dedupResult.deduped,
          dedupChars: dedupResult.overlapChars,
          mergedFromPendingUtteranceIndex,  // 通知GPU仲裁器取消待合并文本的任务
        };
      }
    }

    // 没有待合并的文本，处理当前文本
    let processedText = currentText;
    let deduped = false;
    let dedupChars = 0;

    // 如果有上一个文本，进行去重
    // 注意：如果去重后文本为空或很短，说明当前文本完全被包含在上一个文本中
    // 这种情况下，上一个文本的utterance索引应该是当前索引-1（假设utterance_index是连续的）
    let mergedFromUtteranceIndex: number | undefined = undefined;
    if (previousText) {
      const dedupResult = dedupMergePrecise(previousText, currentText, this.dedupConfig);
      processedText = dedupResult.text;
      deduped = dedupResult.deduped;
      dedupChars = dedupResult.overlapChars;
      
      // 如果去重后文本为空或很短，说明当前文本被合并到上一个文本
      // 需要通知GPU仲裁器取消上一个utterance的任务
      if (deduped && (processedText.length === 0 || processedText.length < this.MIN_LENGTH_TO_KEEP)) {
        // 假设utterance_index是连续的，上一个utterance的索引是当前索引-1
        mergedFromUtteranceIndex = utteranceIndex - 1;
        logger.info(
          {
            sessionId,
            previousText: previousText.substring(0, 50),
            currentText: currentText.substring(0, 50),
            processedText: processedText.substring(0, 100),
            dedupChars,
            previousUtteranceIndex: mergedFromUtteranceIndex,
            currentUtteranceIndex: utteranceIndex,
            reason: 'Current text merged into previous text, will notify GPU arbiter to cancel previous utterance tasks',
          },
          'TextForwardMergeManager: Current text merged into previous, will notify GPU arbiter'
        );
      } else if (deduped) {
        logger.info(
          {
            sessionId,
            previousText: previousText.substring(0, 50),
            currentText: currentText.substring(0, 50),
            processedText: processedText.substring(0, 100),
            dedupChars,
            reason: 'Deduped current text with previous text',
          },
          'TextForwardMergeManager: Deduped current text with previous text'
        );
      }
    }

    // 判断去重后的文本长度
    if (processedText.length < this.MIN_LENGTH_TO_KEEP) {
      // < 6字符：丢弃
      logger.info(
        {
          sessionId,
          processedText: processedText.substring(0, 50),
          length: processedText.length,
          reason: 'Processed text too short, discarding',
        },
        'TextForwardMergeManager: Processed text too short, discarding'
      );
      return {
        processedText: '',
        shouldDiscard: true,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: false,
        deduped,
        dedupChars,
        mergedFromUtteranceIndex,  // 如果合并了上一个utterance，通知GPU仲裁器
      };
    } else if (processedText.length <= this.MIN_LENGTH_TO_SEND) {
      // 6-20字符：如果是手动发送，直接发送给语义修复；否则等待与下一句合并
      if (isManualCut) {
        // 手动发送：直接发送给语义修复，不等待合并
        logger.info(
          {
            sessionId,
            processedText: processedText.substring(0, 50),
            length: processedText.length,
            reason: 'Processed text length 6-20, but isManualCut=true, sending to semantic repair directly',
          },
          'TextForwardMergeManager: Processed text length 6-20, but isManualCut=true, sending to semantic repair directly'
        );
        return {
          processedText,
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          deduped,
          dedupChars,
          mergedFromUtteranceIndex,  // 如果合并了上一个utterance，通知GPU仲裁器
        };
      } else {
        // 非手动发送：等待与下一句合并（6-20字符之间的文本等待合并）
        this.pendingTexts.set(sessionId, {
          text: processedText,
          waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
          jobId,
          utteranceIndex,
        });
        logger.info(
          {
            sessionId,
            processedText: processedText.substring(0, 50),
            length: processedText.length,
            waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
            waitMs: this.WAIT_TIMEOUT_MS,
            reason: 'Processed text length 6-20, waiting for merge with next utterance',
          },
          'TextForwardMergeManager: Processed text length 6-20, waiting for merge'
        );
        return {
          processedText: '',
          shouldDiscard: false,
          shouldWaitForMerge: true,
          shouldSendToSemanticRepair: false,
          deduped,
          dedupChars,
          mergedFromUtteranceIndex,  // 如果合并了上一个utterance，通知GPU仲裁器
        };
      }
    } else if (processedText.length <= this.MAX_LENGTH_TO_WAIT) {
      // 20-40字符：等待3秒确认是否有后续输入，如果没有后续输入，则发送给语义修复
      // 这是为了避免用户说到最后一句话的时候被截断一半，有没有后续输入来触发合并
      if (isManualCut) {
        // 手动截断：直接发送给语义修复，不等待
        logger.info(
          {
            sessionId,
            processedText: processedText.substring(0, 50),
            length: processedText.length,
            reason: 'Processed text length 20-40, but isManualCut=true, sending to semantic repair directly',
          },
          'TextForwardMergeManager: Processed text length 20-40, but isManualCut=true, sending to semantic repair directly'
        );
        return {
          processedText,
          shouldDiscard: false,
          shouldWaitForMerge: false,
          shouldSendToSemanticRepair: true,
          deduped,
          dedupChars,
          mergedFromUtteranceIndex,  // 如果合并了上一个utterance，通知GPU仲裁器
        };
      } else {
        // 非手动截断：等待3秒确认是否有后续输入
        this.pendingTexts.set(sessionId, {
          text: processedText,
          waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
          jobId,
          utteranceIndex,
        });
        logger.info(
          {
            sessionId,
            processedText: processedText.substring(0, 50),
            length: processedText.length,
            waitUntil: nowMs + this.WAIT_TIMEOUT_MS,
            waitMs: this.WAIT_TIMEOUT_MS,
            reason: 'Processed text length 20-40, waiting 3 seconds to confirm if there is subsequent input',
          },
          'TextForwardMergeManager: Processed text length 20-40, waiting 3 seconds to confirm if there is subsequent input'
        );
        return {
          processedText: '',
          shouldDiscard: false,
          shouldWaitForMerge: true,
          shouldSendToSemanticRepair: false,
          deduped,
          dedupChars,
          mergedFromUtteranceIndex,  // 如果合并了上一个utterance，通知GPU仲裁器
        };
      }
    } else {
      // > 40字符：强制截断，直接发送给语义修复（避免用户不断输入导致文本累积过多）
      logger.info(
        {
          sessionId,
          processedText: processedText.substring(0, 50),
          length: processedText.length,
          maxLengthToWait: this.MAX_LENGTH_TO_WAIT,
          reason: 'Processed text length > 40, forcing truncation and sending to semantic repair',
        },
        'TextForwardMergeManager: Processed text length > 40, forcing truncation and sending to semantic repair'
      );
      return {
        processedText,
        shouldDiscard: false,
        shouldWaitForMerge: false,
        shouldSendToSemanticRepair: true,
        deduped,
        dedupChars,
        mergedFromUtteranceIndex,  // 如果合并了上一个utterance，通知GPU仲裁器
      };
    }
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
