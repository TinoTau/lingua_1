/**
 * CTC ASR 策略
 * 处理 CTC 类服务（如 asr-sherpa-lm）：最小 requestBody、无 badSegment/rerun 逻辑
 */

import { AxiosInstance } from 'axios';
import logger from '../logger';
import { ASRTask, ASRResult, ServiceEndpoint } from './types';
import { postASRUtteranceRequest } from './task-router-asr-http';
import { ASRMetricsHandler } from './task-router-asr-metrics';

export interface CTCASRStrategyContext {
  httpClient: AxiosInstance;
  taskStartTime: number;
  metricsHandler: ASRMetricsHandler;
  signal?: AbortSignal;
}

export async function executeCTCASR(
  task: ASRTask,
  endpoint: ServiceEndpoint,
  ctx: CTCASRStrategyContext
): Promise<ASRResult> {
  const audioFormat = task.audio_format || 'opus';
  const requestBody: Record<string, unknown> = {
    job_id: task.job_id || `asr_${Date.now()}`,
    trace_id: task.trace_id ?? task.job_id,
    src_lang: task.src_lang,
    tgt_lang: task.src_lang,
    audio: task.audio,
    audio_format: audioFormat,
    sample_rate: task.sample_rate || 16000,
    task: 'transcribe',
    enable_streaming_asr: task.enable_streaming || false,
    ...(task.beam_size !== undefined ? { beam_size: task.beam_size } : {}),
  };

  const requestUrl = `${endpoint.baseUrl}/utterance`;
  const { response, requestDurationMs } = await postASRUtteranceRequest(
    ctx.httpClient,
    requestBody,
    ctx.signal,
    {
      serviceId: endpoint.serviceId,
      requestUrl,
      baseUrl: endpoint.baseUrl,
      jobId: task.job_id,
      sessionId: (task as any).session_id,
      utteranceIndex: (task as any).utterance_index,
      audioLength: task.audio?.length || 0,
      audioFormat,
      srcLang: task.src_lang,
      sampleRate: task.sample_rate || 16000,
      timeout: ctx.httpClient.defaults?.timeout ?? 60000,
      requestBodySize: JSON.stringify(requestBody).length,
    }
  );

  const data = response.data;
  const asrResult: ASRResult = {
    text: data.text || '',
    confidence: 1.0,
    language: data.language || task.src_lang,
    language_probability: data.language_probability,
    language_probabilities: data.language_probabilities,
    segments: data.segments,
    is_final: true,
  };
  if (data.text_zh != null || data.text_en != null) {
    (asrResult as any).text_zh = data.text_zh ?? '';
    (asrResult as any).text_en = data.text_en ?? '';
  }

  const audioDurationMs = data.duration
    ? Math.round(data.duration * 1000)
    : undefined;

  (asrResult as any)._requestDurationMs = requestDurationMs;
  const sessionId = (task as any).session_id || task.job_id || 'unknown';
  ctx.metricsHandler.updateConsecutiveLowQualityCount(sessionId, 1.0);

  const taskEndTime = Date.now();
  const processingTimeMs = taskEndTime - ctx.taskStartTime;
  ctx.metricsHandler.recordASREfficiency(
    endpoint.serviceId,
    audioDurationMs,
    processingTimeMs
  );

  logger.info(
    {
      serviceId: endpoint.serviceId,
      jobId: task.job_id,
      asrTextLength: asrResult.text.length,
      processingTimeMs,
      audioDurationMs,
    },
    'CTC ASR completed'
  );

  return asrResult;
}
