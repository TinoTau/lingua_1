/**
 * TTSStage - TTS 音频生成阶段
 * 职责：根据翻译文本生成 TTS 音频
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { TTSTask } from '../../task-router/types';
import logger from '../../logger';

export interface TTSStageResult {
  ttsAudio: string;
  ttsFormat: string;
  ttsTimeMs?: number;
}

export class TTSStage {
  constructor(private taskRouter: TaskRouter | null) {}

  /**
   * 生成 TTS 音频
   */
  async process(
    job: JobAssignMessage,
    translatedText: string
  ): Promise<TTSStageResult> {
    const startTime = Date.now();

    // 检查是否需要生成 TTS
    if (!translatedText || translatedText.trim().length === 0) {
      logger.debug(
        { jobId: job.job_id, sessionId: job.session_id },
        'TTSStage: Translated text is empty, skipping TTS'
      );
      return {
        ttsAudio: '',
        ttsFormat: 'opus',  // 强制使用 opus 格式
      };
    }

    // 检查 tgt_lang
    if (!job.tgt_lang) {
      logger.warn(
        { jobId: job.job_id, tgtLang: job.tgt_lang },
        'TTSStage: Missing target language, skipping TTS'
      );
      return {
        ttsAudio: '',
        ttsFormat: 'opus',  // 强制使用 opus 格式
      };
    }

    if (!this.taskRouter) {
      logger.error(
        { jobId: job.job_id, sessionId: job.session_id },
        'TTSStage: TaskRouter not available'
      );
      return {
        ttsAudio: '',
        ttsFormat: 'opus',  // 强制使用 opus 格式
      };
    }

    // 检查是否为无意义单词（避免生成无意义的 TTS）
    const meaninglessWords = ['the', 'a', 'an', 'this', 'that', 'it'];
    if (meaninglessWords.includes(translatedText.trim().toLowerCase())) {
      logger.warn(
        { jobId: job.job_id, translatedText },
        'TTSStage: Translated text is meaningless word, skipping TTS'
      );
      return {
        ttsAudio: '',
        ttsFormat: 'opus',  // 强制使用 opus 格式
      };
    }

    // 生成 TTS 音频
    try {
      const ttsTask: TTSTask = {
        text: translatedText.trim(),
        lang: job.tgt_lang,
        voice_id: (job as any).voice_id,
        speaker_id: (job as any).speaker_id,
        sample_rate: job.sample_rate || 16000,
        job_id: job.job_id,
      };

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          textLength: translatedText.length,
          tgtLang: job.tgt_lang,
        },
        'TTSStage: Starting TTS task'
      );

      const ttsResult = await this.taskRouter.routeTTSTask(ttsTask);
      const ttsTimeMs = Date.now() - startTime;
      
      if (ttsTimeMs > 30000) {
        logger.warn({
          jobId: job.job_id,
          sessionId: job.session_id,
          ttsTimeMs,
          textLength: translatedText.length,
          note: 'TTS generation took longer than 30 seconds - GPU may be overloaded',
        }, 'TTSStage: TTS generation took too long');
      }

      logger.info(
        {
          jobId: job.job_id,
          sessionId: job.session_id,
          ttsTimeMs,
          audioLength: ttsResult.audio?.length || 0,
          audioFormat: ttsResult.audio_format,  // 记录实际格式
        },
        'TTSStage: TTS task completed'
      );

      // TTSStage 返回 TaskRouter 的原始结果（通常是 WAV 格式）
      // Opus 编码应该在 PostProcessCoordinator 或 PipelineOrchestrator 中进行
      // 这里不再检查格式，直接返回原始结果
      return {
        ttsAudio: ttsResult.audio || '',
        ttsFormat: ttsResult.audio_format || 'wav',  // 返回实际格式（通常是 'wav'）
        ttsTimeMs,
      };
    } catch (error) {
      // Opus 编码失败或其他错误，记录错误但返回空音频，确保任务仍然返回结果
      logger.error(
        {
          error,
          jobId: job.job_id,
          sessionId: job.session_id,
          translatedText: translatedText.substring(0, 50),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        'TTSStage: TTS task failed (Opus encoding or other error), returning empty audio'
      );
      return {
        ttsAudio: '',
        ttsFormat: 'opus',  // 强制使用 opus 格式
        ttsTimeMs: Date.now() - startTime,
      };
    }
  }
}

