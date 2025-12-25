import { ModelManager } from '../model-manager/model-manager';
import type { JobAssignMessage, InstalledModel, FeatureFlags } from '@shared/protocols/messages';
import logger from '../logger';
import { TaskRouter } from '../task-router/task-router';
import { PipelineOrchestrator } from '../pipeline-orchestrator/pipeline-orchestrator';

export interface JobResult {
  text_asr: string;
  text_translated: string;
  tts_audio: string; // base64 encoded TTS audio
  tts_format?: string;
  extra?: {
    emotion?: string | null;
    speech_rate?: number | null;
    voice_style?: string | null;
    [key: string]: unknown;
  };
}

export interface PartialResultCallback {
  (partial: { text: string; is_final: boolean; confidence: number }): void;
}

export class InferenceService {
  private modelManager: ModelManager;
  private currentJobs: Set<string> = new Set();
  private onTaskProcessedCallback: ((serviceName: string) => void) | null = null;
  private onTaskStartCallback: (() => void) | null = null;
  private onTaskEndCallback: (() => void) | null = null;
  
  // 新架构组件
  private taskRouter: TaskRouter;
  private pipelineOrchestrator: PipelineOrchestrator;

  constructor(
    modelManager: ModelManager,
    pythonServiceManager: any,
    rustServiceManager: any,
    serviceRegistryManager: any
  ) {
    this.modelManager = modelManager;

    // 初始化新架构组件（必需）
    if (!pythonServiceManager || !rustServiceManager || !serviceRegistryManager) {
      throw new Error('TaskRouter requires pythonServiceManager, rustServiceManager, and serviceRegistryManager');
    }

    this.taskRouter = new TaskRouter(pythonServiceManager, rustServiceManager, serviceRegistryManager);
    this.pipelineOrchestrator = new PipelineOrchestrator(this.taskRouter);
    
    // 异步初始化服务端点
    this.taskRouter.initialize().catch((error) => {
      logger.error({ error }, 'Failed to initialize TaskRouter');
    });
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

  async processJob(job: JobAssignMessage, partialCallback?: PartialResultCallback): Promise<JobResult> {
    const wasFirstJob = this.currentJobs.size === 0;
    this.currentJobs.add(job.job_id);
    
    // 如果是第一个任务，通知任务开始（用于启动GPU跟踪）
    if (wasFirstJob && this.onTaskStartCallback) {
      this.onTaskStartCallback();
    }

    try {
      // 刷新服务端点列表（确保使用最新的服务状态）
      await this.taskRouter.refreshServiceEndpoints();
      
      // 优化：ASR 完成后立即从 currentJobs 中移除，让 ASR 服务可以处理下一个任务
      // NMT 和 TTS 可以异步处理，不阻塞 ASR 服务
      const result = await this.pipelineOrchestrator.processJob(job, partialCallback, (asrCompleted: boolean) => {
        // ASR 完成回调：从 currentJobs 中移除，释放 ASR 服务容量
        if (asrCompleted) {
          this.currentJobs.delete(job.job_id);
          logger.debug({ jobId: job.job_id }, 'ASR completed, removed from currentJobs to free ASR service capacity');
          
          // 如果这是最后一个任务，通知任务结束（用于停止GPU跟踪）
          if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
            this.onTaskEndCallback();
          }
        }
      });
      
      // 记录任务调用
      if (this.onTaskProcessedCallback) {
        this.onTaskProcessedCallback('pipeline');
      }
      
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
    // 从 ModelManager 获取已安装的模型，转换为协议格式
    // 注意：返回的 InstalledModel 接口包含 model_id 字段，这是协议定义的一部分
    const installed = this.modelManager.getInstalledModels();

    // 获取可用模型列表以获取完整元数据
    const availableModels = await this.modelManager.getAvailableModels();

    return installed.map(m => {
      // 从可用模型列表中查找完整信息
      const modelInfo = availableModels.find(am => am.id === m.modelId);

      // 从 model_id 推断模型类型（临时方案，实际应该从元数据获取）
      let kind: 'asr' | 'nmt' | 'tts' | 'emotion' | 'other' = 'other';
      if (modelInfo) {
        if (modelInfo.task === 'asr') kind = 'asr';
        else if (modelInfo.task === 'nmt') kind = 'nmt';
        else if (modelInfo.task === 'tts') kind = 'tts';
        else if (modelInfo.task === 'emotion') kind = 'emotion';
      } else {
        // 回退到名称推断
        if (m.modelId.includes('asr') || m.modelId.includes('whisper')) {
          kind = 'asr';
        } else if (m.modelId.includes('nmt') || m.modelId.includes('m2m')) {
          kind = 'nmt';
        } else if (m.modelId.includes('tts') || m.modelId.includes('piper')) {
          kind = 'tts';
        } else if (m.modelId.includes('emotion')) {
          kind = 'emotion';
        }
      }

      return {
        model_id: m.modelId,
        kind: kind,
        src_lang: modelInfo?.languages?.[0] || null,
        tgt_lang: modelInfo?.languages?.[1] || null,
        dialect: null, // TODO: 从元数据获取
        version: m.version || '1.0.0',
        enabled: m.info.status === 'ready', // 只有 ready 状态才启用
      };
    });
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

