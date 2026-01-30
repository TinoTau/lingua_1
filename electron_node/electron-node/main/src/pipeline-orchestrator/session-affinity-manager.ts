/**
 * Session Affinity Manager
 * 管理超时finalize的sessionId->nodeId映射，确保长语音的后续job发送到同一个节点
 * 
 * 策略：
 * 1. 手动finalize或timeout finalize：可以随机分配（不需要session affinity）
 * 2. MaxDuration finalize：记录sessionId->nodeId的映射，确保后续job发送到同一个节点
 */

import logger from '../logger';

export class SessionAffinityManager {
  private static instance: SessionAffinityManager | null = null;
  
  // 当前节点ID
  private nodeId: string | null = null;
  
  // 存储超时finalize的sessionId->nodeId映射
  private timeoutFinalizeSessions: Map<string, {
    nodeId: string;
    createdAt: number;
    lastAccessAt: number;
  }> = new Map();
  
  // 存储MaxDuration finalize的sessionId->nodeId映射
  private maxDurationFinalizeSessions: Map<string, {
    nodeId: string;
    createdAt: number;
    lastAccessAt: number;
  }> = new Map();
  
  // TTL：30分钟（超时finalize的session映射保留30分钟）
  private readonly SESSION_TTL_MS = 30 * 60 * 1000;
  
  // 清理间隔：5分钟
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private constructor() {
    // 启动定期清理
    this.startCleanup();
  }

  static getInstance(): SessionAffinityManager {
    if (!SessionAffinityManager.instance) {
      SessionAffinityManager.instance = new SessionAffinityManager();
    }
    return SessionAffinityManager.instance;
  }

  /**
   * 设置当前节点ID
   * @param nodeId 节点ID
   */
  setNodeId(nodeId: string | null): void {
    this.nodeId = nodeId;
  }

  /**
   * 获取当前节点ID
   * @returns 节点ID
   */
  getNodeId(): string | null {
    return this.nodeId;
  }

  /**
   * 记录超时finalize的sessionId->nodeId映射
   * @param sessionId 会话ID
   * @param nodeId 节点ID（如果未提供，使用当前节点ID）
   */
  recordTimeoutFinalize(sessionId: string, nodeId?: string): void {
    const targetNodeId = nodeId || this.nodeId;
    if (!targetNodeId) {
      logger.warn(
        { sessionId },
        'SessionAffinityManager: Cannot record timeout finalize, nodeId not set'
      );
      return;
    }
    const nowMs = Date.now();
    this.timeoutFinalizeSessions.set(sessionId, {
      nodeId: targetNodeId,
      createdAt: nowMs,
      lastAccessAt: nowMs,
    });
    
    logger.info(
      {
        sessionId,
        nodeId: targetNodeId,
        totalSessions: this.timeoutFinalizeSessions.size,
        createdAt: new Date(nowMs).toISOString(),
        ttlMs: this.SESSION_TTL_MS,
        reason: 'Timeout finalize - recording sessionId->nodeId mapping for session affinity',
      },
      'SessionAffinityManager: [SessionAffinity] Recorded timeout finalize session mapping - subsequent jobs should route to this node'
    );
  }

  /**
   * 记录MaxDuration finalize的sessionId->nodeId映射
   * @param sessionId 会话ID
   * @param nodeId 节点ID（如果未提供，使用当前节点ID）
   */
  recordMaxDurationFinalize(sessionId: string, nodeId?: string): void {
    const targetNodeId = nodeId || this.nodeId;
    if (!targetNodeId) {
      logger.warn(
        { sessionId },
        'SessionAffinityManager: Cannot record MaxDuration finalize, nodeId not set'
      );
      return;
    }
    const nowMs = Date.now();
    this.maxDurationFinalizeSessions.set(sessionId, {
      nodeId: targetNodeId,
      createdAt: nowMs,
      lastAccessAt: nowMs,
    });
    
    logger.info(
      {
        sessionId,
        nodeId: targetNodeId,
        totalSessions: this.maxDurationFinalizeSessions.size,
        createdAt: new Date(nowMs).toISOString(),
        ttlMs: this.SESSION_TTL_MS,
        reason: 'MaxDuration finalize - recording sessionId->nodeId mapping for session affinity',
      },
      'SessionAffinityManager: [SessionAffinity] Recorded MaxDuration finalize session mapping - subsequent jobs should route to this node'
    );
  }

  /**
   * 获取超时finalize的节点ID
   * @param sessionId 会话ID
   * @returns 节点ID，如果不存在则返回null
   */
  getNodeIdForTimeoutFinalize(sessionId: string): string | null {
    const mapping = this.timeoutFinalizeSessions.get(sessionId);
    if (!mapping) {
      return null;
    }
    
    // 更新最后访问时间
    mapping.lastAccessAt = Date.now();
    
    logger.debug(
      {
        sessionId,
        nodeId: mapping.nodeId,
        ageMs: Date.now() - mapping.createdAt,
      },
      'SessionAffinityManager: Retrieved nodeId for timeout finalize session'
    );
    
    return mapping.nodeId;
  }

  /**
   * 获取MaxDuration finalize的节点ID
   * @param sessionId 会话ID
   * @returns 节点ID，如果不存在则返回null
   */
  getNodeIdForMaxDurationFinalize(sessionId: string): string | null {
    const mapping = this.maxDurationFinalizeSessions.get(sessionId);
    if (!mapping) {
      return null;
    }
    
    // 更新最后访问时间
    mapping.lastAccessAt = Date.now();
    
    logger.debug(
      {
        sessionId,
        nodeId: mapping.nodeId,
        ageMs: Date.now() - mapping.createdAt,
      },
      'SessionAffinityManager: Retrieved nodeId for MaxDuration finalize session'
    );
    
    return mapping.nodeId;
  }

  /**
   * 检查session是否应该使用session affinity（timeout或MaxDuration）
   * @param sessionId 会话ID
   * @returns 是否应该使用session affinity
   */
  shouldUseSessionAffinity(sessionId: string): boolean {
    return this.timeoutFinalizeSessions.has(sessionId) || this.maxDurationFinalizeSessions.has(sessionId);
  }

  /**
   * 清除session映射（用于手动finalize或pause finalize）
   * @param sessionId 会话ID
   */
  clearSessionMapping(sessionId: string): void {
    let cleared = false;
    if (this.timeoutFinalizeSessions.delete(sessionId)) {
      cleared = true;
    }
    if (this.maxDurationFinalizeSessions.delete(sessionId)) {
      cleared = true;
    }
    
    if (cleared) {
      logger.info(
        {
          sessionId,
          remainingTimeoutSessions: this.timeoutFinalizeSessions.size,
          remainingMaxDurationSessions: this.maxDurationFinalizeSessions.size,
          reason: 'Manual/pause finalize - cleared session mapping, subsequent jobs can use random assignment',
        },
        'SessionAffinityManager: [SessionAffinity] Cleared session mapping (manual/pause finalize)'
      );
    }
  }

  /**
   * 清除MaxDuration session映射（用于手动finalize或timeout finalize合并MaxDuration音频后）
   * @param sessionId 会话ID
   */
  clearMaxDurationSessionMapping(sessionId: string): void {
    if (this.maxDurationFinalizeSessions.delete(sessionId)) {
      logger.info(
        {
          sessionId,
          remainingMaxDurationSessions: this.maxDurationFinalizeSessions.size,
          reason: 'Manual/timeout finalize merged MaxDuration audio - cleared MaxDuration session mapping',
        },
        'SessionAffinityManager: [SessionAffinity] Cleared MaxDuration session mapping'
      );
    }
  }

  /**
   * 启动定期清理过期映射
   */
  private startCleanup(): void {
    if (this.cleanupTimer) {
      return;
    }
    
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.CLEANUP_INTERVAL_MS);
    
    logger.info(
      {
        cleanupIntervalMs: this.CLEANUP_INTERVAL_MS,
        sessionTtlMs: this.SESSION_TTL_MS,
      },
      'SessionAffinityManager: Started cleanup timer'
    );
  }

  /**
   * 清理过期的session映射
   */
  private cleanupExpiredSessions(): void {
    const nowMs = Date.now();
    let cleanedCount = 0;
    
    for (const [sessionId, mapping] of this.timeoutFinalizeSessions.entries()) {
      const ageMs = nowMs - mapping.lastAccessAt;
      if (ageMs > this.SESSION_TTL_MS) {
        this.timeoutFinalizeSessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(
        {
          cleanedCount,
          remainingSessions: this.timeoutFinalizeSessions.size,
        },
        'SessionAffinityManager: Cleaned up expired session mappings'
      );
    }
  }

  /**
   * 停止清理定时器
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      logger.info({}, 'SessionAffinityManager: Stopped cleanup timer');
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalTimeoutSessions: number;
    totalMaxDurationSessions: number;
    timeoutSessions: Array<{
      sessionId: string;
      nodeId: string;
      ageMs: number;
      lastAccessAgeMs: number;
    }>;
    maxDurationSessions: Array<{
      sessionId: string;
      nodeId: string;
      ageMs: number;
      lastAccessAgeMs: number;
    }>;
  } {
    const nowMs = Date.now();
    const timeoutSessions = Array.from(this.timeoutFinalizeSessions.entries()).map(([sessionId, mapping]) => ({
      sessionId,
      nodeId: mapping.nodeId,
      ageMs: nowMs - mapping.createdAt,
      lastAccessAgeMs: nowMs - mapping.lastAccessAt,
    }));
    
    const maxDurationSessions = Array.from(this.maxDurationFinalizeSessions.entries()).map(([sessionId, mapping]) => ({
      sessionId,
      nodeId: mapping.nodeId,
      ageMs: nowMs - mapping.createdAt,
      lastAccessAgeMs: nowMs - mapping.lastAccessAt,
    }));
    
    return {
      totalTimeoutSessions: this.timeoutFinalizeSessions.size,
      totalMaxDurationSessions: this.maxDurationFinalizeSessions.size,
      timeoutSessions,
      maxDurationSessions,
    };
  }
}
