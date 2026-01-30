/**
 * Node Agent (简化版)
 * 使用 ServiceRegistry 替代复杂的服务管理逻辑
 */

import WebSocket from 'ws';
import { InferenceService, JobResult } from '../inference/inference-service';
import {
  NodeRegisterAckMessage,
  JobAssignMessage,
  JobCancelMessage,
  InstalledService,
} from '../../../../shared/protocols/messages';
import { ModelNotAvailableError } from '../model-manager/model-manager';
import { loadNodeConfig, type NodeConfig } from '../node-config';
import logger from '../logger';
import { ServicesHandlerSimple } from './node-agent-services-simple';
import { HeartbeatHandler } from './node-agent-heartbeat';
import { RegistrationHandler } from './node-agent-registration';
import { HardwareInfoHandler } from './node-agent-hardware';
import { ResourceUsage } from '../service-layer/ServiceSnapshots';
import { ResultSender } from './node-agent-result-sender';
import { AggregatorMiddleware, type AggregatorMiddlewareConfig } from './aggregator-middleware';
import { JobProcessor } from './node-agent-job-processor';
import { SessionAffinityManager } from '../pipeline-orchestrator/session-affinity-manager';

export interface NodeStatus {
  online: boolean;
  nodeId: string | null;
  connected: boolean;
  lastHeartbeat: Date | null;
}

/** 单次发送项：job + result + shouldSend + reason */
export type ResultToSendItem = {
  job: JobAssignMessage;
  result: JobResult;
  shouldSend: boolean;
  reason?: string;
};

/**
 * 构建待发送结果列表：主结果 + 空容器核销（NO_TEXT_ASSIGNED）。
 * 同一 job_id 只出现一次；pendingEmptyJobs 中与主 job 重复或彼此重复的项会被跳过。
 */
export function buildResultsToSend(
  job: JobAssignMessage,
  processResult: { finalResult: JobResult; shouldSend: boolean; reason?: string }
): ResultToSendItem[] {
  const list: ResultToSendItem[] = [
    {
      job,
      result: processResult.finalResult,
      shouldSend: processResult.shouldSend,
      reason: processResult.reason,
    },
  ];
  const seenJobIds = new Set<string>([job.job_id]);
  const pendingEmptyJobs = (processResult.finalResult.extra as any)?.pendingEmptyJobs as
    | { job_id: string; utterance_index: number }[]
    | undefined;
  if (processResult.shouldSend && pendingEmptyJobs?.length) {
    const emptyResult: JobResult = {
      text_asr: '',
      text_translated: '',
      tts_audio: '',
      should_send: true,
      extra: { reason: 'NO_TEXT_ASSIGNED' },
    };
    for (const empty of pendingEmptyJobs) {
      if (seenJobIds.has(empty.job_id)) continue;
      seenJobIds.add(empty.job_id);
      list.push({
        job: { ...job, job_id: empty.job_id, utterance_index: empty.utterance_index },
        result: emptyResult,
        shouldSend: true,
        reason: 'NO_TEXT_ASSIGNED',
      });
    }
  }
  return list;
}

export class NodeAgent {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;
  private schedulerUrl: string;
  private inferenceService: InferenceService;
  private modelManager: any; // ModelManager 实例
  private nodeConfig: NodeConfig;
  
  /** 已处理过的 job_id，每个 job_id 只处理一次，杜绝 DUP_SEND */
  private processedJobIds: Set<string> = new Set();
  /** 同一 (session_id, utterance_index) 只接受一个 job，杜绝同一 ui 双 Job */
  private sessionUtteranceToJobId: Map<string, string> = new Map();

  // ✅ Day 2: 快照函数替代Manager依赖
  private getServiceSnapshot: () => InstalledService[];
  private getResourceSnapshot: () => ResourceUsage;

  // 模块化处理器
  private hardwareHandler: HardwareInfoHandler;
  private servicesHandler: ServicesHandlerSimple;
  private heartbeatHandler: HeartbeatHandler;
  private registrationHandler: RegistrationHandler;
  private jobProcessor: JobProcessor;
  private resultSender: ResultSender;

  /**
   * ✅ Day 2 Refactor: 新的构造函数签名
   * - 删除 rustServiceManager 和 pythonServiceManager
   * - 使用快照函数代替
   */
  constructor(
    inferenceService: InferenceService,
    modelManager: any,
    getServiceSnapshot: () => InstalledService[],
    getResourceSnapshot: () => ResourceUsage
  ) {
    // 加载配置
    this.nodeConfig = loadNodeConfig();
    this.schedulerUrl =
      this.nodeConfig.scheduler?.url ||
      process.env.SCHEDULER_URL ||
      'ws://127.0.0.1:5010/ws/node';
    
    this.inferenceService = inferenceService;
    this.modelManager = modelManager || (inferenceService as any).modelManager;
    
    // ✅ Day 2: 保存快照函数
    this.getServiceSnapshot = getServiceSnapshot;
    this.getResourceSnapshot = getResourceSnapshot;

    // 初始化模块化处理器
    this.hardwareHandler = new HardwareInfoHandler();
    this.servicesHandler = new ServicesHandlerSimple(() => this.getServiceSnapshot());

    // 初始化心跳处理器
    this.heartbeatHandler = new HeartbeatHandler(
      this.ws,
      this.nodeId,
      this.inferenceService,
      this.nodeConfig,
      async () => this.getServiceSnapshot(),  // ✅ 包装为async
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
      async () => this.getServiceSnapshot(),  // ✅ 包装为async
      (services) => this.servicesHandler.getCapabilityByType(services)
    );

    // 初始化 JobProcessor（处理流式 ASR、TTS 编码等）
    this.jobProcessor = new JobProcessor(
      this.inferenceService,
      this.nodeConfig,
      null  // pythonServiceManager 在简化架构中为 null
    );

    // 初始化 AggregatorMiddleware（启用文本聚合，与备份代码一致）
    // 从 InferenceService 获取 TaskRouter（用于重新触发 NMT）
    const taskRouter = (this.inferenceService as any).taskRouter;
    const aggregatorConfig: AggregatorMiddlewareConfig = {
      enabled: true,  // ✅ 启用 AggregatorMiddleware（与备份代码一致）
      mode: 'offline',  // 默认 offline，可以根据 job 动态调整
      ttlMs: 5 * 60 * 1000,  // 5 分钟 TTL（与备份代码一致）
      maxSessions: 500,  // 降低最大会话数（从 1000 降低到 500，减少内存占用，与备份代码一致）
      translationCacheSize: 200,  // 翻译缓存大小：最多 200 条（提高缓存命中率，与备份代码一致）
      translationCacheTtlMs: 10 * 60 * 1000,  // 翻译缓存过期时间：10 分钟（提高缓存命中率，与备份代码一致）
      enableAsyncRetranslation: true,  // 异步重新翻译（默认启用，长文本使用异步处理，与备份代码一致）
      asyncRetranslationThreshold: 50,  // 异步重新翻译阈值（文本长度，默认 50 字符，与备份代码一致）
    };
    const aggregatorMiddleware = new AggregatorMiddleware(aggregatorConfig, taskRouter);
    this.resultSender = new ResultSender(aggregatorMiddleware);

    // ✅ 关键修复：提取 AggregatorManager 并传递给 InferenceService（与备份代码一致）
    const aggregatorManager = (aggregatorMiddleware as any).manager;
    if (aggregatorManager && this.inferenceService) {
      this.inferenceService.setAggregatorManager(aggregatorManager);
      logger.info({}, 'S1: AggregatorManager passed to InferenceService for prompt building');
    }

    // ✅ 关键修复：将 AggregatorMiddleware 传递给 InferenceService（与备份代码一致）
    if (aggregatorMiddleware && this.inferenceService) {
      this.inferenceService.setAggregatorMiddleware(aggregatorMiddleware);
      logger.info({}, 'AggregatorMiddleware passed to InferenceService for pre-NMT aggregation');
    }

    // ✅ 关键修复：将 ResultSender 注入到 InferenceService，用于音频聚合后发送原始job的结果
    this.inferenceService.setResultSender(this.resultSender);

    // 注入 ServicesHandler，用于语义修复服务发现与 SemanticRepairInitializer 创建
    this.inferenceService.setServicesHandler(this.servicesHandler);

    logger.info({ schedulerUrl: this.schedulerUrl }, '✅ NodeAgent initialized (Day 2 Refactor: snapshot-based)');
  }

  async start(): Promise<void> {
    try {
      // 如果已有连接，先关闭
      if (this.ws) {
        this.stop();
      }

      this.ws = new WebSocket(this.schedulerUrl);

      this.ws.on('open', () => {
        logger.info(
          { schedulerUrl: this.schedulerUrl, nodeId: this.nodeId },
          'Connected to scheduler server'
        );

        // 更新handler的连接信息
        this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
        this.registrationHandler.updateConnection(this.ws, this.nodeId);
        this.jobProcessor.updateConnection(this.ws, this.nodeId);
        this.resultSender.updateConnection(this.ws, this.nodeId);

        // 发起节点注册
        this.registrationHandler.registerNode().catch((error) => {
          logger.error({ error }, 'Failed to register node');
        });

        // 启动心跳
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
        logger.warn(
          {
            code,
            reason: reason?.toString(),
            nodeId: this.nodeId,
          },
          'Connection to scheduler server closed'
        );

        this.heartbeatHandler.stopHeartbeat();
        this.heartbeatHandler.updateConnection(null, this.nodeId);
        this.registrationHandler.updateConnection(null, this.nodeId);
        this.jobProcessor.updateConnection(null, this.nodeId);
        this.resultSender.updateConnection(null, this.nodeId);

        // 尝试重连
        setTimeout(() => {
          logger.info({ nodeId: this.nodeId }, 'Attempting to reconnect to scheduler');
          this.start();
        }, 5000);
      });

      // 监听模型状态变化
      if (this.modelManager && typeof this.modelManager.on === 'function') {
        this.modelManager.on('capability-state-changed', () => {
          logger.debug({}, 'Model state changed, triggering immediate heartbeat');
          this.heartbeatHandler.triggerImmediateHeartbeat();
        });
      }

      // ✅ Day 2: 移除Python服务管理器监听
      // 服务状态变化现在通过ServiceRegistry的事件系统处理
      logger.debug({}, 'Service status monitoring via ServiceRegistry')
    } catch (error) {
      logger.error({ error }, 'Failed to start NodeAgent');
    }
  }

  stop(): void {
    this.heartbeatHandler.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async handleMessage(data: string): Promise<void> {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'node_register_ack': {
          const ack = message as NodeRegisterAckMessage;
          this.nodeId = ack.node_id;
          
          // 更新所有handler的nodeId
          this.heartbeatHandler.updateConnection(this.ws, this.nodeId);
          this.registrationHandler.updateConnection(this.ws, this.nodeId);
          this.jobProcessor.updateConnection(this.ws, this.nodeId);
          this.resultSender.updateConnection(this.ws, this.nodeId);
          
          // ✅ 关键修复：更新SessionAffinityManager的nodeId（用于超时finalize的session affinity）
          SessionAffinityManager.getInstance().setNodeId(this.nodeId);
          
          logger.info({ nodeId: this.nodeId }, 'Node registered successfully');
          
          // 立即发送一次心跳
          this.heartbeatHandler.sendHeartbeatOnce().catch((error) => {
            logger.warn({ error }, 'Failed to send immediate heartbeat after registration');
          });
          break;
        }

        case 'job_assign': {
          const job = message as JobAssignMessage;
          logger.info(
            {
              jobId: job.job_id,
              traceId: job.trace_id,
              audioFormat: job.audio_format,
            },
            'Received job_assign message'
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

        default:
          logger.warn({ messageType: message.type }, 'Unknown message type');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to handle message');
    }
  }

  private async handleJob(job: JobAssignMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.nodeId) {
      logger.warn(
        { jobId: job.job_id, wsState: this.ws?.readyState, nodeId: this.nodeId },
        'Cannot handle job: WebSocket not ready'
      );
      return;
    }

    const startTime = Date.now();

    // 架构约束：每个 job_id 只处理一次，杜绝 DUP_SEND
    if (this.processedJobIds.has(job.job_id)) {
      logger.warn(
        { jobId: job.job_id, sessionId: job.session_id, utteranceIndex: job.utterance_index },
        'Rejecting duplicate job_id: already processed (at most one processing per job_id)'
      );
      this.resultSender.sendErrorResult(
        job,
        new Error('DUPLICATE_JOB_ID: job_id already processed by this node'),
        startTime
      );
      return;
    }

    // 架构约束：同一 (session_id, utterance_index) 只接受一个 job，杜绝同一 ui 双 Job
    const sessionUtteranceKey = `${job.session_id}:${job.utterance_index ?? -1}`;
    const existingJobId = this.sessionUtteranceToJobId.get(sessionUtteranceKey);
    if (existingJobId !== undefined) {
      logger.warn(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          existingJobId,
        },
        'Rejecting duplicate (session_id, utterance_index): only one job accepted per utterance slot'
      );
      this.resultSender.sendErrorResult(
        job,
        new Error('DUPLICATE_UTTERANCE_INDEX: another job already accepted for this session_id and utterance_index'),
        startTime
      );
      return;
    }

    this.processedJobIds.add(job.job_id);
    this.sessionUtteranceToJobId.set(sessionUtteranceKey, job.job_id);
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
      // 使用 JobProcessor 处理 job（包含流式 ASR、TTS 编码等）
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

      // 唯一发送路径：processJob → buildResultsToSend → send loop（直线型，无分支语义）
      const resultsToSend = buildResultsToSend(job, processResult);
      const planId = String(Date.now() % 1e6);
      const planItems = resultsToSend.map((item, idx) => ({
        idx,
        job_id: item.job.job_id,
        reason: item.reason ?? (item.result.extra as any)?.reason ?? (item.result as any).dedup_reason ?? '',
        shouldSend: item.shouldSend,
        isEmptyJob: !(item.result.text_asr || '').trim().length || (item.result.extra as any)?.reason === 'NO_TEXT_ASSIGNED',
      }));
      const planFingerprint = planItems.map((i) => `${i.job_id}|${i.reason}|${i.isEmptyJob}`).join(',');
      logger.info(
        { tag: 'SEND_PLAN', job_id: job.job_id, planId, items: planItems, planFingerprint },
        'SEND_PLAN'
      );

      let attemptSeq = 0;
      const total = resultsToSend.length;
      for (let idx = 0; idx < resultsToSend.length; idx++) {
        const { job: j, result: r, shouldSend: s, reason } = resultsToSend[idx];
        const attemptReason = reason ?? (r.extra as any)?.reason ?? (r as any).dedup_reason;
        attemptSeq += 1;
        logger.info(
          {
            tag: 'SEND_ATTEMPT',
            planId,
            idx,
            total,
            job_id: j.job_id,
            reason: attemptReason,
            attemptSeq,
            callSite: 'node-agent.handleJob.loop',
          },
          'SEND_ATTEMPT'
        );
        this.resultSender.sendJobResult(j, r, startTime, s, reason ?? (r.extra as any)?.reason ?? (r as any).dedup_reason);
        logger.info(
          { tag: 'SEND_DONE', planId, attemptSeq, ok: true },
          'SEND_DONE'
        );
      }
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

  /**
   * 清理 Session（同时清除该 session 的 utterance 槽位记录，便于同一 session 重连后可重新使用 utterance_index）
   */
  removeSession(sessionId: string): void {
    this.inferenceService.removeSession(sessionId);
    for (const key of this.sessionUtteranceToJobId.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.sessionUtteranceToJobId.delete(key);
      }
    }
  }
}
