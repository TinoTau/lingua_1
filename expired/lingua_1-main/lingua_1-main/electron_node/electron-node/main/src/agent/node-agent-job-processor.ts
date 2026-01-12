/**
 * Node Agent Job Processor
 * 处理job处理相关的逻辑
 */

import WebSocket from 'ws';
import logger from '../logger';
import { JobAssignMessage, AsrPartialMessage } from '../../../../shared/protocols/messages';
import { JobResult } from '../inference/inference-service';
import { PostProcessCoordinator } from './postprocess/postprocess-coordinator';
import { AggregatorMiddleware } from './aggregator-middleware';

export class JobProcessor {
  private ws: WebSocket | null = null;
  private nodeId: string | null = null;

  constructor(
    private inferenceService: any,
    private postProcessCoordinator: PostProcessCoordinator | null,
    private aggregatorMiddleware: AggregatorMiddleware,
    private nodeConfig: any,
    private pythonServiceManager: any
  ) {}

  /**
   * 更新连接信息
   */
  updateConnection(ws: WebSocket | null, nodeId: string | null): void {
    this.ws = ws;
    this.nodeId = nodeId;
  }

  /**
   * 处理job（服务启动、推理、后处理）
   */
  async processJob(
    job: JobAssignMessage,
    startTime: number
  ): Promise<{ finalResult: JobResult; shouldSend: boolean; reason?: string }> {
    // 根据 features 启动所需的服务
    if (job.features?.speaker_identification && this.pythonServiceManager) {
      try {
        await this.pythonServiceManager.startService('speaker_embedding');
        logger.info({ jobId: job.job_id }, 'Started speaker_embedding service for speaker_identification feature');
      } catch (error) {
        logger.warn({ error, jobId: job.job_id }, 'Failed to start speaker_embedding service, continuing without it');
      }
    }

    // 如果启用了流式 ASR，设置部分结果回调
    const partialCallback = job.enable_streaming_asr ? (partial: { text: string; is_final: boolean; confidence: number }) => {
      // 发送 ASR 部分结果到调度服务器
      // 对齐协议规范：asr_partial 消息格式（从节点发送到调度服务器，需要包含 node_id）
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.nodeId) {
        const partialMessage: AsrPartialMessage = {
          type: 'asr_partial',
          node_id: this.nodeId,
          session_id: job.session_id,
          utterance_index: job.utterance_index,
          job_id: job.job_id,
          text: partial.text,
          is_final: partial.is_final,
          trace_id: job.trace_id, // Added: propagate trace_id
        };
        this.ws.send(JSON.stringify(partialMessage));
      }
    } : undefined;

    // 调用推理服务处理任务
    logger.info(
      {
        jobId: job.job_id,
        sessionId: job.session_id,
        utteranceIndex: job.utterance_index,
        audioFormat: job.audio_format,
        audioLength: job.audio ? job.audio.length : 0,
      },
      'Processing job: received audio data'
    );
    const result = await this.inferenceService.processJob(job, partialCallback);

    // 后处理（在发送结果前）
    // 优先使用 PostProcessCoordinator（新架构），否则使用 AggregatorMiddleware（旧架构）
    let finalResult = result;
    const enablePostProcessTranslation = this.nodeConfig.features?.enablePostProcessTranslation ?? true;
    
    if (enablePostProcessTranslation && this.postProcessCoordinator) {
      // 使用新架构：PostProcessCoordinator
      logger.debug({ jobId: job.job_id, sessionId: job.session_id }, 'Processing through PostProcessCoordinator (new architecture)');
      
      const postProcessResult = await this.postProcessCoordinator.process(job, result);
      
      // 统一处理 TTS Opus 编码（无论来自 Pipeline 还是 PostProcess）
      let ttsAudio = postProcessResult.ttsAudio || result.tts_audio || '';
      let ttsFormat = postProcessResult.ttsFormat || result.tts_format || 'opus';
      
      // 如果 TTS 音频是 WAV 格式，需要编码为 Opus（统一在 NodeAgent 层处理）
      if (ttsAudio && (ttsFormat === 'wav' || ttsFormat === 'pcm16')) {
        try {
          const { convertWavToOpus } = await import('../utils/opus-codec');
          const wavBuffer = Buffer.from(ttsAudio, 'base64');
          const opusData = await convertWavToOpus(wavBuffer);
          ttsAudio = opusData.toString('base64');
          ttsFormat = 'opus';
          logger.info(
            {
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              wavSize: wavBuffer.length,
              opusSize: opusData.length,
              compression: (wavBuffer.length / opusData.length).toFixed(2),
            },
            'NodeAgent: TTS WAV audio encoded to Opus successfully (unified encoding)'
          );
        } catch (opusError) {
          const errorMessage = opusError instanceof Error ? opusError.message : String(opusError);
          logger.error(
            {
              error: opusError,
              jobId: job.job_id,
              sessionId: job.session_id,
              utteranceIndex: job.utterance_index,
              errorMessage,
            },
            'NodeAgent: Failed to encode TTS WAV to Opus, returning empty audio'
          );
          ttsAudio = '';
          ttsFormat = 'opus';
        }
      }
      
      if (postProcessResult.shouldSend) {
        finalResult = {
          ...result,
          text_asr: postProcessResult.aggregatedText,
          text_translated: postProcessResult.translatedText,
          tts_audio: ttsAudio,
          tts_format: ttsFormat,
        };
        
        logger.debug(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            action: postProcessResult.action,
            originalLength: result.text_asr?.length || 0,
            aggregatedLength: postProcessResult.aggregatedText.length,
          },
          'PostProcessCoordinator processing completed'
        );
        
        return { finalResult, shouldSend: true };
      } else {
        // PostProcessCoordinator 决定不发送（可能是重复文本或被过滤）
        logger.info(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            utteranceIndex: job.utterance_index,
            reason: postProcessResult.reason || 'PostProcessCoordinator filtered result',
            aggregatedText: postProcessResult.aggregatedText?.substring(0, 50) || '',
            aggregatedTextLength: postProcessResult.aggregatedText?.length || 0,
            note: 'Sending empty job_result to scheduler to prevent timeout (result filtered by PostProcessCoordinator)',
          },
          'PostProcessCoordinator filtered result (shouldSend=false), but sending empty job_result to scheduler to prevent timeout'
        );
        
        return {
          finalResult: {
            ...result,
            text_asr: '',
            text_translated: '',
            tts_audio: '',
            tts_format: 'opus',
          },
          shouldSend: false,
          reason: postProcessResult.reason || 'PostProcessCoordinator filtered result',
        };
      }
    } else {
      // 如果未使用 PostProcessCoordinator（不应该发生，但保留作为安全措施）
      finalResult = result;
      return { finalResult, shouldSend: true };
    }
  }
}
