/**
 * 服务器消息处理逻辑
 * 从 App 拆出，保持接口与行为不变
 */

import { SessionState } from '../types';
import {
  ServerMessage,
  ErrorMessage,
  Config,
} from '../types';
import { AsrSubtitle } from '../asr_subtitle';
import { TtsPlayer } from '../tts_player';
import { TranslationDisplayManager } from './translation_display';
import { RoomManager } from './room_manager';
import { WebRTCManager } from './webrtc_manager';
import { ObservabilityManager } from '../observability';
import { logger } from '../logger';

export interface ServerMessageHandlerContext {
  getIsSessionActive(): boolean;
  asrSubtitle: AsrSubtitle;
  translationDisplay: TranslationDisplayManager;
  observability: ObservabilityManager | null;
  getCurrentTraceId(): string | null;
  setCurrentTraceId(v: string | null): void;
  getCurrentGroupId(): string | null;
  setCurrentGroupId(v: string | null): void;
  getState(): SessionState;
  roomManager: RoomManager;
  webrtcManager: WebRTCManager;
  /** 完整退出房间（含结束会话、关闭 WebRTC、roomManager.leaveRoom） */
  leaveRoom(): void;
  handleTtsAudioForRoomMode(base64Audio: string): Promise<void>;
  notifyTtsAudioAvailable(): void;
  startTtsPlayback(): Promise<void>;
  ttsPlayer: TtsPlayer;
  config: Config;
}

/**
 * 处理单条服务器消息
 */
export async function handleServerMessage(
  ctx: ServerMessageHandlerContext,
  message: ServerMessage
): Promise<void> {
  logger.info('App.MessageHandler', '开始处理服务器消息', { type: message.type, session_id: (message as any).session_id });

  switch (message.type) {
    case 'asr_partial':
      if (!ctx.getIsSessionActive()) {
        logger.info('App.MessageHandler', '会话已结束，丢弃 ASR 部分结果', { text_preview: message.text?.substring(0, 50) });
        return;
      }
      if (message.is_final) {
        ctx.asrSubtitle.updateFinal(message.text);
      } else {
        ctx.asrSubtitle.updatePartial(message.text);
      }
      break;

    case 'translation':
      if (!ctx.getIsSessionActive()) {
        logger.info('App.MessageHandler', '会话已结束，丢弃翻译消息', { text_preview: message.text?.substring(0, 50) });
        return;
      }
      logger.info('App.MessageHandler', 'Translation 消息', { text_preview: message.text?.substring(0, 80) });
      break;

    case 'missing_result':
      logger.warn('App.MessageHandler', 'Missing result 收到', {
        utterance_index: message.utterance_index,
        reason: message.reason,
        created_at_ms: message.created_at_ms,
        trace_id: message.trace_id,
      });
      const cachedResult = ctx.translationDisplay.getTranslationResult(message.utterance_index);
      if (cachedResult) {
        logger.info('App.MessageHandler', 'Missing result 已有缓存结果且已显示，不重复显示', { utterance_index: message.utterance_index });
      } else {
        logger.warn('App.MessageHandler', 'Missing result 无缓存文本，静音/空 utterance 不占位', { utterance_index: message.utterance_index, reason: message.reason });
      }
      return;

    case 'backpressure':
      logger.info('App.MessageHandler', 'Backpressure 收到', { action: (message as any).action });
      if (ctx.observability) {
        ctx.observability.recordBackpressureEvent(message.action);
      }
      break;

    case 'error': {
      const errorMsg = message as ErrorMessage;
      const errorTraceId = (errorMsg as any).trace_id;
      logger.error('App.MessageHandler', '收到服务器错误消息', {
        code: errorMsg.code,
        message: errorMsg.message,
        trace_id: errorTraceId,
      });
      const hasResultForTrace = errorTraceId && ctx.getCurrentTraceId() === errorTraceId;
      const hasOtherResults =
        ctx.translationDisplay.getTranslationResult(0) !== undefined ||
        ctx.translationDisplay.getTranslationResult(1) !== undefined;

      if (hasResultForTrace) {
        logger.warn('App.MessageHandler', '收到错误但已有对应翻译结果，不弹窗', { trace_id: errorTraceId, code: errorMsg.code });
      } else if (errorMsg.code === 'PROCESSING_ERROR' && hasOtherResults) {
        logger.warn('App.MessageHandler', '收到 PROCESSING_ERROR 但已有其他结果，不弹窗', { trace_id: errorTraceId });
      } else {
        const isNonCriticalError =
          errorMsg.code === 'PROCESSING_ERROR' ||
          errorMsg.code === 'NMT_TIMEOUT' ||
          errorMsg.code === 'TTS_TIMEOUT';
        if (isNonCriticalError && hasOtherResults) {
          logger.warn('App.MessageHandler', '收到非关键错误但已有其他结果，不弹窗', { trace_id: errorTraceId, code: errorMsg.code });
        } else {
          alert(`服务器错误: ${errorMsg.message || errorMsg.code || 'Unknown error'}`);
        }
      }
      break;
    }

    case 'translation_result': {
      logger.info('App.MessageHandler', '进入 translation_result 分支', {
        job_id: message.job_id,
        utterance_index: message.utterance_index,
        has_text_asr: !!message.text_asr,
        has_text_translated: !!message.text_translated,
        has_tts_audio: !!(message.tts_audio && message.tts_audio.length > 0),
        is_session_active: ctx.getIsSessionActive(),
        state: ctx.getState(),
      });

      if (!ctx.getIsSessionActive()) {
        logger.warn('App.MessageHandler', '会话已结束，丢弃翻译结果（含 TTS）', {
          job_id: message.job_id,
          utterance_index: message.utterance_index,
          trace_id: message.trace_id,
        });
        return;
      }

      const asrEmpty = !message.text_asr || message.text_asr.trim() === '';
      const translatedEmpty = !message.text_translated || message.text_translated.trim() === '';
      const ttsEmpty = !message.tts_audio || message.tts_audio.length === 0;

      if (asrEmpty && translatedEmpty && ttsEmpty) {
        logger.info('App.MessageHandler', '收到空文本结果（静音检测），跳过', {
          job_id: message.job_id,
          utterance_index: message.utterance_index,
        });
        return;
      }

      if (!message.tts_audio || message.tts_audio.length === 0) {
        logger.warn('App.MessageHandler', 'translation_result 无音频数据', {
          job_id: message.job_id,
          utterance_index: message.utterance_index,
          has_text_asr: !!message.text_asr,
          has_text_translated: !!message.text_translated,
        });
      }

      ctx.setCurrentTraceId(message.trace_id);
      ctx.setCurrentGroupId(message.group_id || null);

      logger.info('App.MessageHandler', '翻译结果摘要', {
        job_id: message.job_id,
        utterance_index: message.utterance_index,
        asr_preview: message.text_asr?.substring(0, 60),
        translated_preview: message.text_translated?.substring(0, 60),
        has_tts_audio: !!(message.tts_audio && message.tts_audio.length > 0),
        state: ctx.getState(),
      });

      if (message.text_asr || message.text_translated) {
        const hasAudio = message.tts_audio && message.tts_audio.length > 0;
        const audioLossMark = hasAudio ? '' : '[音频丢失] ';
        const originalText = hasAudio ? message.text_asr : (message.text_asr ? `${audioLossMark}${message.text_asr}` : message.text_asr);
        const translatedText = hasAudio ? message.text_translated : (message.text_translated ? `${audioLossMark}${message.text_translated}` : message.text_translated);

        ctx.translationDisplay.saveTranslationResult(message.utterance_index, {
          originalText,
          translatedText,
          serviceTimings: message.service_timings,
          networkTimings: message.network_timings,
          schedulerSentAtMs: message.scheduler_sent_at_ms,
        });
        logger.info('App.MessageHandler', '翻译结果已保存到 Map', { utterance_index: message.utterance_index, has_audio: hasAudio });

        if (ctx.translationDisplay.isDisplayed(message.utterance_index)) {
          logger.info('App.MessageHandler', '翻译结果已显示过，跳过重复显示', { utterance_index: message.utterance_index });
        } else {
          const displayed = ctx.translationDisplay.displayTranslationResult(
            originalText,
            translatedText,
            message.utterance_index,
            message.service_timings,
            message.network_timings,
            message.scheduler_sent_at_ms
          );
          if (displayed) {
            ctx.translationDisplay.markAsDisplayed(message.utterance_index);
            logger.info('App.MessageHandler', '翻译结果已立即显示', { utterance_index: message.utterance_index });
          } else {
            logger.warn('App.MessageHandler', '翻译结果显示失败（可能被过滤）', {
              utterance_index: message.utterance_index,
              original_preview: originalText?.substring(0, 50),
              translated_preview: translatedText?.substring(0, 50),
            });
          }
        }
      }

      if (message.tts_audio && message.tts_audio.length > 0) {
        logger.info('App.MessageHandler', '准备添加 TTS 音频到缓冲区', {
          job_id: message.job_id,
          utterance_index: message.utterance_index,
          base64_length: message.tts_audio.length,
          is_in_room: ctx.roomManager.getIsInRoom(),
          buffer_count_before: ctx.ttsPlayer.getBufferCount(),
        });

        if (!ctx.getIsSessionActive()) {
          logger.warn('App.MessageHandler', '会话已结束，丢弃 TTS 音频', {
            job_id: message.job_id,
            utterance_index: message.utterance_index,
          });
          return;
        }

        if (ctx.roomManager.getIsInRoom()) {
          logger.info('App.MessageHandler', '房间模式：使用音频混控器');
          await ctx.handleTtsAudioForRoomMode(message.tts_audio);
          ctx.notifyTtsAudioAvailable();
        } else {
          const ttsFormat = message.tts_format || 'pcm16';
          const sampleRate = 16000;
          const estimatedDurationSeconds = (message.tts_audio.length * 3) / 4 / (sampleRate * 2);
          const maxBufferDuration = ctx.ttsPlayer.getMaxBufferDuration();
          const currentDuration = ctx.ttsPlayer.getTotalDuration() || 0;
          const willExceedLimit = currentDuration + estimatedDurationSeconds > maxBufferDuration;

          if (willExceedLimit && !ctx.ttsPlayer.getIsPlaying()) {
            const currentState = ctx.getState();
            const hasPendingAudio = ctx.ttsPlayer.hasPendingAudio();
            if (currentState === SessionState.INPUT_RECORDING && (hasPendingAudio || currentDuration > 0)) {
              logger.warn('App.MessageHandler', '检测到大音频，添加前触发自动播放', {
                utterance_index: message.utterance_index,
                estimated_duration_sec: (estimatedDurationSeconds || 0).toFixed(2),
                current_duration_sec: (currentDuration || 0).toFixed(2),
                max_duration_sec: maxBufferDuration,
              });
              ctx.startTtsPlayback().catch((error) => {
                logger.error('App.MessageHandler', '自动播放失败', { error: String(error) });
              });
            }
          }

          logger.info('App.MessageHandler', '开始添加 TTS 音频到 TtsPlayer', { job_id: message.job_id, utterance_index: message.utterance_index, format: ttsFormat });
          ctx.ttsPlayer
            .addAudioChunk(message.tts_audio, message.utterance_index, ttsFormat)
            .then(async () => {
              logger.info('App.MessageHandler', 'TTS 音频已添加到 TtsPlayer', {
                job_id: message.job_id,
                utterance_index: message.utterance_index,
                buffer_count_after: ctx.ttsPlayer.getBufferCount(),
              });
              if (!ctx.getIsSessionActive()) {
                logger.warn('App.MessageHandler', '会话已结束但音频已入缓冲', { job_id: message.job_id, utterance_index: message.utterance_index });
                return;
              }

              const currentState = ctx.getState();
              const bufferCount = ctx.ttsPlayer.getBufferCount();
              const isAutoPlayEnabled = ctx.config.autoPlay ?? false;

              logger.info('App.MessageHandler', 'TTS 音频块已成功加入缓冲区', {
                job_id: message.job_id,
                utterance_index: message.utterance_index,
                buffer_count: bufferCount,
                is_playing: ctx.ttsPlayer.getIsPlaying(),
                state: currentState,
              });

              if (isAutoPlayEnabled && currentState === SessionState.INPUT_RECORDING && !ctx.ttsPlayer.getIsPlaying()) {
                logger.info('App.MessageHandler', '自动播放模式：音频已添加，即将开始播放', { utterance_index: message.utterance_index, buffer_count: bufferCount });
                setTimeout(() => {
                  ctx.startTtsPlayback().catch((error) => {
                    logger.error('App.MessageHandler', '自动播放失败', { error: String(error) });
                  });
                }, 100);
              } else {
                logger.info('App.MessageHandler', '手动播放模式：音频已入缓冲，等待播放', { utterance_index: message.utterance_index, buffer_count: bufferCount });
              }

              ctx.notifyTtsAudioAvailable();
            })
            .catch((error) => {
              logger.error('App.MessageHandler', '添加 TTS 音频块失败', {
                job_id: message.job_id,
                utterance_index: message.utterance_index,
                base64_length: message.tts_audio?.length,
                tts_format: ttsFormat,
                error: error?.message,
              });

              if (message.text_asr || message.text_translated) {
                const isMemoryLimitError = error?.message?.includes('AUDIO_DISCARDED');
                const discardReason = isMemoryLimitError ? error.message.replace('AUDIO_DISCARDED: ', '') : undefined;
                const warningPrefix = isMemoryLimitError ? '[内存限制]' : '[播放失败]';
                const warningSuffix = isMemoryLimitError && discardReason ? ` (${discardReason})` : '';
                const failedOriginalText = message.text_asr ? `${warningPrefix} ${message.text_asr}${warningSuffix}` : '';
                const failedTranslatedText = message.text_translated ? `${warningPrefix} ${message.text_translated}${warningSuffix}` : '';

                ctx.translationDisplay.saveTranslationResult(message.utterance_index, {
                  originalText: failedOriginalText,
                  translatedText: failedTranslatedText,
                  serviceTimings: message.service_timings,
                  networkTimings: message.network_timings,
                  schedulerSentAtMs: message.scheduler_sent_at_ms,
                });

                if (!ctx.translationDisplay.isDisplayed(message.utterance_index)) {
                  const displayed = ctx.translationDisplay.displayTranslationResult(
                    failedOriginalText,
                    failedTranslatedText,
                    message.utterance_index,
                    message.service_timings,
                    message.network_timings,
                    message.scheduler_sent_at_ms
                  );
                  if (displayed) {
                    ctx.translationDisplay.markAsDisplayed(message.utterance_index);
                    logger.info('App.MessageHandler', '翻译结果已显示（带失败/内存标记）', { utterance_index: message.utterance_index, warning: warningPrefix });
                  }
                }
              }
            });
        }
      } else {
        logger.warn('App.MessageHandler', 'translation_result 中无 TTS 音频', {
          utterance_index: message.utterance_index,
          job_id: message.job_id,
        });
      }
      break;
    }

    case 'tts_audio':
      if (!ctx.getIsSessionActive()) {
        logger.info('App.MessageHandler', '会话已结束，丢弃 TTS 音频消息', { payload_length: message.payload?.length || 0 });
        return;
      }
      logger.info('App.MessageHandler', '收到单独 TTS 音频消息', { state: ctx.getState(), payload_length: message.payload?.length || 0 });
      const ttsUtteranceIndex = (message as any).utterance_index ?? -1;
      const ttsFormatSingle = (message as any).tts_format || 'pcm16';
      if (ctx.roomManager.getIsInRoom()) {
        await ctx.handleTtsAudioForRoomMode(message.payload);
        ctx.notifyTtsAudioAvailable();
      } else {
        ctx.ttsPlayer
          .addAudioChunk(message.payload, ttsUtteranceIndex, ttsFormatSingle)
          .then(() => {
            logger.info('App.MessageHandler', 'TTS 音频块已添加（单独消息）', { utterance_index: ttsUtteranceIndex });
            ctx.notifyTtsAudioAvailable();
          })
          .catch((error) => {
            logger.error('App.MessageHandler', '添加 TTS 音频块失败（单独消息）', { error: String(error) });
          });
      }
      break;

    case 'room_create_ack':
      ctx.roomManager.setRoomCode(message.room_code);
      ctx.webrtcManager.setRoomInfo(message.room_code, []);
      logger.info('App.MessageHandler', 'Room created', { room_code: message.room_code });
      if (typeof window !== 'undefined' && (window as any).onRoomCreated) {
        (window as any).onRoomCreated(message.room_code);
      }
      break;

    case 'room_members':
      if (message.room_code === ctx.roomManager.getCurrentRoomCode()) {
        ctx.roomManager.updateMembers(message.members);
        ctx.webrtcManager.setRoomInfo(message.room_code, message.members);
        logger.info('App.MessageHandler', 'Room members updated', { room_code: message.room_code, count: message.members?.length });
        ctx.webrtcManager.syncPeerConnections();
        if (typeof window !== 'undefined' && (window as any).onRoomMembersUpdated) {
          (window as any).onRoomMembersUpdated(message.members);
        }
      }
      break;

    case 'webrtc_offer':
      await ctx.webrtcManager.handleWebRTCOffer(message.room_code, message.to, message.sdp);
      break;

    case 'webrtc_answer':
      await ctx.webrtcManager.handleWebRTCAnswer(message.to, message.sdp);
      break;

    case 'webrtc_ice':
      await ctx.webrtcManager.handleWebRTCIce(message.to, message.candidate);
      break;

    case 'room_error':
      logger.error('App.MessageHandler', 'Room error', { code: message.code, message: message.message });
      break;

    case 'room_expired':
      if (message.room_code === ctx.roomManager.getCurrentRoomCode()) {
        logger.info('App.MessageHandler', 'Room expired', { message: message.message });
        alert('房间已过期: ' + message.message);
        ctx.leaveRoom();
        if (typeof window !== 'undefined' && (window as any).onRoomExpired) {
          (window as any).onRoomExpired();
        }
      }
      break;

    default:
      logger.warn('App.MessageHandler', '收到未处理的消息类型', { type: (message as any).type });
      break;
  }
}
