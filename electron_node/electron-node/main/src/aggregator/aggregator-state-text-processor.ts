/**
 * Aggregator State Text Processor
 * 处理文本合并和去重逻辑
 */

import { UtteranceInfo } from './aggregator-decision';
import { dedupMergePrecise, DedupConfig } from './dedup';
import { extractTail, TailCarryConfig } from './tail-carry';
import logger from '../logger';

export interface TextProcessResult {
  processedText: string;
  deduped: boolean;
  dedupChars: number;
  tailBufferCleared: boolean;
}

export class AggregatorStateTextProcessor {
  constructor(
    private dedupConfig: DedupConfig,
    private tailCarryConfig: TailCarryConfig
  ) {}

  /**
   * 处理文本合并和去重
   * @param action 流动作（MERGE 或 NEW_STREAM）
   * @param text 当前文本
   * @param lastUtterance 上一个utterance
   * @param tailBuffer 尾部缓冲区
   * @returns 处理结果
   */
  processText(
    action: 'MERGE' | 'NEW_STREAM',
    text: string,
    lastUtterance: UtteranceInfo | null,
    tailBuffer: string
  ): TextProcessResult {
    let processedText = text;
    let deduped = false;
    let dedupChars = 0;
    let tailBufferCleared = false;

    if (action === 'MERGE' && lastUtterance) {
      // 如果有 tail buffer，先与 tail 合并
      if (tailBuffer) {
        const tailDedup = dedupMergePrecise(tailBuffer, text, this.dedupConfig);
        processedText = tailDedup.text;
        
        // 修复：如果去重后文本为空，且原始文本较短（可能是误判），保留原始文本
        if (tailDedup.deduped && !processedText.trim() && text.length <= 10) {
          logger.warn(
            {
              originalText: text,
              originalTextLength: text.length,
              tailBuffer: tailBuffer.substring(0, 50),
              overlapChars: tailDedup.overlapChars,
              reason: 'Dedup with tail buffer resulted in empty text for short utterance, keeping original text',
            },
            'AggregatorStateTextProcessor: Dedup with tail buffer removed all text for short utterance, keeping original'
          );
          processedText = text; // 保留原始文本
          deduped = false; // 重置去重标志
        } else if (tailDedup.deduped) {
          deduped = true;
          dedupChars += tailDedup.overlapChars;
        }
        tailBufferCleared = true;
      } else {
        // 与上一个 utterance 的尾部去重
        const lastText = lastUtterance.text;
        const lastTail = extractTail(lastText, this.tailCarryConfig) || lastText.slice(-20); // 使用最后 20 个字符作为参考
        const dedupResult = dedupMergePrecise(lastTail, text, this.dedupConfig);
        processedText = dedupResult.text;
        
        // 修复：如果去重后文本为空，且原始文本较短（可能是误判），保留原始文本
        // 避免短句（如 "就回来了"）被完全去重导致语音丢失
        if (dedupResult.deduped && !processedText.trim() && text.length <= 10) {
          logger.warn(
            {
              originalText: text,
              originalTextLength: text.length,
              lastTail: lastTail.substring(0, 50),
              overlapChars: dedupResult.overlapChars,
              reason: 'Dedup resulted in empty text for short utterance, keeping original text to avoid speech loss',
            },
            'AggregatorStateTextProcessor: Dedup removed all text for short utterance, keeping original to prevent speech loss'
          );
          processedText = text; // 保留原始文本，避免语音丢失
          deduped = false; // 重置去重标志，因为保留了原始文本
          dedupChars = Math.max(0, dedupChars - dedupResult.overlapChars); // 调整去重字符数
        } else if (dedupResult.deduped) {
          deduped = true;
          dedupChars += dedupResult.overlapChars;
        }
      }
    }

    return {
      processedText,
      deduped,
      dedupChars,
      tailBufferCleared,
    };
  }
}
