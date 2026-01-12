/**
 * Task Router ASR Rerun Handler
 * 处理ASR Top-2语言重跑相关的逻辑
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../logger';
import { ASRTask, ASRResult } from './types';
import { detectBadSegment } from './bad-segment-detector';
import { shouldTriggerRerun, getTop2LanguagesForRerun } from './rerun-trigger';
import { ServiceEndpoint } from './types';

export interface RerunMetrics {
  totalReruns: number;
  successfulReruns: number;
  failedReruns: number;
  timeoutReruns: number;
  qualityImprovements: number;
}

export class ASRRerunHandler {
  private rerunMetrics: RerunMetrics = {
    totalReruns: 0,
    successfulReruns: 0,
    failedReruns: 0,
    timeoutReruns: 0,
    qualityImprovements: 0,
  };

  /**
   * 执行 Top-2 语言重跑
   */
  async executeRerun(
    task: ASRTask,
    asrResult: ASRResult,
    badSegmentDetection: any,
    audioDurationMs: number | undefined,
    httpClient: AxiosInstance,
    requestBody: any,
    previousText: string | undefined
  ): Promise<ASRResult | null> {
    const rerunCondition = shouldTriggerRerun(asrResult, audioDurationMs, task);
    
    if (!rerunCondition.shouldRerun) {
      return null;
    }

    logger.info(
      {
        jobId: task.job_id,
        reason: rerunCondition.reason,
        languageProbability: asrResult.language_probability,
        qualityScore: badSegmentDetection.qualityScore,
      },
      'P0.5-SH-2: Triggering Top-2 language rerun'
    );
    
    const top2Langs = getTop2LanguagesForRerun(
      asrResult.language_probabilities || {},
      asrResult.language
    );
    
    if (top2Langs.length === 0) {
      logger.warn(
        {
          jobId: task.job_id,
        },
        'P0.5-SH-2: No Top-2 languages available for rerun'
      );
      return null;
    }

    let bestResult = asrResult;
    let bestQualityScore = badSegmentDetection.qualityScore;
    
    for (const lang of top2Langs) {
      try {
        logger.info(
          {
            jobId: task.job_id,
            rerunLanguage: lang,
            originalLanguage: asrResult.language,
            rerunCount: (task.rerun_count || 0) + 1,
          },
          'P0.5-SH-2: Attempting rerun with forced language'
        );
        
        const rerunTimeoutMs = task.rerun_timeout_ms ?? 5000;
        const rerunAbortController = new AbortController();
        const rerunTimeoutId = setTimeout(() => {
          rerunAbortController.abort();
          logger.warn(
            {
              jobId: task.job_id,
              rerunLanguage: lang,
              timeoutMs: rerunTimeoutMs,
            },
            'P0.5-SH-4: Rerun timeout exceeded'
          );
        }, rerunTimeoutMs);
        
        try {
          const rerunTask: ASRTask = {
            ...task,
            src_lang: lang,
            rerun_count: (task.rerun_count || 0) + 1,
          };
          
          const rerunRequestBody: any = {
            ...requestBody,
            src_lang: lang,
            language: lang,
          };
          
          const rerunResponse = await httpClient.post('/utterance', rerunRequestBody, {
            signal: rerunAbortController.signal,
          });
          
          clearTimeout(rerunTimeoutId);
        
          const rerunResult: ASRResult = {
            text: rerunResponse.data.text || '',
            confidence: 1.0,
            language: rerunResponse.data.language || lang,
            language_probability: rerunResponse.data.language_probability,
            language_probabilities: rerunResponse.data.language_probabilities,
            segments: rerunResponse.data.segments,
            is_final: true,
          };
          
          const rerunAudioDurationMs = rerunResponse.data.duration
            ? Math.round(rerunResponse.data.duration * 1000)
            : undefined;
          const rerunBadSegmentDetection = detectBadSegment(
            rerunResult,
            rerunAudioDurationMs,
            previousText
          );
          rerunResult.badSegmentDetection = rerunBadSegmentDetection;
          
          if (rerunBadSegmentDetection.qualityScore > bestQualityScore) {
            logger.info(
              {
                jobId: task.job_id,
                rerunLanguage: lang,
                originalQualityScore: bestQualityScore,
                rerunQualityScore: rerunBadSegmentDetection.qualityScore,
              },
              'P0.5-SH-3: Rerun result has better quality score, selecting it'
            );
            bestResult = rerunResult;
            bestQualityScore = rerunBadSegmentDetection.qualityScore;
            this.rerunMetrics.qualityImprovements++;
          } else {
            logger.debug(
              {
                jobId: task.job_id,
                rerunLanguage: lang,
                originalQualityScore: bestQualityScore,
                rerunQualityScore: rerunBadSegmentDetection.qualityScore,
              },
              'P0.5-SH-3: Rerun result quality score not better, keeping original'
            );
          }
          
          this.rerunMetrics.totalReruns++;
          this.rerunMetrics.successfulReruns++;
        } catch (rerunError: any) {
          clearTimeout(rerunTimeoutId);
          
          this.rerunMetrics.totalReruns++;
          
          if (rerunAbortController.signal.aborted) {
            logger.warn(
              {
                jobId: task.job_id,
                rerunLanguage: lang,
                timeoutMs: rerunTimeoutMs,
              },
              'P0.5-SH-4: Rerun aborted due to timeout'
            );
            this.rerunMetrics.timeoutReruns++;
          } else {
            logger.warn(
              {
                jobId: task.job_id,
                rerunLanguage: lang,
                error: rerunError.message,
              },
              'P0.5-SH-2: Rerun failed, continuing with next language or original result'
            );
            this.rerunMetrics.failedReruns++;
          }
        }
      } catch (outerError: any) {
        logger.error(
          {
            jobId: task.job_id,
            rerunLanguage: lang,
            error: outerError.message,
          },
          'P0.5-SH-2: Unexpected error during rerun setup'
        );
      }
    }
    
    if (bestResult !== asrResult) {
      logger.info(
        {
          jobId: task.job_id,
          originalLanguage: asrResult.language,
          selectedLanguage: bestResult.language,
          originalQualityScore: badSegmentDetection.qualityScore,
          selectedQualityScore: bestQualityScore,
        },
        'P0.5-SH-3: Selected rerun result as best'
      );
    }
    
    return bestResult;
  }

  /**
   * 获取 Rerun 指标
   */
  getRerunMetrics(): RerunMetrics {
    return { ...this.rerunMetrics };
  }
}
