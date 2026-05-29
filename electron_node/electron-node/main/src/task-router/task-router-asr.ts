/**
 * Task Router ASR Handler
 * 按 serviceId 分发到 CTC 或 Faster-Whisper 策略
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import { ServiceType } from '../../../../shared/protocols/messages';
import { ASRTask, ASRResult, ServiceEndpoint } from './types';
import { checkAudioQuality } from './task-router-asr-audio-quality';
import { ASRRerunHandler } from './task-router-asr-rerun';
import { ASRMetricsHandler } from './task-router-asr-metrics';
import { executeCTCASR } from './ctc-asr-strategy';
import { executeFasterWhisperASR } from './faster-whisper-asr-strategy';
import { FW_ASR_SERVICE_ID, isFwDetectorEngineEnabled } from '../fw-detector/fw-mode';

const SUPPORTED_ASR = ['faster-whisper-vad', 'asr-sherpa-lm', 'asr-sherpa-en'] as const;

export class TaskRouterASRHandler {
  private jobAbortControllers: Map<string, AbortController> = new Map();
  private rerunHandler: ASRRerunHandler;
  private metricsHandler: ASRMetricsHandler;

  constructor(
    private selectServiceEndpoint: (serviceType: ServiceType) => ServiceEndpoint | null,
    private getASREndpointForService: (serviceId: string) => ServiceEndpoint | null,
    private startGpuTrackingForService: (serviceId: string) => void,
    private serviceConnections: Map<string, number>,
    private updateServiceConnections: (serviceId: string, delta: number) => void
  ) {
    this.rerunHandler = new ASRRerunHandler();
    this.metricsHandler = new ASRMetricsHandler();
  }

  async routeASRTask(task: ASRTask, options?: { preferredServiceId?: string }): Promise<ASRResult> {
    let endpoint: ServiceEndpoint | null = null;
    if (options?.preferredServiceId) {
      endpoint = this.getASREndpointForService(options.preferredServiceId);
    }
    if (!endpoint) {
      endpoint = this.selectServiceEndpoint(ServiceType.ASR);
    }
    if (!endpoint) {
      throw new Error('No available ASR service');
    }
    return this.routeASRTaskWithEndpoint(endpoint, task);
  }

  /** 按指定端点执行 ASR（单模式一发 / 双模式主路或校验路） */
  async routeASRTaskWithEndpoint(endpoint: ServiceEndpoint, task: ASRTask): Promise<ASRResult> {
    let resolvedEndpoint = endpoint;
    if (
      isFwDetectorEngineEnabled()
      && (endpoint.serviceId === 'asr-sherpa-lm' || endpoint.serviceId === 'asr-sherpa-en')
    ) {
      const fwEndpoint = this.getASREndpointForService(FW_ASR_SERVICE_ID);
      if (!fwEndpoint) {
        throw new Error(`FW detector mode requires ${FW_ASR_SERVICE_ID} endpoint`);
      }
      resolvedEndpoint = fwEndpoint;
    }

    const taskStartTime = Date.now();
    if (!SUPPORTED_ASR.includes(resolvedEndpoint.serviceId as any)) {
      throw new Error(`Unsupported ASR service: ${endpoint.serviceId}. Supported: ${SUPPORTED_ASR.join(', ')}.`);
    }

    this.startGpuTrackingForService(resolvedEndpoint.serviceId);
    this.updateServiceConnections(resolvedEndpoint.serviceId, 1);

    const abortController = new AbortController();
    if (task.job_id) {
      this.jobAbortControllers.set(task.job_id, abortController);
    }

    const httpClient: AxiosInstance = axios.create({
      baseURL: endpoint.baseUrl,
      timeout: 60000,
    });

    try {
      const audioQuality = checkAudioQuality(task, resolvedEndpoint.serviceId);
      if (!audioQuality) {
        logger.warn(
          { serviceId: resolvedEndpoint.serviceId, jobId: task.job_id },
          'ASR task: Rejecting low quality audio, returning empty result'
        );
        return {
          text: '',
          segments: [],
          language_probability: 0,
          badSegmentDetection: { isBad: true, reasonCodes: ['low_quality_audio'], qualityScore: 0 },
        };
      }

      const strategyCtx = {
        httpClient,
        taskStartTime,
        metricsHandler: this.metricsHandler,
        signal: abortController.signal,
      };

      if (resolvedEndpoint.serviceId === 'asr-sherpa-lm' || resolvedEndpoint.serviceId === 'asr-sherpa-en') {
        const result = await executeCTCASR(task, resolvedEndpoint, strategyCtx);
        result.routedServiceId = resolvedEndpoint.serviceId;
        return result;
      }

      const result = await executeFasterWhisperASR(task, resolvedEndpoint, {
        ...strategyCtx,
        rerunHandler: this.rerunHandler,
      });
      result.routedServiceId = resolvedEndpoint.serviceId;
      return result;
    } catch (error: any) {
      logger.error(
        {
          serviceId: endpoint.serviceId,
          jobId: task.job_id,
          errorMessage: error.message,
        },
        'ASR task failed'
      );
      throw error;
    } finally {
      if (task.job_id) {
        this.jobAbortControllers.delete(task.job_id);
      }
      this.updateServiceConnections(resolvedEndpoint.serviceId, -1);
    }
  }

  resetConsecutiveLowQualityCount(sessionId: string): void {
    this.metricsHandler.resetConsecutiveLowQualityCount(sessionId);
  }

  getRerunMetrics() {
    return this.rerunHandler.getRerunMetrics();
  }

  getProcessingMetrics(): Record<string, number> {
    return this.metricsHandler.getProcessingMetrics();
  }

  resetCycleMetrics(): void {
    this.metricsHandler.resetCycleMetrics();
  }
}
