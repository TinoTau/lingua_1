/**
 * Task Router ASR Handler
 * 处理ASR路由相关的逻辑
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import { ServiceType, InstalledService } from '../../../../shared/protocols/messages';
import { NodeConfig } from '../node-config';
import {
  ServiceEndpoint,
  ASRTask,
  ASRResult,
} from './types';
import { detectBadSegment, BadSegmentDetectionResult } from './bad-segment-detector';
import { parseWavFile } from '../utils/opus-encoder';
import { checkAudioQuality } from './task-router-asr-audio-quality';
import { ASRRerunHandler } from './task-router-asr-rerun';
import { ASRMetricsHandler } from './task-router-asr-metrics';

export class TaskRouterASRHandler {
  private asrConfig: NodeConfig['asr'];
  private jobAbortControllers: Map<string, AbortController> = new Map();
  
  // 模块化处理器
  private rerunHandler: ASRRerunHandler;
  private metricsHandler: ASRMetricsHandler;

  constructor(
    private selectServiceEndpoint: (serviceType: ServiceType) => ServiceEndpoint | null,
    private startGpuTrackingForService: (serviceId: string) => void,
    private serviceConnections: Map<string, number>,
    private updateServiceConnections: (serviceId: string, delta: number) => void
  ) {
    this.loadASRConfig();
    this.rerunHandler = new ASRRerunHandler();
    this.metricsHandler = new ASRMetricsHandler();
  }

  /**
   * 加载 ASR 配置
   */
  private loadASRConfig(): void {
    try {
      const { loadNodeConfig } = require('../node-config');
      const config = loadNodeConfig();
      this.asrConfig = config.asr;
    } catch (error) {
      logger.warn({ error }, 'Failed to load ASR config, using defaults');
      this.asrConfig = undefined;
    }
  }

  /**
   * 获取 ASR 配置（带默认值）
   */
  private getASRConfig(): Required<NonNullable<NodeConfig['asr']>> {
    if (!this.asrConfig) {
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
   * 路由 ASR 任务
   */
  async routeASRTask(task: ASRTask): Promise<ASRResult> {
    const taskStartTime = Date.now();
    
    const endpoint = this.selectServiceEndpoint(ServiceType.ASR);
    if (!endpoint) {
      throw new Error('No available ASR service');
    }

    // GPU 跟踪：在任务开始时启动 GPU 跟踪
    this.startGpuTrackingForService(endpoint.serviceId);

    // 增加连接计数
    this.updateServiceConnections(endpoint.serviceId, 1);

    try {
      // 创建 AbortController 用于支持任务取消
      if (!task.job_id) {
        logger.warn({}, 'ASR task missing job_id, cannot support cancellation');
      }
      const abortController = new AbortController();
      if (task.job_id) {
        this.jobAbortControllers.set(task.job_id, abortController);
      }

      const httpClient: AxiosInstance = axios.create({
        baseURL: endpoint.baseUrl,
        timeout: 60000,
      });

      // ASR 服务路由：目前只支持 faster-whisper-vad
      if (endpoint.serviceId !== 'faster-whisper-vad') {
        throw new Error(`Unsupported ASR service: ${endpoint.serviceId}. Only faster-whisper-vad is supported.`);
      }

      const audioFormat = task.audio_format || 'opus';
      const requestUrl = `${endpoint.baseUrl}/utterance`;
      
      if (!task.audio_format) {
        logger.warn({
          serviceId: endpoint.serviceId,
          jobId: task.job_id,
          message: 'task.audio_format is missing, defaulting to opus (web client uses opus format)',
        }, 'Missing audio_format in task, using opus as default');
      }
      
      logger.info({
        serviceId: endpoint.serviceId,
        baseUrl: endpoint.baseUrl,
        requestUrl,
        audioFormat,
        originalFormat: task.audio_format,
        jobId: task.job_id,
      }, 'Routing ASR task to faster-whisper-vad');

      // 检查音频输入质量（用于调试 Job2 问题）
      checkAudioQuality(task, endpoint.serviceId);
      
      const requestBody: any = {
        job_id: task.job_id || `asr_${Date.now()}`,
        src_lang: task.src_lang,
        tgt_lang: task.src_lang,
        audio: task.audio,
        audio_format: audioFormat,
        sample_rate: task.sample_rate || 16000,
        task: 'transcribe',
        beam_size: task.beam_size || this.getASRConfig().beam_size,
        condition_on_previous_text: false,
        use_context_buffer: false,
        use_text_context: true,
        enable_streaming_asr: task.enable_streaming || false,
        context_text: task.context_text,
        best_of: task.best_of,
        temperature: task.temperature,
        patience: task.patience,
        padding_ms: task.padding_ms,
      };

      let response;
      const requestStartTime = Date.now();
      try {
        // 详细记录ASR输入
        logger.info({
          serviceId: endpoint.serviceId,
          requestUrl,
          jobId: task.job_id,
          sessionId: (task as any).session_id,
          utteranceIndex: (task as any).utterance_index,
          audioLength: task.audio?.length || 0,
          audioFormat: audioFormat,
          srcLang: task.src_lang,
          sampleRate: task.sample_rate || 16000,
          contextText: task.context_text,
          contextTextLength: task.context_text?.length || 0,
          enableStreaming: task.enable_streaming || false,
          beamSize: requestBody.beam_size,
          timeout: httpClient.defaults.timeout,
          requestBodySize: JSON.stringify(requestBody).length,
        }, 'ASR INPUT: Sending ASR request to faster-whisper-vad');
        
        response = await httpClient.post('/utterance', requestBody, {
          signal: abortController.signal,
        });
        
        const requestDuration = Date.now() - requestStartTime;
        
        // 详细记录ASR输出
        const asrText = response.data?.text || '';
        const segments = response.data?.segments || [];
        const qualityScore = response.data?.badSegmentDetection?.qualityScore;
        const languageProbability = response.data?.language_probability;
        
        logger.info({
          serviceId: endpoint.serviceId,
          requestUrl,
          status: response.status,
          jobId: task.job_id,
          sessionId: (task as any).session_id,
          utteranceIndex: (task as any).utterance_index,
          requestDurationMs: requestDuration,
          asrText: asrText,
          asrTextLength: asrText.length,
          asrTextPreview: asrText.substring(0, 100),
          segmentsCount: segments.length,
          qualityScore: qualityScore,
          languageProbability: languageProbability,
          hasLanguageProbabilities: !!response.data?.language_probabilities,
        }, 'ASR OUTPUT: faster-whisper-vad request succeeded');
      } catch (axiosError: any) {
        const requestDuration = Date.now() - requestStartTime;
        const isTimeout = axiosError.code === 'ECONNABORTED' || axiosError.message?.includes('timeout');
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
          requestDurationMs: requestDuration,
          isTimeout,
          timeout: httpClient.defaults.timeout,
        }, `faster-whisper-vad request failed${isTimeout ? ' (TIMEOUT)' : ''}'`);
        throw axiosError;
      }

      const langProb = response.data.language_probability ?? 0;
      let useTextContext = false;
      let conditionOnPreviousText = false;
      
      // P0.5-CTX-1: 低质量禁用 context
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
      
      if (langProb < 0.70) {
        useTextContext = false;
        conditionOnPreviousText = false;
      }
      
      // 构建 ASR 结果
      const asrText = response.data.text || '';
      const asrResult: ASRResult = {
        text: asrText,
        confidence: 1.0,
        language: response.data.language || task.src_lang,
        language_probability: response.data.language_probability,
        language_probabilities: response.data.language_probabilities,
        segments: response.data.segments,
        is_final: true,
      };
      
      logger.info(
        {
          serviceId: endpoint.serviceId,
          jobId: task.job_id,
          utteranceIndex: task.utterance_index,
          asrTextLength: asrText.length,
          asrTextPreview: asrText.substring(0, 100),
          language: asrResult.language,
          languageProbability: asrResult.language_probability,
          segmentCount: response.data.segments?.length || 0,
          audioDurationMs: response.data.duration ? Math.round(response.data.duration * 1000) : undefined,
          segmentsPreview: response.data.segments?.slice(0, 3).map((seg: any) => ({
            text: seg.text?.substring(0, 50) || '',
            start: seg.start,
            end: seg.end,
          })) || [],
        },
        'ASR service returned result'
      );

      // CONF-3 + RERUN-1: 基于 segments 时间戳的断裂/异常检测 + 坏段判定
      const audioDurationMs = response.data.duration 
        ? Math.round(response.data.duration * 1000)
        : undefined;
      
      let calculatedAudioDurationMs = audioDurationMs;
      if (!calculatedAudioDurationMs && asrResult.segments && asrResult.segments.length > 0) {
        const lastSegment = asrResult.segments[asrResult.segments.length - 1];
        if (lastSegment && lastSegment.end) {
          calculatedAudioDurationMs = Math.round(lastSegment.end * 1000);
          logger.debug(
            { jobId: task.job_id, calculatedAudioDurationMs },
            'OBS-1: Calculated audio duration from segments'
          );
        }
      }
      
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

      asrResult.badSegmentDetection = badSegmentDetection;
      
      // P0.5-CTX-2: 检查连续低质量
      const sessionId = (task as any).session_id || task.job_id || 'unknown';
      const shouldResetContext = this.metricsHandler.updateConsecutiveLowQualityCount(
        sessionId,
        badSegmentDetection.qualityScore
      );
      if (shouldResetContext) {
        (asrResult as any).shouldResetContext = true;
      }
      
      // P0.5-SH-1/2: 检查是否应该触发 Top-2 语言重跑
      const rerunResult = await this.rerunHandler.executeRerun(
        task,
        asrResult,
        badSegmentDetection,
        audioDurationMs,
        httpClient,
        requestBody,
        previousText
      );
      
      if (rerunResult) {
        // OBS-1: 记录处理效率（重跑场景，包含重跑时间）
        const taskEndTime = Date.now();
        const processingTimeMs = taskEndTime - taskStartTime;
        this.metricsHandler.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
        
        return rerunResult;
      }
      
      // OBS-1: 记录处理效率（正常场景，无重跑）
      const taskEndTime = Date.now();
      const processingTimeMs = taskEndTime - taskStartTime;
      this.metricsHandler.recordASREfficiency(endpoint.serviceId, calculatedAudioDurationMs || audioDurationMs, processingTimeMs);
      
      return asrResult;
    } catch (error: any) {
      const errorDetails: any = {
        serviceId: endpoint.serviceId,
        baseUrl: endpoint.baseUrl,
        jobId: task.job_id,
        errorMessage: error.message,
      };

      if (error.response) {
        errorDetails.status = error.response.status;
        errorDetails.statusText = error.response.statusText;
        errorDetails.responseData = error.response.data;
        errorDetails.requestUrl = error.config?.url || 'unknown';
        errorDetails.requestMethod = error.config?.method || 'unknown';
      } else if (error.request) {
        errorDetails.requestError = true;
        errorDetails.requestUrl = error.config?.url || 'unknown';
      } else {
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
      this.updateServiceConnections(endpoint.serviceId, -1);
    }
  }

  /**
   * Gate-A: 重置指定 session 的连续低质量计数
   */
  resetConsecutiveLowQualityCount(sessionId: string): void {
    this.metricsHandler.resetConsecutiveLowQualityCount(sessionId);
  }

  /**
   * Gate-B: 获取 Rerun 指标
   */
  getRerunMetrics() {
    return this.rerunHandler.getRerunMetrics();
  }

  /**
   * OBS-1: 获取当前心跳周期的处理效率指标
   */
  getProcessingMetrics(): Record<string, number> {
    return this.metricsHandler.getProcessingMetrics();
  }

  /**
   * OBS-1: 重置当前心跳周期的统计数据
   */
  resetCycleMetrics(): void {
    this.metricsHandler.resetCycleMetrics();
  }
}
