import WebSocket from 'ws';
import { InferenceService } from '../inference/inference-service';
import * as si from 'systeminformation';
import * as os from 'os';
import {
  NodeRegisterMessage,
  NodeRegisterAckMessage,
  NodeHeartbeatMessage,
  JobAssignMessage,
  JobCancelMessage,
  JobResultMessage,
  AsrPartialMessage,
  InstalledModel,
  InstalledService,
  FeatureFlags,
  ServiceType,
  CapabilityByType,
  DeviceType,
  ServiceStatus,
} from '../../../../shared/protocols/messages';
import { ModelNotAvailableError } from '../model-manager/model-manager';
import { loadNodeConfig, type NodeConfig } from '../node-config';
import logger from '../logger';
import { AggregatorMiddleware, AggregatorMiddlewareConfig } from './aggregator-middleware';
import { PostProcessCoordinator, PostProcessConfig } from './postprocess/postprocess-coordinator';

export interface NodeStatus {
  online: boolean;
  nodeId: string | null;
  connected: boolean;
  lastHeartbeat: Date | null;
}

export class NodeAgent {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private schedulerUrl: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private inferenceService: InferenceService;
  private modelManager: any; // ModelManager 实例
  private serviceRegistryManager: any; // ServiceRegistryManager 实例
  private rustServiceManager: any; // RustServiceManager 实例（用于检查 node-inference 运行状态）
  private pythonServiceManager: any; // PythonServiceManager 实例（用于检查 Python 服务运行状态）
  private capabilityStateChangedHandler: (() => void) | null = null; // 保存监听器函数，用于清理
  private heartbeatDebounceTimer: NodeJS.Timeout | null = null; // 心跳防抖定时器
  private readonly HEARTBEAT_DEBOUNCE_MS = 2000; // 防抖延迟：2秒内最多触发一次立即心跳
  private nodeConfig: NodeConfig; // 节点配置（用于指标收集配置）
  private aggregatorMiddleware: AggregatorMiddleware; // Aggregator 中间件（旧架构）
  private postProcessCoordinator: PostProcessCoordinator | null = null; // PostProcess 协调器（新架构）
  // 防止重复处理同一个job（只保留最近的两个job_id，用于检测相邻重复）
  private recentJobIds: string[] = [];

  constructor(
    inferenceService: InferenceService,
    modelManager?: any,
    serviceRegistryManager?: any,
    rustServiceManager?: any,
    pythonServiceManager?: any
  ) {
    // 优先从配置文件读取，其次从环境变量，最后使用默认值
    this.nodeConfig = loadNodeConfig();
    this.schedulerUrl =
      this.nodeConfig.scheduler?.url ||
      process.env.SCHEDULER_URL ||
      'ws://127.0.0.1:5010/ws/node';
    this.inferenceService = inferenceService;
    // 通过参数传入或从 inferenceService 获取 modelManager
    this.modelManager = modelManager || (inferenceService as any).modelManager;
    this.serviceRegistryManager = serviceRegistryManager;
    this.rustServiceManager = rustServiceManager;
    this.pythonServiceManager = pythonServiceManager;

    // 初始化 Aggregator 中间件（默认启用）
    // 从 InferenceService 获取 TaskRouter（用于重新触发 NMT）
    const taskRouter = (this.inferenceService as any).taskRouter;
    const aggregatorConfig: AggregatorMiddlewareConfig = {
      enabled: true,  // 可以通过配置控制
      mode: 'offline',  // 默认 offline，可以根据 job 动态调整
      ttlMs: 5 * 60 * 1000,  // 5 分钟 TTL
      maxSessions: 500,  // 降低最大会话数（从 1000 降低到 500，减少内存占用）
      translationCacheSize: 200,  // 翻译缓存大小：最多 200 条（提高缓存命中率）
      translationCacheTtlMs: 10 * 60 * 1000,  // 翻译缓存过期时间：10 分钟（提高缓存命中率）
      enableAsyncRetranslation: true,  // 异步重新翻译（默认启用，长文本使用异步处理）
      asyncRetranslationThreshold: 50,  // 异步重新翻译阈值（文本长度，默认 50 字符）
      nmtRepairEnabled: true,  // 启用 NMT Repair
      nmtRepairNumCandidates: 5,  // 生成 5 个候选
      nmtRepairThreshold: 0.7,  // 质量分数 < 0.7 时触发
    };
    this.aggregatorMiddleware = new AggregatorMiddleware(aggregatorConfig, taskRouter);

    // 初始化 PostProcessCoordinator（新架构，通过 Feature Flag 控制）
    const enablePostProcessTranslation = this.nodeConfig.features?.enablePostProcessTranslation ?? true;
    if (enablePostProcessTranslation) {
      const aggregatorManager = (this.aggregatorMiddleware as any).manager;
      const postProcessConfig: PostProcessConfig = {
        enabled: true,
        translationConfig: {
          translationCacheSize: aggregatorConfig.translationCacheSize,
          translationCacheTtlMs: aggregatorConfig.translationCacheTtlMs,
          enableAsyncRetranslation: aggregatorConfig.enableAsyncRetranslation,
          asyncRetranslationThreshold: aggregatorConfig.asyncRetranslationThreshold,
          nmtRepairEnabled: aggregatorConfig.nmtRepairEnabled,
          nmtRepairNumCandidates: aggregatorConfig.nmtRepairNumCandidates,
          nmtRepairThreshold: aggregatorConfig.nmtRepairThreshold,
        },
      };
      this.postProcessCoordinator = new PostProcessCoordinator(
        aggregatorManager,
        taskRouter,
        postProcessConfig
      );
      logger.info({}, 'PostProcessCoordinator initialized (new architecture)');
    }

    // S1: 将AggregatorManager传递给InferenceService（用于构建prompt）
    const aggregatorManager = (this.aggregatorMiddleware as any).manager;
    if (aggregatorManager && this.inferenceService) {
      (this.inferenceService as any).setAggregatorManager(aggregatorManager);
      logger.info({}, 'S1: AggregatorManager passed to InferenceService for prompt building');
    }

    // 将AggregatorMiddleware传递给InferenceService（用于在ASR之后、NMT之前进行文本聚合）
    if (this.aggregatorMiddleware && this.inferenceService) {
      (this.inferenceService as any).setAggregatorMiddleware(this.aggregatorMiddleware);
      logger.info({}, 'AggregatorMiddleware passed to InferenceService for pre-NMT aggregation');
    }

    logger.info({ schedulerUrl: this.schedulerUrl }, 'Scheduler server URL configured');
  }

  async start(): Promise<void> {
    try {
      // 如果已有连接，先关闭
      if (this.ws) {
        this.stop();
      }

      this.ws = new WebSocket(this.schedulerUrl);

      this.ws.on('open', () => {
        logger.info({ schedulerUrl: this.schedulerUrl }, 'Connected to scheduler server, starting registration');
        // 使用 Promise 确保注册完成后再启动心跳
        this.registerNode().catch((error) => {
          logger.error({ error }, 'Failed to register node in open handler');
        });
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        const messageStr = data.toString();
        logger.debug({ message: messageStr }, 'Received message from scheduler');
        this.handleMessage(messageStr);
      });

      this.ws.on('error', (error) => {
        logger.error({ error, schedulerUrl: this.schedulerUrl }, 'WebSocket error');
      });

      this.ws.on('close', (code, reason) => {
        logger.info({ code, reason: reason?.toString() }, 'Connection to scheduler server closed');
        this.stopHeartbeat();
        // 尝试重连
        setTimeout(() => this.start(), 5000);
      });

      // 监听模型状态变化，实时更新 capability_state
      // 先移除旧的监听器（如果存在），避免重复添加
      if (this.modelManager && typeof this.modelManager.on === 'function') {
        if (this.capabilityStateChangedHandler) {
          this.modelManager.off('capability-state-changed', this.capabilityStateChangedHandler);
        }
        // 创建新的监听器函数并保存
        this.capabilityStateChangedHandler = () => {
          // 状态变化时，立即触发心跳（带防抖）
          logger.debug({}, 'Model state changed, triggering immediate heartbeat');
          this.triggerImmediateHeartbeat();
        };
        this.modelManager.on('capability-state-changed', this.capabilityStateChangedHandler);
      }

      // 注册 Python 服务状态变化回调
      if (this.pythonServiceManager && typeof this.pythonServiceManager.setOnStatusChangeCallback === 'function') {
        this.pythonServiceManager.setOnStatusChangeCallback((serviceName: string, status: any) => {
          // 服务状态变化时，立即触发心跳（带防抖）
          logger.debug({ serviceName, running: status.running }, 'Python service status changed, triggering immediate heartbeat');
          this.triggerImmediateHeartbeat();
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to start Node Agent');
    }
  }

  stop(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    // 移除 capability-state-changed 监听器，避免内存泄漏
    if (this.modelManager && this.capabilityStateChangedHandler) {
      this.modelManager.off('capability-state-changed', this.capabilityStateChangedHandler);
      this.capabilityStateChangedHandler = null;
    }
  }

  private async registerNode(): Promise<void> {
    if (!this.ws) {
      logger.warn({}, 'Cannot register node: WebSocket is null');
      return;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ readyState: this.ws.readyState }, 'Cannot register node: WebSocket is not OPEN');
      return;
    }

    logger.info({ readyState: this.ws.readyState }, 'Starting node registration');

    try {
      // 获取硬件信息
      logger.debug({}, 'Getting hardware info...');
      const hardware = await this.getHardwareInfo();
      logger.debug({ gpus: hardware.gpus?.length || 0 }, 'Hardware info retrieved');

      // 获取已安装的模型
      logger.debug({}, 'Getting installed models...');
      const installedModels = await this.inferenceService.getInstalledModels();
      logger.debug({ modelCount: installedModels.length }, 'Installed models retrieved');

      // 获取服务实现列表与按类型聚合的能力
      logger.debug({}, 'Getting installed services...');
      const installedServicesAll = await this.getInstalledServices();
      logger.debug({ serviceCount: installedServicesAll.length }, 'Installed services retrieved');

      logger.debug({}, 'Getting capability by type...');
      const capabilityByType = await this.getCapabilityByType(installedServicesAll);
      logger.debug({ capabilityCount: capabilityByType.length }, 'Capability by type retrieved');

      // 获取支持的功能
      logger.debug({}, 'Getting features supported...');
      const featuresSupported = this.inferenceService.getFeaturesSupported();
      logger.debug({ features: featuresSupported }, 'Features supported retrieved');

      // 对齐协议规范：node_register 消息格式
      const message: NodeRegisterMessage = {
        type: 'node_register',
        node_id: this.nodeId || null, // 首次连接时为 null
        version: '2.0.0', // TODO: 从 package.json 读取
        capability_schema_version: '2.0', // ServiceType 能力模型版本
        platform: this.getPlatform(),
        hardware: hardware,
        installed_models: installedModels,
        // 上报全部已安装实现（含运行状态），调度按 type 聚合
        // 如果为空数组，则发送 undefined 以匹配 Option<Vec<InstalledService>>
        installed_services: installedServicesAll.length > 0 ? installedServicesAll : undefined,
        capability_by_type: capabilityByType,
        features_supported: featuresSupported,
        accept_public_jobs: true, // TODO: 从配置读取
      };

      const messageStr = JSON.stringify(message);
      logger.info({
        node_id: this.nodeId,
        capability_schema_version: message.capability_schema_version,
        platform: message.platform,
        gpus: hardware.gpus?.length || 0,
        installed_services_count: installedServicesAll.length,
        capability_by_type_count: capabilityByType.length,
        capabilityByType,
        message_length: messageStr.length,
        ws_readyState: this.ws.readyState,
      }, 'Sending node registration message');

      logger.debug({ message: messageStr }, 'Node registration message content');

      if (this.ws.readyState !== WebSocket.OPEN) {
        logger.error({ readyState: this.ws.readyState }, 'WebSocket is not OPEN when trying to send registration message');
        return;
      }

      this.ws.send(messageStr);
      logger.info({ message_length: messageStr.length }, 'Node registration message sent successfully');
    } catch (error) {
      const errorDetails = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
        error: error,
      };
      logger.error(errorDetails, 'Failed to register node');
    }
  }

  private getPlatform(): 'windows' | 'linux' | 'macos' {
    const platform = os.platform();
    if (platform === 'win32') return 'windows';
    if (platform === 'darwin') return 'macos';
    return 'linux';
  }

  private async getHardwareInfo(): Promise<{
    cpu_cores: number;
    memory_gb: number;
    gpus?: Array<{ name: string; memory_gb: number }>;
  }> {
    try {
      const mem = await si.mem();
      const cpu = await si.cpu();

      // 获取 GPU 硬件信息（使用 nvidia-smi）
      const gpus = await this.getGpuHardwareInfo();

      return {
        cpu_cores: cpu.cores || os.cpus().length,
        memory_gb: Math.round(mem.total / (1024 * 1024 * 1024)),
        gpus: gpus.length > 0 ? gpus : undefined,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get hardware info');
      return {
        cpu_cores: os.cpus().length,
        memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
      };
    }
  }

  /**
   * 获取 GPU 硬件信息（名称和显存大小）
   * 使用 nvidia-smi 命令获取
   */
  private async getGpuHardwareInfo(): Promise<Array<{ name: string; memory_gb: number }>> {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      // nvidia-smi 命令：获取GPU名称和显存大小
      const nvidiaSmi = spawn('nvidia-smi', [
        '--query-gpu=name,memory.total',
        '--format=csv,noheader,nounits'
      ]);

      let output = '';
      let errorOutput = '';

      nvidiaSmi.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      nvidiaSmi.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      nvidiaSmi.on('close', (code: number) => {
        if (code === 0 && output.trim()) {
          try {
            const lines = output.trim().split('\n');
            const gpus: Array<{ name: string; memory_gb: number }> = [];

            for (const line of lines) {
              // 格式: "GPU Name, Memory Total (MB)"
              const parts = line.split(',');
              if (parts.length >= 2) {
                const name = parts[0].trim();
                const memoryMb = parseFloat(parts[1].trim());
                const memoryGb = Math.round(memoryMb / 1024);

                if (!isNaN(memoryGb) && name) {
                  gpus.push({ name, memory_gb: memoryGb });
                }
              }
            }

            if (gpus.length > 0) {
              logger.info({ gpus }, 'Successfully fetched GPU hardware info');
              resolve(gpus);
            } else {
              logger.warn({ output }, 'Failed to parse GPU hardware info');
              resolve([]);
            }
          } catch (parseError) {
            logger.warn({ parseError, output }, 'Failed to parse nvidia-smi output');
            resolve([]);
          }
        } else {
          logger.warn({ code, errorOutput: errorOutput.trim() }, 'nvidia-smi command failed or no GPU found');
          resolve([]);
        }
      });

      nvidiaSmi.on('error', (error: Error) => {
        // nvidia-smi 命令不存在或无法执行
        logger.warn({ error: error.message }, 'nvidia-smi command not available');
        resolve([]);
      });
    });
  }

  private startHeartbeat(): void {
    // 如果 nodeId 已存在（重连场景），立即发送一次心跳
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.nodeId) {
      this.sendHeartbeatOnce().catch((error) => {
        logger.warn({ error }, 'Failed to send initial heartbeat');
      });
    }

    // 设置定时器，每15秒发送一次心跳
    this.heartbeatInterval = setInterval(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) return;

      await this.sendHeartbeatOnce();
    }, 15000); // 每15秒发送一次心跳
  }

  /**
   * 立即发送一次心跳（用于 node_register_ack 后立刻同步 installed_services/capability_state）
   * 避免等待 15s interval 导致调度端短时间内认为“无可用节点/无服务包”。
   */
  private async sendHeartbeatOnce(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) return;

    const resources = await this.getSystemResources();
    const installedModels = await this.inferenceService.getInstalledModels();

    const installedServicesAll = await this.getInstalledServices();
    const capabilityByType = await this.getCapabilityByType(installedServicesAll);

    logger.info({
      nodeId: this.nodeId,
      installedModelsCount: installedModels.length,
      installedServicesCount: installedServicesAll.length,
      capabilityByTypeCount: capabilityByType.length,
      capabilityByType,
      installedServices: installedServicesAll.map(s => `${s.service_id}:${s.type}:${s.status}`),
    }, 'Sending heartbeat with type-level capability');

    // 对齐协议规范：node_heartbeat 消息格式
    // 注意：gpu_percent 必须提供（不能为 undefined），因为调度服务器的健康检查要求所有节点都必须有 GPU
    // 如果无法获取 GPU 使用率，使用 0.0 作为默认值
    const message: NodeHeartbeatMessage = {
      type: 'node_heartbeat',
      node_id: this.nodeId,
      timestamp: Date.now(),
      resource_usage: {
        cpu_percent: resources.cpu,
        gpu_percent: resources.gpu ?? 0.0, // 如果为 null，使用 0.0 作为默认值
        gpu_mem_percent: resources.gpuMem || undefined,
        mem_percent: resources.memory,
        running_jobs: this.inferenceService.getCurrentJobCount(),
      },
      installed_models: installedModels.length > 0 ? installedModels : undefined,
      installed_services: installedServicesAll,
      capability_by_type: capabilityByType,
    };

    // 方案1+方案2：基于配置和服务状态的动态指标收集（支持热插拔）
    const metricsConfig = this.nodeConfig.metrics;
    const metricsEnabled = metricsConfig?.enabled !== false; // 默认启用（向后兼容）

    if (metricsEnabled) {
      // 检查 Rerun 指标（Gate-B）
      const rerunMetricsEnabled = metricsConfig?.metrics?.rerun !== false; // 默认启用
      if (rerunMetricsEnabled && this.shouldCollectRerunMetrics(installedServicesAll)) {
        const rerunMetrics = this.inferenceService.getRerunMetrics?.();
        if (rerunMetrics) {
          message.rerun_metrics = rerunMetrics;
        }
      }

      // 检查处理效率指标（OBS-1）
      const asrMetricsEnabled = metricsConfig?.metrics?.asr !== false; // 默认启用
      if (asrMetricsEnabled && this.shouldCollectASRMetrics(installedServicesAll)) {
        // 获取按服务ID分组的处理效率指标
        // 注意：在发送心跳前获取，因为心跳发送后会重置数据
        const serviceEfficiencies = this.inferenceService.getProcessingMetrics?.();
        if (serviceEfficiencies && Object.keys(serviceEfficiencies).length > 0) {
          message.processing_metrics = {
            serviceEfficiencies,
          };
        }
        // 向后兼容：保留 asr_metrics
        const asrMetrics = this.inferenceService.getASRMetrics?.();
        if (asrMetrics) {
          message.asr_metrics = asrMetrics;
        }
      }
    }

    const messageStr = JSON.stringify(message);
    logger.debug({ message: messageStr }, 'Heartbeat message content');
    this.ws.send(messageStr);

    // OBS-1: 心跳发送后重置周期数据，为下一个周期做准备
    // 注意：在消息发送之后重置，确保 UI 可以获取到当前周期的数据
    const asrMetricsEnabled = this.nodeConfig.metrics?.metrics?.asr !== false;
    if (asrMetricsEnabled && this.shouldCollectASRMetrics(installedServicesAll)) {
      this.inferenceService.resetProcessingMetrics?.();
    }
  }

  /**
   * 获取已安装的服务包列表
   * 包括：
   * 1. 从服务注册表中读取的已注册服务
   * 2. 实际运行但未在注册表中的本地服务（如 faster-whisper-vad、speaker-embedding）
   */
  private async getInstalledServices(): Promise<InstalledService[]> {
    const result: InstalledService[] = [];
    const defaultVersion = '2.0.0';

    const serviceTypeMap: Record<string, ServiceType> = {
      'faster-whisper-vad': ServiceType.ASR,
      'node-inference': ServiceType.ASR,
      'nmt-m2m100': ServiceType.NMT,
      'piper-tts': ServiceType.TTS,
      'speaker-embedding': ServiceType.TONE,
      'your-tts': ServiceType.TONE,
    };

    const defaultDevice: DeviceType = 'gpu';

    const pushService = (service_id: string, status: ServiceStatus, version?: string) => {
      const type = serviceTypeMap[service_id];
      if (!type) {
        logger.warn({ service_id }, 'Unknown service_id, skipped when building installed_services');
        return;
      }
      // 去重：若已存在则更新状态
      const existingIndex = result.findIndex(s => s.service_id === service_id);
      const entry: InstalledService = {
        service_id,
        type,
        device: defaultDevice,
        status,
        version: version || defaultVersion,
      };
      if (existingIndex >= 0) {
        result[existingIndex] = entry;
      } else {
        result.push(entry);
      }
    };

    // 1. 从服务注册表获取已注册的服务
    if (this.serviceRegistryManager) {
      try {
        await this.serviceRegistryManager.loadRegistry();
        const installed = this.serviceRegistryManager.listInstalled();

        logger.debug({
          installedCount: installed.length,
          installed: installed.map((s: any) => ({
            service_id: s.service_id,
            version: s.version,
            platform: s.platform
          }))
        }, 'Getting installed services from registry for heartbeat');

        installed.forEach((service: any) => {
          const running = this.isServiceRunning(service.service_id);
          pushService(service.service_id, running ? 'running' : 'stopped', service.version);
        });
      } catch (error) {
        logger.error({ error }, 'Failed to get installed services from registry');
      }
    }

    // 2. 补充实际运行但未在注册表中的本地服务（Python）
    const serviceIdMap: Record<string, string> = {
      nmt: 'nmt-m2m100',
      tts: 'piper-tts',
      yourtts: 'your-tts',
      speaker_embedding: 'speaker-embedding',
      faster_whisper_vad: 'faster-whisper-vad',
    };

    if (this.pythonServiceManager) {
      const pythonServiceNames: Array<'nmt' | 'tts' | 'yourtts' | 'speaker_embedding' | 'faster_whisper_vad'> =
        ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];

      for (const serviceName of pythonServiceNames) {
        const serviceId = serviceIdMap[serviceName];
        const alreadyAdded = result.some(s => s.service_id === serviceId);
        if (!alreadyAdded) {
          const status = this.pythonServiceManager.getServiceStatus(serviceName);
          if (status?.running) {
            pushService(serviceId, 'running');
            logger.debug({ serviceId, serviceName }, 'Added running service to installed services list (not in registry)');
          }
        }
      }
    }

    // 3. 补充 Rust 服务（node-inference）
    if (this.rustServiceManager && typeof this.rustServiceManager.getStatus === 'function') {
      const rustStatus = this.rustServiceManager.getStatus();
      const alreadyAdded = result.some(s => s.service_id === 'node-inference');
      if (!alreadyAdded && rustStatus?.running) {
        pushService('node-inference', 'running');
        logger.debug({}, 'Added node-inference to installed services list (not in registry)');
      }
    }

    logger.info({
      totalCount: result.length,
      services: result.map(s => `${s.service_id}:${s.status}`),
    }, 'Getting installed services for heartbeat (type-level)');

    return result;
  }

  /**
   * 方案2：动态检测是否应该收集 Rerun 指标
   * 检查是否有 ASR 服务运行（Rerun 功能依赖 ASR）
   */
  private shouldCollectRerunMetrics(installedServices: InstalledService[]): boolean {
    // Rerun 功能需要 ASR 服务支持
    const hasASRService = installedServices.some(
      s => s.type === ServiceType.ASR && s.status === 'running'
    );
    return hasASRService;
  }

  /**
   * 方案2：动态检测是否应该收集 ASR 指标
   * 检查是否有 ASR 服务运行
   */
  private shouldCollectASRMetrics(installedServices: InstalledService[]): boolean {
    const hasASRService = installedServices.some(
      s => s.type === ServiceType.ASR && s.status === 'running'
    );
    return hasASRService;
  }

  /**
   * 聚合 type 级可用性：同一类型只要有 GPU+running 的实现即 ready
   */
  private async getCapabilityByType(installedServices: InstalledService[]): Promise<CapabilityByType[]> {
    const types = [ServiceType.ASR, ServiceType.NMT, ServiceType.TTS, ServiceType.TONE];
    const capability: CapabilityByType[] = [];

    for (const t of types) {
      const runningGpu = installedServices.filter(s => s.type === t && s.device === 'gpu' && s.status === 'running');
      if (runningGpu.length > 0) {
        capability.push({
          type: t,
          ready: true,
          ready_impl_ids: runningGpu.map(s => s.service_id),
        });
        continue;
      }

      const anyInstalled = installedServices.some(s => s.type === t);
      const anyRunning = installedServices.some(s => s.type === t && s.status === 'running');
      const anyGpu = installedServices.some(s => s.type === t && s.device === 'gpu');

      let reason = 'no_impl';
      if (anyInstalled && anyGpu && !anyRunning) reason = 'gpu_impl_not_running';
      else if (anyInstalled && anyRunning && !anyGpu) reason = 'only_cpu_running';
      else if (anyInstalled && !anyRunning) reason = 'no_running_impl';

      capability.push({
        type: t,
        ready: false,
        reason,
      });
    }

    logger.debug({ capability }, 'Built capability_by_type');
    return capability;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // 清理防抖定时器
    if (this.heartbeatDebounceTimer) {
      clearTimeout(this.heartbeatDebounceTimer);
      this.heartbeatDebounceTimer = null;
    }
  }

  /**
   * 触发立即心跳（带防抖机制）
   * 避免在短时间内多次触发导致心跳过于频繁
   */
  private triggerImmediateHeartbeat(): void {
    // 如果已有待发送的立即心跳，取消它
    if (this.heartbeatDebounceTimer) {
      clearTimeout(this.heartbeatDebounceTimer);
    }

    // 设置新的防抖定时器
    this.heartbeatDebounceTimer = setTimeout(async () => {
      this.heartbeatDebounceTimer = null;
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.nodeId) {
        logger.debug({}, 'Triggering immediate heartbeat due to service state change');
        await this.sendHeartbeatOnce();
      }
    }, this.HEARTBEAT_DEBOUNCE_MS);
  }

  private async getSystemResources(): Promise<{
    cpu: number;
    gpu: number | null;
    gpuMem: number | null;
    memory: number
  }> {
    try {
      const [cpu, mem] = await Promise.all([
        si.currentLoad(),
        si.mem(),
      ]);

      // TODO: 获取 GPU 使用率（需要额外库，如 nvidia-ml-py）
      return {
        cpu: cpu.currentLoad || 0,
        gpu: null,
        gpuMem: null,
        memory: (mem.used / mem.total) * 100,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get system resources');
      return { cpu: 0, gpu: null, gpuMem: null, memory: 0 };
    }
  }

  /**
   * 检查服务是否正在运行
   * 根据 service_id 映射到对应的服务管理器并检查运行状态
   */
  private isServiceRunning(serviceId: string): boolean {
    try {
      // 服务 ID 到服务管理器的映射
      if (serviceId === 'node-inference') {
        // node-inference 通过 RustServiceManager 管理
        if (this.rustServiceManager && typeof this.rustServiceManager.getStatus === 'function') {
          const status = this.rustServiceManager.getStatus();
          return status?.running === true;
        }
      } else if (serviceId === 'nmt-m2m100') {
        // nmt-m2m100 通过 PythonServiceManager 管理（服务名是 'nmt'）
        if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
          const status = this.pythonServiceManager.getServiceStatus('nmt');
          return status?.running === true;
        }
      } else if (serviceId === 'piper-tts') {
        // piper-tts 通过 PythonServiceManager 管理（服务名是 'tts'）
        if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
          const status = this.pythonServiceManager.getServiceStatus('tts');
          return status?.running === true;
        }
      } else if (serviceId === 'your-tts') {
        // your-tts 通过 PythonServiceManager 管理（服务名是 'yourtts'）
        if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
          const status = this.pythonServiceManager.getServiceStatus('yourtts');
          return status?.running === true;
        }
      } else if (serviceId === 'speaker-embedding') {
        // speaker-embedding 通过 PythonServiceManager 管理（服务名是 'speaker_embedding'）
        if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
          const status = this.pythonServiceManager.getServiceStatus('speaker_embedding');
          return status?.running === true;
        }
      } else if (serviceId === 'faster-whisper-vad') {
        // faster-whisper-vad 通过 PythonServiceManager 管理（服务名是 'faster_whisper_vad'）
        if (this.pythonServiceManager && typeof this.pythonServiceManager.getServiceStatus === 'function') {
          const status = this.pythonServiceManager.getServiceStatus('faster_whisper_vad');
          return status?.running === true;
        }
      }

      // 未知的服务 ID 或服务管理器不可用，返回 false
      return false;
    } catch (error) {
      logger.error({ error, serviceId }, 'Failed to check service running status');
      return false;
    }
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'node_register_ack': {
          const ack = message as NodeRegisterAckMessage;
          this.nodeId = ack.node_id;
          logger.info({ nodeId: this.nodeId }, 'Node registered successfully');
          // 立刻补发一次心跳，把 installed_services/capability_state 尽快同步到 Scheduler
          this.sendHeartbeatOnce().catch((error) => {
            logger.warn({ error }, 'Failed to send immediate heartbeat after node_register_ack');
          });
          break;
        }

        case 'job_assign': {
          const job = message as JobAssignMessage;
          await this.handleJob(job);
          break;
        }

        case 'job_cancel': {
          const cancel = message as JobCancelMessage;
          const ok = this.inferenceService.cancelJob(cancel.job_id);
          logger.info(
            { jobId: cancel.job_id, traceId: cancel.trace_id, reason: cancel.reason, ok },
            'Received job_cancel from scheduler'
          );
          break;
        }

        case 'pairing_code':
          // 配对码已生成，通过 IPC 通知渲染进程
          break;

        default:
          logger.warn({ messageType: message.type }, 'Unknown message type');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to handle message');
    }
  }

  private async handleJob(job: JobAssignMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) {
      logger.warn({ jobId: job.job_id, wsState: this.ws?.readyState, nodeId: this.nodeId }, 'Cannot handle job: WebSocket not ready');
      return;
    }

    // 检查是否与最近处理的job_id重复（只检查相邻的两个，因为重复通常是明显的）
    if (this.recentJobIds.length > 0 && this.recentJobIds[this.recentJobIds.length - 1] === job.job_id) {
      logger.warn(
        {
          jobId: job.job_id,
          traceId: job.trace_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          recentJobIds: this.recentJobIds,
        },
        'Skipping duplicate job_id (same as last processed job)'
      );
      return;
    }

    // 更新最近处理的job_id列表（只保留最近2个）
    this.recentJobIds.push(job.job_id);
    if (this.recentJobIds.length > 2) {
      this.recentJobIds.shift(); // 移除最旧的
    }

    const startTime = Date.now();
    logger.info(
      {
        jobId: job.job_id,
        traceId: job.trace_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
      },
      'Received job_assign, starting processing'
    );

    try {
      // 根据 features 启动所需的服务
      if (job.features?.speaker_identification && this.pythonServiceManager) {
        try {
          await this.pythonServiceManager.startService('speaker_embedding');
          logger.info({ jobId: job.job_id }, 'Started speaker_embedding service for speaker_identification feature');
        } catch (error) {
          logger.warn({ error, jobId: job.job_id }, 'Failed to start speaker_embedding service, continuing without it');
        }
      }

      // 如果启用了流式 ASR，设置部分结果回调
      const partialCallback = job.enable_streaming_asr ? (partial: { text: string; is_final: boolean; confidence: number }) => {
        // 发送 ASR 部分结果到调度服务器
        // 对齐协议规范：asr_partial 消息格式（从节点发送到调度服务器，需要包含 node_id）
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.nodeId) {
          const partialMessage: AsrPartialMessage = {
            type: 'asr_partial',
            node_id: this.nodeId,
            session_id: job.session_id,
            utterance_index: job.utterance_index,
            job_id: job.job_id,
            text: partial.text,
            is_final: partial.is_final,
            trace_id: job.trace_id, // Added: propagate trace_id
          };
          this.ws.send(JSON.stringify(partialMessage));
        }
      } : undefined;

      // 调用推理服务处理任务
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          audioFormat: job.audio_format,
          audioLength: job.audio ? job.audio.length : 0,
        },
        'Processing job: received audio data'
      );
      const result = await this.inferenceService.processJob(job, partialCallback);

      // 后处理（在发送结果前）
      // 优先使用 PostProcessCoordinator（新架构），否则使用 AggregatorMiddleware（旧架构）
      let finalResult = result;
      const enablePostProcessTranslation = this.nodeConfig.features?.enablePostProcessTranslation ?? true;
      
      if (enablePostProcessTranslation && this.postProcessCoordinator) {
        // 使用新架构：PostProcessCoordinator
        logger.debug({ jobId: job.job_id, sessionId: job.session_id }, 'Processing through PostProcessCoordinator (new architecture)');
        
        const postProcessResult = await this.postProcessCoordinator.process(job, result);
        
        // 统一处理 TTS Opus 编码（无论来自 Pipeline 还是 PostProcess）
        let ttsAudio = postProcessResult.ttsAudio || result.tts_audio || '';
        let ttsFormat = postProcessResult.ttsFormat || result.tts_format || 'opus';
        
        // 如果 TTS 音频是 WAV 格式，需要编码为 Opus（统一在 NodeAgent 层处理）
        if (ttsAudio && (ttsFormat === 'wav' || ttsFormat === 'pcm16')) {
          try {
            const { convertWavToOpus } = await import('../utils/opus-codec');
            const wavBuffer = Buffer.from(ttsAudio, 'base64');
            const opusData = await convertWavToOpus(wavBuffer);
            ttsAudio = opusData.toString('base64');
            ttsFormat = 'opus';
            logger.info(
              {
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                wavSize: wavBuffer.length,
                opusSize: opusData.length,
                compression: (wavBuffer.length / opusData.length).toFixed(2),
              },
              'NodeAgent: TTS WAV audio encoded to Opus successfully (unified encoding)'
            );
          } catch (opusError) {
            const errorMessage = opusError instanceof Error ? opusError.message : String(opusError);
            logger.error(
              {
                error: opusError,
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                errorMessage,
              },
              'NodeAgent: Failed to encode TTS WAV to Opus, returning empty audio'
            );
            ttsAudio = '';
            ttsFormat = 'opus';
          }
        }
        
        if (postProcessResult.shouldSend) {
          finalResult = {
            ...result,
            text_asr: postProcessResult.aggregatedText,
            text_translated: postProcessResult.translatedText,
            tts_audio: ttsAudio,
            tts_format: ttsFormat,
          };
          
          logger.debug(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              action: postProcessResult.action,
              originalLength: result.text_asr?.length || 0,
              aggregatedLength: postProcessResult.aggregatedText.length,
            },
            'PostProcessCoordinator processing completed'
          );
        } else {
          // PostProcessCoordinator 决定不发送（可能是重复文本或被过滤）
          // 修复：如果PostProcessCoordinator决定不发送（shouldSend=false），不发送job_result
          // 避免发送重复内容或空结果导致重复输出
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              reason: postProcessResult.reason || 'PostProcessCoordinator filtered result',
              aggregatedText: postProcessResult.aggregatedText?.substring(0, 50) || '',
              aggregatedTextLength: postProcessResult.aggregatedText?.length || 0,
            },
            'PostProcessCoordinator filtered result (shouldSend=false), skipping job_result send to avoid duplicate output'
          );
          return;  // 不发送结果，避免重复输出
        }
      } else {
        // 如果未使用 PostProcessCoordinator（不应该发生，但保留作为安全措施）
        finalResult = result;
      }
      // 注意：AggregatorMiddleware 现在在 PipelineOrchestrator 中调用（ASR 之后、NMT 之前）
      // 不再在这里调用，避免重复处理和重复翻译
      // 如果启用了 AggregatorMiddleware，文本聚合已经在 PipelineOrchestrator 中完成

      // 检查ASR结果是否为空
      const asrTextTrimmed = (finalResult.text_asr || '').trim();
      const isEmpty = !asrTextTrimmed || asrTextTrimmed.length === 0;

      if (isEmpty) {
        // 修复：即使ASR结果为空，也发送job_result（空结果）给调度服务器
        // 这样调度服务器知道节点端已经处理完成，不会触发超时
        // 调度服务器的result_queue会处理空结果，不会发送给客户端
        logger.info(
          { 
            jobId: job.job_id, 
            traceId: job.trace_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            reason: 'ASR result is empty, but sending empty job_result to scheduler to prevent timeout',
          },
          'NodeAgent: ASR result is empty, sending empty job_result to scheduler to prevent timeout'
        );
        // 继续执行，发送空结果
      } else {
        logger.info(
          {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            textAsr: finalResult.text_asr?.substring(0, 50),
            textAsrLength: finalResult.text_asr?.length || 0,
            textTranslated: finalResult.text_translated?.substring(0, 100),
            textTranslatedLength: finalResult.text_translated?.length || 0,
            ttsAudioLength: finalResult.tts_audio?.length || 0,
          },
          'Job processing completed successfully'
        );
      }

      // 对齐协议规范：job_result 消息格式
      const response: JobResultMessage = {
        type: 'job_result',
        job_id: job.job_id,
        attempt_id: job.attempt_id,
        node_id: this.nodeId,
        session_id: job.session_id,
        utterance_index: job.utterance_index,
        success: true,
        text_asr: finalResult.text_asr,
        text_translated: finalResult.text_translated,
        tts_audio: finalResult.tts_audio,
        tts_format: finalResult.tts_format || 'opus',  // 强制使用 opus 格式
        extra: finalResult.extra,
        processing_time_ms: Date.now() - startTime,
        trace_id: job.trace_id, // Added: propagate trace_id
        // OBS-2: 透传 ASR 质量信息
        asr_quality_level: finalResult.asr_quality_level,
        reason_codes: finalResult.reason_codes,
        quality_score: finalResult.quality_score,
        rerun_count: finalResult.rerun_count,
        segments_meta: finalResult.segments_meta,
      };

      // 检查是否与上次发送的文本完全相同（防止重复发送）
      // 优化：使用更严格的文本比较
      const lastSentText = this.aggregatorMiddleware.getLastSentText(job.session_id);
      if (lastSentText && finalResult.text_asr) {
        const normalizeText = (text: string): string => {
          return text.replace(/\s+/g, ' ').trim();
        };

        const normalizedCurrent = normalizeText(finalResult.text_asr);
        const normalizedLast = normalizeText(lastSentText);

        if (normalizedCurrent === normalizedLast && normalizedCurrent.length > 0) {
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              text: finalResult.text_asr.substring(0, 50),
              normalizedText: normalizedCurrent.substring(0, 50),
            },
            'Skipping duplicate job result (same as last sent after normalization)'
          );
          return;  // 不发送重复的结果
        }
      }

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          responseLength: JSON.stringify(response).length,
          textAsrLength: finalResult.text_asr?.length || 0,
          ttsAudioLength: finalResult.tts_audio?.length || 0,
        },
        'Sending job_result to scheduler'
      );
      this.ws.send(JSON.stringify(response));
      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          processingTimeMs: Date.now() - startTime,
        },
        'Job result sent successfully'
      );

      // 更新最后发送的文本（在成功发送后）
      if (finalResult.text_asr) {
        this.aggregatorMiddleware.setLastSentText(job.session_id, finalResult.text_asr.trim());
      }
    } catch (error) {
      logger.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Failed to process job');

      // 检查是否是 ModelNotAvailableError
      if (error instanceof ModelNotAvailableError) {
        // 发送 MODEL_NOT_AVAILABLE 错误给调度服务器
        // 注意：根据新架构，使用 service_id 而不是 model_id
        const errorResponse: JobResultMessage = {
          type: 'job_result',
          job_id: job.job_id,
          attempt_id: job.attempt_id,
          node_id: this.nodeId,
          session_id: job.session_id,
          utterance_index: job.utterance_index,
          success: false,
          processing_time_ms: Date.now() - startTime,
          error: {
            code: 'MODEL_NOT_AVAILABLE',
            message: `Service ${error.modelId}@${error.version} is not available: ${error.reason}`,
            details: {
              service_id: error.modelId,
              service_version: error.version,
              reason: error.reason,
            },
          },
          trace_id: job.trace_id, // Added: propagate trace_id
        };

        this.ws.send(JSON.stringify(errorResponse));
        return;
      }

      // 其他错误
      const errorResponse: JobResultMessage = {
        type: 'job_result',
        job_id: job.job_id,
        attempt_id: job.attempt_id,
        node_id: this.nodeId,
        session_id: job.session_id,
        utterance_index: job.utterance_index,
        success: false,
        processing_time_ms: Date.now() - startTime,
        error: {
          code: 'PROCESSING_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
        trace_id: job.trace_id, // Added: propagate trace_id
      };

      this.ws.send(JSON.stringify(errorResponse));
    }
  }

  getStatus(): NodeStatus {
    return {
      online: this.ws?.readyState === WebSocket.OPEN,
      nodeId: this.nodeId,
      connected: this.ws?.readyState === WebSocket.OPEN || false,
      lastHeartbeat: new Date(),
    };
  }

  async generatePairingCode(): Promise<string | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;

    return new Promise((resolve) => {
      const handler = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'pairing_code') {
            this.ws?.off('message', handler);
            resolve(message.code);
          }
        } catch (error) {
          // 忽略解析错误
        }
      };

      this.ws?.on('message', handler);
      this.ws?.send(JSON.stringify({ type: 'request_pairing_code' }));

      // 超时处理
      setTimeout(() => {
        this.ws?.off('message', handler);
        resolve(null);
      }, 5000);
    });
  }
}

