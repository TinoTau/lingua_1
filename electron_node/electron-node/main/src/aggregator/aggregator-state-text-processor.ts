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
        
        // 修复：处理完全包含的情况
        if (tailDedup.deduped && !processedText.trim()) {
          // 检查是否是完全包含
          if (tailDedup.isCompletelyContained) {
            // 完全重复，丢弃这个utterance
            logger.info(
              {
                originalText: text,
                originalTextLength: text.length,
                tailBuffer: tailBuffer.substring(0, 50),
                overlapChars: tailDedup.overlapChars,
                reason: 'Current utterance is completely contained in tail buffer, discarding duplicate',
              },
              'AggregatorStateTextProcessor: Current utterance completely contained in tail buffer, discarding duplicate'
            );
            processedText = ''; // 返回空文本，表示丢弃
            deduped = true;
            dedupChars += tailDedup.overlapChars;
          } else if (text.length <= 20) {
            // 可能是误判，保留原始文本（统一使用20字符标准）
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
          } else {
            // 去重后为空，但不是完全包含，也不是短句
            deduped = true;
            dedupChars += tailDedup.overlapChars;
          }
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
        
        // 修复：处理完全包含的情况
        if (dedupResult.deduped && !processedText.trim()) {
          // 检查是否是完全包含（第二个utterance完全被第一个utterance包含）
          if (dedupResult.isCompletelyContained) {
            // 完全重复，丢弃这个utterance
            logger.info(
              {
                originalText: text,
                originalTextLength: text.length,
                lastTail: lastTail.substring(0, 50),
                lastText: lastText.substring(0, 100),
                overlapChars: dedupResult.overlapChars,
                reason: 'Current utterance is completely contained in previous utterance, discarding duplicate',
              },
              'AggregatorStateTextProcessor: Current utterance completely contained in previous, discarding duplicate'
            );
            processedText = ''; // 返回空文本，表示丢弃
            deduped = true;
            dedupChars += dedupResult.overlapChars;
          } else if (text.length <= 20) {
            // 可能是误判，保留原始文本（避免短句被误判为重复，统一使用20字符标准）
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
          } else {
            // 去重后为空，但不是完全包含，也不是短句，可能是正常去重
            deduped = true;
            dedupChars += dedupResult.overlapChars;
          }
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
