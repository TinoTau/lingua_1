// 任务路由器 - 根据任务类型路由到对应的服务

import axios, { AxiosInstance } from 'axios';
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
// Opus 编码支持（使用 WebAssembly 实现，不会影响其他服务）
import { parseWavFile, encodePcm16ToOpus, isOpusEncoderAvailable } from '../utils/opus-encoder';
// CONF-3: 基于 segments 时间戳的断裂/异常检测
import { detectBadSegment, BadSegmentDetectionResult } from './bad-segment-detector';
// P0.5-SH-1: 坏段触发条件封装
import { shouldTriggerRerun, getTop2LanguagesForRerun } from './rerun-trigger';

export class TaskRouter {
  private serviceEndpoints: Map<ServiceType, ServiceEndpoint[]> = new Map();
  private serviceConnections: Map<string, number> = new Map(); // 服务连接数统计
  private selectionStrategy: ServiceSelectionStrategy = 'round_robin';
  private roundRobinIndex: Map<ServiceType, number> = new Map();
  // best-effort cancel 支持：HTTP AbortController（用于中断 HTTP 请求）
  private jobAbortControllers: Map<string, AbortController> = new Map();
  // P0.5-SH-5: Rerun 指标统计
  private rerunMetrics = {
    totalReruns: 0,
    successfulReruns: 0,
    failedReruns: 0,
    timeoutReruns: 0,
    qualityImprovements: 0, // 质量提升的重跑次数
  };
  // P0.5-CTX-2: 连续低质量计数（用于 reset context）
  private consecutiveLowQualityCount: Map<string, number> = new Map(); // sessionId -> count
  // ASR 配置缓存
  private asrConfig: NodeConfig['asr'];
  // OBS-1: 处理效率观测指标统计（按心跳周期，按服务ID分组）
  // 每个服务ID对应一个处理效率列表
  private currentCycleServiceEfficiencies: Map<string, number[]> = new Map(); // serviceId -> efficiency[]

  /**
   * Gate-A: 重置指定 session 的连续低质量计数
   * @param sessionId 会话 ID
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

  constructor(
    private pythonServiceManager: any,
    private rustServiceManager: any,
    private serviceRegistryManager: any
  ) {
    // 初始化时加载 ASR 配置
    this.loadASRConfig();
  }

  /**
   * 加载 ASR 配置
   */
  private loadASRConfig(): void {
    try {
      const config = loadNodeConfig();
      this.asrConfig = config.asr;
    } catch (error) {
      logger.warn({ error }, 'Failed to load ASR config, using defaults');
      this.asrConfig = undefined; // 使用默认值
    }
  }

  /**
   * 获取 ASR 配置（带默认值）
   * 返回完整的配置对象，确保所有字段都有值
   */
  private getASRConfig(): Required<NonNullable<NodeConfig['asr']>> {
    if (!this.asrConfig) {
      // 如果配置未加载，尝试重新加载
      this.loadASRConfig();
    }
    const defaultConfig: Required<NonNullable<NodeConfig['asr']>> = {
      beam_size: 10,
      temperature: 0.0,
      patience: 1.0,
      compression_ratio_threshold: 2.4,
      log_prob_threshold: -1.0,
      no_speech_threshold: 0.6,
    };
    if (!this.asrConfig) {
      return defaultConfig;
    }
    // 合并配置，确保所有字段都有值
    return {
      beam_size: this.asrConfig.beam_size ?? defaultConfig.beam_size,
      temperature: this.asrConfig.temperature ?? defaultConfig.temperature,
      patience: this.asrConfig.patience ?? defaultConfig.patience,
      compression_ratio_threshold: this.asrConfig.compression_ratio_threshold ?? defaultConfig.compression_ratio_threshold,
      log_prob_threshold: this.asrConfig.log_prob_threshold ?? defaultConfig.log_prob_threshold,
      no_speech_threshold: this.asrConfig.no_speech_threshold ?? defaultConfig.no_speech_threshold,
    };
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
    const endpoints: Map<ServiceType, ServiceEndpoint[]> = new Map();

    // 初始化每个服务类型的列表
    [ServiceType.ASR, ServiceType.NMT, ServiceType.TTS, ServiceType.TONE].forEach((type) => {
      endpoints.set(type, []);
    });

    // 从服务管理器获取运行中的服务
    const installedServices = await this.getInstalledServices();

    logger.debug({
      installedServicesCount: installedServices.length,
      installedServices: installedServices.map(s => ({
        service_id: s.service_id,
        type: s.type,
        status: s.status,
      })),
    }, 'Refreshing service endpoints');

    for (const service of installedServices) {
      if (service.status !== 'running') {
        logger.debug({ serviceId: service.service_id, status: service.status }, 'Skipping non-running service');
        continue;
      }

      const endpoint = await this.createServiceEndpoint(service);
      if (endpoint) {
        const existing = endpoints.get(service.type) || [];
        existing.push(endpoint);
        endpoints.set(service.type, existing);
        logger.debug({
          serviceId: endpoint.serviceId,
          baseUrl: endpoint.baseUrl,
          port: endpoint.port,
          serviceType: endpoint.serviceType,
        }, 'Created service endpoint');
      } else {
        logger.warn({
          serviceId: service.service_id,
          serviceType: service.type,
        }, 'Failed to create service endpoint (port not available)');
      }
    }

    this.serviceEndpoints = endpoints;
    logger.info(
      {
        asr: endpoints.get(ServiceType.ASR)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        nmt: endpoints.get(ServiceType.NMT)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        tts: endpoints.get(ServiceType.TTS)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        tone: endpoints.get(ServiceType.TONE)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
      },
      'Service endpoints refreshed'
    );
  }

  /**
   * 创建服务端点
   */
  private async createServiceEndpoint(service: InstalledService): Promise<ServiceEndpoint | null> {
    const port = await this.getServicePort(service.service_id);
    if (!port) {
      logger.warn({
        serviceId: service.service_id,
        serviceType: service.type,
        status: service.status,
      }, 'Cannot create service endpoint: port not available');
      return null;
    }

    const endpoint = {
      serviceId: service.service_id,
      serviceType: service.type,
      baseUrl: `http://127.0.0.1:${port}`,
      port,
      status: service.status,
    };

    logger.debug({
      serviceId: endpoint.serviceId,
      baseUrl: endpoint.baseUrl,
      port: endpoint.port,
      serviceType: endpoint.serviceType,
      status: endpoint.status,
    }, 'Created service endpoint');

    return endpoint;
  }

  /**
   * 获取服务端口
   */
  private async getServicePort(serviceId: string): Promise<number | null> {
    // 服务ID到端口的映射
    const portMap: Record<string, number> = {
      'faster-whisper-vad': 6007,
      'node-inference': 5009,
      'nmt-m2m100': 5008,
      'piper-tts': 5006,
      'your-tts': 5004,
      'speaker-embedding': 5003,
    };

    // 首先尝试从映射表获取
    if (portMap[serviceId]) {
      logger.debug({ serviceId, port: portMap[serviceId], source: 'portMap' }, 'Got service port from portMap');
      return portMap[serviceId];
    }

    // 尝试从服务管理器获取
    if (serviceId === 'node-inference' && this.rustServiceManager) {
      const status = this.rustServiceManager.getStatus();
      if (status?.port) {
        return status.port;
      }
    }

    // 尝试从Python服务管理器获取
    const pythonServiceNameMap: Record<string, string> = {
      'nmt-m2m100': 'nmt',
      'piper-tts': 'tts',
      'your-tts': 'yourtts',
      'speaker-embedding': 'speaker_embedding',
      'faster-whisper-vad': 'faster_whisper_vad',
    };

    const pythonServiceName = pythonServiceNameMap[serviceId];
    if (pythonServiceName && this.pythonServiceManager) {
      const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
      if (status?.port) {
        return status.port;
      }
    }

    return null;
  }

  /**
   * 获取已安装的服务列表
   */
  private async getInstalledServices(): Promise<InstalledService[]> {
    const result: InstalledService[] = [];

    // 从服务注册表获取
    if (this.serviceRegistryManager) {
      try {
        await this.serviceRegistryManager.loadRegistry();
        const installed = this.serviceRegistryManager.listInstalled();
        for (const service of installed) {
          const running = this.isServiceRunning(service.service_id);
          result.push({
            service_id: service.service_id,
            type: this.getServiceType(service.service_id),
            device: 'gpu',
            status: running ? 'running' : 'stopped',
            version: service.version || '2.0.0',
          });
        }
      } catch (error) {
        logger.error({ error }, 'Failed to get installed services from registry');
      }
    }

    // 补充Python服务
    if (this.pythonServiceManager) {
      const pythonServices = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];
      for (const serviceName of pythonServices) {
        const serviceId = this.getServiceIdFromPythonName(serviceName);
        const status = this.pythonServiceManager.getServiceStatus(serviceName);
        if (status?.running) {
          result.push({
            service_id: serviceId,
            type: this.getServiceType(serviceId),
            device: 'gpu',
            status: 'running',
            version: '2.0.0',
          });
        }
      }
    }

    // 补充Rust服务
    if (this.rustServiceManager) {
      const status = this.rustServiceManager.getStatus();
      if (status?.running) {
        result.push({
          service_id: 'node-inference',
          type: ServiceType.ASR, // node-inference 可以作为 ASR 服务
          device: 'gpu',
          status: 'running',
          version: '2.0.0',
        });
      }
    }

    return result;
  }

  /**
   * 检查服务是否运行
   */
  private isServiceRunning(serviceId: string): boolean {
    if (serviceId === 'node-inference' && this.rustServiceManager) {
      const status = this.rustServiceManager.getStatus();
      return status?.running === true;
    }

    const pythonServiceNameMap: Record<string, string> = {
      'nmt-m2m100': 'nmt',
      'piper-tts': 'tts',
      'your-tts': 'yourtts',
      'speaker-embedding': 'speaker_embedding',
      'faster-whisper-vad': 'faster_whisper_vad',
    };

    const pythonServiceName = pythonServiceNameMap[serviceId];
    if (pythonServiceName && this.pythonServiceManager) {
      const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
      return status?.running === true;
    }

    return false;
  }

  /**
   * 获取服务类型
   */
  private getServiceType(serviceId: string): ServiceType {
    const typeMap: Record<string, ServiceType> = {
      'faster-whisper-vad': ServiceType.ASR,
      'node-inference': ServiceType.ASR,
      'nmt-m2m100': ServiceType.NMT,
      'piper-tts': ServiceType.TTS,
      'your-tts': ServiceType.TTS,
      'speaker-embedding': ServiceType.TONE,
    };
    return typeMap[serviceId] || ServiceType.ASR;
  }

  /**
   * 从Python服务名获取服务ID
   */
  private getServiceIdFromPythonName(serviceName: string): string {
    const map: Record<string, string> = {
      nmt: 'nmt-m2m100',
      tts: 'piper-tts',
      yourtts: 'your-tts',
      speaker_embedding: 'speaker-embedding',
      faster_whisper_vad: 'faster-whisper-vad',
    };
    return map[serviceName] || serviceName;
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
    return { ...this.rerunMetrics };
  }

  /**
   * OBS-1: 获取 ASR 观测指标（用于上报）
   */
  /**
   * OBS-1: 获取当前心跳周期的处理效率指标（按服务ID分组）
   * 返回每个服务ID的平均处理效率
   */
  getProcessingMetrics(): Record<string, number> {
    const result: Record<string, number> = {};
    
    // 计算每个服务ID的平均处理效率
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
   * OBS-1: 判断任务模式（会议室或线下）
   * 注意：节点端无法直接判断任务是否在房间中，因为节点端没有 room_manager
   * 简化实现：
   * - 如果任务有 session_id（通过调度服务器），默认为普通会话模式（offline）
   * - 真正的会议室模式判断需要在调度服务器端完成
   * - 这里暂时统一使用 'offline' 模式统计，后续可以通过任务中的其他字段（如 target_session_ids）来判断
   */
  private getTaskMode(task: ASRTask): 'conference' | 'offline' {
    // TODO: 如果调度服务器在 job_assign 中传递了模式信息，可以使用该信息
    // 目前暂时统一使用 'offline' 模式统计
    // 真正的会议室模式判断应该在调度服务器端完成，然后通过指标聚合来区分
    return 'offline';
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
   * OBS-1: 记录 ASR 处理效率（按心跳周期）
   * @param serviceId 服务ID（如 'faster-whisper-vad'）
   * @param audioDurationMs 音频时长（毫秒）
   * @param processingTimeMs ASR 处理时间（毫秒，包含重跑时间）
   */
  private recordASREfficiency(serviceId: string, audioDurationMs: number | undefined, processingTimeMs: number): void {
    // 如果音频时长无效，跳过记录
    if (!audioDurationMs || audioDurationMs <= 0 || processingTimeMs <= 0) {
      logger.debug(
        { serviceId, audioDurationMs, processingTimeMs },
        'OBS-1: Skipping ASR efficiency recording due to invalid parameters'
      );
      return;
    }

    // 计算处理效率 = 音频时长 / 处理时间
    const efficiency = audioDurationMs / processingTimeMs;
    this.recordServiceEfficiency(serviceId, efficiency);
    
    logger.debug(
      { serviceId, audioDurationMs, processingTimeMs, efficiency: efficiency.toFixed(2) },
      'OBS-1: Recorded ASR processing efficiency'
    );
  }

  /**
   * OBS-1: 记录 NMT 处理效率（按心跳周期）
   * @param serviceId 服务ID（如 'nmt-m2m100'）
   * @param textLength 文本长度（字符数）
   * @param processingTimeMs NMT 处理时间（毫秒）
   */
  private recordNMTEfficiency(serviceId: string, textLength: number | undefined, processingTimeMs: number): void {
    // 如果文本长度无效，跳过记录
    if (!textLength || textLength <= 0 || processingTimeMs <= 0) {
      return;
    }

    // 计算处理效率 = 文本长度(字符) / 处理时间(ms) * 1000 (转换为字符/秒)
    // 为了与其他指标保持一致（值越大越好），使用字符/秒作为效率指标
    const efficiency = (textLength / processingTimeMs) * 1000;
    this.recordServiceEfficiency(serviceId, efficiency);
  }

  /**
   * OBS-1: 记录 TTS 处理效率（按心跳周期）
   * @param serviceId 服务ID（如 'piper-tts', 'your-tts'）
   * @param audioDurationMs 生成的音频时长（毫秒）
   * @param processingTimeMs TTS 处理时间（毫秒）
   */
  private recordTTSEfficiency(serviceId: string, audioDurationMs: number | undefined, processingTimeMs: number): void {
    // 如果音频时长无效，跳过记录
    if (!audioDurationMs || audioDurationMs <= 0 || processingTimeMs <= 0) {
      return;
    }

    // 计算处理效率 = 音频时长 / 处理时间
    const efficiency = audioDurationMs / processingTimeMs;
    this.recordServiceEfficiency(serviceId, efficiency);

    logger.debug(
      {
        audioDurationMs,
        processingTimeMs,
        efficiency: efficiency.toFixed(2),
      },
      'OBS-1: Recorded processing efficiency for current heartbeat cycle'
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
        const index = this.roundRobinIndex.get(serviceType) || 0;
        const selected = runningEndpoints[index % runningEndpoints.length];
        this.roundRobinIndex.set(serviceType, (index + 1) % runningEndpoints.length);
        return selected;
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
    // OBS-1: 记录任务开始时间（用于计算延迟）
    const taskStartTime = Date.now();
    // OBS-1: 获取任务模式
    const taskMode = this.getTaskMode(task);
    
    const endpoint = this.selectServiceEndpoint(ServiceType.ASR);
    if (!endpoint) {
      throw new Error('No available ASR service');
    }

    // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
    this.startGpuTrackingForService(endpoint.serviceId);

    // 增加连接计数
    const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
    this.serviceConnections.set(endpoint.serviceId, connections + 1);

    try {
      // 创建 AbortController 用于支持任务取消
      // 注意：job_id 是调度服务器发送的，用于任务管理和取消
      // trace_id 用于全链路追踪，不用于任务管理
      if (!task.job_id) {
        logger.warn({}, 'ASR task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

      const httpClient: AxiosInstance = axios.create({
        baseURL: endpoint.baseUrl,
        timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
      });

      // ASR 服务路由：目前只支持 faster-whisper-vad
      if (endpoint.serviceId !== 'faster-whisper-vad') {
        throw new Error(`Unsupported ASR service: ${endpoint.serviceId}. Only faster-whisper-vad is supported.`);
      }

      // faster-whisper-vad 使用 /utterance 接口
      let response;
      {
        // faster-whisper-vad 使用 /utterance 接口
        // 注意：需要提供所有必需字段，包括 task、beam_size 等
        // 使用调度服务器发送的 audio_format（默认值 pcm16）
        const audioFormat = task.audio_format || 'pcm16';
        const requestUrl = `${endpoint.baseUrl}/utterance`;
        logger.info({
          serviceId: endpoint.serviceId,
          baseUrl: endpoint.baseUrl,
          requestUrl,
          audioFormat,
          originalFormat: task.audio_format,
          jobId: task.job_id,
        }, 'Routing ASR task to faster-whisper-vad');

        const requestBody: any = {
          job_id: task.job_id || `asr_${Date.now()}`,
          src_lang: task.src_lang,
          tgt_lang: task.src_lang, // ASR 不需要目标语言
          audio: task.audio,
          audio_format: audioFormat,
          sample_rate: task.sample_rate || 16000,
          task: 'transcribe', // 必需字段
          beam_size: this.getASRConfig().beam_size, // 从配置文件读取，默认 10
          condition_on_previous_text: false, // 修复：改为 false，避免重复识别（当上下文文本和当前音频内容相同时，会导致重复输出）
          use_context_buffer: false, // 修复：禁用音频上下文，避免重复识别和增加处理时间（utterance已经是完整的，不需要音频上下文）
          use_text_context: true, // 保留文本上下文（initial_prompt），这是Faster Whisper的标准功能
          enable_streaming_asr: task.enable_streaming || false,
          context_text: task.context_text,
          // EDGE-4: Padding 配置（如果提供）
          padding_ms: task.padding_ms,
        };

        try {
          response = await httpClient.post('/utterance', requestBody, {
            signal: abortController.signal, // 支持任务取消
          });
          logger.info({
            serviceId: endpoint.serviceId,
            requestUrl,
            status: response.status,
            jobId: task.job_id,
          }, 'faster-whisper-vad request succeeded');
        } catch (axiosError: any) {
          logger.error({
            serviceId: endpoint.serviceId,
            requestUrl,
            baseUrl: endpoint.baseUrl,
            status: axiosError.response?.status,
            statusText: axiosError.response?.statusText,
            errorMessage: axiosError.message,
            errorCode: axiosError.code,
            jobId: task.job_id,
            responseData: axiosError.response?.data,
          }, 'faster-whisper-vad request failed');
          throw axiosError;
        }
        // UtteranceResponse 返回的字段是 text，不是 transcript
        // 实现语言置信度分级逻辑（CONF-1）
        const langProb = response.data.language_probability ?? 0;
        let useTextContext = false;  // 默认关闭上下文
        let conditionOnPreviousText = false;  // 默认关闭
        
        // P0.5-CTX-1: 低质量禁用 context（在坏段检测之前先检查 qualityScore）
        // 注意：这里先使用默认值，坏段检测后会在重跑逻辑中更新
        const tempBadSegmentDetection = detectBadSegment(
          {
            text: response.data.text || '',
            language: response.data.language || task.src_lang,
            language_probability: langProb,
            language_probabilities: response.data.language_probabilities,
            segments: response.data.segments,
          },
          response.data.duration ? Math.round(response.data.duration * 1000) : undefined,
          task.context_text
        );
        
        // P0.5-CTX-1: qualityScore < 0.4 → 禁用上下文 prompt
        if (tempBadSegmentDetection.qualityScore < 0.4) {
          useTextContext = false;
          conditionOnPreviousText = false;
          logger.info(
            {
              jobId: task.job_id,
              qualityScore: tempBadSegmentDetection.qualityScore,
            },
            'P0.5-CTX-1: Low quality score, disabling context'
          );
        }
        
        // 仅在极少数"同语种连续且高置信"的窗口中才允许开启（可选）
        // 这里先实现基础逻辑，后续可以添加"最近多段语言一致"的检查
        if (langProb >= 0.90 && tempBadSegmentDetection.qualityScore >= 0.4) {
          // 高置信且高质量：可以启用上下文（可选，根据方案默认关闭）
          // useTextContext = true;  // 暂时保持关闭，等待后续优化
        }
        
        if (langProb < 0.70) {
          // 低置信：强制关闭上下文（防污染）
          useTextContext = false;
          conditionOnPreviousText = false;
        }
        
        // 构建 ASR 结果
        const asrResult: ASRResult = {
          text: response.data.text || '',
          confidence: 1.0, // faster-whisper-vad 不返回 confidence
          language: response.data.language || task.src_lang,
          language_probability: response.data.language_probability,  // 新增：检测到的语言的概率
          language_probabilities: response.data.language_probabilities,  // 新增：所有语言的概率信息
          segments: response.data.segments,  // 新增：Segment 元数据（包含时间戳）
          is_final: true,
        };

        // CONF-3 + RERUN-1: 基于 segments 时间戳的断裂/异常检测 + 坏段判定
        // OBS-1: 计算音频时长（用于处理效率统计）
        const audioDurationMs = response.data.duration 
          ? Math.round(response.data.duration * 1000)  // 转换为毫秒
          : undefined;
        
        // 如果 response.data.duration 不存在，尝试从 segments 计算
        // 注意：这是备用方案，优先使用 response.data.duration
        let calculatedAudioDurationMs = audioDurationMs;
        if (!calculatedAudioDurationMs && asrResult.segments && asrResult.segments.length > 0) {
          // 从 segments 计算音频时长（最后一个 segment 的 end 时间）
          const lastSegment = asrResult.segments[asrResult.segments.length - 1];
          if (lastSegment && lastSegment.end) {
            calculatedAudioDurationMs = Math.round(lastSegment.end * 1000);
            logger.debug(
              { jobId: task.job_id, calculatedAudioDurationMs },
              'OBS-1: Calculated audio duration from segments'
            );
          }
        }
        
        // 获取上一段文本（从 context_text 中提取，如果可用）
        // 注意：context_text 是传递给 ASR 服务的，可能包含上一个 utterance 的文本
        const previousText = task.context_text || undefined;
        
        const badSegmentDetection = detectBadSegment(asrResult, audioDurationMs, previousText);
        
        if (badSegmentDetection.isBad) {
          logger.warn(
            {
              jobId: task.job_id,
              reasonCodes: badSegmentDetection.reasonCodes,
              qualityScore: badSegmentDetection.qualityScore,
              segmentCount: asrResult.segments?.length || 0,
              audioDurationMs,
              languageProbability: asrResult.language_probability,
            },
            'CONF-3: Bad segment detected based on segments timestamps'
          );
        } else {
          logger.debug(
            {
              jobId: task.job_id,
              qualityScore: badSegmentDetection.qualityScore,
              segmentCount: asrResult.segments?.length || 0,
            },
            'CONF-3: Segment quality check passed'
          );
        }

        // 将检测结果附加到 ASR 结果中（用于日志和后续处理）
        asrResult.badSegmentDetection = badSegmentDetection;
        
        // P0.5-CTX-2: 检查连续低质量（在重跑之前）
        const sessionId = (task as any).session_id || task.job_id || 'unknown';
        if (badSegmentDetection.qualityScore < 0.4) {
          const currentCount = this.consecutiveLowQualityCount.get(sessionId) || 0;
          const newCount = currentCount + 1;
          this.consecutiveLowQualityCount.set(sessionId, newCount);
          
          if (newCount >= 2) {
            logger.warn(
              {
                jobId: task.job_id,
                sessionId,
                consecutiveLowQualityCount: newCount,
                qualityScore: badSegmentDetection.qualityScore,
              },
              'P0.5-CTX-2: Consecutive low quality detected (>=2), should reset context'
            );
            (asrResult as any).shouldResetContext = true;
          }
        } else {
          // 质量正常，重置连续低质量计数
          this.consecutiveLowQualityCount.set(sessionId, 0);
        }
        
        // P0.5-SH-1/2: 检查是否应该触发 Top-2 语言重跑
        const rerunCondition = shouldTriggerRerun(asrResult, audioDurationMs, task);
        
        if (rerunCondition.shouldRerun) {
          logger.info(
            {
              jobId: task.job_id,
              reason: rerunCondition.reason,
              languageProbability: asrResult.language_probability,
              qualityScore: badSegmentDetection.qualityScore,
            },
            'P0.5-SH-2: Triggering Top-2 language rerun'
          );
          
          // P0.5-SH-2: 获取 Top-2 语言并执行重跑
          const top2Langs = getTop2LanguagesForRerun(
            asrResult.language_probabilities || {},
            asrResult.language
          );
          
          if (top2Langs.length > 0) {
            // 尝试使用 Top-2 语言重跑
            let bestResult = asrResult; // 默认使用原始结果
            let bestQualityScore = badSegmentDetection.qualityScore;
            
            for (const lang of top2Langs) {
              try {
                logger.info(
                  {
                    jobId: task.job_id,
                    rerunLanguage: lang,
                    originalLanguage: asrResult.language,
                    rerunCount: (task.rerun_count || 0) + 1,
                  },
                  'P0.5-SH-2: Attempting rerun with forced language'
                );
                
                // P0.5-SH-4: 创建带超时的 AbortController
                const rerunTimeoutMs = task.rerun_timeout_ms ?? 5000; // 默认 5 秒
                const rerunAbortController = new AbortController();
                const rerunTimeoutId = setTimeout(() => {
                  rerunAbortController.abort();
                  logger.warn(
                    {
                      jobId: task.job_id,
                      rerunLanguage: lang,
                      timeoutMs: rerunTimeoutMs,
                    },
                    'P0.5-SH-4: Rerun timeout exceeded'
                  );
                }, rerunTimeoutMs);
                
                try {
                  // 使用强制语言重跑 ASR
                  const rerunTask: ASRTask = {
                    ...task,
                    src_lang: lang, // 强制使用指定语言
                    rerun_count: (task.rerun_count || 0) + 1, // 递增重跑次数
                  };
                  
                  // 创建新的请求体，强制使用指定语言
                  const rerunRequestBody: any = {
                    ...requestBody,
                    src_lang: lang,
                    language: lang, // 强制语言
                  };
                  
                  // 执行重跑请求（带超时）
                  const rerunResponse = await httpClient.post('/utterance', rerunRequestBody, {
                    signal: rerunAbortController.signal,
                  });
                  
                  clearTimeout(rerunTimeoutId); // 清除超时定时器
                
                // 构建重跑结果
                const rerunResult: ASRResult = {
                  text: rerunResponse.data.text || '',
                  confidence: 1.0,
                  language: rerunResponse.data.language || lang,
                  language_probability: rerunResponse.data.language_probability,
                  language_probabilities: rerunResponse.data.language_probabilities,
                  segments: rerunResponse.data.segments,
                  is_final: true,
                };
                
                // 重新检测坏段（用于质量评分）
                const rerunAudioDurationMs = rerunResponse.data.duration
                  ? Math.round(rerunResponse.data.duration * 1000)
                  : undefined;
                const rerunBadSegmentDetection = detectBadSegment(
                  rerunResult,
                  rerunAudioDurationMs,
                  previousText
                );
                rerunResult.badSegmentDetection = rerunBadSegmentDetection;
                
                  // P0.5-SH-3: 使用 qualityScore 择优
                  if (rerunBadSegmentDetection.qualityScore > bestQualityScore) {
                    logger.info(
                      {
                        jobId: task.job_id,
                        rerunLanguage: lang,
                        originalQualityScore: bestQualityScore,
                        rerunQualityScore: rerunBadSegmentDetection.qualityScore,
                      },
                      'P0.5-SH-3: Rerun result has better quality score, selecting it'
                    );
                    bestResult = rerunResult;
                    bestQualityScore = rerunBadSegmentDetection.qualityScore;
                    
                    // P0.5-SH-5: 记录质量提升
                    this.rerunMetrics.qualityImprovements++;
                  } else {
                    logger.debug(
                      {
                        jobId: task.job_id,
                        rerunLanguage: lang,
                        originalQualityScore: bestQualityScore,
                        rerunQualityScore: rerunBadSegmentDetection.qualityScore,
                      },
                      'P0.5-SH-3: Rerun result quality score not better, keeping original'
                    );
                  }
                  
                  // P0.5-SH-5: 记录成功重跑
                  this.rerunMetrics.totalReruns++;
                  this.rerunMetrics.successfulReruns++;
                } catch (rerunError: any) {
                  clearTimeout(rerunTimeoutId); // 确保清除超时定时器
                  
                  // P0.5-SH-5: 记录失败重跑
                  this.rerunMetrics.totalReruns++;
                  
                  if (rerunAbortController.signal.aborted) {
                    logger.warn(
                      {
                        jobId: task.job_id,
                        rerunLanguage: lang,
                        timeoutMs: rerunTimeoutMs,
                      },
                      'P0.5-SH-4: Rerun aborted due to timeout'
                    );
                    this.rerunMetrics.timeoutReruns++;
                  } else {
                    logger.warn(
                      {
                        jobId: task.job_id,
                        rerunLanguage: lang,
                        error: rerunError.message,
                      },
                      'P0.5-SH-2: Rerun failed, continuing with next language or original result'
                    );
                    this.rerunMetrics.failedReruns++;
                  }
                  // 继续尝试下一个语言，或使用原始结果
                }
              } catch (outerError: any) {
                logger.error(
                  {
                    jobId: task.job_id,
                    rerunLanguage: lang,
                    error: outerError.message,
                  },
                  'P0.5-SH-2: Unexpected error during rerun setup'
                );
                // 继续尝试下一个语言，或使用原始结果
              }
            }
            
            // 返回最佳结果
            if (bestResult !== asrResult) {
              logger.info(
                {
                  jobId: task.job_id,
                  originalLanguage: asrResult.language,
                  selectedLanguage: bestResult.language,
                  originalQualityScore: badSegmentDetection.qualityScore,
                  selectedQualityScore: bestQualityScore,
                },
                'P0.5-SH-3: Selected rerun result as best'
              );
            }
            
            // OBS-1: 记录处理效率（重跑场景，包含重跑时间）
            const taskEndTime = Date.now();
            const processingTimeMs = taskEndTime - taskStartTime;
            // 使用原始音频时长（calculatedAudioDurationMs 或 audioDurationMs），不是重跑的音频时长
            this.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
            
            return bestResult;
          } else {
            logger.warn(
              {
                jobId: task.job_id,
              },
              'P0.5-SH-2: No Top-2 languages available for rerun'
            );
          }
        }
        
        // OBS-1: 记录处理效率（正常场景，无重跑）
        const taskEndTime = Date.now();
        const processingTimeMs = taskEndTime - taskStartTime;
        // 使用计算出的音频时长（优先使用 response.data.duration，否则使用 segments 计算的值）
        this.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
        
        return asrResult;
      }
    } catch (error: any) {
      // 增强错误日志，特别是对于Axios错误
      const errorDetails: any = {
        serviceId: endpoint.serviceId,
        baseUrl: endpoint.baseUrl,
        jobId: task.job_id,
        errorMessage: error.message,
      };

      if (error.response) {
        // Axios错误响应
        errorDetails.status = error.response.status;
        errorDetails.statusText = error.response.statusText;
        errorDetails.responseData = error.response.data;
        errorDetails.requestUrl = error.config?.url || 'unknown';
        errorDetails.requestMethod = error.config?.method || 'unknown';
      } else if (error.request) {
        // 请求已发送但没有收到响应
        errorDetails.requestError = true;
        errorDetails.requestUrl = error.config?.url || 'unknown';
      } else {
        // 其他错误
        errorDetails.errorCode = error.code;
        errorDetails.errorStack = error.stack;
      }

      logger.error(errorDetails, 'ASR task failed');
      throw error;
    } finally {
      // 清理 AbortController
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      // 减少连接计数
      const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
      this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
    }
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
    const endpoint = this.selectServiceEndpoint(ServiceType.NMT);
    if (!endpoint) {
      throw new Error('No available NMT service');
    }

    // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
    this.startGpuTrackingForService(endpoint.serviceId);

    const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
    this.serviceConnections.set(endpoint.serviceId, connections + 1);

    try {
      // 创建 AbortController 用于支持任务取消
      // 注意：job_id 是调度服务器发送的，用于任务管理和取消
      // trace_id 用于全链路追踪，不用于任务管理
      if (!task.job_id) {
        logger.warn({}, 'ASR task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

      const httpClient: AxiosInstance = axios.create({
        baseURL: endpoint.baseUrl,
        timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
      });

      const taskStartTime = Date.now();
      const response = await httpClient.post('/v1/translate', {
        text: task.text,
        src_lang: task.src_lang,
        tgt_lang: task.tgt_lang,
        context_text: task.context_text,
      }, {
        signal: abortController.signal, // 支持任务取消
      });

      // OBS-1: 记录 NMT 处理效率
      const taskEndTime = Date.now();
      const processingTimeMs = taskEndTime - taskStartTime;
      const textLength = task.text?.length || 0;
      this.recordNMTEfficiency(endpoint.serviceId, textLength, processingTimeMs);

      return {
        text: response.data.text || '',
        confidence: response.data.confidence,
      };
    } catch (error) {
      logger.error({ error, serviceId: endpoint.serviceId }, 'NMT task failed');
      throw error;
    } finally {
      // 清理 AbortController
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
      this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
    }
  }

  /**
   * 路由 TTS 任务
   */
  async routeTTSTask(task: TTSTask): Promise<TTSResult> {
    const endpoint = this.selectServiceEndpoint(ServiceType.TTS);
    if (!endpoint) {
      throw new Error('No available TTS service');
    }

    // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
    this.startGpuTrackingForService(endpoint.serviceId);

    const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
    this.serviceConnections.set(endpoint.serviceId, connections + 1);

    try {
      // 创建 AbortController 用于支持任务取消
      // 注意：job_id 是调度服务器发送的，用于任务管理和取消
      // trace_id 用于全链路追踪，不用于任务管理
      if (!task.job_id) {
        logger.warn({}, 'ASR task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

      const httpClient: AxiosInstance = axios.create({
        baseURL: endpoint.baseUrl,
        timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
      });

      // TTS服务端点：/tts
      // 请求格式：{ text: string, voice: string, language?: string }
      // 响应：WAV格式的音频数据（二进制）
      // 根据目标语言自动选择语音（如果没有指定 voice_id）
      const targetLang = (task.lang || 'zh').toLowerCase();
      let defaultVoice = 'zh_CN-huayan-medium'; // 默认使用中文语音
      if (targetLang.startsWith('en')) {
        defaultVoice = 'en_US-lessac-medium'; // 英语使用英语语音
      } else if (targetLang.startsWith('zh')) {
        defaultVoice = 'zh_CN-huayan-medium'; // 中文使用中文语音
      }
      
      const response = await httpClient.post('/tts', {
        text: task.text,
        voice: task.voice_id || defaultVoice, // 使用根据语言选择的默认语音
        language: task.lang || 'zh', // 将lang映射到language
      }, {
        signal: abortController.signal, // 支持任务取消
        responseType: 'arraybuffer', // TTS服务返回WAV音频数据（二进制）
      });

      const taskStartTime = Date.now();
      
      // 将WAV音频数据转换为Buffer
      const wavBuffer = Buffer.from(response.data);

      // 尝试使用 Opus 编码（如果可用），否则使用 PCM16
      let audioBase64: string;
      let audioFormat: string;
      let audioDurationMs: number | undefined;
      
      if (isOpusEncoderAvailable()) {
        try {
          // 解析 WAV 文件，提取 PCM16 数据和元信息
          const { pcm16Data, sampleRate, channels } = parseWavFile(wavBuffer);
          
          // 计算音频时长（毫秒）
          // 音频时长 = 样本数 / 采样率
          // 样本数 = PCM16数据长度 / (2字节 * 声道数)
          const sampleCount = pcm16Data.length / (2 * channels);
          audioDurationMs = Math.round((sampleCount / sampleRate) * 1000);
          
          // 编码为 Opus
          const opusData = await encodePcm16ToOpus(pcm16Data, sampleRate, channels);
          
          // 转换为 base64
          audioBase64 = opusData.toString('base64');
          audioFormat = 'opus';
          
          logger.debug(
            `TTS audio encoded to Opus: ${wavBuffer.length} bytes (WAV) -> ${opusData.length} bytes (Opus), ` +
            `compression: ${(wavBuffer.length / opusData.length).toFixed(2)}x`
          );
        } catch (opusError) {
          // Opus 编码失败，回退到 PCM16
          logger.warn({ error: opusError }, 'Opus encoding failed, falling back to PCM16');
          // 如果 Opus 编码失败，需要重新解析 WAV 来计算时长
          try {
            const { pcm16Data, sampleRate, channels } = parseWavFile(wavBuffer);
            const sampleCount = pcm16Data.length / (2 * channels);
            audioDurationMs = Math.round((sampleCount / sampleRate) * 1000);
          } catch (parseError) {
            logger.warn({ error: parseError }, 'Failed to parse WAV for duration calculation');
          }
          audioBase64 = wavBuffer.toString('base64');
          audioFormat = 'pcm16';
        }
      } else {
        // Opus 编码器不可用，使用 PCM16
        // 解析 WAV 文件以计算音频时长
        try {
          const { pcm16Data, sampleRate, channels } = parseWavFile(wavBuffer);
          const sampleCount = pcm16Data.length / (2 * channels);
          audioDurationMs = Math.round((sampleCount / sampleRate) * 1000);
        } catch (parseError) {
          logger.warn({ error: parseError }, 'Failed to parse WAV for duration calculation');
        }
        audioBase64 = wavBuffer.toString('base64');
        audioFormat = 'pcm16';
      }

      // OBS-1: 记录 TTS 处理效率
      const taskEndTime = Date.now();
      const processingTimeMs = taskEndTime - taskStartTime;
      if (audioDurationMs) {
        this.recordTTSEfficiency(endpoint.serviceId, audioDurationMs, processingTimeMs);
      }

      return {
        audio: audioBase64,
        audio_format: audioFormat,
        sample_rate: task.sample_rate || 16000, // 使用目标采样率
      };
    } catch (error) {
      logger.error({ error, serviceId: endpoint.serviceId }, 'TTS task failed');
      throw error;
    } finally {
      // 清理 AbortController
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
      this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
    }
  }

  /**
   * 路由 TONE 任务
   */
  async routeTONETask(task: TONETask): Promise<TONEResult> {
    const endpoint = this.selectServiceEndpoint(ServiceType.TONE);
    if (!endpoint) {
      throw new Error('No available TONE service');
    }

    const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
    this.serviceConnections.set(endpoint.serviceId, connections + 1);

    try {
      // 创建 AbortController 用于支持任务取消
      // 注意：job_id 是调度服务器发送的，用于任务管理和取消
      // trace_id 用于全链路追踪，不用于任务管理
      if (!task.job_id) {
        logger.warn({}, 'ASR task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

      const httpClient: AxiosInstance = axios.create({
        baseURL: endpoint.baseUrl,
        timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
      });

      const endpointPath = task.action === 'embed' ? '/v1/tone/embed' : '/v1/tone/clone';
      const response = await httpClient.post(endpointPath, {
        audio: task.audio,
        audio_format: task.audio_format,
        sample_rate: task.sample_rate,
        speaker_id: task.speaker_id,
      }, {
        signal: abortController.signal, // 支持任务取消
      });

      return {
        embedding: response.data.embedding,
        speaker_id: response.data.speaker_id,
        audio: response.data.audio,
      };
    } catch (error) {
      logger.error({ error, serviceId: endpoint.serviceId }, 'TONE task failed');
      throw error;
    } finally {
      // 清理 AbortController
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      const connections = this.serviceConnections.get(endpoint.serviceId) || 0;
      this.serviceConnections.set(endpoint.serviceId, Math.max(0, connections - 1));
    }
  }

  /**
   * 设置服务选择策略
   */
  setSelectionStrategy(strategy: ServiceSelectionStrategy): void {
    this.selectionStrategy = strategy;
  }
}

