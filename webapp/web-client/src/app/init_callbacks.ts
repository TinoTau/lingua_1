/**
 * App 初始化：混音器输出、回调注册
 * 从 App 拆出，保持行为不变
 */

import { AudioMixer } from '../audio_mixer';
import { StateMachine } from '../state_machine';
import { Recorder } from '../recorder';
import { WebSocketClient } from '../websocket_client';
import { TtsPlayer } from '../tts_player';
import { SessionManager } from './session_manager';
import { TranslationDisplayManager } from './translation_display';
import { AppPlayback } from './playback';
import { ObservabilityManager } from '../observability';
import { SessionState } from '../types';
import { ServerMessage } from '../types';
import { handleServerMessage, ServerMessageHandlerContext } from './message_handler';
import { logger } from '../logger';

/**
 * 创建并挂载混音器输出 audio 元素，并启动定时更新流
 */
export function createAndAttachAudioMixerOutput(audioMixer: AudioMixer): HTMLAudioElement {
  const audioMixerOutput = document.createElement('audio');
  audioMixerOutput.autoplay = true;
  audioMixerOutput.style.display = 'none';
  document.body.appendChild(audioMixerOutput);

  const updateOutput = async () => {
    if (audioMixer && audioMixerOutput) {
      const stream = audioMixer.getOutputStream();
      if (stream && audioMixerOutput.srcObject !== stream) {
        audioMixerOutput.srcObject = stream;
      }
    }
  };
  setInterval(updateOutput, 100);
  return audioMixerOutput;
}

export interface AppCallbacksContext {
  stateMachine: StateMachine;
  recorder: Recorder;
  wsClient: WebSocketClient;
  sessionManager: SessionManager;
  translationDisplay: TranslationDisplayManager;
  ttsPlayer: TtsPlayer;
  appPlayback: AppPlayback;
  observability: ObservabilityManager | null;
  getMessageHandlerContext(): ServerMessageHandlerContext;
  onStateChange(newState: SessionState, oldState: SessionState): void;
}

/**
 * 注册状态机、录音、WebSocket、TTS 等回调
 */
export function setupAppCallbacks(ctx: AppCallbacksContext): void {
  ctx.stateMachine.onStateChange((newState, oldState) => {
    ctx.onStateChange(newState, oldState);
  });

  ctx.recorder.setAudioFrameCallback((audioData) => {
    ctx.sessionManager.onAudioFrame(audioData);
  });

  ctx.recorder.setSilenceDetectedCallback(() => {
    ctx.sessionManager.onSilenceDetected();
  });

  ctx.wsClient.setMessageCallback((message: ServerMessage) => {
    logger.info('App', '收到服务器消息回调', { type: message.type, session_id: (message as any).session_id });
    handleServerMessage(ctx.getMessageHandlerContext(), message).catch((error) => {
      logger.error('App', '处理服务器消息时出错', { message_type: message.type, error: String(error) });
    });
  });

  ctx.wsClient.setReconnectCallback(() => {
    if (ctx.observability) {
      ctx.observability.recordReconnect();
    }
  });

  ctx.ttsPlayer.setPlaybackStartedCallback(() => {
    ctx.appPlayback.onPlaybackStarted();
  });
  ctx.ttsPlayer.setPlaybackFinishedCallback(() => {
    ctx.appPlayback.onPlaybackFinished();
  });
  ctx.ttsPlayer.setPlaybackIndexChangeCallback((utteranceIndex) => {
    ctx.translationDisplay.setCurrentPlayingIndex(utteranceIndex);
    ctx.appPlayback.onPlaybackIndexChange(utteranceIndex);
  });
  ctx.ttsPlayer.setMemoryPressureCallback((pressure) => {
    ctx.appPlayback.onMemoryPressure(pressure);
  });
}
