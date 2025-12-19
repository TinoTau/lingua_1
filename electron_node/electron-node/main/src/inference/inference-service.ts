import axios, { AxiosInstance } from 'axios';
import WebSocket from 'ws';
import { ModelManager } from '../model-manager/model-manager';
// 临时类型定义，实际应该从 shared/protocols/messages 导入
import type { JobAssignMessage, InstalledModel, FeatureFlags } from '@shared/protocols/messages';
import logger from '../logger';

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
  private httpClient: AxiosInstance;
  private inferenceServiceUrl: string;
  private wsClient: WebSocket | null = null;
  private onTaskProcessedCallback: ((serviceName: string) => void) | null = null;
  private onTaskStartCallback: (() => void) | null = null;
  private onTaskEndCallback: (() => void) | null = null;
  // best-effort cancel 支持：HTTP AbortController / 流式 WebSocket close
  private jobAbortControllers: Map<string, AbortController> = new Map();
  private jobStreamSockets: Map<string, WebSocket> = new Map();

  constructor(modelManager: ModelManager) {
    this.modelManager = modelManager;
    let url = process.env.INFERENCE_SERVICE_URL || 'http://localhost:5009';
    // 如果 URL 包含 localhost，替换为 127.0.0.1 以避免 IPv6 解析问题
    url = url.replace(/localhost/g, '127.0.0.1');
    this.inferenceServiceUrl = url;
    this.httpClient = axios.create({
      baseURL: this.inferenceServiceUrl,
      timeout: 300000, // 5 分钟超时（推理可能需要较长时间）
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
    const abortController = new AbortController();
    this.jobAbortControllers.set(job.job_id, abortController);
    
    // 如果是第一个任务，通知任务开始（用于启动GPU跟踪）
    if (wasFirstJob && this.onTaskStartCallback) {
      this.onTaskStartCallback();
    }

    try {
      // 根据任务请求中的 features 自动启用所需模块（运行时动态启用）
      // 注意：模块启用由推理服务根据请求自动处理，不需要手动调用

      // 如果启用了流式 ASR，使用 WebSocket
      if (job.enable_streaming_asr && partialCallback) {
        return await this.processJobStreaming(job, partialCallback);
      }

      // 否则使用 HTTP 同步请求
      // 将任务中的 features 传递给推理服务，推理服务会根据 features 自动启用相应模块
      const request = {
        job_id: job.job_id,
        src_lang: job.src_lang,
        tgt_lang: job.tgt_lang,
        audio: job.audio,
        audio_format: job.audio_format,
        sample_rate: job.sample_rate,
        features: job.features ? {
          emotion_detection: job.features.emotion_detection || false,
          voice_style_detection: job.features.voice_style_detection || false,
          speech_rate_detection: job.features.speech_rate_detection || false,
          speech_rate_control: job.features.speech_rate_control || false,
          speaker_identification: job.features.speaker_identification || false,
          persona_adaptation: job.features.persona_adaptation || false,
        } : undefined,
        mode: job.mode,
        lang_a: job.lang_a,
        lang_b: job.lang_b,
        auto_langs: job.auto_langs,
        enable_streaming_asr: false,
        trace_id: job.trace_id, // Added: propagate trace_id
        context_text: (job as any).context_text, // Added: propagate context_text (optional field)
      };

      const response = await this.httpClient.post('/v1/inference', request, {
        signal: abortController.signal,
      });

      if (!response.data.success) {
        throw new Error(response.data.error?.message || 'Inference failed');
      }

      // 记录任务调用（Rust服务处理所有推理任务）
      if (this.onTaskProcessedCallback) {
        this.onTaskProcessedCallback('rust');
      }

      return {
        text_asr: response.data.transcript || '',
        text_translated: response.data.translation || '',
        tts_audio: response.data.audio || '',
        tts_format: response.data.audio_format || job.audio_format || 'pcm16',
        extra: response.data.extra,
      };
    } catch (error) {
      logger.error({ error, jobId: job.job_id, traceId: job.trace_id }, 'Inference service call failed');
      throw error;
    } finally {
      this.currentJobs.delete(job.job_id);
      this.jobAbortControllers.delete(job.job_id);
      this.jobStreamSockets.delete(job.job_id);
      
      // 如果没有任务了，通知任务结束（用于停止GPU跟踪）
      if (this.currentJobs.size === 0 && this.onTaskEndCallback) {
        this.onTaskEndCallback();
      }
    }
  }

  private async processJobStreaming(
    job: JobAssignMessage,
    partialCallback: PartialResultCallback
  ): Promise<JobResult> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.inferenceServiceUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      const ws = new WebSocket(`${wsUrl}/v1/inference/stream`);
      this.jobStreamSockets.set(job.job_id, ws);

      let finalResult: JobResult | null = null;

      ws.on('open', () => {
        const request = {
          job_id: job.job_id,
          src_lang: job.src_lang,
          tgt_lang: job.tgt_lang,
          audio: job.audio,
          audio_format: job.audio_format,
          sample_rate: job.sample_rate,
          features: job.features ? {
            emotion_detection: job.features.emotion_detection || false,
            voice_style_detection: job.features.voice_style_detection || false,
            speech_rate_detection: job.features.speech_rate_detection || false,
            speech_rate_control: job.features.speech_rate_control || false,
            speaker_identification: job.features.speaker_identification || false,
            persona_adaptation: job.features.persona_adaptation || false,
          } : undefined,
          mode: job.mode,
          lang_a: job.lang_a,
          lang_b: job.lang_b,
          auto_langs: job.auto_langs,
          enable_streaming_asr: true,
          partial_update_interval_ms: job.partial_update_interval_ms || 1000,
          trace_id: job.trace_id, // Added: propagate trace_id
        };

        ws.send(JSON.stringify(request));
      });

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'asr_partial') {
            // 调用部分结果回调
            partialCallback({
              text: message.text,
              is_final: message.is_final,
              confidence: message.confidence || 0,
            });
          } else if (message.type === 'result') {
            // 最终结果
            finalResult = {
              text_asr: message.transcript || '',
              text_translated: message.translation || '',
              tts_audio: message.audio || '',
              tts_format: message.audio_format || job.audio_format || 'pcm16',
              extra: message.extra,
            };
            // 记录任务调用（Rust服务处理所有推理任务）
            if (this.onTaskProcessedCallback) {
              this.onTaskProcessedCallback('rust');
            }
            ws.close();
            resolve(finalResult);
          } else if (message.type === 'error') {
            ws.close();
            reject(new Error(message.message || 'Inference failed'));
          }
        } catch (error) {
          logger.error({ error }, 'Failed to parse WebSocket message');
        }
      });

      ws.on('error', (error: Error) => {
        ws.close();
        reject(error);
      });

      ws.on('close', () => {
        this.jobStreamSockets.delete(job.job_id);
        if (!finalResult) {
          reject(new Error('WebSocket connection closed, no result received'));
        }
      });
    });
  }

  /**
   * best-effort cancel：尝试中断 HTTP 请求或关闭流式 WebSocket
   * 注意：取消不保证推理服务一定立刻停止（取决于下游实现）
   */
  cancelJob(jobId: string): boolean {
    const controller = this.jobAbortControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.jobAbortControllers.delete(jobId);
      return true;
    }
    const ws = this.jobStreamSockets.get(jobId);
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      this.jobStreamSockets.delete(jobId);
      return true;
    }
    return false;
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

  // 注意：以下方法已废弃，模块现在根据任务请求自动启用/禁用
  // 保留这些方法是为了向后兼容，但不再通过 UI 手动调用

  async getModuleStatus(): Promise<Record<string, boolean>> {
    // 模块状态现在由推理服务根据任务请求动态管理
    // 返回空对象，表示不提供手动管理功能
    return {};
  }

  async enableModule(moduleName: string): Promise<void> {
    // 已废弃：模块现在根据任务请求自动启用
    // 不再支持手动启用模块
    logger.warn({ moduleName }, 'enableModule is deprecated: modules are now automatically enabled based on task requests');
  }

  async disableModule(moduleName: string): Promise<void> {
    // 已废弃：模块现在根据任务请求自动启用/禁用
    // 不再支持手动禁用模块
    logger.warn({ moduleName }, 'disableModule is deprecated: modules are now automatically managed based on task requests');
  }
}

