/**
 * ASR HTTP 请求：发送 /utterance 请求并记录输入/输出日志
 */

import { AxiosInstance } from 'axios';
import logger from '../logger';

export interface ASRRequestLogContext {
  serviceId: string;
  requestUrl: string;
  baseUrl: string;
  jobId: string | undefined;
  sessionId: string | undefined;
  utteranceIndex: number | undefined;
  audioLength?: number;
  audioFormat?: string;
  srcLang?: string;
  sampleRate?: number;
  contextText?: string;
  contextTextLength?: number;
  enableStreaming?: boolean;
  beamSize?: number;
  timeout?: number;
  requestBodySize?: number;
}

/**
 * 发送 ASR /utterance 请求，记录输入/输出与错误日志，失败时抛出
 */
export async function postASRUtteranceRequest(
  httpClient: AxiosInstance,
  requestBody: Record<string, unknown>,
  signal: AbortSignal | undefined,
  logContext: ASRRequestLogContext
): Promise<{ response: { data: any }; requestDurationMs: number }> {
  const requestStartTime = Date.now();
  try {
    logger.info(
      {
        serviceId: logContext.serviceId,
        requestUrl: logContext.requestUrl,
        jobId: logContext.jobId,
        sessionId: logContext.sessionId,
        utteranceIndex: logContext.utteranceIndex,
        audioLength: logContext.audioLength,
        audioFormat: logContext.audioFormat,
        srcLang: logContext.srcLang,
        sampleRate: logContext.sampleRate,
        contextText: logContext.contextText,
        contextTextLength: logContext.contextTextLength,
        enableStreaming: logContext.enableStreaming,
        beamSize: logContext.beamSize,
        timeout: logContext.timeout ?? 60000,
        requestBodySize: logContext.requestBodySize,
      },
      'ASR INPUT: Sending ASR request to faster-whisper-vad'
    );

    const response = await httpClient.post('/utterance', requestBody, { signal });
    const requestDurationMs = Date.now() - requestStartTime;

    const asrText = response.data?.text || '';
    const segments = response.data?.segments || [];
    const qualityScore = response.data?.badSegmentDetection?.qualityScore;
    const languageProbability = response.data?.language_probability;

    logger.info(
      {
        serviceId: logContext.serviceId,
        requestUrl: logContext.requestUrl,
        status: response.status,
        jobId: logContext.jobId,
        sessionId: logContext.sessionId,
        utteranceIndex: logContext.utteranceIndex,
        requestDurationMs,
        asrText,
        asrTextLength: asrText.length,
        asrTextPreview: asrText.substring(0, 100),
        segmentsCount: segments.length,
        qualityScore,
        languageProbability,
        hasLanguageProbabilities: !!response.data?.language_probabilities,
      },
      'ASR OUTPUT: faster-whisper-vad request succeeded'
    );

    return { response, requestDurationMs };
  } catch (axiosError: any) {
    const requestDurationMs = Date.now() - requestStartTime;
    const isTimeout =
      axiosError.code === 'ECONNABORTED' || axiosError.message?.includes('timeout');
    logger.error(
      {
        serviceId: logContext.serviceId,
        requestUrl: logContext.requestUrl,
        baseUrl: logContext.baseUrl,
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        errorMessage: axiosError.message,
        errorCode: axiosError.code,
        jobId: logContext.jobId,
        sessionId: logContext.sessionId,
        utteranceIndex: logContext.utteranceIndex,
        responseData: axiosError.response?.data,
        requestDurationMs,
        isTimeout,
        timeout: logContext.timeout ?? 60000,
        note: isTimeout
          ? 'ASR service timeout - this should be marked as missing segment'
          : 'ASR service error - this should be marked as missing segment',
      },
      `faster-whisper-vad request failed${isTimeout ? ' (TIMEOUT)' : ''}`
    );
    throw axiosError;
  }
}
