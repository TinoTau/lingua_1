/**
 * Text Forward Merge - Dedup Processor
 * 处理文本去重逻辑
 */

import { dedupMergePrecise, DedupConfig } from '../../aggregator/dedup';
import logger from '../../logger';

export interface DedupProcessResult {
  processedText: string;
  deduped: boolean;
  dedupChars: number;
  mergedFromUtteranceIndex?: number;
}

export class TextForwardMergeDedupProcessor {
  constructor(
    private dedupConfig: DedupConfig,
    private minLengthToKeep: number
  ) {}

  /**
   * 合并两个文本并去重
   */
  mergePendingWithCurrent(
    pendingText: string,
    currentText: string,
    sessionId: string
  ): DedupProcessResult {
    const dedupResult = dedupMergePrecise(pendingText, currentText, this.dedupConfig);
    const mergedText = dedupResult.deduped 
      ? pendingText + dedupResult.text
      : pendingText + currentText;

    logger.info(
      {
        sessionId,
        pendingText: pendingText.substring(0, 50),
        currentText: currentText.substring(0, 50),
        mergedText: mergedText.substring(0, 100),
        pendingLength: pendingText.length,
        currentLength: currentText.length,
        mergedLength: mergedText.length,
        deduped: dedupResult.deduped,
        dedupChars: dedupResult.overlapChars,
      },
      'TextForwardMergeDedupProcessor: Merged pending text with current text'
    );

    return {
      processedText: mergedText,
      deduped: dedupResult.deduped,
      dedupChars: dedupResult.overlapChars,
    };
  }

  /**
   * 用前一个文本对当前文本去重
   */
  dedupWithPrevious(
    previousText: string,
    currentText: string,
    utteranceIndex: number,
    sessionId: string
  ): DedupProcessResult {
    const dedupResult = dedupMergePrecise(previousText, currentText, this.dedupConfig);
    const processedText = dedupResult.text;
    const deduped = dedupResult.deduped;
    const dedupChars = dedupResult.overlapChars;

    let mergedFromUtteranceIndex: number | undefined;

    // 如果去重后文本为空或很短，说明当前文本被合并到上一个文本
    if (deduped && (processedText.length === 0 || processedText.length < this.minLengthToKeep)) {
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
        },
        'TextForwardMergeDedupProcessor: Current text merged into previous'
      );
    } else if (deduped) {
      logger.info(
        {
          sessionId,
          previousText: previousText.substring(0, 50),
          currentText: currentText.substring(0, 50),
          processedText: processedText.substring(0, 100),
          dedupChars,
        },
        'TextForwardMergeDedupProcessor: Deduped current text with previous text'
      );
    }

    return {
      processedText,
      deduped,
      dedupChars,
      mergedFromUtteranceIndex,
    };
  }
}
