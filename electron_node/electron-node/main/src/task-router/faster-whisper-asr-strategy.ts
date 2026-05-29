/**
 * Faster-Whisper ASR 策略
 * 处理 faster-whisper-vad：完整 requestBody、badSegment、rerun、P0.5-CTX
 */

import { AxiosInstance } from 'axios';
import logger from '../logger';
import { ASRTask, ASRResult, ServiceEndpoint } from './types';
import { detectBadSegment } from './bad-segment-detector';
import { postASRUtteranceRequest } from './task-router-asr-http';
import { ASRRerunHandler } from './task-router-asr-rerun';
import { ASRMetricsHandler } from './task-router-asr-metrics';
import { isFwDetectorEngineEnabled } from '../fw-detector/fw-mode';
import { loadNodeConfig } from '../node-config';

export interface FasterWhisperASRStrategyContext {
  httpClient: AxiosInstance;
  taskStartTime: number;
  rerunHandler: ASRRerunHandler;
  metricsHandler: ASRMetricsHandler;
  signal?: AbortSignal;
}

export async function executeFasterWhisperASR(
  task: ASRTask,
  endpoint: ServiceEndpoint,
  ctx: FasterWhisperASRStrategyContext
): Promise<ASRResult> {
  const audioFormat = task.audio_format || 'opus';
  const fwP0 = isFwDetectorEngineEnabled();
  const requestBody: Record<string, unknown> = {
    job_id: task.job_id || `asr_${Date.now()}`,
    src_lang: task.src_lang,
    tgt_lang: task.src_lang,
    audio: task.audio,
    audio_format: audioFormat,
    sample_rate: task.sample_rate || 16000,
    task: 'transcribe',
    condition_on_previous_text: false,
    use_context_buffer: false,
    use_text_context: fwP0 ? false : true,
    enable_streaming_asr: task.enable_streaming || false,
    context_text: fwP0 ? undefined : task.context_text,
    beam_size: fwP0 ? 1 : (task.beam_size ?? 1),
    ...(fwP0
      ? { temperature: 0 }
      : {
          ...(task.temperature !== undefined ? { temperature: task.temperature } : {}),
          ...(task.best_of !== undefined ? { best_of: task.best_of } : {}),
        }),
    ...(task.patience !== undefined ? { patience: task.patience } : {}),
    padding_ms: task.padding_ms,
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
      contextText: task.context_text,
      contextTextLength: task.context_text?.length || 0,
      enableStreaming: task.enable_streaming || false,
      beamSize: requestBody.beam_size as number | undefined,
      timeout: ctx.httpClient.defaults?.timeout ?? 60000,
      requestBodySize: JSON.stringify(requestBody).length,
    }
  );

  const asrText = response.data.text || '';
  const asrResult: ASRResult = {
    text: asrText,
    confidence: 1.0,
    language: response.data.language || task.src_lang,
    language_probability: response.data.language_probability,
    language_probabilities: response.data.language_probabilities,
    segments: response.data.segments,
    is_final: true,
    ...(response.data.diagnostics ? { diagnostics: response.data.diagnostics } : {}),
  };

  const audioDurationMs = response.data.duration
    ? Math.round(response.data.duration * 1000)
    : undefined;

  let calculatedAudioDurationMs = audioDurationMs;
  if (!calculatedAudioDurationMs && asrResult.segments?.length) {
    const lastSegment = asrResult.segments[asrResult.segments.length - 1];
    if (lastSegment?.end) {
      calculatedAudioDurationMs = Math.round(lastSegment.end * 1000);
    }
  }

  const previousText = task.context_text || undefined;
  const badSegmentDetection = detectBadSegment(asrResult, audioDurationMs, previousText);
  asrResult.badSegmentDetection = badSegmentDetection;

  const sessionId = (task as any).session_id || task.job_id || 'unknown';
  const shouldResetContext = ctx.metricsHandler.updateConsecutiveLowQualityCount(
    sessionId,
    badSegmentDetection.qualityScore
  );
  if (shouldResetContext) {
    (asrResult as any).shouldResetContext = true;
  }

  const disableRerun =
    isFwDetectorEngineEnabled()
    && loadNodeConfig().features?.fwDetector?.disableAsrRerun !== false;

  let result = asrResult;
  if (!disableRerun) {
    const rerunResult = await ctx.rerunHandler.executeRerun(
      task,
      asrResult,
      badSegmentDetection,
      audioDurationMs,
      ctx.httpClient,
      requestBody,
      previousText
    );
    result = rerunResult || asrResult;
  }
  (result as any)._requestDurationMs = requestDurationMs;
  const taskEndTime = Date.now();
  ctx.metricsHandler.recordASREfficiency(
    endpoint.serviceId,
    calculatedAudioDurationMs || audioDurationMs,
    taskEndTime - ctx.taskStartTime
  );

  return result;
}
