/**
 * Task Router TTS Handler
 * 处理TTS路由相关的逻辑
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import { ServiceType } from '../../../../shared/protocols/messages';
import {
  ServiceEndpoint,
  TTSTask,
  TTSResult,
} from './types';
import { parseWavFile } from '../utils/opus-encoder';

export class TaskRouterTTSHandler {
  private jobAbortControllers: Map<string, AbortController> = new Map();
  private currentCycleServiceEfficiencies: Map<string, number[]> = new Map();

  constructor(
    private selectServiceEndpoint: (serviceType: ServiceType) => ServiceEndpoint | null,
    private startGpuTrackingForService: (serviceId: string) => void,
    private serviceConnections: Map<string, number>,
    private updateServiceConnections: (serviceId: string, delta: number) => void,
    private recordServiceEfficiency: (serviceId: string, efficiency: number) => void
  ) {}

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

    this.updateServiceConnections(endpoint.serviceId, 1);

    // 创建 httpClient 在 try 块外，以便在 catch 块中访问
    const httpClient: AxiosInstance = axios.create({
      baseURL: endpoint.baseUrl,
      timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
    });

    try {
      // 创建 AbortController 用于支持任务取消
      // 注意：job_id 是调度服务器发送的，用于任务管理和取消
      // trace_id 用于全链路追踪，不用于任务管理
      if (!task.job_id) {
        logger.warn({}, 'TTS task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

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
      
      const taskStartTime = Date.now();
      logger.info({
        serviceId: endpoint.serviceId,
        jobId: task.job_id,
        textLength: task.text?.length || 0,
        timeout: httpClient.defaults.timeout,
      }, 'Sending TTS request');
      
      const response = await httpClient.post('/tts', {
        text: task.text,
        voice: task.voice_id || defaultVoice, // 使用根据语言选择的默认语音
        language: task.lang || 'zh', // 将lang映射到language
      }, {
        signal: abortController.signal, // 支持任务取消
        responseType: 'arraybuffer', // TTS服务返回WAV音频数据（二进制）
      });
      
      const requestDuration = Date.now() - taskStartTime;
      if (requestDuration > 30000) {
        logger.warn({
          serviceId: endpoint.serviceId,
          jobId: task.job_id,
          requestDurationMs: requestDuration,
          textLength: task.text?.length || 0,
        }, 'TTS request took longer than 30 seconds');
      }

      // 将WAV音频数据转换为Buffer
      const wavBuffer = Buffer.from(response.data);

      // 注意：Opus 编码已移至 PipelineOrchestrator 中处理
      // TaskRouter 现在只返回 WAV 数据，由 Pipeline 负责编码为 Opus
      const wavBase64 = wavBuffer.toString('base64');

      // OBS-1: 记录 TTS 处理效率
      const taskEndTime = Date.now();
      const processingTimeMs = taskEndTime - taskStartTime;
      
      // 计算音频时长（用于效率统计）
      let audioDurationMs: number | undefined;
      try {
        const { sampleRate, channels } = parseWavFile(wavBuffer);
        const sampleCount = wavBuffer.length / (2 * channels);
        audioDurationMs = Math.round((sampleCount / sampleRate) * 1000);
        if (audioDurationMs) {
          this.recordTTSEfficiency(endpoint.serviceId, audioDurationMs, processingTimeMs);
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to calculate audio duration for efficiency tracking');
      }

      logger.info(
        {
          serviceId: endpoint.serviceId,
          wavSize: wavBuffer.length,
          base64Length: wavBase64.length,
          audioDurationMs,
        },
        'TTS: WAV audio received, will be encoded to Opus in Pipeline'
      );

      return {
        audio: wavBase64,
        audio_format: 'wav', // 返回 WAV 格式，由 Pipeline 编码为 Opus
        sample_rate: task.sample_rate || 16000,
      };
    } catch (error: any) {
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      logger.error({
        error,
        serviceId: endpoint.serviceId,
        jobId: task.job_id,
        errorCode: error.code,
        errorMessage: error.message,
        isTimeout,
        timeout: httpClient.defaults.timeout,
      }, `TTS task failed${isTimeout ? ' (TIMEOUT)' : ''}`);
      throw error;
    } finally {
      // 清理 AbortController
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      this.updateServiceConnections(endpoint.serviceId, -1);
    }
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
   * OBS-1: 获取当前心跳周期的处理效率指标
   */
  getProcessingMetrics(): Record<string, number> {
    const result: Record<string, number> = {};
    
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
   * OBS-1: 重置当前心跳周期的统计数据
   */
  resetCycleMetrics(): void {
    this.currentCycleServiceEfficiencies.clear();
  }
}
