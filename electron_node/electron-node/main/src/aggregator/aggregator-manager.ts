/* Aggregator Manager: 管理多个 session 的 Aggregator 状态
   支持 TTL/LRU 回收过期会话
*/

import { AggregatorState, AggregatorCommitResult, AggregatorMetrics } from './aggregator-state';
import { Mode, AggregatorTuning } from './aggregator-decision';
import { SegmentInfo } from '../task-router/types';
import logger from '../logger';

export interface AggregatorManagerConfig {
  ttlMs: number;  // 会话超时时间（默认 5 分钟）
  maxSessions: number;  // 最大会话数（LRU 回收）
}

const DEFAULT_CONFIG: AggregatorManagerConfig = {
  ttlMs: 5 * 60 * 1000,  // 5 分钟
  maxSessions: 500,  // 降低最大会话数（从 1000 降低到 500，减少内存占用）
};

export class AggregatorManager {
  private states: Map<string, AggregatorState> = new Map();
  private lastAccessTime: Map<string, number> = new Map();
  private config: AggregatorManagerConfig;

  constructor(config: Partial<AggregatorManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // 定期清理过期会话（缩短清理间隔，更及时清理）
    setInterval(() => this.cleanupExpiredSessions(), 30000); // 每30秒清理一次（从60秒缩短）
  }

  /**
   * 获取或创建 session 的 Aggregator 状态
   * 
   * 关键：每个 session_id 都有独立的状态，确保不同 session 的 utterance 不会互相影响
   */
  getOrCreateState(
    sessionId: string,
    mode: Mode = 'offline',
    tuning?: AggregatorTuning
  ): AggregatorState {
    // 验证 sessionId 不为空
    if (!sessionId || sessionId.trim() === '') {
      logger.error({ sessionId }, 'Invalid sessionId in getOrCreateState');
      throw new Error('sessionId cannot be empty');
    }
    
    let state = this.states.get(sessionId);
    
    if (!state) {
      // 检查是否超过最大会话数
      if (this.states.size >= this.config.maxSessions) {
        this.evictLRU();
      }
      
      state = new AggregatorState(sessionId, mode, tuning);
      this.states.set(sessionId, state);
      logger.debug(
        { 
          sessionId, 
          mode, 
          totalSessions: this.states.size 
        }, 
        'Created new AggregatorState (session isolated)'
      );
    }
    
    this.lastAccessTime.set(sessionId, Date.now());
    return state;
  }

  /**
   * 处理 utterance
   */
  processUtterance(
    sessionId: string,
    text: string,
    segments: SegmentInfo[] | undefined,
    langProbs: { top1: string; p1: number; top2?: string; p2?: number },
    qualityScore: number | undefined,
    isFinal: boolean = false,
    isManualCut: boolean = false,
    mode: Mode = 'offline',
    isPauseTriggered: boolean = false,
    isTimeoutTriggered: boolean = false,
    hasPendingSecondHalfMerged: boolean = false
  ): AggregatorCommitResult {
    const state = this.getOrCreateState(sessionId, mode);
    return state.processUtterance(
      text,
      segments,
      langProbs,
      qualityScore,
      isFinal,
      isManualCut,
      isPauseTriggered,
      isTimeoutTriggered,
      hasPendingSecondHalfMerged
    );
  }

  /**
   * 强制 flush session
   */
  flush(sessionId: string): string {
    const state = this.states.get(sessionId);
    if (!state) return '';
    
    const flushed = state.flush();
    if (flushed) {
      logger.debug({ sessionId, flushedLength: flushed.length }, 'Flushed AggregatorState');
    }
    return flushed;
  }

  /**
   * 清理 session（显式关闭）
   */
  removeSession(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (state) {
      // 先 flush
      const flushed = state.flush();
      if (flushed) {
        logger.debug({ sessionId, flushedLength: flushed.length }, 'Flushed before removing session');
      }
      
      // 清理上下文缓存（停止说话时清理）
      (state as any).clearLastTranslatedText();
      
      this.states.delete(sessionId);
      this.lastAccessTime.delete(sessionId);
      logger.debug({ sessionId }, 'Removed AggregatorState and cleared context cache');
    }
  }

  /**
   * 获取 session 的指标
   */
  getMetrics(sessionId: string): AggregatorMetrics | null {
    const state = this.states.get(sessionId);
    return state ? state.getMetrics() : null;
  }

  /**
   * 清理过期会话
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, lastAccess] of this.lastAccessTime.entries()) {
      if (now - lastAccess > this.config.ttlMs) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.removeSession(sessionId);
      logger.debug({ sessionId }, 'Removed expired AggregatorState');
    }

    if (expiredSessions.length > 0) {
      logger.info(
        { count: expiredSessions.length, totalSessions: this.states.size },
        'Cleaned up expired AggregatorState sessions'
      );
    }
  }

  /**
   * LRU 回收：移除最久未使用的会话
   */
  private evictLRU(): void {
    if (this.lastAccessTime.size === 0) return;

    // 找到最久未使用的会话
    let oldestSessionId = '';
    let oldestTime = Infinity;

    for (const [sessionId, lastAccess] of this.lastAccessTime.entries()) {
      if (lastAccess < oldestTime) {
        oldestTime = lastAccess;
        oldestSessionId = sessionId;
      }
    }

    if (oldestSessionId) {
      this.removeSession(oldestSessionId);
      logger.debug({ sessionId: oldestSessionId }, 'Evicted LRU AggregatorState');
    }
  }

  /**
   * 获取所有会话的统计信息
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
  } {
    return {
      totalSessions: this.states.size,
      activeSessions: this.states.size,
    };
  }
  
  /**
   * 获取上一个 utterance 的翻译文本（带1分钟过期）
   */
  getLastTranslatedText(sessionId: string): string | null {
    const state = this.states.get(sessionId);
    if (!state) {
      return null;
    }
    return (state as any).getLastTranslatedText();
  }
  
  /**
   * 设置上一个 utterance 的翻译文本（带1分钟过期）
   */
  setLastTranslatedText(sessionId: string, translatedText: string): void {
    const state = this.states.get(sessionId);
    if (state) {
      (state as any).setLastTranslatedText(translatedText);
    }
  }
  
  /**
   * 清理翻译文本（NEW_STREAM 时可选调用）
   */
  clearLastTranslatedText(sessionId: string): void {
    const state = this.states.get(sessionId);
    if (state) {
      (state as any).clearLastTranslatedText();
    }
  }

  /**
   * 获取上一个 utterance 的原文（ASR文本，中文）
   * 用于NMT服务的context_text，应该是原文而不是翻译文本
   * 
   * 重要：返回倒数第二个元素（上一句），而不是最后一个元素（当前句）
   * 因为当前句在聚合阶段已经被提交并添加到 recentCommittedText 中
   * 
   * 注意：如果当前句刚刚被提交，recentCommittedText 可能已经包含当前句。
   * 我们需要确保返回的是真正的上一句，而不是当前句。
   */
  getLastCommittedText(sessionId: string, currentText?: string): string | null {
    const state = this.states.get(sessionId);
    if (!state) {
      return null;
    }
    const recentCommittedText = (state as any).getRecentCommittedText();
    if (!recentCommittedText || recentCommittedText.length === 0) {
      return null;
    }
    
    // 如果提供了 currentText，排除当前句（避免返回当前句）
    // 使用更严格的匹配逻辑：不仅检查完全相等，还检查是否是子串关系
    if (currentText) {
      const currentTextTrimmed = currentText.trim().replace(/\s+/g, ' '); // 标准化空格
      // 从后往前查找，找到第一个不等于当前句的文本
      for (let i = recentCommittedText.length - 1; i >= 0; i--) {
        const text = recentCommittedText[i];
        if (text) {
          const textTrimmed = text.trim().replace(/\s+/g, ' '); // 标准化空格
          // 检查是否完全相等
          if (textTrimmed === currentTextTrimmed) {
            continue; // 跳过完全相同的文本
          }
          // 检查是否是子串关系（如果当前文本包含在历史文本中，或历史文本包含在当前文本中，认为是同一文本的变体）
          if (textTrimmed.includes(currentTextTrimmed) || currentTextTrimmed.includes(textTrimmed)) {
            // 如果相似度很高（长度差异小于30%），认为是同一文本的变体，跳过
            // 修复：提高相似度阈值从20%到30%，避免误判
            const lengthDiff = Math.abs(textTrimmed.length - currentTextTrimmed.length);
            const avgLength = (textTrimmed.length + currentTextTrimmed.length) / 2;
            if (avgLength > 0 && lengthDiff / avgLength < 0.3) {
              continue; // 跳过相似文本
            }
          }
          // 检查：如果历史文本是当前文本的前缀或后缀，且长度差异较大，可能是合并后的文本，跳过
          // 例如：当前文本="再提高了一点速度"，历史文本="提高了一点,那我希望接下来可以做到更好更快 也就是说我们需要把这个事情继续做下去 然后这个架构也没有太大的问题,只是需要再提升一点速度"
          // 这种情况下，历史文本包含了当前文本，且长度差异很大，不应该使用历史文本作为context
          if (textTrimmed.includes(currentTextTrimmed)) {
            const lengthDiff = textTrimmed.length - currentTextTrimmed.length;
            // 如果历史文本比当前文本长很多（超过50%），可能是合并后的文本，跳过
            if (lengthDiff > currentTextTrimmed.length * 0.5) {
              continue; // 跳过包含当前文本的长文本
            }
          }
          // 找到不同的文本，返回
          return text;
        }
      }
      // 如果所有文本都等于当前句或非常相似，返回 null
      return null;
    }
    
    // 如果没有提供 currentText，返回倒数第二个元素（如果存在）
    if (recentCommittedText.length > 1) {
      return recentCommittedText[recentCommittedText.length - 2];
    }
    
    // 如果只有1个元素，返回 null（没有上一句）
    return null;
  }
}

