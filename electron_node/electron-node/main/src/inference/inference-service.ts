import { ModelManager } from '../model-manager/model-manager';
import type { JobAssignMessage, InstalledModel, FeatureFlags } from '@shared/protocols/messages';
import logger from '../logger';
import { TaskRouter } from '../task-router/task-router';
import { runJobPipeline, ServicesBundle } from '../pipeline/job-pipeline';
import { initJobContext } from '../pipeline/context/job-context';
import { SessionContextManager } from '../pipeline-orchestrator/session-context-manager';
import { ServiceRegistry } from '../service-layer/ServiceTypes';
import { getInstalledModelsAsProtocol } from './inference-service-models';
import { waitForServicesReady } from './inference-service-ready';

export interface JobResult {
  text_asr: string;
  text_translated: string;
  tts_audio: string; // base64 encoded TTS audio
  tts_format?: string;
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    language_probability?: number | null;  // 新增：检测到的语言的概率（0.0-1.0）
    language_probabilities?: Record<string, number> | null;  // 新增：所有语言的概率信息（字典：语言代码 -> 概率）
    [key: string]: unknown;
  };
  /** OBS-2: ASR 质量信息 */
  asr_quality_level?: 'good' | 'suspect' | 'bad';
  reason_codes?: string[];
  quality_score?: number;  // 0.0-1.0
  rerun_count?: number;
  segments_meta?: {
    count: number;
    max_gap: number;  // 最大间隔（秒）
    avg_duration: number;  // 平均时长（秒）
  };
  segments?: Array<{  // 传递 segments 信息给中间件使用
    text: string;
    start?: number;
    end?: number;
    no_speech_prob?: number;
  }>;
  /** 文本聚合相关字段 */
  aggregation_applied?: boolean;  // 是否应用了文本聚合
  aggregation_action?: 'MERGE' | 'NEW_STREAM' | 'COMMIT';  // 聚合动作
  is_last_in_merged_group?: boolean;  // 是否是合并组中的最后一个 utterance
  aggregation_metrics?: {
    dedupCount?: number;
    dedupCharsRemoved?: number;
  };
  /** 语义修复相关字段 */
  semantic_repair_applied?: boolean;  // 是否应用了语义修复
  semantic_repair_confidence?: number;  // 语义修复置信度
  text_asr_repaired?: string;  // 语义修复后的 ASR 文本（如果应用了修复）
  /** 去重相关字段 */
  should_send?: boolean;  // 是否应该发送（去重检查结果）
  dedup_reason?: string;  // 去重原因（如果 should_send=false）
}

export interface PartialResultCallback {
  (partial: { text: string; is_final: boolean; confidence: number }): void;
}

export class InferenceService {
  private modelManager: ModelManager;
  private currentJobs: Set<string> = new Set();
  private hasProcessedFirstJob: boolean = false; // 跟踪是否已经处理过第一个 job
  private onTaskProcessedCallback: ((serviceName: string) => void) | null = null;
  private onTaskStartCallback: (() => void) | null = null;
  private onTaskEndCallback: (() => void) | null = null;

  // 新架构组件
  private taskRouter: TaskRouter;
  private servicesBundle: ServicesBundle;
  private sessionContextManager: SessionContextManager;
  // S1: AggregatorManager引用（可选，用于构建prompt）
  private aggregatorManager: any = null;
  // AggregatorMiddleware引用（可选，用于在ASR之后、NMT之前进行文本聚合）
  private aggregatorMiddleware: any = null;

  constructor(
    modelManager: ModelManager,
    registry: ServiceRegistry,
    aggregatorManager?: any,  // S1: 可选的AggregatorManager（仅用于构建prompt）
    aggregatorMiddleware?: any,  // 已废弃：不再传递给PipelineOrchestrator，但保留参数以兼容旧代码
    servicesHandler?: any  // 可选的ServicesHandler（用于语义修复服务发现）
  ) {
    this.modelManager = modelManager;

    // 初始化新架构组件（必需）
    this.taskRouter = new TaskRouter(registry);

    // S1: 保存引用
    this.aggregatorManager = aggregatorManager;
    this.aggregatorMiddleware = aggregatorMiddleware;

    // 初始化 SessionContextManager
    this.sessionContextManager = new SessionContextManager();
    this.sessionContextManager.setTaskRouter(this.taskRouter);

    // 初始化 DedupStage（全局实例，用于维护 job_id 去重状态）
    const { DedupStage } = require('../agent/postprocess/dedup-stage');
    const dedupStage = new DedupStage();

    // 初始化 AudioAggregator（用于在job之间共享音频缓冲区）
    const { AudioAggregator } = require('../pipeline-orchestrator/audio-aggregator');
    const audioAggregator = new AudioAggregator();

    // 兜底清理：仅用于用户断线导致 turn 永远收不到 manual/timeout finalize 的孤儿 buffer。
    // cleanupExpiredBuffers 内部按空闲 > 5 分钟清理并打日志，每 1 分钟检查一次。
    const CLEANUP_INTERVAL_MS = 60 * 1000;
    setInterval(() => {
      try {
        audioAggregator.cleanupExpiredBuffers();
      } catch (err) {
        logger.warn({ err }, 'AudioAggregator cleanupExpiredBuffers error');
      }
    }, CLEANUP_INTERVAL_MS);

    // 初始化 servicesBundle
    // 初始化SemanticRepairInitializer（如果servicesHandler可用）
    let semanticRepairInitializer: any = null;
    if (servicesHandler) {
      const { SemanticRepairInitializer } = require('../agent/postprocess/postprocess-semantic-repair-initializer');
      semanticRepairInitializer = new SemanticRepairInitializer(this.taskRouter);
      // 异步初始化（不等待完成，让第一次使用时再等待）
      semanticRepairInitializer.initialize().catch((error: any) => {
        logger.error({ error: error.message }, 'Failed to initialize SemanticRepairInitializer');
      });
    }

    this.servicesBundle = {
      taskRouter: this.taskRouter,
      aggregatorManager: aggregatorManager || null,
      servicesHandler: servicesHandler || null,
      deduplicationHandler: null, // 将在运行时通过 setDeduplicationHandler 设置
      sessionContextManager: this.sessionContextManager,
      aggregatorMiddleware: aggregatorMiddleware || null,
      dedupStage: dedupStage,
      audioAggregator: audioAggregator,
      semanticRepairInitializer: semanticRepairInitializer,
    };

    // 异步初始化服务端点
    this.taskRouter.initialize().catch((error) => {
      logger.error({ error }, 'Failed to initialize TaskRouter');
    });
  }

  /**
   * S1: 设置AggregatorManager（用于动态更新）
   */
  setAggregatorManager(aggregatorManager: any): void {
    this.aggregatorManager = aggregatorManager;
    this.servicesBundle.aggregatorManager = aggregatorManager;
    logger.info({}, 'InferenceService: AggregatorManager updated');
  }

  /**
   * 设置ServicesHandler（用于语义修复服务发现）
   */
  setServicesHandler(servicesHandler: any): void {
    this.servicesBundle.servicesHandler = servicesHandler;
    
    // 创建SemanticRepairInitializer（如果servicesHandler可用）
    if (servicesHandler && !this.servicesBundle.semanticRepairInitializer) {
      const { SemanticRepairInitializer } = require('../agent/postprocess/postprocess-semantic-repair-initializer');
      const semanticRepairInitializer = new SemanticRepairInitializer(this.taskRouter);
      // 异步初始化（不等待完成，让第一次使用时再等待）
      semanticRepairInitializer.initialize().catch((error: any) => {
        logger.error({ error: error.message }, 'Failed to initialize SemanticRepairInitializer');
      });
      this.servicesBundle.semanticRepairInitializer = semanticRepairInitializer;
    }
    
    logger.info({}, 'InferenceService: ServicesHandler updated');
  }

  /**
   * 设置DeduplicationHandler（用于去重）
   */
  setDeduplicationHandler(deduplicationHandler: any): void {
    this.servicesBundle.deduplicationHandler = deduplicationHandler;
    logger.info({}, 'InferenceService: DeduplicationHandler updated');
  }

  /**
   * 设置AggregatorMiddleware（用于去重时获取lastSentText）
   */
  setAggregatorMiddleware(aggregatorMiddleware: any): void {
    this.aggregatorMiddleware = aggregatorMiddleware;
    this.servicesBundle.aggregatorMiddleware = aggregatorMiddleware;
    logger.info({}, 'InferenceService: AggregatorMiddleware updated');
  }

  /**
   * 设置ResultSender（用于在音频聚合后发送原始job的结果）
   */
  setResultSender(resultSender: any): void {
    this.servicesBundle.resultSender = resultSender;
    logger.info({}, 'InferenceService: ResultSender updated');
  }

  /**
   * 清理 Session（统一入口）
   */
  removeSession(sessionId: string): void {
    this.servicesBundle.aggregatorManager?.removeSession(sessionId);
    this.servicesBundle.deduplicationHandler?.removeSession(sessionId);
    this.servicesBundle.servicesHandler?.removeSession?.(sessionId);
    this.servicesBundle.sessionContextManager?.removeSession?.(sessionId);
    this.servicesBundle.dedupStage?.removeSession?.(sessionId);
    logger.info({ sessionId }, 'InferenceService: Session removed from all components');
  }

  /**
   * 获取 DedupStage 实例（用于在成功发送后记录job_id）
   */
  getDedupStage() {
    return this.servicesBundle.dedupStage;
  }

  setOnTaskProcessedCallback(callback: (serviceName: string) => void): void {
    this.onTaskProcessedCallback = callback;
  }

  setOnTaskStartCallback(callback: () => void): void {
    this.onTaskStartCallback = callback;
  }

  setOnTaskEndCallback(callback: () => void): void {
    this.onTaskEndCallback = callback;
  }

  /**
   * Gate-B: 获取 Rerun 指标（用于上报）
   */
  getRerunMetrics() {
    return this.taskRouter.getRerunMetrics?.() || {
      totalReruns: 0,
      successfulReruns: 0,
      failedReruns: 0,
      timeoutReruns: 0,
      qualityImprovements: 0,
    };
  }


  /**
   * OBS-1: 获取处理效率指标（按服务ID分组）
   * @returns Record<serviceId, efficiency>
   */
  getProcessingMetrics(): Record<string, number> {
    return this.taskRouter.getProcessingMetrics?.() || {};
  }

  /**
   * OBS-1: 获取指定服务ID的处理效率
   * @param serviceId 服务ID
   * @returns 处理效率，如果该服务在心跳周期内没有任务则为 null
   */
  getServiceEfficiency(serviceId: string): number | null {
    return this.taskRouter.getServiceEfficiency?.(serviceId) || null;
  }


  /**
   * OBS-1: 重置当前心跳周期的处理效率指标（所有服务）
   * 在心跳发送后调用，清空当前周期的数据
   */
  resetProcessingMetrics(): void {
    this.taskRouter.resetCycleMetrics?.();
  }

  async processJob(job: JobAssignMessage, partialCallback?: PartialResultCallback): Promise<JobResult> {
    const wasFirstJob = !this.hasProcessedFirstJob;
    this.currentJobs.add(job.job_id);

    // 如果是第一个任务（节点启动后的第一个），等待服务就绪
    if (wasFirstJob) {
      this.hasProcessedFirstJob = true;
      logger.info({ jobId: job.job_id }, 'First job detected, waiting for services to be ready');
      await waitForServicesReady(this.taskRouter, 5000);
    }

    // 如果是第一个任务，通知任务开始（用于启动GPU跟踪）
    if (wasFirstJob && this.onTaskStartCallback) {
      this.onTaskStartCallback();
    }

    try {
      // 刷新服务端点列表（带缓存机制，避免频繁刷新）
      // 注意：首次任务已在 waitForServicesReady() 中强制刷新，这里使用缓存即可
      await this.taskRouter.refreshServiceEndpoints();

      // 使用新的 JobPipeline
      const result = await runJobPipeline({
        job,
        partialCallback,
        asrCompletedCallback: (asrCompleted: boolean) => {
          // ASR 完成回调：从 currentJobs 中移除，释放 ASR 服务容量
          if (asrCompleted) {
            this.currentJobs.delete(job.job_id);
            logger.debug({ jobId: job.job_id }, 'ASR completed, removed from currentJobs to free ASR service capacity');

            // 如果这是最后一个任务，通知任务结束（用于停止GPU跟踪）
            if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
              this.onTaskEndCallback();
            }
          }
        },
        services: this.servicesBundle,
        callbacks: {
          onTaskStart: this.onTaskStartCallback || undefined,
          onTaskEnd: this.onTaskEndCallback || undefined,
          onTaskProcessed: this.onTaskProcessedCallback || undefined,
        },
      });

      return result;
    } catch (error) {
      logger.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Pipeline orchestration failed');
      throw error;
    } finally {
      // 确保任务从 currentJobs 中移除（如果 ASR 完成回调没有执行）
      if (this.currentJobs.has(job.job_id)) {
        this.currentJobs.delete(job.job_id);

        // 如果没有任务了，通知任务结束（用于停止GPU跟踪）
        if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
          this.onTaskEndCallback();
        }
      }
    }
  }

  /**
   * 使用模拟 ASR 文本跑完整 pipeline（聚合 → 语义修复 → 去重 → NMT），用于联调与测试。
   * 跳过 ASR 步骤，直接以 asrText 作为本段输入。
   */
  async runPipelineWithMockAsr(
    asrText: string,
    srcLang: string = 'zh',
    tgtLang: string = 'en'
  ): Promise<JobResult> {
    const job: JobAssignMessage = {
      job_id: `mock-asr-${Date.now()}`,
      session_id: 'mock-session',
      utterance_index: 0,
      src_lang: srcLang,
      tgt_lang: tgtLang,
      lang_a: srcLang,
      lang_b: tgtLang,
      pipeline: { use_asr: true, use_nmt: true, use_tts: false },
    } as JobAssignMessage;

    const ctx = initJobContext(job);
    ctx.asrText = asrText;

    await this.taskRouter.refreshServiceEndpoints();

    return runJobPipeline({
      job,
      services: this.servicesBundle,
      ctx,
    });
  }

  /**
   * 取消任务
   * 注意：取消不保证推理服务一定立刻停止（取决于下游实现）
   */
  cancelJob(jobId: string): boolean {
    // 尝试通过 TaskRouter 取消任务（中断 HTTP 请求）
    const cancelled = this.taskRouter.cancelJob(jobId);
    // 从 currentJobs 中移除任务
    if (this.currentJobs.has(jobId)) {
      this.currentJobs.delete(jobId);
      // 如果没有任务了，通知任务结束（用于停止GPU跟踪）
      if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
        this.onTaskEndCallback();
      }
      return true;
    }
    return cancelled;
  }

  getCurrentJobCount(): number {
    return this.currentJobs.size;
  }

  async getInstalledModels(): Promise<InstalledModel[]> {
    return getInstalledModelsAsProtocol(this.modelManager);
  }

  getFeaturesSupported(): FeatureFlags {
    // TODO: 根据实际安装的模型和启用的模块返回支持的功能
    // 这里返回一个示例，实际应该根据模型和模块状态动态生成
    return {
      emotion_detection: false,
      voice_style_detection: false,
      speech_rate_detection: false,
      speech_rate_control: false,
      speaker_identification: false,
      persona_adaptation: false,
    };
  }
}

