// 任务路由器 - 根据任务类型路由到对应的服务

import logger from '../logger';
import { ServiceType, InstalledService } from '../../../../shared/protocols/messages';
import { loadNodeConfig, NodeConfig } from '../node-config';
import {
  ServiceEndpoint,
  ASRTask,
  ASRResult,
  NMTTask,
  NMTResult,
  TTSTask,
  TTSResult,
  TONETask,
  TONEResult,
  SemanticRepairTask,
  SemanticRepairResult,
  ServiceSelectionStrategy,
} from './types';
import { TaskRouterASRHandler } from './task-router-asr';
import { TaskRouterNMTHandler } from './task-router-nmt';
import { TaskRouterTTSHandler } from './task-router-tts';
import { TaskRouterTONEHandler } from './task-router-tone';
import { TaskRouterSemanticRepairHandler } from './task-router-semantic-repair';
import { TaskRouterServiceManagerNew } from './task-router-service-manager-new';
import { TaskRouterServiceSelector } from './task-router-service-selector';
import { ServiceRegistry } from '../service-layer/ServiceTypes';

export class TaskRouter {
  private serviceEndpoints: Map<ServiceType, ServiceEndpoint[]> = new Map();
  private serviceConnections: Map<string, number> = new Map(); // 服务连接数统计
  private selectionStrategy: ServiceSelectionStrategy = 'round_robin';
  // best-effort cancel 支持：HTTP AbortController（用于中断 HTTP 请求）
  private jobAbortControllers: Map<string, AbortController> = new Map();
  // Service Endpoints 刷新缓存：避免频繁刷新服务端点列表
  private lastRefreshTime: number = 0;
  private refreshCacheTTL: number = 1000; // 默认 1 秒缓存（可配置，500ms-1000ms）
  // 路由处理器
  private asrHandler: TaskRouterASRHandler;
  private nmtHandler: TaskRouterNMTHandler;
  private ttsHandler: TaskRouterTTSHandler;
  private toneHandler: TaskRouterTONEHandler;
  private semanticRepairHandler: TaskRouterSemanticRepairHandler;
  // 服务管理器和选择器
  private serviceManager: TaskRouterServiceManagerNew;
  private serviceSelector: TaskRouterServiceSelector;
  // OBS-1: 处理效率观测指标统计（按心跳周期，按服务ID分组）
  // 每个服务ID对应一个处理效率列表（用于NMT、TTS等非ASR服务）
  private currentCycleServiceEfficiencies: Map<string, number[]> = new Map(); // serviceId -> efficiency[]

  /**
   * Gate-A: 重置指定 session 的连续低质量计数
   * @param sessionId 会话 ID
   */
  resetConsecutiveLowQualityCount(sessionId: string): void {
    this.asrHandler.resetConsecutiveLowQualityCount(sessionId);
  }

  constructor(
    private registry: ServiceRegistry
  ) {
    // 初始化服务管理器和选择器
    this.serviceManager = new TaskRouterServiceManagerNew(this.registry);
    this.serviceSelector = new TaskRouterServiceSelector();

    // 初始化SEMANTIC类型的端点列表（用于语义修复服务）
    this.serviceEndpoints.set(ServiceType.SEMANTIC, []);

    // 初始化路由处理器
    const updateConnections = (serviceId: string, delta: number) => {
      const connections = this.serviceConnections.get(serviceId) || 0;
      this.serviceConnections.set(serviceId, Math.max(0, connections + delta));
    };

    this.asrHandler = new TaskRouterASRHandler(
      (serviceType) => this.selectServiceEndpoint(serviceType),
      (serviceId) => this.startGpuTrackingForService(serviceId),
      this.serviceConnections,
      updateConnections
    );

    this.nmtHandler = new TaskRouterNMTHandler(
      (serviceType) => this.selectServiceEndpoint(serviceType),
      (serviceId) => this.startGpuTrackingForService(serviceId),
      this.serviceConnections,
      updateConnections,
      (serviceId, efficiency) => this.recordServiceEfficiency(serviceId, efficiency)
    );

    this.ttsHandler = new TaskRouterTTSHandler(
      (serviceType) => this.selectServiceEndpoint(serviceType),
      (serviceId) => this.startGpuTrackingForService(serviceId),
      this.serviceConnections,
      updateConnections,
      (serviceId, efficiency) => this.recordServiceEfficiency(serviceId, efficiency)
    );

    this.toneHandler = new TaskRouterTONEHandler(
      (serviceType) => this.selectServiceEndpoint(serviceType),
      this.serviceConnections,
      updateConnections
    );

    // P0-5: 语义修复服务并发限制（默认2）
    const semanticRepairMaxConcurrency = 2;
    // P2-1: 读取缓存配置
    const config = loadNodeConfig();
    const cacheConfig = config.features?.semanticRepair?.cache;
    // P2-2: 读取模型完整性检查配置
    const enableModelIntegrityCheck = config.features?.semanticRepair?.modelIntegrityCheck?.enabled ?? false;
    // P0-1: 传递服务运行状态检查回调
    // P2-2: 传递获取服务包路径的回调
    this.semanticRepairHandler = new TaskRouterSemanticRepairHandler(
      (serviceType) => this.selectServiceEndpoint(serviceType),
      (serviceId) => this.startGpuTrackingForService(serviceId),
      this.serviceConnections,
      updateConnections,
      semanticRepairMaxConcurrency,
      (serviceId: string) => {
        // 检查语义修复服务是否运行（通过SEMANTIC类型的端点列表）
        const semanticEndpoints = this.serviceEndpoints.get(ServiceType.SEMANTIC) || [];
        const endpoint = semanticEndpoints.find(e => e.serviceId === serviceId);
        return endpoint?.status === 'running' || false;
      },
      cacheConfig,  // P2-1: 传递缓存配置
      enableModelIntegrityCheck,  // P2-2: 是否启用模型完整性检查
      (serviceId: string) => {
        // P2-2: 从服务注册表获取服务包路径
        const entry = this.registry.get(serviceId);
        return entry?.installPath || null;
      },
      (serviceId: string) => {
        // 直接根据服务ID查找端点（用于语义修复服务）
        const semanticEndpoints = this.serviceEndpoints.get(ServiceType.SEMANTIC) || [];
        return semanticEndpoints.find(e => e.serviceId === serviceId && e.status === 'running') || null;
      }
    );
  }


  /**
   * 初始化服务端点列表
   */
  async initialize(): Promise<void> {
    await this.refreshServiceEndpoints();
  }

  /**
   * 刷新服务端点列表（带缓存机制）
   * @param forceRefresh 是否强制刷新（忽略缓存）
   */
  async refreshServiceEndpoints(forceRefresh: boolean = false): Promise<void> {
    const now = Date.now();
    const cacheAge = now - this.lastRefreshTime;

    // 如果强制刷新或缓存已过期，则刷新
    if (forceRefresh || cacheAge >= this.refreshCacheTTL) {
      this.serviceEndpoints = await this.serviceManager.refreshServiceEndpoints();
      this.lastRefreshTime = now;
      logger.debug(
        {
          forceRefresh,
          cacheAge,
          ttl: this.refreshCacheTTL
        },
        'Service endpoints refreshed'
      );
    } else {
      logger.debug(
        {
          cacheAge,
          ttl: this.refreshCacheTTL
        },
        'Service endpoints refresh skipped (using cache)'
      );
    }
  }

  /**
   * 强制刷新服务端点列表（忽略缓存）
   * 用于 waitForServicesReady 等需要实时状态的场景
   */
  async forceRefreshServiceEndpoints(): Promise<void> {
    await this.refreshServiceEndpoints(true);
  }

  /**
   * Gate-A: 获取 ASR 服务端点列表（用于上下文重置）
   */
  getASREndpoints(): string[] {
    const endpoints = this.serviceEndpoints.get(ServiceType.ASR) || [];
    return endpoints
      .filter(e => e.status === 'running')
      .map(e => e.baseUrl);
  }

  /**
   * Gate-B: 获取 Rerun 指标（用于上报）
   */
  getRerunMetrics() {
    return this.asrHandler.getRerunMetrics();
  }

  /**
   * OBS-1: 获取 ASR 观测指标（用于上报）
   */
  /**
   * OBS-1: 获取当前心跳周期的处理效率指标（按服务ID分组）
   * 返回每个服务ID的平均处理效率
   */
  getProcessingMetrics(): Record<string, number> {
    // 合并所有 handler 的指标
    const asrMetrics = this.asrHandler.getProcessingMetrics();
    const nmtMetrics = this.nmtHandler.getProcessingMetrics();
    const ttsMetrics = this.ttsHandler.getProcessingMetrics();

    const result: Record<string, number> = { ...asrMetrics, ...nmtMetrics, ...ttsMetrics };

    // 计算其他服务的平均处理效率（如果有）
    for (const [serviceId, efficiencies] of this.currentCycleServiceEfficiencies.entries()) {
      if (efficiencies.length > 0 && !result[serviceId]) {
        const sum = efficiencies.reduce((a: number, b: number) => a + b, 0);
        const average = sum / efficiencies.length;
        result[serviceId] = average;
      }
    }

    return result;
  }

  /**
   * OBS-1: 获取指定服务ID的处理效率
   * @param serviceId 服务ID
   * @returns 处理效率，如果该服务在心跳周期内没有任务则为 null
   */
  getServiceEfficiency(serviceId: string): number | null {
    const efficiencies = this.currentCycleServiceEfficiencies.get(serviceId);
    if (!efficiencies || efficiencies.length === 0) {
      return null;
    }
    const sum = efficiencies.reduce((a, b) => a + b, 0);
    return sum / efficiencies.length;
  }


  /**
   * OBS-1: 重置当前心跳周期的统计数据
   * 在每次心跳发送后调用，清空当前周期的数据
   */
  resetCycleMetrics(): void {
    this.asrHandler.resetCycleMetrics();
    this.nmtHandler.resetCycleMetrics();
    this.ttsHandler.resetCycleMetrics();
    this.currentCycleServiceEfficiencies.clear();
  }

  /**
   * GPU 跟踪：为指定服务启动 GPU 跟踪
   * 注意：新架构中GPU跟踪已经在ServiceProcessRunner中统一处理
   * 这里保留空实现以兼容旧接口
   */
  private startGpuTrackingForService(serviceId: string): void {
    // GPU跟踪已经在ServiceProcessRunner中处理，这里不需要额外操作
    logger.debug({ serviceId }, 'GPU tracking handled by ServiceProcessRunner');
  }


  /**
   * OBS-1: 记录服务处理效率（按心跳周期，按服务ID分组）
   * @param serviceId 服务ID（如 'faster-whisper-vad', 'nmt-m2m100', 'piper-tts' 等）
   * @param efficiency 处理效率值
   */
  private recordServiceEfficiency(serviceId: string, efficiency: number): void {
    if (!serviceId || !isFinite(efficiency) || efficiency <= 0) {
      return;
    }

    // 获取或创建该服务ID的效率列表
    let efficiencies = this.currentCycleServiceEfficiencies.get(serviceId);
    if (!efficiencies) {
      efficiencies = [];
      this.currentCycleServiceEfficiencies.set(serviceId, efficiencies);
    }

    efficiencies.push(efficiency);

    logger.debug(
      { serviceId, efficiency },
      'OBS-1: Recorded service processing efficiency'
    );
  }



  /**
   * 选择服务端点
   */
  private selectServiceEndpoint(serviceType: ServiceType): ServiceEndpoint | null {
    const endpoints = this.serviceEndpoints.get(serviceType) || [];
    if (endpoints.length === 0) {
      logger.warn({ serviceType, endpointCount: 0 }, 'No endpoints available for service type');
      return null;
    }

    // 过滤出运行中的服务
    const runningEndpoints = endpoints.filter((e) => e.status === 'running');
    if (runningEndpoints.length === 0) {
      logger.warn({
        serviceType,
        totalEndpoints: endpoints.length,
        endpointStatuses: endpoints.map(e => ({ serviceId: e.serviceId, status: e.status })),
      }, 'No running endpoints available for service type');
      return null;
    }

    logger.debug({
      serviceType,
      availableEndpoints: runningEndpoints.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })),
    }, 'Selecting service endpoint');

    switch (this.selectionStrategy) {
      case 'round_robin': {
        // 创建临时映射，只包含运行中的端点
        const runningEndpointsMap = new Map<ServiceType, ServiceEndpoint[]>();
        runningEndpointsMap.set(serviceType, runningEndpoints);
        return this.serviceSelector.selectServiceEndpoint(serviceType, runningEndpointsMap, this.selectionStrategy);
      }
      case 'least_connections': {
        let minConnections = Infinity;
        let selected: ServiceEndpoint | null = null;
        for (const endpoint of runningEndpoints) {
          const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
          if (connections < minConnections) {
            minConnections = connections;
            selected = endpoint;
          }
        }
        return selected;
      }
      case 'random': {
        const index = Math.floor(Math.random() * runningEndpoints.length);
        return runningEndpoints[index];
      }
      case 'first_available':
      default:
        return runningEndpoints[0];
    }
  }

  /**
   * 路由 ASR 任务
   */
  async routeASRTask(task: ASRTask): Promise<ASRResult> {
    return await this.asrHandler.routeASRTask(task);
  }

  /**
   * 取消任务（best-effort cancel：尝试中断 HTTP 请求）
   * 注意：取消不保证推理服务一定立刻停止（取决于下游实现）
   */
  cancelJob(jobId: string): boolean {
    const controller = this.jobAbortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.jobAbortControllers.delete(jobId);
      logger.info({ jobId }, 'Task cancelled via AbortController');
      return true;
    }
    return false;
  }

  /**
   * 路由 NMT 任务
   */
  async routeNMTTask(task: NMTTask): Promise<NMTResult> {
    return await this.nmtHandler.routeNMTTask(task);
  }

  /**
   * 路由 TTS 任务
   */
  async routeTTSTask(task: TTSTask): Promise<TTSResult> {
    return await this.ttsHandler.routeTTSTask(task);
  }

  /**
   * 路由 TONE 任务
   */
  async routeTONETask(task: TONETask): Promise<TONEResult> {
    return await this.toneHandler.routeTONETask(task);
  }

  /**
   * 路由语义修复任务
   */
  async routeSemanticRepairTask(task: SemanticRepairTask): Promise<SemanticRepairResult> {
    return await this.semanticRepairHandler.routeSemanticRepairTask(task);
  }

  /**
   * 检查语义修复服务健康状态
   */
  async checkSemanticRepairServiceHealth(serviceId: string, baseUrl: string): Promise<boolean> {
    return await this.semanticRepairHandler.checkServiceHealth(serviceId, baseUrl);
  }

  /**
   * 设置服务选择策略
   */
  setSelectionStrategy(strategy: ServiceSelectionStrategy): void {
    this.selectionStrategy = strategy;
  }
}

