import WebSocket from 'ws';
import { InferenceService } from '../inference/inference-service';
import * as si from 'systeminformation';
import * as os from 'os';
import type {
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
  ModelStatus
} from '@shared/protocols/messages';
import { ModelNotAvailableError } from '../model-manager/model-manager';
import { loadNodeConfig } from '../node-config';
import logger from '../logger';

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

  constructor(
    inferenceService: InferenceService, 
    modelManager?: any, 
    serviceRegistryManager?: any,
    rustServiceManager?: any,
    pythonServiceManager?: any
  ) {
    // 优先从配置文件读取，其次从环境变量，最后使用默认值
    const config = loadNodeConfig();
    this.schedulerUrl =
      config.scheduler?.url ||
      process.env.SCHEDULER_URL ||
      'ws://127.0.0.1:5010/ws/node';
    this.inferenceService = inferenceService;
    // 通过参数传入或从 inferenceService 获取 modelManager
    this.modelManager = modelManager || (inferenceService as any).modelManager;
    this.serviceRegistryManager = serviceRegistryManager;
    this.rustServiceManager = rustServiceManager;
    this.pythonServiceManager = pythonServiceManager;

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
        logger.info({}, 'Connected to scheduler server');
        this.registerNode();
        this.startHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error) => {
        logger.error({ error }, 'WebSocket error');
      });

      this.ws.on('close', () => {
        logger.info({}, 'Connection to scheduler server closed');
        this.stopHeartbeat();
        // 尝试重连
        setTimeout(() => this.start(), 5000);
      });

      // 监听模型状态变化，实时更新 capability_state
      if (this.modelManager && typeof this.modelManager.on === 'function') {
        this.modelManager.on('capability-state-changed', () => {
          // 状态变化时，在下次心跳时更新 capability_state
          // 这里不立即发送，因为心跳会定期发送最新的状态
          logger.debug({}, 'Model state changed, will update capability_state on next heartbeat');
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
  }

  private async registerNode(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    try {
      // 获取硬件信息
      const hardware = await this.getHardwareInfo();

      // 获取已安装的模型
      const installedModels = await this.inferenceService.getInstalledModels();

      // 获取 capability_state（节点模型能力图）
      const capabilityState = await this.getCapabilityState();
      
      // 只保留状态为 'ready' 的服务（只有正在使用的服务才应该传递给调度服务器）
      // 已下载但未启用的服务不应计入热度统计
      const installedServicesAll = await this.getInstalledServices();
      const enabledServices: InstalledService[] = [];
      
      // 从 capability_state 中筛选出状态为 ready 的服务
      for (const service of installedServicesAll) {
        const status = capabilityState[service.service_id];
        if (status === 'ready') {
          enabledServices.push(service);
        }
      }

      // 获取支持的功能
      const featuresSupported = this.inferenceService.getFeaturesSupported();

      // 对齐协议规范：node_register 消息格式
      const message: NodeRegisterMessage = {
        type: 'node_register',
        node_id: this.nodeId || null, // 首次连接时为 null
        version: '1.0.0', // TODO: 从 package.json 读取
        platform: this.getPlatform(),
        hardware: hardware,
        installed_models: installedModels,
        // 只发送启用的服务（capability_state 中状态为 ready 的服务）
        // 已下载但未启用的服务不应传递给调度服务器，避免影响热度统计
        installed_services: enabledServices.length > 0 ? enabledServices : undefined,
        features_supported: featuresSupported,
        accept_public_jobs: true, // TODO: 从配置读取
        capability_state: Object.keys(capabilityState).length > 0 ? capabilityState : undefined,
      };

      this.ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error({ error }, 'Failed to register node');
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

    // 获取 capability_state（节点模型能力图）
    const capabilityState = await this.getCapabilityState();
    
    // 只保留状态为 'ready' 的服务（只有正在使用的服务才应该传递给调度服务器）
    // 已下载但未启用的服务不应计入热度统计
    const enabledServices: InstalledService[] = [];
    const installedServicesAll = await this.getInstalledServices();
    
    // 从 capability_state 中筛选出状态为 ready 的服务
    for (const service of installedServicesAll) {
      const status = capabilityState[service.service_id];
      if (status === 'ready') {
        enabledServices.push(service);
      }
    }

    // 记录 capability_state 信息
    const capabilityStateCount = Object.keys(capabilityState).length;
    const readyCount = Object.values(capabilityState).filter(s => s === 'ready').length;
    logger.info({
      capabilityStateCount,
      readyCount,
      installedModelsCount: installedModels.length,
      installedServicesCount: installedServicesAll.length,
      enabledServicesCount: enabledServices.length,
      enabledServices: enabledServices.map(s => s.service_id),
      installedButNotEnabledServices: installedServicesAll
        .filter(s => capabilityState[s.service_id] !== 'ready')
        .map(s => s.service_id)
    }, 'Sending heartbeat with capability_state and enabled services only');

    // 对齐协议规范：node_heartbeat 消息格式
    const message: NodeHeartbeatMessage = {
      type: 'node_heartbeat',
      node_id: this.nodeId,
      timestamp: Date.now(),
      resource_usage: {
        cpu_percent: resources.cpu,
        gpu_percent: resources.gpu || undefined,
        gpu_mem_percent: resources.gpuMem || undefined,
        mem_percent: resources.memory,
        running_jobs: this.inferenceService.getCurrentJobCount(),
      },
      installed_models: installedModels.length > 0 ? installedModels : undefined,
      // 只发送启用的服务（capability_state 中状态为 ready 的服务）
      // 已下载但未启用的服务不应传递给调度服务器，避免影响热度统计
      installed_services: enabledServices.length > 0 ? enabledServices : undefined,
      // 为空时不要发送，避免把 Scheduler 端已有的 capability_state 覆盖成空
      capability_state: capabilityStateCount > 0 ? capabilityState : undefined,
    };

    this.ws.send(JSON.stringify(message));

    if (capabilityStateCount === 0) {
      logger.warn({
        modelHubUrl: this.modelManager ? 'configured' : 'not configured'
      }, 'Heartbeat sent with empty capability_state - this may cause health check failures');
    }
  }

  /**
   * 获取已安装的服务包列表
   */
  private async getInstalledServices(): Promise<InstalledService[]> {
    if (!this.serviceRegistryManager) {
      logger.warn({}, 'ServiceRegistryManager not available for heartbeat');
      return [];
    }

    try {
      // 确保注册表已加载
      await this.serviceRegistryManager.loadRegistry();
      const installed = this.serviceRegistryManager.listInstalled();

      logger.debug({
        installedCount: installed.length,
        installed: installed.map((s: any) => ({
          service_id: s.service_id,
          version: s.version,
          platform: s.platform
        }))
      }, 'Getting installed services for heartbeat');

      // 转换为协议格式
      return installed.map((service: any) => ({
        service_id: service.service_id,
        version: service.version,
        platform: service.platform,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get installed services for heartbeat');
      return [];
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
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
      }
      
      // 未知的服务 ID 或服务管理器不可用，返回 false
      return false;
    } catch (error) {
      logger.error({ error, serviceId }, 'Failed to check service running status');
      return false;
    }
  }

  /**
   * 获取节点当前的 capability_state（服务包能力图）
   * Phase 1 规范：key 必须是 service_id（服务包 ID），value 为该服务包当前状态
   * 
   * 状态判断逻辑：
   * - ready: 服务包已安装且正在运行（进程正在运行）
   * - not_installed: 服务包未安装或已安装但未运行
   * - error: 服务包安装失败或损坏（暂不支持，预留）
   */
  private async getCapabilityState(): Promise<Record<string, ModelStatus>> {
    const capabilityState: Record<string, ModelStatus> = {};

    try {
      if (!this.serviceRegistryManager) {
        logger.warn('ServiceRegistryManager not available, returning empty capability_state');
        return {};
      }

      // 确保注册表已加载
      await this.serviceRegistryManager.loadRegistry();

      // 获取所有已安装的服务包
      const installedServices = this.serviceRegistryManager.listInstalled();
      
      // 获取所有 service_id（去重）
      const serviceIds = new Set<string>();
      installedServices.forEach((service: any) => {
        serviceIds.add(service.service_id);
      });

      // 为每个 service_id 检查状态
      for (const serviceId of serviceIds) {
        // 检查服务是否正在运行
        const isRunning = this.isServiceRunning(serviceId);
        if (isRunning) {
          // 服务包已安装且正在运行，状态为 ready
          capabilityState[serviceId] = 'ready';
        } else {
          // 服务包已安装但未运行，状态为 not_installed
          capabilityState[serviceId] = 'not_installed';
        }
      }

      const readyCount = Object.values(capabilityState).filter(s => s === 'ready').length;
      logger.debug({
        capabilityStateCount: Object.keys(capabilityState).length,
        readyCount,
        readyServices: Object.entries(capabilityState)
          .filter(([_, status]) => status === 'ready')
          .map(([serviceId, _]) => serviceId),
        notInstalledServices: Object.entries(capabilityState)
          .filter(([_, status]) => status === 'not_installed')
          .map(([serviceId, _]) => serviceId)
      }, 'Built capability_state from service registry (service_id based)');

      return capabilityState;
    } catch (error) {
      logger.error({ error }, 'Failed to get capability_state from service registry');
      return {};
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) return;

    const startTime = Date.now();

    try {
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
      const result = await this.inferenceService.processJob(job, partialCallback);

      // 对齐协议规范：job_result 消息格式
      const response: JobResultMessage = {
        type: 'job_result',
        job_id: job.job_id,
        attempt_id: job.attempt_id,
        node_id: this.nodeId,
        session_id: job.session_id,
        utterance_index: job.utterance_index,
        success: true,
        text_asr: result.text_asr,
        text_translated: result.text_translated,
        tts_audio: result.tts_audio,
        tts_format: result.tts_format || 'pcm16',
        extra: result.extra,
        processing_time_ms: Date.now() - startTime,
        trace_id: job.trace_id, // Added: propagate trace_id
      };

      this.ws.send(JSON.stringify(response));
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

