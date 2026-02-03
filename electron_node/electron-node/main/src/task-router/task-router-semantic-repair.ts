/**
 * Task Router Semantic Repair Handler
 * 处理语义修复任务路由相关的逻辑
 *
 * 设计契约（强制语义修复，失败即失败）：
 * - 对每个 utterance 必须调用语义修复并成功返回。
 * - 若语义修复不可用/超时/异常：job 直接失败，由上层将错误回传调度服务器（调度重试/重分配）。
 * - 不再存在 PASS 作为降级策略；不可用/超时/异常一律 throw。
 */

import logger from '../logger';
import { ServiceType, ServiceStatus } from '../../../../shared/protocols/messages';
import {
  ServiceEndpoint,
  SemanticRepairTask,
  SemanticRepairResult,
  ServiceSelectionStrategy,
} from './types';
import { TaskRouterServiceSelector } from './task-router-service-selector';
import { SemanticRepairConcurrencyManager } from './task-router-semantic-repair-concurrency';
import { SemanticRepairHealthChecker, SemanticRepairServiceStatus } from './task-router-semantic-repair-health';
import { SemanticRepairCache } from './semantic-repair-cache';
import { SemanticRepairModelIntegrityChecker } from './semantic-repair-model-integrity';

export class TaskRouterSemanticRepairHandler {
  private serviceSelector: TaskRouterServiceSelector;
  private concurrencyManager: SemanticRepairConcurrencyManager;
  private healthChecker: SemanticRepairHealthChecker;
  private cache: SemanticRepairCache;  // P2-1: 语义修复结果缓存
  private modelIntegrityChecker: SemanticRepairModelIntegrityChecker | null = null;  // P2-2: 模型完整性校验器
  private isServiceRunningCallback: ((serviceId: string) => boolean) | null = null;
  private getServicePathCallback: ((serviceId: string) => string | null) | null = null;  // P2-2: 获取服务包路径的回调
  private getServiceEndpointById: ((serviceId: string) => ServiceEndpoint | null) | null = null;  // 直接根据服务ID查找端点

  constructor(
    private selectServiceEndpoint: (serviceType: ServiceType) => ServiceEndpoint | null,
    private startGpuTrackingForService: (serviceId: string) => void,
    private serviceConnections: Map<string, number>,
    private updateConnections: (serviceId: string, delta: number) => void,
    maxConcurrency: number = 2,  // P0-5: 默认最大并发数为2
    isServiceRunningCallback?: (serviceId: string) => boolean,  // P0-1: 用于检查进程是否运行
    cacheConfig?: { maxSize?: number; ttlMs?: number; modelVersion?: string },  // P2-1: 缓存配置
    enableModelIntegrityCheck: boolean = false,  // P2-2: 是否启用模型完整性检查
    getServicePathCallback?: (serviceId: string) => string | null,  // P2-2: 获取服务包路径的回调
    getServiceEndpointById?: (serviceId: string) => ServiceEndpoint | null  // 直接根据服务ID查找端点
  ) {
    this.getServiceEndpointById = getServiceEndpointById || null;
    this.serviceSelector = new TaskRouterServiceSelector();
    this.concurrencyManager = new SemanticRepairConcurrencyManager({
      maxConcurrency,
    });
    this.healthChecker = new SemanticRepairHealthChecker({
      enableModelIntegrityCheck,  // P2-2: 传递配置
    });
    this.isServiceRunningCallback = isServiceRunningCallback || null;
    this.getServicePathCallback = getServicePathCallback || null;

    // P2-1: 初始化缓存
    this.cache = new SemanticRepairCache({
      maxSize: cacheConfig?.maxSize || 200,
      ttlMs: cacheConfig?.ttlMs || 5 * 60 * 1000,  // 默认5分钟
      modelVersion: cacheConfig?.modelVersion || 'default',
    });

    // P2-2: 初始化模型完整性校验器（如果启用）
    if (enableModelIntegrityCheck) {
      this.modelIntegrityChecker = new SemanticRepairModelIntegrityChecker({
        checkOnStartup: true,
        checkOnHealthCheck: false,  // 默认不在健康检查时检查，避免频繁IO
        checkInterval: 30 * 60 * 1000,  // 默认30分钟
      });
      this.healthChecker.setModelIntegrityChecker(this.modelIntegrityChecker);
    }
  }

  /**
   * 路由语义修复任务
   */
  async routeSemanticRepairTask(task: SemanticRepairTask): Promise<SemanticRepairResult> {
    const cachedResult = this.cache.get(task.lang, task.text_in);
    if (cachedResult) {
      // REPAIR 但 output === input 视为旧逻辑下的无效缓存，跳过
      if (cachedResult.decision === 'REPAIR' && cachedResult.text_out === task.text_in) {
        // skip cache, call service
      } else {
        logger.debug(
          { jobId: task.job_id, lang: task.lang, decision: cachedResult.decision },
          'Semantic repair result from cache'
        );
        return cachedResult;
      }
    }

    // 仅使用合并语义修复服务 semantic-repair-en-zh（与备份一致：单一服务 ID，直接查端点）
    const serviceId = 'semantic-repair-en-zh';
    const endpoint = this.getServiceEndpointById?.(serviceId) ?? null;

    if (!endpoint) {
      logger.warn(
        { lang: task.lang, serviceId, message: 'Semantic repair service not found' },
        'Semantic repair service not available, failing job'
      );
      throw new Error('SEM_REPAIR_UNAVAILABLE: SERVICE_NOT_AVAILABLE');
    }

    // P0-1: 检查服务健康状态（只有WARMED状态才可用）
    // 注意：在测试环境中，如果没有提供isServiceRunningCallback，跳过健康检查
    if (this.isServiceRunningCallback) {
      const isProcessRunning = this.isServiceRunningCallback(endpoint.serviceId);

      const healthResult = await this.healthChecker.checkServiceHealth(
        endpoint.serviceId,
        endpoint.baseUrl,
        isProcessRunning
      );

      if (!healthResult.isAvailable) {
        logger.warn(
          {
            serviceId: endpoint.serviceId,
            baseUrl: endpoint.baseUrl,
            status: healthResult.status,
            reason: healthResult.reason,
          },
          'Semantic repair service not available (not warmed), failing job'
        );
        throw new Error(`SEM_REPAIR_UNAVAILABLE: SERVICE_NOT_${healthResult.status}`);
      }
    }

    // P0-5: 获取并发许可（如果超过限制则等待）
    const acquireStartTime = Date.now();
    try {
      logger.info(
        {
          jobId: task.job_id,
          sessionId: task.session_id,
          utteranceIndex: task.utterance_index,
          serviceId: endpoint.serviceId,
          textLength: task.text_in?.length || 0,
        },
        'SemanticRepairHandler: Attempting to acquire concurrency permit'
      );
      await this.concurrencyManager.acquire(endpoint.serviceId, task.job_id, 5000);
      const acquireDuration = Date.now() - acquireStartTime;
      logger.info(
        {
          jobId: task.job_id,
          serviceId: endpoint.serviceId,
          acquireDurationMs: acquireDuration,
        },
        'SemanticRepairHandler: Concurrency permit acquired'
      );
    } catch (error: any) {
      const acquireDuration = Date.now() - acquireStartTime;
      logger.warn(
        {
          error: error.message,
          jobId: task.job_id,
          sessionId: task.session_id,
          utteranceIndex: task.utterance_index,
          serviceId: endpoint.serviceId,
          acquireDurationMs: acquireDuration,
        },
        'Semantic repair concurrency timeout, failing job'
      );
      throw new Error('SEM_REPAIR_TIMEOUT: CONCURRENCY_TIMEOUT');
    }

    // 更新连接数
    this.updateConnections(endpoint.serviceId, 1);
    this.startGpuTrackingForService(endpoint.serviceId);

    const serviceCallStartTime = Date.now();
    try {
      // 调用语义修复服务
      logger.info(
        {
          jobId: task.job_id,
          sessionId: task.session_id,
          utteranceIndex: task.utterance_index,
          serviceId: endpoint.serviceId,
          baseUrl: endpoint.baseUrl,
          textLength: task.text_in?.length || 0,
        },
        'SemanticRepairHandler: Calling semantic repair service'
      );
      const result = await this.callSemanticRepairService(endpoint, task);
      const serviceCallDuration = Date.now() - serviceCallStartTime;
      if (result.decision === 'REPAIR') {
        this.cache.set(task.lang, task.text_in, result);
      }

      logger.info(
        {
          jobId: task.job_id,
          sessionId: task.session_id,
          utteranceIndex: task.utterance_index,
          lang: task.lang,
          decision: result.decision,
          confidence: result.confidence,
          reasonCodes: result.reason_codes,
          serviceCallDurationMs: serviceCallDuration,
          cached: result.decision === 'REPAIR',
        },
        'Semantic repair task completed'
      );

      return result;
    } catch (error: any) {
      const serviceCallDuration = Date.now() - serviceCallStartTime;
      const isTimeout = error.message?.includes('timeout') || error.name === 'AbortError';
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          jobId: task.job_id,
          sessionId: task.session_id,
          utteranceIndex: task.utterance_index,
          lang: task.lang,
          serviceId: endpoint.serviceId,
          serviceCallDurationMs: serviceCallDuration,
          isTimeout,
        },
        'Semantic repair service error, failing job'
      );
      const code = isTimeout ? 'SEM_REPAIR_TIMEOUT: SERVICE_TIMEOUT' : 'SEM_REPAIR_ERROR: SERVICE_ERROR';
      throw new Error(`${code} (${error.message || error})`);
    } finally {
      // P0-5: 释放并发许可
      logger.info(
        {
          jobId: task.job_id,
          serviceId: endpoint.serviceId,
        },
        'SemanticRepairHandler: Releasing concurrency permit'
      );
      this.concurrencyManager.release(endpoint.serviceId, task.job_id);
      // 更新连接数
      this.updateConnections(endpoint.serviceId, -1);
    }
  }

  /**
   * 调用语义修复服务
   */
  private async callSemanticRepairService(
    endpoint: ServiceEndpoint,
    task: SemanticRepairTask
  ): Promise<SemanticRepairResult> {
    const url = `${endpoint.baseUrl}/repair`;
    // 长句或大模型生成可能超过 10s，使用 30s 降低 SERVICE_TIMEOUT（与 GPU 仲裁无关，语义修复为 HTTP 调独立服务）
    const timeout = 30000;

    // 合并语义修复 job 输入日志：便于排查请求内容
    const textInPreview = task.text_in.length > 80 ? `${task.text_in.slice(0, 80)}…` : task.text_in;
    logger.info(
      {
        job_id: task.job_id,
        lang: task.lang,
        text_in_len: task.text_in.length,
        text_in_preview: textInPreview,
      },
      'Semantic repair job input (sending to service)'
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          job_id: task.job_id,
          session_id: task.session_id,
          utterance_index: task.utterance_index,
          lang: task.lang,
          text_in: task.text_in,
          quality_score: task.quality_score,
          micro_context: task.micro_context,
          meta: task.meta,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as any;

      // 验证响应格式
      if (!data.decision || !data.text_out || typeof data.confidence !== 'number') {
        throw new Error('Invalid response format from semantic repair service');
      }

      // 合并语义修复 job 输出日志：便于排查返回结果与耗时
      const textOutPreview = (data.text_out || '').length > 80
        ? `${String(data.text_out).slice(0, 80)}…`
        : (data.text_out || '');
      logger.info(
        {
          job_id: task.job_id,
          decision: data.decision,
          text_out_len: (data.text_out || '').length,
          text_out_preview: textOutPreview,
          process_time_ms: data.process_time_ms,
        },
        'Semantic repair job output (received from service)'
      );

      return {
        decision: data.decision,
        text_out: data.text_out,
        confidence: data.confidence,
        diff: data.diff,
        reason_codes: data.reason_codes || [],
        process_time_ms: data.process_time_ms,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Semantic repair service timeout');
      }
      throw error;
    }
  }

  /**
   * 检查语义修复服务健康状态
   * P0-1: 使用真实的健康检查器
   */
  async checkServiceHealth(serviceId: string, baseUrl: string): Promise<boolean> {
    const isProcessRunning = this.isServiceRunningCallback
      ? this.isServiceRunningCallback(serviceId)
      : false;

    const healthResult = await this.healthChecker.checkServiceHealth(
      serviceId,
      baseUrl,
      isProcessRunning
    );

    return healthResult.isAvailable;
  }

  /**
   * 获取详细的服务健康状态
   * P0-1: 返回详细的状态信息
   */
  async getServiceHealthStatus(
    serviceId: string,
    baseUrl: string
  ): Promise<import('./task-router-semantic-repair-health').SemanticRepairHealthCheckResult> {
    const isProcessRunning = this.isServiceRunningCallback
      ? this.isServiceRunningCallback(serviceId)
      : false;

    return await this.healthChecker.checkServiceHealth(
      serviceId,
      baseUrl,
      isProcessRunning
    );
  }

  /**
   * P2-1: 获取缓存统计信息
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    modelVersion: string;
  } {
    return this.cache.getStats();
  }

  /**
   * P2-1: 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * P2-1: 更新模型版本（当模型更新时调用）
   */
  updateModelVersion(newVersion: string): void {
    this.cache.updateModelVersion(newVersion);
  }
}
