/**
 * 客户端可观测性模块
 * 负责收集和上报匿名指标
 */

export interface ObservabilityMetrics {
  // 连接指标
  connectionSuccess: number; // 连接成功次数
  connectionFailure: number; // 连接失败次数
  reconnectCount: number; // 重连次数
  
  // 音频指标
  audioChunksSent: number; // 发送的音频块数
  audioChunksFiltered: number; // 被过滤的音频块数（静音）
  audioSendRatio: number; // 音频发送比例（0-1）
  
  // 背压指标
  backpressureEvents: {
    BUSY: number;
    PAUSE: number;
    SLOW_DOWN: number;
  };
  
  // 性能指标
  averageLatency?: number; // 平均延迟（毫秒）
  
  // 时间戳
  sessionStartTime: number;
  lastUpdateTime: number;
}

/**
 * 可观测性管理器
 */
export class ObservabilityManager {
  private metrics: ObservabilityMetrics;
  private reportInterval: number | null = null;
  private reportUrl?: string;
  
  constructor(reportUrl?: string, reportIntervalMs: number = 60000) {
    this.reportUrl = reportUrl;
    this.metrics = {
      connectionSuccess: 0,
      connectionFailure: 0,
      reconnectCount: 0,
      audioChunksSent: 0,
      audioChunksFiltered: 0,
      audioSendRatio: 0,
      backpressureEvents: {
        BUSY: 0,
        PAUSE: 0,
        SLOW_DOWN: 0,
      },
      sessionStartTime: Date.now(),
      lastUpdateTime: Date.now(),
    };
    
    // 如果提供了上报 URL，启动定期上报
    if (this.reportUrl && reportIntervalMs > 0) {
      this.startReporting(reportIntervalMs);
    }
  }
  
  /**
   * 记录连接成功
   */
  recordConnectionSuccess(): void {
    this.metrics.connectionSuccess++;
    this.metrics.lastUpdateTime = Date.now();
  }
  
  /**
   * 记录连接失败
   */
  recordConnectionFailure(): void {
    this.metrics.connectionFailure++;
    this.metrics.lastUpdateTime = Date.now();
  }
  
  /**
   * 记录重连
   */
  recordReconnect(): void {
    this.metrics.reconnectCount++;
    this.metrics.lastUpdateTime = Date.now();
  }
  
  /**
   * 记录音频块发送
   */
  recordAudioChunkSent(): void {
    this.metrics.audioChunksSent++;
    this.updateAudioSendRatio();
    this.metrics.lastUpdateTime = Date.now();
  }
  
  /**
   * 记录音频块过滤
   */
  recordAudioChunkFiltered(): void {
    this.metrics.audioChunksFiltered++;
    this.updateAudioSendRatio();
    this.metrics.lastUpdateTime = Date.now();
  }
  
  /**
   * 记录背压事件
   */
  recordBackpressureEvent(action: 'BUSY' | 'PAUSE' | 'SLOW_DOWN'): void {
    this.metrics.backpressureEvents[action]++;
    this.metrics.lastUpdateTime = Date.now();
  }
  
  /**
   * 更新音频发送比例
   */
  private updateAudioSendRatio(): void {
    const total = this.metrics.audioChunksSent + this.metrics.audioChunksFiltered;
    if (total > 0) {
      this.metrics.audioSendRatio = this.metrics.audioChunksSent / total;
    }
  }
  
  /**
   * 获取当前指标
   */
  getMetrics(): Readonly<ObservabilityMetrics> {
    return { ...this.metrics };
  }
  
  /**
   * 重置指标
   */
  reset(): void {
    this.metrics = {
      connectionSuccess: 0,
      connectionFailure: 0,
      reconnectCount: 0,
      audioChunksSent: 0,
      audioChunksFiltered: 0,
      audioSendRatio: 0,
      backpressureEvents: {
        BUSY: 0,
        PAUSE: 0,
        SLOW_DOWN: 0,
      },
      sessionStartTime: Date.now(),
      lastUpdateTime: Date.now(),
    };
  }
  
  /**
   * 上报指标
   */
  async report(): Promise<void> {
    if (!this.reportUrl) {
      return;
    }
    
    try {
      const payload = {
        ...this.metrics,
        timestamp: Date.now(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      };
      
      // 使用 sendBeacon 或 fetch 上报
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(this.reportUrl, blob);
      } else {
        await fetch(this.reportUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      }
    } catch (error) {
      console.error('Failed to report metrics:', error);
    }
  }
  
  /**
   * 启动定期上报
   */
  private startReporting(intervalMs: number): void {
    if (this.reportInterval !== null) {
      clearInterval(this.reportInterval);
    }
    
    this.reportInterval = window.setInterval(() => {
      this.report();
    }, intervalMs);
  }
  
  /**
   * 停止定期上报
   */
  stopReporting(): void {
    if (this.reportInterval !== null) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }
  }
  
  /**
   * 销毁（清理资源）
   */
  destroy(): void {
    this.stopReporting();
    // 最后一次上报
    this.report();
  }
}

