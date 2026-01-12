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
}

/**
 * 检查音频输入质量
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
      
      logger.info(
        {
          serviceId,
          jobId: task.job_id,
          utteranceIndex: task.utterance_index,
          audioDataLength,
          estimatedDurationMs,
          rms: rmsNormalized.toFixed(4),
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
