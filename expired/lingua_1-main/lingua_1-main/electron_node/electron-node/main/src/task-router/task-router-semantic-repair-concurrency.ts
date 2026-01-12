/**
 * Task Router Semantic Repair Concurrency Manager
 * 管理语义修复服务的并发限制
 */

import logger from '../logger';

export interface SemanticRepairConcurrencyConfig {
  maxConcurrency?: number;  // 最大并发数（默认2）
  serviceMaxConcurrency?: Map<string, number>;  // 每个服务的最大并发数
}

export class SemanticRepairConcurrencyManager {
  private activeRequests: Map<string, Set<string>> = new Map();  // serviceId -> Set<job_id>
  private waitingQueue: Array<{
    serviceId: string;
    jobId: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private config: SemanticRepairConcurrencyConfig;

  constructor(config: SemanticRepairConcurrencyConfig = {}) {
    this.config = {
      maxConcurrency: config.maxConcurrency || 2,
      serviceMaxConcurrency: config.serviceMaxConcurrency || new Map(),
    };
  }

  /**
   * 获取服务的最大并发数
   */
  private getMaxConcurrency(serviceId: string): number {
    return this.config.serviceMaxConcurrency?.get(serviceId) || this.config.maxConcurrency || 2;
  }

  /**
   * 获取当前活跃请求数
   */
  private getActiveCount(serviceId: string): number {
    return this.activeRequests.get(serviceId)?.size || 0;
  }

  /**
   * 获取并发许可（如果超过限制则等待）
   */
  async acquire(serviceId: string, jobId: string, timeoutMs: number = 5000): Promise<void> {
    const maxConcurrency = this.getMaxConcurrency(serviceId);
    const activeCount = this.getActiveCount(serviceId);

    // 如果未超过限制，直接获取许可
    if (activeCount < maxConcurrency) {
      this.addActiveRequest(serviceId, jobId);
      logger.debug(
        {
          serviceId,
          jobId,
          activeCount: activeCount + 1,
          maxConcurrency,
        },
        'SemanticRepairConcurrencyManager: Acquired permit immediately'
      );
      return;
    }

    // 超过限制，加入等待队列
    const queueStartTime = Date.now();
    logger.info(
      {
        serviceId,
        jobId,
        activeCount,
        maxConcurrency,
        queueLength: this.waitingQueue.length,
        timeoutMs,
        waitingJobIds: this.waitingQueue.map(item => item.jobId),
        activeJobIds: Array.from(this.activeRequests.get(serviceId) || []),
      },
      'SemanticRepairConcurrencyManager: Concurrency limit reached, queuing request'
    );

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // 从等待队列中移除
        const waitDuration = Date.now() - queueStartTime;
        const index = this.waitingQueue.findIndex(
          (item) => item.serviceId === serviceId && item.jobId === jobId
        );
        if (index >= 0) {
          this.waitingQueue.splice(index, 1);
        }
        logger.warn(
          {
            serviceId,
            jobId,
            waitDurationMs: waitDuration,
            timeoutMs,
            activeCount: this.getActiveCount(serviceId),
            queueLength: this.waitingQueue.length,
            activeJobIds: Array.from(this.activeRequests.get(serviceId) || []),
          },
          'SemanticRepairConcurrencyManager: Concurrency timeout - job waited too long'
        );
        reject(new Error(`Semantic repair concurrency timeout for ${serviceId}, job ${jobId}`));
      }, timeoutMs);

      this.waitingQueue.push({
        serviceId,
        jobId,
        resolve: () => {
          clearTimeout(timeout);
          const waitDuration = Date.now() - queueStartTime;
          logger.info(
            {
              serviceId,
              jobId,
              waitDurationMs: waitDuration,
              queueLength: this.waitingQueue.length - 1,
              activeCount: this.getActiveCount(serviceId),
            },
            'SemanticRepairConcurrencyManager: Permit acquired after waiting'
          );
          this.addActiveRequest(serviceId, jobId);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout,
      });

      // 尝试处理等待队列
      this.processWaitingQueue();
    });
  }

  /**
   * 释放并发许可
   */
  release(serviceId: string, jobId: string): void {
    const activeSet = this.activeRequests.get(serviceId);
    if (activeSet) {
      activeSet.delete(jobId);
      if (activeSet.size === 0) {
        this.activeRequests.delete(serviceId);
      }
    }

    const activeCountAfter = this.getActiveCount(serviceId);
    const queueLengthBefore = this.waitingQueue.length;
    
    logger.info(
      {
        serviceId,
        jobId,
        activeCount: activeCountAfter,
        queueLengthBefore,
        waitingJobIds: this.waitingQueue.map(item => item.jobId),
      },
      'SemanticRepairConcurrencyManager: Released permit, processing waiting queue'
    );

    // 处理等待队列
    this.processWaitingQueue();
    
    const queueLengthAfter = this.waitingQueue.length;
    if (queueLengthAfter < queueLengthBefore) {
      logger.info(
        {
          serviceId,
          queueLengthBefore,
          queueLengthAfter,
          processedCount: queueLengthBefore - queueLengthAfter,
        },
        'SemanticRepairConcurrencyManager: Processed waiting queue items'
      );
    }
  }

  /**
   * 添加活跃请求
   */
  private addActiveRequest(serviceId: string, jobId: string): void {
    let activeSet = this.activeRequests.get(serviceId);
    if (!activeSet) {
      activeSet = new Set();
      this.activeRequests.set(serviceId, activeSet);
    }
    activeSet.add(jobId);
  }

  /**
   * 处理等待队列
   */
  private processWaitingQueue(): void {
    for (let i = this.waitingQueue.length - 1; i >= 0; i--) {
      const item = this.waitingQueue[i];
      const activeCount = this.getActiveCount(item.serviceId);
      const maxConcurrency = this.getMaxConcurrency(item.serviceId);

      if (activeCount < maxConcurrency) {
        // 可以处理，从队列中移除
        this.waitingQueue.splice(i, 1);
        item.resolve();
      }
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    activeRequests: Map<string, number>;
    waitingQueue: number;
  } {
    const activeRequests = new Map<string, number>();
    for (const [serviceId, set] of this.activeRequests.entries()) {
      activeRequests.set(serviceId, set.size);
    }

    return {
      activeRequests,
      waitingQueue: this.waitingQueue.length,
    };
  }
}
