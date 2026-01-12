/**
 * TONEStage - TONE 音色配音阶段
 * 职责：根据 TTS 音频生成音色配音
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { TONETask, TONEResult } from '../../task-router/types';
import logger from '../../logger';
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';
import { withGpuLease } from '../../gpu-arbiter';

export interface TONEStageResult {
  toneAudio?: string;  // TONE 处理后的音频
  toneFormat?: string;  // TONE 音频格式
  speakerId?: string;  // 音色ID
  toneTimeMs?: number;
}

export class TONEStage {
  constructor(private taskRouter: TaskRouter | null) {}

  /**
   * 生成 TONE 音色配音
   * @param job 任务消息
   * @param ttsAudio TTS 生成的音频（base64）
   * @param ttsFormat TTS 音频格式
   * @param speakerId 音色ID（可选，从 job 中提取）
   */
  async process(
    job: JobAssignMessage,
    ttsAudio: string,
    ttsFormat: string,
    speakerId?: string
  ): Promise<TONEStageResult> {
    const startTime = Date.now();

    // 检查是否需要生成 TONE
    if (job.pipeline?.use_tone !== true) {
      logger.debug(
        { jobId: job.job_id, sessionId: job.session_id },
        'TONEStage: TONE disabled by pipeline config, skipping TONE'
      );
      return {
        toneAudio: undefined,
        toneFormat: undefined,
        speakerId: undefined,
      };
    }

    // 检查 TTS 音频是否为空
    if (!ttsAudio || ttsAudio.trim().length === 0) {
      logger.debug(
        { jobId: job.job_id, sessionId: job.session_id },
        'TONEStage: TTS audio is empty, skipping TONE'
      );
      return {
        toneAudio: undefined,
        toneFormat: undefined,
        speakerId: undefined,
      };
    }

    if (!this.taskRouter) {
      logger.error(
        { jobId: job.job_id, sessionId: job.session_id },
        'TONEStage: TaskRouter not available'
      );
      return {
        toneAudio: undefined,
        toneFormat: undefined,
        speakerId: undefined,
      };
    }

    // 从 job 中提取 speaker_id（如果未提供）
    const finalSpeakerId = speakerId || (job as any).speaker_id || (job as any).voice_id;

    if (!finalSpeakerId) {
      logger.warn(
        { jobId: job.job_id, sessionId: job.session_id },
        'TONEStage: Missing speaker_id, skipping TONE'
      );
      return {
        toneAudio: undefined,
        toneFormat: undefined,
        speakerId: undefined,
      };
    }

    // 生成 TONE 音色配音
    try {
      // 使用 SequentialExecutor 确保同一 session 的 TONE 任务按顺序执行
      const executor = getSequentialExecutor();
      const taskType = 'TTS' as const;  // TONE使用TTS的SequentialExecutor队列
      const sessionId = job.session_id || job.job_id;
      const utteranceIndex = job.utterance_index || 0;

      const toneResult = await executor.execute(
        sessionId,
        utteranceIndex,
        taskType,
        async () => {
          // GPU仲裁：获取GPU租约
          return await withGpuLease(
            'OTHER',  // TONE不在GpuTaskType中，使用OTHER
            async () => {
              const toneTask: TONETask = {
                audio: ttsAudio,
                audio_format: ttsFormat,
                sample_rate: job.sample_rate || 16000,
                action: 'clone',  // 使用 clone 模式进行音色配音
                speaker_id: finalSpeakerId,
                job_id: job.job_id,
              };

              return await this.taskRouter!.routeTONETask(toneTask);
            },
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              stage: 'TONE',
            }
          );
        }
      );

      const toneDuration = Date.now() - startTime;

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          utteranceIndex: job.utterance_index,
          speakerId: finalSpeakerId,
          toneDurationMs: toneDuration,
          hasAudio: !!toneResult.audio,
        },
        'TONEStage: TONE processing completed'
      );

      return {
        toneAudio: toneResult.audio,
        toneFormat: toneResult.audio ? ttsFormat : undefined,  // 使用与 TTS 相同的格式
        speakerId: toneResult.speaker_id || finalSpeakerId,
        toneTimeMs: toneDuration,
      };
    } catch (error) {
      logger.error(
        {
          error,
          jobId: job.job_id,
          sessionId: job.session_id,
          speakerId: finalSpeakerId,
        },
        'TONEStage: TONE processing failed'
      );
      // TONE 失败不影响整体流程，返回空结果
      return {
        toneAudio: undefined,
        toneFormat: undefined,
        speakerId: finalSpeakerId,
      };
    }
  }
}
