import WebSocket from 'ws';
import { InferenceService } from '../inference/inference-service';
import {
  NodeRegisterAckMessage,
  JobAssignMessage,
  JobCancelMessage,
  JobResultMessage,
  AsrPartialMessage,
  InstalledService,
} from '../../../../shared/protocols/messages';
import { ModelNotAvailableError } from '../model-manager/model-manager';
import { loadNodeConfig, type NodeConfig } from '../node-config';
import logger from '../logger';
import { AggregatorMiddleware, AggregatorMiddlewareConfig } from './aggregator-middleware';
import { PostProcessCoordinator, PostProcessConfig } from './postprocess/postprocess-coordinator';
import { HardwareInfoHandler } from './node-agent-hardware';
import { ServicesHandler } from './node-agent-services';
import { HeartbeatHandler } from './node-agent-heartbeat';
import { RegistrationHandler } from './node-agent-registration';
import { JobProcessor } from './node-agent-job-processor';
import { ResultSender } from './node-agent-result-sender';

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
  private inferenceService: InferenceService;
  private modelManager: any; // ModelManager 实例
  private serviceRegistryManager: any; // ServiceRegistryManager 实例
  private rustServiceManager: any; // RustServiceManager 实例（用于检查 node-inference 运行状态）
  private pythonServiceManager: any; // PythonServiceManager 实例（用于检查 Python 服务运行状态）
  private semanticRepairServiceManager: any; // SemanticRepairServiceManager 实例（用于检查语义修复服务运行状态）
  private capabilityStateChangedHandler: (() => void) | null = null; // 保存监听器函数，用于清理
  private nodeConfig: NodeConfig; // 节点配置（用于指标收集配置）
  private aggregatorMiddleware: AggregatorMiddleware; // Aggregator 中间件（旧架构）
  private postProcessCoordinator: PostProcessCoordinator | null = null; // PostProcess 协调器（新架构）
  // 防止重复处理同一个job（只保留最近的两个job_id，用于检测相邻重复）
  private recentJobIds: string[] = [];

  // 模块化处理器
  private hardwareHandler: HardwareInfoHandler;
  private servicesHandler: ServicesHandler;
  private heartbeatHandler: HeartbeatHandler;
  private registrationHandler: RegistrationHandler;
  private jobProcessor: JobProcessor;
  private resultSender: ResultSender;

  constructor(
    inferenceService: InferenceService,
    modelManager?: any,
    serviceRegistryManager?: any,
    rustServiceManager?: any,
    pythonServiceManager?: any,
    semanticRepairServiceManager?: any
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
    this.semanticRepairServiceManager = semanticRepairServiceManager;

    // 初始化模块化处理器
    this.hardwareHandler = new HardwareInfoHandler();
    this.servicesHandler = new ServicesHandler(
      this.serviceRegistryManager,
      this.rustServiceManager,
      this.pythonServiceManager
    );

    // 初始化心跳处理器（需要先初始化其他handler）
    this.heartbeatHandler = new HeartbeatHandler(
      this.ws,
      this.nodeId,
      this.inferenceService,
      this.nodeConfig,
      () => this.servicesHandler.getInstalledServices(),
      (services) => this.servicesHandler.getCapabilityByType(services),
      (services) => this.servicesHandler.shouldCollectRerunMetrics(services),
      (services) => this.servicesHandler.shouldCollectASRMetrics(services)
    );

    // 初始化注册处理器
    this.registrationHandler = new RegistrationHandler(
      this.ws,
      this.nodeId,
      this.inferenceService,
      this.hardwareHandler,
      () => this.servicesHandler.getInstalledServices(),
      (services) => this.servicesHandler.getCapabilityByType(services)
    );

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
        },
      };
      this.postProcessCoordinator = new PostProcessCoordinator(
        aggregatorManager,
        taskRouter,
        this.servicesHandler,  // 传递ServicesHandler用于服务发现
        postProcessConfig
      );
      logger.info({}, 'PostProcessCoordinator initialized (new architecture)');
      
      // 将PostProcessCoordinator的DeduplicationHandler传递给PipelineOrchestrator（用于去重）
      if (this.postProcessCoordinator && this.inferenceService) {
        const deduplicationHandler = this.postProcessCoordinator.getDeduplicationHandler();
        (this.inferenceService as any).setDeduplicationHandler(deduplicationHandler);
        logger.info({}, 'DeduplicationHandler passed from PostProcessCoordinator to InferenceService');
      }
    }

    // S1: 将AggregatorManager传递给InferenceService（用于构建prompt）
    const aggregatorManager = (this.aggregatorMiddleware as any).manager;
    if (aggregatorManager && this.inferenceService) {
      (this.inferenceService as any).setAggregatorManager(aggregatorManager);
      logger.info({}, 'S1: AggregatorManager passed to InferenceService for prompt building');
    }

    // 将ServicesHandler传递给InferenceService（用于语义修复服务发现）
    if (this.servicesHandler && this.inferenceService) {
      (this.inferenceService as any).setServicesHandler(this.servicesHandler);
      logger.info({}, 'ServicesHandler passed to InferenceService for semantic repair');
    }

    // 将AggregatorMiddleware传递给InferenceService（用于在ASR之后、NMT之前进行文本聚合）
    if (this.aggregatorMiddleware && this.inferenceService) {
      (this.inferenceService as any).setAggregatorMiddleware(this.aggregatorMiddleware);
      logger.info({}, 'AggregatorMiddleware passed to InferenceService for pre-NMT aggregation');
    }

    // 初始化job处理器和结果发送器
    this.jobProcessor = new JobProcessor(
      this.inferenceService,
      this.postProcessCoordinator,
      this.aggregatorMiddleware,
      this.nodeConfig,
      this.pythonServiceManager
    );
    // 获取DedupStage实例，传递给ResultSender用于在成功发送后记录job_id
    const dedupStage = this.postProcessCoordinator?.getDedupStage() || null;
    this.resultSender = new ResultSender(
      this.aggregatorMiddleware,
      dedupStage,
      this.postProcessCoordinator  // 传递PostProcessCoordinator，用于更新lastSentText
    );

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
        logger.info({ schedulerUrl: this.schedulerUrl, nodeId: this.nodeId }, 'Connected to scheduler server, starting registration');
        // 更新handler的连接信息
        this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
        this.registrationHandler.updateConnection(this.ws, this.nodeId);
        // 更新job处理器和结果发送器的连接信息
        this.jobProcessor.updateConnection(this.ws, this.nodeId);
        this.resultSender.updateConnection(this.ws, this.nodeId);
        // 使用 Promise 确保注册完成后再启动心跳
        this.registrationHandler.registerNode().catch((error) => {
          logger.error({ error }, 'Failed to register node in open handler');
        });
        this.heartbeatHandler.startHeartbeat();
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
        logger.warn({
          code,
          reason: reason?.toString(),
          nodeId: this.nodeId,
          note: code === 1006 ? 'Abnormal closure - connection may have been lost during job processing' : 'Normal closure'
        }, 'Connection to scheduler server closed');
        this.heartbeatHandler.stopHeartbeat();
        // 连接关闭时，更新所有handler的连接信息（但保留nodeId用于重连）
        this.heartbeatHandler.updateConnection(null, this.nodeId);
        this.registrationHandler.updateConnection(null, this.nodeId);
        this.jobProcessor.updateConnection(null, this.nodeId);
        this.resultSender.updateConnection(null, this.nodeId);
        // 尝试重连
        setTimeout(() => {
          logger.info({ nodeId: this.nodeId }, 'Attempting to reconnect to scheduler server');
          this.start();
        }, 5000);
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
          this.heartbeatHandler.triggerImmediateHeartbeat();
        };
        this.modelManager.on('capability-state-changed', this.capabilityStateChangedHandler);
      }

      // 注册 Python 服务状态变化回调
      if (this.pythonServiceManager && typeof this.pythonServiceManager.setOnStatusChangeCallback === 'function') {
        this.pythonServiceManager.setOnStatusChangeCallback((serviceName: string, status: any) => {
          // 服务状态变化时，立即触发心跳（带防抖）
          logger.debug({ serviceName, running: status.running }, 'Python service status changed, triggering immediate heartbeat');
          this.heartbeatHandler.triggerImmediateHeartbeat();
        });
      }

      // 注册语义修复服务状态变化回调
      if (this.semanticRepairServiceManager && typeof this.semanticRepairServiceManager.setOnStatusChangeCallback === 'function') {
        this.semanticRepairServiceManager.setOnStatusChangeCallback((serviceId: string, status: any) => {
          // 语义修复服务状态变化时，立即触发心跳（带防抖）
          // 语义修复服务的变化会影响语言能力，需要重新检测并上报
          logger.info({ 
            serviceId, 
            running: status.running,
            starting: status.starting,
            port: status.port
          }, '语义修复服务状态变化，触发立即心跳以更新语言能力：serviceId={}, running={}', serviceId, status.running);
          this.heartbeatHandler.triggerImmediateHeartbeat();
        });
      }
    } catch (error) {
      logger.error({ error }, 'Failed to start Node Agent');
    }
  }

  stop(): void {
    this.heartbeatHandler.stopHeartbeat();
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


  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'node_register_ack': {
          const ack = message as NodeRegisterAckMessage;
          this.nodeId = ack.node_id;
          // 更新所有handler的nodeId（确保它们有正确的nodeId和WebSocket连接）
          this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
          this.registrationHandler.updateConnection(this.ws, this.nodeId);
          this.jobProcessor.updateConnection(this.ws, this.nodeId);
          this.resultSender.updateConnection(this.ws, this.nodeId);
          logger.info({ nodeId: this.nodeId }, 'Node registered successfully');
          // 立刻补发一次心跳，把 installed_services/capability_state 尽快同步到 Scheduler
          this.heartbeatHandler.sendHeartbeatOnce().catch((error) => {
            logger.warn({ error }, 'Failed to send immediate heartbeat after node_register_ack');
          });
          break;
        }

        case 'job_assign': {
          const job = message as JobAssignMessage;
          // 诊断：记录接收到的 audio_format（用于调试为什么会出现空值）
          logger.info(
            {
              jobId: job.job_id,
              traceId: job.trace_id,
              audioFormat: job.audio_format,
              audioFormatType: typeof job.audio_format,
              audioFormatLength: job.audio_format?.length,
              hasAudioFormat: 'audio_format' in job,
              messageKeys: Object.keys(job),
            },
            'Received job_assign message, checking audio_format field'
          );
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
      // 使用job处理器处理job
      const processStartTime = Date.now();
      const processResult = await this.jobProcessor.processJob(job, startTime);
      const processDuration = Date.now() - processStartTime;

      if (processDuration > 30000) {
        logger.warn({
          jobId: job.job_id,
          processDurationMs: processDuration,
          note: 'Job processing took longer than 30 seconds',
        }, 'Long job processing time detected');
      }

      // 使用结果发送器发送结果
      if (!processResult.shouldSend) {
        // PostProcessCoordinator决定不发送，发送空结果
        this.resultSender.sendJobResult(job, processResult.finalResult, startTime, false, processResult.reason);
        return;
      }

      this.resultSender.sendJobResult(job, processResult.finalResult, startTime, true);
    } catch (error) {
      this.resultSender.sendErrorResult(job, error, startTime);
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

