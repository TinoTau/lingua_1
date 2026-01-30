/**
 * Task Router ASR Audio Quality Checker
 * 处理ASR音频质量检查相关的逻辑
 */

import logger from '../logger';
import { ASRTask } from './types';

export interface AudioQualityInfo {
  audioDataLength: number;
  estimatedDurationMs: number;
  rms: number;
  rmsNormalized: number;
  preview: string;
  isQualityAcceptable: boolean;
  rejectionReason?: string;
}

/**
 * 最小 RMS 阈值（归一化值，0-1范围）
 * 低于此值的音频被认为是静音或极低质量噪音，应该被过滤
 * 参考：Web端 releaseThreshold 为 0.005
 * 调整：从0.015降低到0.008，避免误判有效语音为静音/噪音
 */
const MIN_RMS_THRESHOLD = 0.008;  // 与Web端保持一致，避免过于严格

/**
 * 检查音频输入质量
 * @param task ASR任务
 * @param serviceId 服务ID
 * @returns AudioQualityInfo | null - 如果音频质量不可接受，返回 null
 */
export function checkAudioQuality(
  task: ASRTask,
  serviceId: string
): AudioQualityInfo | null {
  let audioDataLength = 0;
  let audioDataPreview = '';
  
  try {
    if (task.audio) {
      const audioBuffer = Buffer.from(task.audio, 'base64');
      audioDataLength = audioBuffer.length;
      const estimatedDurationMs = Math.round((audioDataLength / 2) / 16);
      const samples = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) {
        sumSquares += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const rmsNormalized = rms / 32768.0;
      
      audioDataPreview = `length=${audioDataLength}, duration=${estimatedDurationMs}ms, rms=${rmsNormalized.toFixed(4)}`;
      
      // 检查 RMS 是否低于阈值
      const isQualityAcceptable = rmsNormalized >= MIN_RMS_THRESHOLD;
      const rejectionReason = !isQualityAcceptable 
        ? `RMS (${rmsNormalized.toFixed(4)}) below MIN_RMS_THRESHOLD (${MIN_RMS_THRESHOLD})`
        : undefined;
      
      if (!isQualityAcceptable) {
        logger.warn(
          {
            serviceId,
            jobId: task.job_id,
            utteranceIndex: task.utterance_index,
            audioDataLength,
            estimatedDurationMs,
            rms: rmsNormalized.toFixed(4),
            minRmsThreshold: MIN_RMS_THRESHOLD,
            audioFormat: task.audio_format || 'opus',
            sampleRate: task.sample_rate || 16000,
            contextTextLength: task.context_text?.length || 0,
            rejectionReason,
          },
          'ASR task: Audio quality too low (likely silence or noise), rejecting'
        );
        return null;
      }
      
      logger.info(
        {
          serviceId,
          jobId: task.job_id,
          utteranceIndex: task.utterance_index,
          audioDataLength,
          estimatedDurationMs,
          rms: rmsNormalized.toFixed(4),
          minRmsThreshold: MIN_RMS_THRESHOLD,
          audioFormat: task.audio_format || 'opus',
          sampleRate: task.sample_rate || 16000,
          contextTextLength: task.context_text?.length || 0,
          contextTextPreview: task.context_text ? task.context_text.substring(0, 200) : null,
        },
        'ASR task: Audio input quality check'
      );

      return {
        audioDataLength,
        estimatedDurationMs,
        rms,
        rmsNormalized,
        preview: audioDataPreview,
        isQualityAcceptable: true,
      };
    }
  } catch (error) {
    logger.warn(
      {
        serviceId,
        jobId: task.job_id,
        utteranceIndex: task.utterance_index,
        error: (error as Error).message,
      },
      'ASR task: Failed to analyze audio input quality'
    );
  }
  
  return null;
}
