/**
 * Aggregator State Context Manager
 * 处理上下文相关的逻辑（翻译文本、关键词等）
 */

import { AggregatorStateUtils } from './aggregator-state-utils';

export class AggregatorStateContextManager {
  private lastTranslatedText: string | null = null;
  private lastTranslatedTextTimestamp: number = 0;
  private readonly CONTEXT_TTL_MS = 60 * 1000; // 1分钟过期

  private recentCommittedText: string[] = [];
  private recentKeywords: string[] = [];
  private lastCommitQuality: number | undefined = undefined;
  private readonly MAX_RECENT_COMMITS = 10;

  /**
   * 获取上一个 utterance 的翻译文本
   */
  getLastTranslatedText(): string | null {
    const now = Date.now();
    // 如果超过1分钟，返回 null
    if (this.lastTranslatedText && (now - this.lastTranslatedTextTimestamp) <= this.CONTEXT_TTL_MS) {
      return this.lastTranslatedText;
    }
    // 过期或不存在，返回 null
    this.lastTranslatedText = null;
    this.lastTranslatedTextTimestamp = 0;
    return null;
  }
  
  /**
   * 设置上一个 utterance 的翻译文本
   */
  setLastTranslatedText(translatedText: string): void {
    this.lastTranslatedText = translatedText;
    this.lastTranslatedTextTimestamp = Date.now();
  }
  
  /**
   * 清理翻译文本（NEW_STREAM 时可选调用）
   */
  clearLastTranslatedText(): void {
    this.lastTranslatedText = null;
    this.lastTranslatedTextTimestamp = 0;
  }

  /**
   * S1/S2: 更新最近提交的文本
   */
  updateRecentCommittedText(text: string): void {
    if (!text || !text.trim()) return;

    this.recentCommittedText.push(text.trim());
    // 保持最多MAX_RECENT_COMMITS条
    if (this.recentCommittedText.length > this.MAX_RECENT_COMMITS) {
      this.recentCommittedText.shift();
    }
  }

  /**
   * S1/S2: 获取最近提交的文本
   */
  getRecentCommittedText(): string[] {
    return [...this.recentCommittedText];
  }

  /**
   * S1/S2: 获取最近关键词
   */
  getRecentKeywords(): string[] {
    return [...this.recentKeywords];
  }

  /**
   * S1/S2: 设置用户关键词
   */
  setUserKeywords(keywords: string[]): void {
    this.recentKeywords = [...keywords];
  }

  /**
   * S1/S2: 更新关键词（从最近文本中提取）
   */
  updateKeywordsFromRecent(): void {
    // 从最近提交的文本中提取关键词
    const extractedKeywords = AggregatorStateUtils.extractKeywordsFromRecent(this.recentCommittedText);
    // 合并到现有关键词（保留用户配置的）
    this.recentKeywords = AggregatorStateUtils.mergeKeywords(this.recentKeywords, extractedKeywords);
  }

  /**
   * S1/S2: 获取上一次提交的质量分数
   */
  getLastCommitQuality(): number | undefined {
    return this.lastCommitQuality;
  }

  /**
   * S1/S2: 设置上一次提交的质量分数
   */
  setLastCommitQuality(quality: number | undefined): void {
    this.lastCommitQuality = quality;
  }

  /**
   * 清理上下文
   */
  clearContext(): void {
    this.recentCommittedText = [];
    this.recentKeywords = [];
    this.lastCommitQuality = undefined;
    this.clearLastTranslatedText();
  }
}
