/**
 * Aggregator Middleware Deduplication Handler
 * 处理重复文本检测相关的逻辑
 */

import logger from '../logger';

export class DeduplicationHandler {
  private lastSentText: Map<string, string> = new Map();
  private lastSentTextAccessTime: Map<string, number> = new Map();
  private readonly LAST_SENT_TEXT_TTL_MS = 10 * 60 * 1000;  // 10 分钟 TTL
  private readonly LAST_SENT_TEXT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;  // 5 分钟清理一次

  /**
   * 规范化文本（去除所有空白字符）
   */
  private normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * 计算文本相似度（简单的字符重叠度）
   */
  calculateTextSimilarity(text1: string, text2: string): number {
    if (text1.length === 0 && text2.length === 0) return 1.0;
    if (text1.length === 0 || text2.length === 0) return 0.0;
    
    // 使用较短的文本作为基准
    const shorter = text1.length < text2.length ? text1 : text2;
    const longer = text1.length >= text2.length ? text1 : text2;
    
    // 检查较短文本是否完全包含在较长文本中
    if (longer.includes(shorter)) {
      return shorter.length / longer.length;
    }
    
    // 计算字符重叠度（简化版）
    let matches = 0;
    const minLen = Math.min(text1.length, text2.length);
    for (let i = 0; i < minLen; i++) {
      if (text1[i] === text2[i]) {
        matches++;
      }
    }
    
    return matches / Math.max(text1.length, text2.length);
  }

  /**
   * 检测句子开头/结尾的重叠（由于hangover导致的重复）
   * 例如："有一些東西會重複 但是問題不大" 和 "不大 感覺反彙速度也會重複 但是問題不大"
   * 返回重叠的部分和去重后的文本
   */
  private detectAndRemoveOverlap(
    lastSent: string,
    current: string
  ): { hasOverlap: boolean; overlapText?: string; deduplicatedText?: string; overlapAtStart?: boolean } {
    const normalizedLastSent = this.normalizeText(lastSent);
    const normalizedCurrent = this.normalizeText(current);

    // 检查当前文本的开头是否与上次文本的结尾重叠（hangover导致的重复）
    // 从最长匹配开始，逐步缩短
    const maxOverlapLength = Math.min(normalizedLastSent.length, normalizedCurrent.length, 50); // 最多检查50个字符
    
    for (let overlapLen = maxOverlapLength; overlapLen >= 3; overlapLen--) {
      const lastSentEnd = normalizedLastSent.slice(-overlapLen);
      const currentStart = normalizedCurrent.slice(0, overlapLen);
      
      if (lastSentEnd === currentStart) {
        // 找到重叠，移除当前文本开头的重叠部分
        const deduplicatedText = normalizedCurrent.slice(overlapLen).trim();
        return {
          hasOverlap: true,
          overlapText: lastSentEnd,
          deduplicatedText: deduplicatedText.length > 0 ? deduplicatedText : undefined,
          overlapAtStart: true,
        };
      }
    }

    // 检查当前文本的结尾是否与上次文本的开头重叠（反向情况）
    for (let overlapLen = maxOverlapLength; overlapLen >= 3; overlapLen--) {
      const lastSentStart = normalizedLastSent.slice(0, overlapLen);
      const currentEnd = normalizedCurrent.slice(-overlapLen);
      
      if (lastSentStart === currentEnd) {
        // 找到重叠，移除当前文本结尾的重叠部分
        const deduplicatedText = normalizedCurrent.slice(0, -overlapLen).trim();
        return {
          hasOverlap: true,
          overlapText: lastSentStart,
          deduplicatedText: deduplicatedText.length > 0 ? deduplicatedText : undefined,
          overlapAtStart: false,
        };
      }
    }

    return { hasOverlap: false };
  }

  /**
   * 检查是否与上次发送的文本重复
   */
  isDuplicate(
    sessionId: string,
    text: string,
    jobId?: string,
    utteranceIndex?: number
  ): { isDuplicate: boolean; reason?: string; deduplicatedText?: string } {
    const lastSent = this.lastSentText.get(sessionId);
    if (!lastSent) {
      return { isDuplicate: false };
    }

    const normalizedCurrent = this.normalizeText(text);
    const normalizedLastSent = this.normalizeText(lastSent);

    // 完全相同的文本
    if (normalizedCurrent === normalizedLastSent && normalizedCurrent.length > 0) {
      logger.info(
        {
          jobId,
          sessionId,
          utteranceIndex,
          originalASRText: text,
          normalizedText: normalizedCurrent,
          lastSentText: lastSent,
          reason: 'Duplicate text detected (same as last sent)',
        },
        'AggregatorMiddleware: Filtering duplicate text, returning empty result (no NMT/TTS)'
      );
      return { isDuplicate: true, reason: 'same_as_last_sent' };
    }

    // 检查当前文本是否是前一个utterance的子串
    if (normalizedLastSent.length > 0 && normalizedCurrent.length > 0) {
      if (normalizedCurrent.length >= 3 && normalizedLastSent.includes(normalizedCurrent)) {
        logger.info(
          {
            jobId,
            sessionId,
            utteranceIndex,
            originalASRText: text,
            normalizedText: normalizedCurrent,
            lastSentText: lastSent,
            normalizedLastSent: normalizedLastSent,
            reason: 'Current text is a substring of last sent text, filtering to avoid duplicate output',
          },
          'AggregatorMiddleware: Filtering substring duplicate text, returning empty result (no NMT/TTS)'
        );
        return { isDuplicate: true, reason: 'substring_of_last_sent' };
      }

      // 检查前一个utterance是否是当前文本的子串
      if (normalizedLastSent.length >= 3 && normalizedCurrent.includes(normalizedLastSent)) {
        logger.info(
          {
            jobId,
            sessionId,
            utteranceIndex,
            originalASRText: text,
            normalizedText: normalizedCurrent,
            lastSentText: lastSent,
            normalizedLastSent: normalizedLastSent,
            reason: 'Last sent text is a substring of current text, this should not happen, but filtering to avoid duplicate output',
          },
          'AggregatorMiddleware: Filtering reverse substring duplicate text, returning empty result (no NMT/TTS)'
        );
        return { isDuplicate: true, reason: 'last_sent_is_substring' };
      }

      // 检查句子开头/结尾的重叠（hangover导致的重复）
      const overlapResult = this.detectAndRemoveOverlap(normalizedLastSent, normalizedCurrent);
      if (overlapResult.hasOverlap && overlapResult.deduplicatedText) {
        logger.info(
          {
            jobId,
            sessionId,
            utteranceIndex,
            originalASRText: text,
            normalizedText: normalizedCurrent,
            lastSentText: lastSent,
            normalizedLastSent: normalizedLastSent,
            overlapText: overlapResult.overlapText,
            deduplicatedText: overlapResult.deduplicatedText,
            overlapAtStart: overlapResult.overlapAtStart,
            reason: 'Overlap detected (likely due to hangover), returning deduplicated text',
          },
          'AggregatorMiddleware: Detected overlap, deduplicating text'
        );
        // 返回去重后的文本，而不是完全过滤
        return { 
          isDuplicate: false, 
          deduplicatedText: overlapResult.deduplicatedText,
          reason: 'overlap_deduplicated'
        };
      } else if (overlapResult.hasOverlap && !overlapResult.deduplicatedText) {
        // 重叠后没有剩余文本，完全过滤
        logger.info(
          {
            jobId,
            sessionId,
            utteranceIndex,
            originalASRText: text,
            normalizedText: normalizedCurrent,
            lastSentText: lastSent,
            normalizedLastSent: normalizedLastSent,
            overlapText: overlapResult.overlapText,
            reason: 'Overlap detected but no remaining text after deduplication, filtering',
          },
          'AggregatorMiddleware: Overlap detected, no remaining text, filtering'
        );
        return { isDuplicate: true, reason: 'overlap_no_remaining_text' };
      }

      // 检查相似度
      const similarity = this.calculateTextSimilarity(normalizedCurrent, normalizedLastSent);
      if (similarity > 0.95) {
        logger.warn(
          {
            jobId,
            sessionId,
            utteranceIndex,
            text: text.substring(0, 50),
            lastSentText: lastSent.substring(0, 50),
            similarity,
          },
          'Skipping duplicate text (high similarity with last sent)'
        );
        return { isDuplicate: true, reason: 'high_similarity' };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * 获取最后发送的文本
   */
  getLastSentText(sessionId: string): string | undefined {
    return this.lastSentText.get(sessionId);
  }

  /**
   * 设置最后发送的文本（在成功发送后调用）
   */
  setLastSentText(sessionId: string, text: string): void {
    const normalized = this.normalizeText(text);
    this.lastSentText.set(sessionId, normalized);
    this.lastSentTextAccessTime.set(sessionId, Date.now());
  }

  /**
   * 清理过期的 lastSentText 记录
   */
  cleanupExpiredLastSentText(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, lastAccess] of this.lastSentTextAccessTime.entries()) {
      if (now - lastAccess > this.LAST_SENT_TEXT_TTL_MS) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.lastSentText.delete(sessionId);
      this.lastSentTextAccessTime.delete(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.info(
        {
          count: expiredSessions.length,
          remainingCount: this.lastSentText.size,
        },
        'AggregatorMiddleware: Cleaned up expired lastSentText entries'
      );
    }
  }

  /**
   * 清理指定会话的记录
   */
  removeSession(sessionId: string): void {
    this.lastSentText.delete(sessionId);
    this.lastSentTextAccessTime.delete(sessionId);
  }

  /**
   * 清理所有记录
   */
  clearAll(): void {
    this.lastSentText.clear();
    this.lastSentTextAccessTime.clear();
  }
}
