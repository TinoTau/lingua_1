/**
 * Task Router ASR Metrics Handler
 * 处理ASR指标管理相关的逻辑
 */

import logger from '../logger';

export class ASRMetricsHandler {
  private consecutiveLowQualityCount: Map<string, number> = new Map();
  private currentCycleServiceEfficiencies: Map<string, number[]> = new Map();

  /**
   * Gate-A: 重置指定 session 的连续低质量计数
   */
  resetConsecutiveLowQualityCount(sessionId: string): void {
    this.consecutiveLowQualityCount.set(sessionId, 0);
    logger.info(
      {
        sessionId,
      },
      'Gate-A: Reset consecutiveLowQualityCount for session'
    );
  }

  /**
   * 更新连续低质量计数
   */
  updateConsecutiveLowQualityCount(sessionId: string, qualityScore: number): boolean {
    if (qualityScore < 0.4) {
      const currentCount = this.consecutiveLowQualityCount.get(sessionId) || 0;
      const newCount = currentCount + 1;
      this.consecutiveLowQualityCount.set(sessionId, newCount);
      
      if (newCount >= 2) {
        logger.warn(
          {
            sessionId,
            consecutiveLowQualityCount: newCount,
            qualityScore,
          },
          'P0.5-CTX-2: Consecutive low quality detected (>=2), should reset context'
        );
        return true; // 应该重置上下文
      }
    } else {
      this.consecutiveLowQualityCount.set(sessionId, 0);
    }
    return false;
  }

  /**
   * OBS-1: 记录 ASR 处理效率
   */
  recordASREfficiency(serviceId: string, audioDurationMs: number | undefined, processingTimeMs: number): void {
    if (!audioDurationMs || audioDurationMs <= 0 || processingTimeMs <= 0) {
      logger.debug(
        { serviceId, audioDurationMs, processingTimeMs },
        'OBS-1: Skipping ASR efficiency recording due to invalid parameters'
      );
      return;
    }

    const efficiency = audioDurationMs / processingTimeMs;
    let efficiencies = this.currentCycleServiceEfficiencies.get(serviceId);
    if (!efficiencies) {
      efficiencies = [];
      this.currentCycleServiceEfficiencies.set(serviceId, efficiencies);
    }
    efficiencies.push(efficiency);
    
    logger.debug(
      { serviceId, audioDurationMs, processingTimeMs, efficiency: efficiency.toFixed(2) },
      'OBS-1: Recorded ASR processing efficiency'
    );
  }

  /**
   * OBS-1: 获取当前心跳周期的处理效率指标
   */
  getProcessingMetrics(): Record<string, number> {
    const result: Record<string, number> = {};
    
    for (const [serviceId, efficiencies] of this.currentCycleServiceEfficiencies.entries()) {
      if (efficiencies.length > 0) {
        const sum = efficiencies.reduce((a, b) => a + b, 0);
        const average = sum / efficiencies.length;
        result[serviceId] = average;
      }
    }
    
    return result;
  }

  /**
   * OBS-1: 重置当前心跳周期的统计数据
   */
  resetCycleMetrics(): void {
    this.currentCycleServiceEfficiencies.clear();
  }
}
