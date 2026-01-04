/**
 * Task Router Semantic Repair Health Check
 * P0-1: 实现真实的语义修复服务健康检查机制
 */

import logger from '../logger';

export enum SemanticRepairServiceStatus {
  INSTALLED = 'INSTALLED',  // 已安装但未运行
  RUNNING = 'RUNNING',      // 进程运行中但未健康
  HEALTHY = 'HEALTHY',      // 健康（HTTP接口可访问）
  WARMED = 'WARMED',        // 模型已warm，可以处理请求
}

export interface SemanticRepairHealthCheckResult {
  status: SemanticRepairServiceStatus;
  isAvailable: boolean;  // 是否可用于处理请求（只有WARMED状态为true）
  reason?: string;  // 状态原因
  lastCheckTime?: number;  // 最后检查时间
  responseTime?: number;  // 响应时间（ms）
}

export interface SemanticRepairHealthCheckConfig {
  healthCheckTimeout?: number;  // 健康检查超时（默认1000ms）
  healthCheckInterval?: number;  // 健康检查间隔（默认5000ms）
  warmedCheckTimeout?: number;  // Warm检查超时（默认2000ms）
  enableModelIntegrityCheck?: boolean;  // P2-2: 是否启用模型完整性检查（默认false，避免频繁IO）
  modelIntegrityCheckInterval?: number;  // P2-2: 模型完整性检查间隔（默认30分钟）
}

export class SemanticRepairHealthChecker {
  private config: Required<SemanticRepairHealthCheckConfig>;
  private healthCache: Map<string, {
    result: SemanticRepairHealthCheckResult;
    lastCheckTime: number;
  }> = new Map();
  private modelIntegrityChecker: any = null;  // P2-2: 模型完整性校验器（延迟加载）

  constructor(config: SemanticRepairHealthCheckConfig = {}) {
    this.config = {
      healthCheckTimeout: config.healthCheckTimeout ?? 1000,
      healthCheckInterval: config.healthCheckInterval ?? 5000,
      warmedCheckTimeout: config.warmedCheckTimeout ?? 2000,
      enableModelIntegrityCheck: config.enableModelIntegrityCheck ?? false,
      modelIntegrityCheckInterval: config.modelIntegrityCheckInterval ?? 30 * 60 * 1000, // 默认30分钟
    };
  }

  /**
   * P2-2: 设置模型完整性校验器
   */
  setModelIntegrityChecker(checker: any): void {
    this.modelIntegrityChecker = checker;
  }

  /**
   * 检查服务健康状态
   * P0-1: 实现真实的健康检查，包括进程、端口、HTTP接口、模型warm状态
   */
  async checkServiceHealth(
    serviceId: string,
    baseUrl: string,
    isProcessRunning: boolean = false
  ): Promise<SemanticRepairHealthCheckResult> {
    const cacheKey = `${serviceId}:${baseUrl}`;
    const cached = this.healthCache.get(cacheKey);
    const now = Date.now();

    // 使用缓存（如果检查间隔内）
    if (cached && (now - cached.lastCheckTime) < this.config.healthCheckInterval) {
      logger.debug(
        {
          serviceId,
          baseUrl,
          status: cached.result.status,
          cached: true,
        },
        'SemanticRepairHealthChecker: Using cached health check result'
      );
      return cached.result;
    }

    // 1. 检查进程是否运行
    if (!isProcessRunning) {
      const result: SemanticRepairHealthCheckResult = {
        status: SemanticRepairServiceStatus.INSTALLED,
        isAvailable: false,
        reason: 'Process not running',
        lastCheckTime: now,
      };
      this.updateCache(cacheKey, result, now);
      return result;
    }

    // 2. 检查HTTP健康接口
    const healthCheckResult = await this.checkHealthEndpoint(baseUrl);
    if (!healthCheckResult.healthy) {
      const result: SemanticRepairHealthCheckResult = {
        status: SemanticRepairServiceStatus.RUNNING,
        isAvailable: false,
        reason: healthCheckResult.reason || 'Health endpoint not accessible',
        lastCheckTime: now,
        responseTime: healthCheckResult.responseTime,
      };
      this.updateCache(cacheKey, result, now);
      return result;
    }

    // 3. 检查模型是否已warm
    const warmedCheckResult = await this.checkModelWarmed(baseUrl);
    if (!warmedCheckResult.warmed) {
      const result: SemanticRepairHealthCheckResult = {
        status: SemanticRepairServiceStatus.HEALTHY,
        isAvailable: false,
        reason: warmedCheckResult.reason || 'Model not warmed',
        lastCheckTime: now,
        responseTime: healthCheckResult.responseTime,
      };
      this.updateCache(cacheKey, result, now);
      return result;
    }

    // P2-2: 4. 可选：检查模型完整性（如果启用）
    if (this.config.enableModelIntegrityCheck && this.modelIntegrityChecker) {
      // 注意：这里需要服务包路径，需要从外部传入
      // 暂时跳过，在TaskRouter层面处理
    }

    // 5. 服务完全可用
    const result: SemanticRepairHealthCheckResult = {
      status: SemanticRepairServiceStatus.WARMED,
      isAvailable: true,
      reason: 'Service ready',
      lastCheckTime: now,
      responseTime: healthCheckResult.responseTime,
    };
    this.updateCache(cacheKey, result, now);

    logger.info(
      {
        serviceId,
        baseUrl,
        status: result.status,
        responseTime: result.responseTime,
      },
      'SemanticRepairHealthChecker: Service is healthy and warmed'
    );

    return result;
  }

  /**
   * 检查健康端点
   */
  private async checkHealthEndpoint(baseUrl: string): Promise<{
    healthy: boolean;
    reason?: string;
    responseTime?: number;
  }> {
    const startTime = Date.now();
    const url = `${baseUrl}/health`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.healthCheckTimeout);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        if (!response.ok) {
          return {
            healthy: false,
            reason: `HTTP ${response.status}: ${response.statusText}`,
            responseTime,
          };
        }

        const data = await response.json() as any;
        const status = data.status || data.health || 'unknown';

        if (status === 'healthy' || status === 'ready' || status === 'ok') {
          return {
            healthy: true,
            responseTime,
          };
        } else {
          return {
            healthy: false,
            reason: `Service status: ${status}`,
            responseTime,
          };
        }
      } catch (error: any) {
        clearTimeout(timeoutId);
        const responseTime = Date.now() - startTime;

        if (error.name === 'AbortError') {
          return {
            healthy: false,
            reason: 'Health check timeout',
            responseTime,
          };
        }

        return {
          healthy: false,
          reason: error.message || 'Health check failed',
          responseTime,
        };
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      return {
        healthy: false,
        reason: error.message || 'Health check error',
        responseTime,
      };
    }
  }

  /**
   * 检查模型是否已warm
   * 通过调用/health端点并检查响应中的warmed字段
   */
  private async checkModelWarmed(baseUrl: string): Promise<{
    warmed: boolean;
    reason?: string;
  }> {
    const url = `${baseUrl}/health`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.warmedCheckTimeout);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            warmed: false,
            reason: `HTTP ${response.status}`,
          };
        }

        const data = await response.json() as any;

        // 检查响应中的warmed字段
        if (data.warmed === true || data.model_warmed === true) {
          return {
            warmed: true,
          };
        }

        // 如果响应中没有warmed字段，但status为ready，也认为已warm
        if (data.status === 'ready' || data.status === 'warmed') {
          return {
            warmed: true,
          };
        }

        return {
          warmed: false,
          reason: 'Model not warmed (warmed field is false or missing)',
        };
      } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          return {
            warmed: false,
            reason: 'Warm check timeout',
          };
        }

        return {
          warmed: false,
          reason: error.message || 'Warm check failed',
        };
      }
    } catch (error: any) {
      return {
        warmed: false,
        reason: error.message || 'Warm check error',
      };
    }
  }

  /**
   * 更新缓存
   */
  private updateCache(
    cacheKey: string,
    result: SemanticRepairHealthCheckResult,
    checkTime: number
  ): void {
    this.healthCache.set(cacheKey, {
      result,
      lastCheckTime: checkTime,
    });
  }

  /**
   * 清除缓存（用于强制重新检查）
   */
  clearCache(serviceId?: string, baseUrl?: string): void {
    if (serviceId && baseUrl) {
      const cacheKey = `${serviceId}:${baseUrl}`;
      this.healthCache.delete(cacheKey);
    } else {
      this.healthCache.clear();
    }
  }

  /**
   * 获取缓存的状态
   */
  getCachedStatus(serviceId: string, baseUrl: string): SemanticRepairHealthCheckResult | null {
    const cacheKey = `${serviceId}:${baseUrl}`;
    const cached = this.healthCache.get(cacheKey);
    return cached ? cached.result : null;
  }
}
