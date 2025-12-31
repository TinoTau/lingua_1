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
        // 更新handler的连接信息
        this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
        this.registrationHandler.updateConnection(this.ws, this.nodeId);
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
        logger.info({ code, reason: reason?.toString() }, 'Connection to scheduler server closed');
        this.heartbeatHandler.stopHeartbeat();
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
          // 更新handler的nodeId
          this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
          this.registrationHandler.updateConnection(this.ws, this.nodeId);
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
          // 修复：即使PostProcessCoordinator决定不发送（shouldSend=false），仍然需要发送空的job_result给调度服务器
          // 这样调度服务器知道节点端已经处理完成，不会触发超时
          // 调度服务器的result_queue会处理空结果，不会发送给客户端
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              reason: postProcessResult.reason || 'PostProcessCoordinator filtered result',
              aggregatedText: postProcessResult.aggregatedText?.substring(0, 50) || '',
              aggregatedTextLength: postProcessResult.aggregatedText?.length || 0,
              note: 'Sending empty job_result to scheduler to prevent timeout (result filtered by PostProcessCoordinator)',
            },
            'PostProcessCoordinator filtered result (shouldSend=false), but sending empty job_result to scheduler to prevent timeout'
          );
          
          // 发送空的job_result给调度服务器，用于核销job，避免超时
          const emptyResponse: JobResultMessage = {
            type: 'job_result',
            job_id: job.job_id,
            attempt_id: job.attempt_id,
            node_id: this.nodeId,
            session_id: job.session_id,
            utterance_index: job.utterance_index,
            success: true,
            text_asr: '',
            text_translated: '',
            tts_audio: '',
            tts_format: 'opus',
            processing_time_ms: Date.now() - startTime,
            trace_id: job.trace_id,
            extra: {
              filtered: true,
              reason: postProcessResult.reason || 'PostProcessCoordinator filtered result',
            },
          };
          
          this.ws.send(JSON.stringify(emptyResponse));
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
            },
            'Empty job_result sent to scheduler (filtered by PostProcessCoordinator) to prevent timeout'
          );
          return;  // 返回，不继续处理
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

