/**
 * runTtsStep - TTS 步骤
 * 调用 TTSStage 生成 TTS 音频
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from '../context/job-context';
import { ServicesBundle } from '../job-pipeline';
import { TTSStage } from '../../agent/postprocess/tts-stage';
import logger from '../../logger';

export async function runTtsStep(
  job: JobAssignMessage,
  ctx: JobContext,
  services: ServicesBundle
): Promise<void> {
  // 如果去重检查失败，跳过 TTS
  if (ctx.shouldSend === false) {
    return;
  }

  // 如果翻译文本为空，跳过 TTS
  const textToTts = ctx.translatedText || '';
  if (!textToTts || textToTts.trim().length === 0) {
    ctx.ttsAudio = '';
    ctx.ttsFormat = 'opus';
    return;
  }

  // 如果没有 TaskRouter，跳过 TTS
  if (!services.taskRouter) {
    logger.error(
      { jobId: job.job_id },
      'runTtsStep: TaskRouter not available'
    );
    ctx.ttsAudio = '';
    ctx.ttsFormat = 'opus';
    return;
  }

  // 创建 TTSStage
  const ttsStage = new TTSStage(services.taskRouter);

  // 执行 TTS
  try {
    const ttsResult = await ttsStage.process(job, textToTts);

    // 更新 JobContext
    ctx.ttsAudio = ttsResult.ttsAudio;
    ctx.ttsFormat = ttsResult.ttsFormat;

    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        ttsAudioLength: ctx.ttsAudio?.length || 0,
        ttsFormat: ctx.ttsFormat,
      },
      'runTtsStep: TTS completed'
    );
  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
      },
      'runTtsStep: TTS failed'
    );
    ctx.ttsAudio = '';
    ctx.ttsFormat = 'opus';
  }
}
