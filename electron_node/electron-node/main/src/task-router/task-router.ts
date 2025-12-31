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
  ServiceSelectionStrategy,
} from './types';
import { TaskRouterASRHandler } from './task-router-asr';
import { TaskRouterNMTHandler } from './task-router-nmt';
import { TaskRouterTTSHandler } from './task-router-tts';
import { TaskRouterTONEHandler } from './task-router-tone';
import { TaskRouterServiceManager } from './task-router-service-manager';
import { TaskRouterServiceSelector } from './task-router-service-selector';

export class TaskRouter {
  private serviceEndpoints: Map<ServiceType, ServiceEndpoint[]> = new Map();
  private serviceConnections: Map<string, number> = new Map(); // 服务连接数统计
  private selectionStrategy: ServiceSelectionStrategy = 'round_robin';
  // best-effort cancel 支持：HTTP AbortController（用于中断 HTTP 请求）
  private jobAbortControllers: Map<string, AbortController> = new Map();
  // 路由处理器
  private asrHandler: TaskRouterASRHandler;
  private nmtHandler: TaskRouterNMTHandler;
  private ttsHandler: TaskRouterTTSHandler;
  private toneHandler: TaskRouterTONEHandler;
  // 服务管理器和选择器
  private serviceManager: TaskRouterServiceManager;
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
    private pythonServiceManager: any,
    private rustServiceManager: any,
    private serviceRegistryManager: any
  ) {
    // 初始化服务管理器和选择器
    this.serviceManager = new TaskRouterServiceManager(
      this.pythonServiceManager,
      this.rustServiceManager,
      this.serviceRegistryManager
    );
    this.serviceSelector = new TaskRouterServiceSelector();

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
  }


  /**
   * 初始化服务端点列表
   */
  async initialize(): Promise<void> {
    await this.refreshServiceEndpoints();
  }

  /**
   * 刷新服务端点列表
   */
  async refreshServiceEndpoints(): Promise<void> {
    this.serviceEndpoints = await this.serviceManager.refreshServiceEndpoints();
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
   * OBS-1: 获取当前心跳周期的 ASR 指标（向后兼容）
   * @deprecated 使用 getProcessingMetrics() 或 getServiceEfficiency() 代替
   */
  getASRMetrics() {
    // 向后兼容：查找 faster-whisper-vad 的处理效率
    const asrEfficiency = this.getServiceEfficiency('faster-whisper-vad');
    return {
      processingEfficiency: asrEfficiency,
    };
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
   * 根据 serviceId 自动判断是 Python 服务还是 Rust 服务
   */
  private startGpuTrackingForService(serviceId: string): void {
    try {
      // 映射 serviceId 到 Python 服务名称
      const serviceIdToPythonName: Record<string, string> = {
        'faster-whisper-vad': 'faster_whisper_vad',
        'nmt-m2m100': 'nmt',
        'piper-tts': 'tts',
        'your-tts': 'yourtts',
        'speaker-embedding': 'speaker_embedding',
      };

      const pythonServiceName = serviceIdToPythonName[serviceId];
      if (pythonServiceName && this.pythonServiceManager) {
        // Python 服务：启动 GPU 跟踪
        this.pythonServiceManager.startGpuTracking(pythonServiceName as any);
        logger.debug({ serviceId, pythonServiceName }, 'Started GPU tracking for Python service');
      } else if (serviceId === 'node-inference' && this.rustServiceManager) {
        // Rust 服务：启动 GPU 跟踪
        this.rustServiceManager.startGpuTracking();
        logger.debug({ serviceId }, 'Started GPU tracking for Rust service');
      } else {
        logger.debug({ serviceId }, 'No GPU tracking available for service (service may not use GPU)');
      }
    } catch (error) {
      logger.warn({ error, serviceId }, 'Failed to start GPU tracking for service');
    }
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
   * 设置服务选择策略
   */
  setSelectionStrategy(strategy: ServiceSelectionStrategy): void {
    this.selectionStrategy = strategy;
  }
}

