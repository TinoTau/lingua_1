// 流水线编排器 - 协调多个服务完成完整流程

import logger from '../logger';
import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../task-router/task-router';
import {
  ASRTask,
  ASRResult,
  NMTTask,
  NMTResult,
  TTSTask,
  TTSResult,
} from '../task-router/types';
import { JobResult, PartialResultCallback } from '../inference/inference-service';

export class PipelineOrchestrator {
  constructor(private taskRouter: TaskRouter) {}

  /**
   * 处理完整任务（ASR -> NMT -> TTS）
   * @param asrCompletedCallback ASR 完成时的回调，用于释放 ASR 服务容量
   */
  async processJob(
    job: JobAssignMessage,
    partialCallback?: PartialResultCallback,
    asrCompletedCallback?: (asrCompleted: boolean) => void
  ): Promise<JobResult> {
    const startTime = Date.now();

    try {
      // 1. ASR 任务
      logger.debug({ jobId: job.job_id }, 'Starting ASR task');
      const asrTask: ASRTask = {
        audio: job.audio,
        audio_format: job.audio_format || 'pcm16',
        sample_rate: job.sample_rate || 16000,
        src_lang: job.src_lang,
        enable_streaming: job.enable_streaming_asr || false,
        context_text: (job as any).context_text,
        job_id: job.job_id, // 传递 job_id 用于任务取消
      };

      let asrResult: ASRResult;
      if (job.enable_streaming_asr && partialCallback) {
        // 流式 ASR 处理
        asrResult = await this.processASRStreaming(asrTask, partialCallback);
      } else {
        asrResult = await this.taskRouter.routeASRTask(asrTask);
      }

      logger.debug({ jobId: job.job_id, text: asrResult.text }, 'ASR task completed');
      
      // ASR 完成后，立即通知 InferenceService 从 currentJobs 中移除任务
      // 这样可以让 ASR 服务更快地处理下一个任务，避免任务堆积
      if (asrCompletedCallback) {
        asrCompletedCallback(true);
      }

      // 检查 ASR 结果是否为空或无意义（防止空文本进入 NMT/TTS）
      // 重要：ASR 服务已经过滤了空文本，但节点端也应该检查以确保安全
      const asrTextTrimmed = (asrResult.text || '').trim();
      if (!asrTextTrimmed || asrTextTrimmed.length === 0) {
        logger.warn(
          { jobId: job.job_id, asrText: asrResult.text },
          'ASR result is empty, skipping NMT and TTS'
        );
        // 返回空结果，不进行翻译和 TTS
        return {
          text_asr: '',
          text_translated: '',
          tts_audio: '',
          tts_format: 'pcm16',
          extra: {
            emotion: undefined,
            speech_rate: undefined,
            voice_style: undefined,
          },
        };
      }

      // 检查是否为无意义文本（如 "The", "A", "An" 等）
      // 这些通常是 NMT 对空文本的默认翻译
      const meaninglessWords = ['the', 'a', 'an', 'this', 'that', 'it'];
      if (meaninglessWords.includes(asrTextTrimmed.toLowerCase())) {
        logger.warn(
          { jobId: job.job_id, asrText: asrResult.text },
          'ASR result is meaningless word, skipping NMT and TTS'
        );
        return {
          text_asr: asrResult.text,
          text_translated: '',
          tts_audio: '',
          tts_format: 'pcm16',
          extra: {
            emotion: undefined,
            speech_rate: undefined,
            voice_style: undefined,
          },
        };
      }

      // 2. NMT 任务（异步处理，不阻塞 ASR 服务）
      logger.debug({ jobId: job.job_id }, 'Starting NMT task');
      // 关键修复：context_text 应该是上一个utterance的文本，而不是当前文本
      // 如果使用当前文本作为上下文，会导致NMT输入重复（context_text + text = text + text）
      // 暂时不传递上下文，或者需要从其他地方获取上一个utterance的文本
      const nmtTask: NMTTask = {
        text: asrTextTrimmed,
        src_lang: job.src_lang,
        tgt_lang: job.tgt_lang,
        context_text: undefined, // 不传递上下文，避免重复翻译（TODO: 如果需要上下文，应该传递上一个utterance的文本）
        job_id: job.job_id, // 传递 job_id 用于任务取消
      };

      const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
      logger.debug({ jobId: job.job_id, text: nmtResult.text }, 'NMT task completed');

      // 检查 NMT 结果是否为空或无意义
      const nmtTextTrimmed = (nmtResult.text || '').trim();
      if (!nmtTextTrimmed || nmtTextTrimmed.length === 0) {
        logger.warn(
          { jobId: job.job_id, asrText: asrResult.text, nmtText: nmtResult.text },
          'NMT result is empty, skipping TTS'
        );
        return {
          text_asr: asrResult.text,
          text_translated: '',
          tts_audio: '',
          tts_format: 'pcm16',
          extra: {
            emotion: undefined,
            speech_rate: undefined,
            voice_style: undefined,
          },
        };
      }

      // 检查 NMT 结果是否为无意义单词
      if (meaninglessWords.includes(nmtTextTrimmed.toLowerCase())) {
        logger.warn(
          { jobId: job.job_id, asrText: asrResult.text, nmtText: nmtResult.text },
          'NMT result is meaningless word, skipping TTS'
        );
        return {
          text_asr: asrResult.text,
          text_translated: nmtResult.text,
          tts_audio: '',
          tts_format: 'pcm16',
          extra: {
            emotion: undefined,
            speech_rate: undefined,
            voice_style: undefined,
          },
        };
      }

      // 3. TTS 任务
      logger.debug({ jobId: job.job_id }, 'Starting TTS task');
      const ttsTask: TTSTask = {
        text: nmtTextTrimmed,
        lang: job.tgt_lang,
        voice_id: (job as any).voice_id,
        speaker_id: (job as any).speaker_id,
        sample_rate: job.sample_rate || 16000,
        job_id: job.job_id, // 传递 job_id 用于任务取消
      };

      const ttsResult = await this.taskRouter.routeTTSTask(ttsTask);
      logger.debug({ jobId: job.job_id }, 'TTS task completed');

      // 4. 返回结果
      const result: JobResult = {
        text_asr: asrResult.text,
        text_translated: nmtResult.text,
        tts_audio: ttsResult.audio,
        tts_format: ttsResult.audio_format,
        extra: {
          emotion: undefined,
          speech_rate: undefined,
          voice_style: undefined,
        },
      };

      const processingTime = Date.now() - startTime;
      logger.info(
        { jobId: job.job_id, processingTime },
        'Pipeline orchestration completed'
      );

      return result;
    } catch (error) {
      logger.error({ error, jobId: job.job_id }, 'Pipeline orchestration failed');
      throw error;
    }
  }

  /**
   * 处理流式 ASR
   */
  private async processASRStreaming(
    task: ASRTask,
    partialCallback: PartialResultCallback
  ): Promise<ASRResult> {
    // 对于流式 ASR，我们需要通过 WebSocket 连接
    // 这里简化处理，实际应该使用 WebSocket 客户端
    // 暂时回退到非流式处理
    logger.warn({}, 'Streaming ASR not fully implemented, falling back to non-streaming');
    return await this.taskRouter.routeASRTask({
      ...task,
      enable_streaming: false,
    });
  }

  /**
   * 处理仅 ASR 任务
   */
  async processASROnly(job: JobAssignMessage): Promise<{ text_asr: string }> {
    const asrTask: ASRTask = {
      audio: job.audio,
      audio_format: job.audio_format || 'pcm16',
      sample_rate: job.sample_rate || 16000,
      src_lang: job.src_lang,
      enable_streaming: job.enable_streaming_asr || false,
      context_text: (job as any).context_text,
      job_id: job.job_id, // 传递 job_id 用于任务取消
    };

    const asrResult = await this.taskRouter.routeASRTask(asrTask);
    return { text_asr: asrResult.text };
  }

  /**
   * 处理仅 NMT 任务
   */
  async processNMTOnly(
    text: string,
    srcLang: string,
    tgtLang: string,
    contextText?: string
  ): Promise<{ text_translated: string }> {
    const nmtTask: NMTTask = {
      text,
      src_lang: srcLang,
      tgt_lang: tgtLang,
      context_text: contextText,
    };

    const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
    return { text_translated: nmtResult.text };
  }

  /**
   * 处理仅 TTS 任务
   */
  async processTTSOnly(
    text: string,
    lang: string,
    voiceId?: string,
    speakerId?: string,
    sampleRate?: number
  ): Promise<{ tts_audio: string; tts_format: string }> {
    const ttsTask: TTSTask = {
      text,
      lang,
      voice_id: voiceId,
      speaker_id: speakerId,
      sample_rate: sampleRate || 16000,
    };

    const ttsResult = await this.taskRouter.routeTTSTask(ttsTask);
    return {
      tts_audio: ttsResult.audio,
      tts_format: ttsResult.audio_format,
    };
  }
}

