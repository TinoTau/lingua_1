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
   * 检查是否与上次发送的文本重复
   * 
   * 职责：只做 Drop 判定（完全重复、子串重复、高相似度）
   * 注意：边界重叠裁剪由 dedupMergePrecise 统一处理，不再在此处处理
   */
  isDuplicate(
    sessionId: string,
    text: string,
    jobId?: string,
    utteranceIndex?: number
  ): { isDuplicate: boolean; reason?: string } {
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

      // 注意：重叠检测（overlap）已移除，现在由 dedupMergePrecise 统一处理边界重叠裁剪
      // 这里只做 Drop 判定（完全重复、子串重复、相似度）

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
