/**
 * TTS 播放与闭环监控逻辑
 * 从 App 拆出，保持接口与行为不变
 */

import { SessionState } from '../types';
import { Recorder } from '../recorder';
import { WebSocketClient } from '../websocket_client';
import { TtsPlayer } from '../tts_player';
import { TranslationDisplayManager } from './translation_display';
import { SessionManager } from './session_manager';
import { StateMachine } from '../state_machine';
import { logger } from '../logger';

export interface AppPlaybackDeps {
  sessionManager: SessionManager;
  stateMachine: StateMachine;
  recorder: Recorder;
  wsClient: WebSocketClient;
  ttsPlayer: TtsPlayer;
  translationDisplay: TranslationDisplayManager;
  getCurrentTraceId(): string | null;
  getCurrentGroupId(): string | null;
  setCurrentTraceId(v: string | null): void;
  setCurrentGroupId(v: string | null): void;
  displayPendingTranslationResults(): void;
}

/**
 * 封装播放相关逻辑与 trace/group 状态
 */
export class AppPlayback {
  private deps: AppPlaybackDeps;

  constructor(deps: AppPlaybackDeps) {
    this.deps = deps;
  }

  onPlaybackIndexChange(utteranceIndex: number): void {
    console.log('[App] 播放索引变化，显示 utterance_index:', utteranceIndex);
    if (utteranceIndex === -1) {
      console.log('[App] utterance_index 为 -1，跳过文本显示');
      return;
    }
    if (this.deps.translationDisplay.isDisplayed(utteranceIndex)) {
      console.log('[App] utterance_index 已显示过，跳过重复显示:', utteranceIndex);
      return;
    }
    const result = this.deps.translationDisplay.getTranslationResult(utteranceIndex);
    if (result) {
      console.log('[App] 找到对应的翻译结果，显示文本，utterance_index:', utteranceIndex);
      const displayed = this.deps.translationDisplay.displayTranslationResult(
        result.originalText,
        result.translatedText,
        utteranceIndex,
        result.serviceTimings,
        result.networkTimings,
        result.schedulerSentAtMs
      );
      if (displayed) {
        this.deps.translationDisplay.markAsDisplayed(utteranceIndex);
        console.log('[App] 播放时文本已显示，utterance_index:', utteranceIndex);
      } else {
        console.warn('[App] 播放时文本显示失败（可能被过滤），utterance_index:', utteranceIndex);
      }
    } else {
      console.warn('[App] 未找到 utterance_index 对应的翻译结果:', utteranceIndex);
    }
  }

  onMemoryPressure(pressure: 'normal' | 'warning' | 'critical'): void {
    console.log(`[App] 内存压力: ${pressure}`);
    if (typeof window !== 'undefined' && (window as any).onMemoryPressure) {
      (window as any).onMemoryPressure(pressure);
    }
    if (pressure === 'critical') {
      const currentState = this.deps.stateMachine.getState();
      const hasPendingAudio = this.deps.ttsPlayer.hasPendingAudio();
      if (
        currentState === SessionState.INPUT_RECORDING &&
        hasPendingAudio &&
        !this.deps.ttsPlayer.getIsPlaying()
      ) {
        console.warn('[App] 内存压力过高，自动开始播放以释放内存');
        this.startTtsPlayback().catch((error) => {
          console.error('[App] 自动播放失败:', error);
        });
      }
    }
  }

  onPlaybackStarted(): void {
    const traceId = this.deps.getCurrentTraceId();
    const groupId = this.deps.getCurrentGroupId();
    if (traceId && groupId) {
      const tsStartMs = Date.now();
      this.deps.wsClient.sendTtsStarted(traceId, groupId, tsStartMs);
      console.log(`[App] 已发送 TTS_STARTED`, {
        trace_id: traceId,
        group_id: groupId,
        ts_start_ms: tsStartMs,
        ts_start_ms_iso: new Date(tsStartMs).toISOString(),
        timestamp: Date.now(),
        timestampIso: new Date().toISOString(),
      });
    } else {
      console.warn('[App] ⚠️ 无法发送 TTS_STARTED: 缺少 trace_id 或 group_id', {
        hasTraceId: !!traceId,
        hasGroupId: !!groupId,
        timestamp: Date.now(),
        timestampIso: new Date().toISOString(),
      });
    }
  }

  onPlaybackFinished(): void {
    const playbackFinishedTimestamp = Date.now();
    const currentState = this.deps.stateMachine.getState();
    const isRecording = this.deps.recorder.getIsRecording();
    const isSessionActive = this.deps.sessionManager.getIsSessionActive();

    console.log('[App] 🎵 播放完成', {
      timestamp: playbackFinishedTimestamp,
      timestampIso: new Date(playbackFinishedTimestamp).toISOString(),
      isSessionActive,
      currentState,
      isRecording,
    });

    const traceId = this.deps.getCurrentTraceId();
    const groupId = this.deps.getCurrentGroupId();
    if (traceId && groupId) {
      const tsEndMs = Date.now();
      this.deps.wsClient.sendTtsPlayEnded(traceId, groupId, tsEndMs);
      console.log(`[App] 已发送 TTS_PLAY_ENDED`, {
        trace_id: traceId,
        group_id: groupId,
        ts_end_ms: tsEndMs,
        ts_end_ms_iso: new Date(tsEndMs).toISOString(),
        timestamp: Date.now(),
        timestampIso: new Date().toISOString(),
      });
    } else {
      console.warn('[App] ⚠️ 无法发送 TTS_PLAY_ENDED: 缺少 trace_id 或 group_id', {
        hasTraceId: !!traceId,
        hasGroupId: !!groupId,
        timestamp: Date.now(),
        timestampIso: new Date().toISOString(),
      });
    }

    if (isSessionActive) {
      const playbackEndTimestamp = Date.now();
      this.deps.sessionManager.setPlaybackFinishedTimestamp(playbackEndTimestamp);
      const currentUtteranceIndex = this.deps.sessionManager.getCurrentUtteranceIndex();
      console.log('[App] 播放完成，TTS_PLAY_ENDED 消息已发送，调度服务器将重启计时器', {
        playbackEndTimestamp,
        isoString: new Date(playbackEndTimestamp).toISOString(),
        currentUtteranceIndex,
      });
      this.deps.sessionManager.setCanSendChunks(true);
    }

    this.deps.setCurrentTraceId(null);
    this.deps.setCurrentGroupId(null);

    if (isSessionActive) {
      this.monitorPlaybackToFirstAudioFrame(playbackFinishedTimestamp);
    }

    if (
      isSessionActive &&
      this.deps.stateMachine.getState() === SessionState.INPUT_RECORDING &&
      !this.deps.recorder.getIsRecording()
    ) {
      const backupRecoverTimestamp = Date.now();
      console.log('[App] 播放完成后检测到录音器未恢复，使用事件驱动恢复录音...', {
        timestamp: backupRecoverTimestamp,
        timestampIso: new Date(backupRecoverTimestamp).toISOString(),
        timeSincePlaybackFinished: backupRecoverTimestamp - playbackFinishedTimestamp,
      });
      const backupRafStart = Date.now();
      requestAnimationFrame(() => {
        const backupRafEnd = Date.now();
        const backupRafDelay = backupRafEnd - backupRafStart;
        console.log('[App] 播放完成后的备用恢复 requestAnimationFrame 回调执行', {
          rafStartTimestamp: backupRafStart,
          rafEndTimestamp: backupRafEnd,
          rafDelayMs: backupRafDelay,
        });
        if (
          this.deps.sessionManager.getIsSessionActive() &&
          this.deps.stateMachine.getState() === SessionState.INPUT_RECORDING &&
          !this.deps.recorder.getIsRecording()
        ) {
          const backupRecorderStartTimestamp = Date.now();
          this.deps.recorder.start().then(() => {
            const backupRecorderEndTimestamp = Date.now();
            console.log('[App] ✅ 播放完成后已恢复录音（事件驱动）', {
              recorderStartTimestamp: backupRecorderStartTimestamp,
              recorderEndTimestamp: backupRecorderEndTimestamp,
              recorderStartDurationMs: backupRecorderEndTimestamp - backupRecorderStartTimestamp,
              timestampIso: new Date(backupRecorderEndTimestamp).toISOString(),
              isRecording: this.deps.recorder.getIsRecording(),
            });
          }).catch((error) => {
            console.error('[App] ❌ 播放完成后恢复录音失败（事件驱动）:', {
              error,
              recorderStartTimestamp: backupRecorderStartTimestamp,
              timestampIso: new Date(Date.now()).toISOString(),
            });
          });
        }
      });

      setTimeout(() => {
        const backupFallbackTimestamp = Date.now();
        if (
          !this.deps.recorder.getIsRecording() &&
          this.deps.sessionManager.getIsSessionActive() &&
          this.deps.stateMachine.getState() === SessionState.INPUT_RECORDING
        ) {
          console.warn('[App] ⚠️ 事件驱动恢复失败，使用fallback', {
            fallbackTimestamp: backupFallbackTimestamp,
            timestampIso: new Date(backupFallbackTimestamp).toISOString(),
          });
          this.deps.recorder.start().then(() => {
            const backupFallbackEndTimestamp = Date.now();
            console.log('[App] ✅ 播放完成后已恢复录音（fallback）', {
              fallbackTimestamp: backupFallbackTimestamp,
              fallbackEndTimestamp: backupFallbackEndTimestamp,
              timestampIso: new Date(backupFallbackEndTimestamp).toISOString(),
              isRecording: this.deps.recorder.getIsRecording(),
            });
          }).catch((error) => {
            console.error('[App] ❌ 播放完成后恢复录音失败（fallback）:', {
              error,
              fallbackTimestamp: backupFallbackTimestamp,
              timestampIso: new Date(backupFallbackTimestamp).toISOString(),
            });
          });
        }
      }, 50);
    }

    console.log('[App] 等待状态机自动切换状态并恢复录音...');
  }

  monitorPlaybackToFirstAudioFrame(playbackFinishedTimestamp: number): void {
    const MONITOR_TIMEOUT_MS = 2000;
    const monitorStartTime = Date.now();
    let timeoutId: number | null = null;
    let callbackTriggered = false;
    const { sessionManager, stateMachine, recorder } = this.deps;

    logger.info('App', '🔄 开始监控闭环：播放结束 → 恢复录音 → 等待第一帧音频', {
      playbackFinishedTimestamp,
      playbackFinishedTimestampIso: new Date(playbackFinishedTimestamp).toISOString(),
      monitorStartTime,
      monitorStartTimeIso: new Date(monitorStartTime).toISOString(),
      timeoutMs: MONITOR_TIMEOUT_MS,
      currentState: stateMachine.getState(),
      isRecording: recorder.getIsRecording(),
    });

    const ensureRecorderStarted = async (): Promise<void> => {
      if (
        !recorder.getIsRecording() &&
        sessionManager.getIsSessionActive() &&
        stateMachine.getState() === SessionState.INPUT_RECORDING
      ) {
        const recorderStartTime = Date.now();
        logger.info('App', '📢 监控闭环：录音器未启动，正在启动...', {
          recorderStartTime,
          recorderStartTimeIso: new Date(recorderStartTime).toISOString(),
          timeSincePlaybackFinished: recorderStartTime - playbackFinishedTimestamp,
        });
        try {
          await recorder.start();
          const recorderEndTime = Date.now();
          const recorderStartDuration = recorderEndTime - recorderStartTime;
          logger.info('App', '✅ 监控闭环：录音器已启动', {
            recorderStartTime,
            recorderEndTime,
            recorderStartDuration,
            audioContextState: recorder.getAudioContextState() || 'unknown',
            isRecording: recorder.getIsRecording(),
          });
        } catch (error) {
          logger.error('App', '❌ 监控闭环：录音器启动失败', {
            error,
            recorderStartTime,
            timestampIso: new Date().toISOString(),
          });
        }
      } else {
        logger.info('App', '📢 监控闭环：录音器状态检查', {
          isRecording: recorder.getIsRecording(),
          isSessionActive: sessionManager.getIsSessionActive(),
          currentState: stateMachine.getState(),
          audioContextState: (recorder as any).audioContext?.state || 'unknown',
        });
      }
    };

    const firstAudioFrameCallback = (audioFrameTimestamp: number): void => {
      if (callbackTriggered) return;
      callbackTriggered = true;
      const timeToFirstFrame = audioFrameTimestamp - playbackFinishedTimestamp;
      const monitorDuration = audioFrameTimestamp - monitorStartTime;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      sessionManager.setFirstAudioFrameAfterPlaybackCallback(null);
      logger.info('App', '✅ 监控闭环：成功收到第一帧音频', {
        playbackFinishedTimestamp,
        playbackFinishedTimestampIso: new Date(playbackFinishedTimestamp).toISOString(),
        audioFrameTimestamp,
        audioFrameTimestampIso: new Date(audioFrameTimestamp).toISOString(),
        timeToFirstFrame,
        timeToFirstFrameSeconds: (timeToFirstFrame / 1000).toFixed(2),
        monitorDuration,
        monitorDurationSeconds: (monitorDuration / 1000).toFixed(2),
        isRecording: recorder.getIsRecording(),
        audioContextState: (recorder as any).audioContext?.state || 'unknown',
      });
      console.log('[App] ✅ 监控闭环完成：播放结束 → 恢复录音 → 收到第一帧音频', {
        timeToFirstFrame,
        timeToFirstFrameSeconds: (timeToFirstFrame / 1000).toFixed(2),
      });
    };

    sessionManager.setFirstAudioFrameAfterPlaybackCallback(firstAudioFrameCallback);

    timeoutId = window.setTimeout(() => {
      if (callbackTriggered) return;
      callbackTriggered = true;
      const timeoutTimestamp = Date.now();
      const timeSincePlaybackFinished = timeoutTimestamp - playbackFinishedTimestamp;
      const monitorDuration = timeoutTimestamp - monitorStartTime;
      sessionManager.setFirstAudioFrameAfterPlaybackCallback(null);
      logger.error('App', '❌ 监控闭环：超时未收到第一帧音频', {
        playbackFinishedTimestamp,
        playbackFinishedTimestampIso: new Date(playbackFinishedTimestamp).toISOString(),
        timeoutTimestamp,
        timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
        timeSincePlaybackFinished,
        timeSincePlaybackFinishedSeconds: (timeSincePlaybackFinished / 1000).toFixed(2),
        monitorDuration,
        monitorDurationSeconds: (monitorDuration / 1000).toFixed(2),
        timeoutMs: MONITOR_TIMEOUT_MS,
        currentState: stateMachine.getState(),
        isRecording: recorder.getIsRecording(),
        isSessionActive: sessionManager.getIsSessionActive(),
        audioContextState: (recorder as any).audioContext?.state || 'unknown',
      });
      console.error('[App] ❌ 监控闭环超时：播放结束后 2 秒内未收到第一帧音频', {
        timeSincePlaybackFinished,
        timeSincePlaybackFinishedSeconds: (timeSincePlaybackFinished / 1000).toFixed(2),
        audioContextState: (recorder as any).audioContext?.state || 'unknown',
      });
      this.attemptRecoverAudioContext(timeoutTimestamp);
    }, MONITOR_TIMEOUT_MS);

    requestAnimationFrame(() => {
      ensureRecorderStarted().catch((error) => {
        logger.error('App', '❌ 监控闭环：确保录音器启动失败', { error });
      });
    });
  }

  async attemptRecoverAudioContext(timeoutTimestamp: number): Promise<void> {
    const { recorder, sessionManager, stateMachine } = this.deps;
    try {
      const originalState = recorder.getAudioContextState();
      if (!originalState) {
        logger.warn('App', '⚠️ 尝试恢复 AudioContext：audioContext 不存在');
        return;
      }
      logger.info('App', '🔄 尝试恢复 AudioContext', {
        originalState,
        timeoutTimestamp,
        timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
      });
      if (originalState === 'suspended') {
        const recovered = await recorder.resumeAudioContextIfSuspended();
        const newState = recorder.getAudioContextState();
        if (recovered) {
          logger.info('App', '✅ AudioContext 已恢复', {
            originalState,
            newState,
            timeoutTimestamp,
            timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
          });
        } else {
          logger.warn('App', '⚠️ AudioContext 恢复失败或未恢复', {
            originalState,
            newState,
            timeoutTimestamp,
            timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
          });
        }
        if (
          !recorder.getIsRecording() &&
          sessionManager.getIsSessionActive() &&
          stateMachine.getState() === SessionState.INPUT_RECORDING
        ) {
          logger.info('App', '🔄 尝试重新启动录音器', {
            timeoutTimestamp,
            timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
          });
          try {
            await recorder.start();
            logger.info('App', '✅ 录音器已重新启动', {
              timeoutTimestamp,
              timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
              isRecording: recorder.getIsRecording(),
              audioContextState: recorder.getAudioContextState(),
            });
          } catch (error) {
            logger.error('App', '❌ 重新启动录音器失败', {
              error,
              timeoutTimestamp,
              timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
            });
          }
        }
      } else {
        logger.info('App', 'ℹ️ AudioContext 状态正常，无需恢复', {
          state: originalState,
          timeoutTimestamp,
          timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
        });
      }
    } catch (error) {
      logger.error('App', '❌ 尝试恢复 AudioContext 失败', {
        error,
        timeoutTimestamp,
        timeoutTimestampIso: new Date(timeoutTimestamp).toISOString(),
      });
    }
  }

  notifyTtsAudioAvailable(): void {
    const duration = this.deps.ttsPlayer.getTotalDuration();
    const hasPendingAudio = this.deps.ttsPlayer.hasPendingAudio();
    const bufferCount = this.deps.ttsPlayer.getBufferCount();
    const currentState = this.deps.stateMachine.getState();
    const isSessionActive = this.deps.sessionManager.getIsSessionActive();
    const safeDuration = duration || 0;
    console.log('[App] 📢 TTS 音频可用通知:', {
      duration: safeDuration.toFixed(2) + '秒',
      hasPendingAudio,
      bufferCount,
      currentState,
      isSessionActive,
      isPlaying: this.deps.ttsPlayer.getIsPlaying(),
    });
    if (typeof window !== 'undefined' && (window as any).onTtsAudioAvailable) {
      console.log('[App] 调用 onTtsAudioAvailable 回调，duration:', safeDuration.toFixed(2));
      (window as any).onTtsAudioAvailable(safeDuration);
    } else {
      console.warn('[App] ⚠️ onTtsAudioAvailable 回调不存在');
    }
    console.log('[App] 触发 UI 更新（通知状态机），当前状态:', currentState, 'hasPendingAudio:', hasPendingAudio);
    this.deps.stateMachine.notifyUIUpdate();
  }

  async startTtsPlayback(): Promise<void> {
    if (!this.deps.ttsPlayer.hasPendingAudio()) {
      logger.warn('App.Playback', 'startTtsPlayback: 没有待播放的音频');
      return;
    }
    logger.info('App.Playback', 'startTtsPlayback 被调用', { state: this.deps.stateMachine.getState() });
    this.deps.sessionManager.setCanSendChunks(false);
    this.deps.displayPendingTranslationResults();
    await this.deps.ttsPlayer.startPlayback();
  }

  pauseTtsPlayback(): void {
    if (this.deps.ttsPlayer.getIsPlaying()) {
      console.log('用户手动暂停播放');
      this.deps.ttsPlayer.pausePlayback();
      if (
        this.deps.sessionManager.getIsSessionActive() &&
        this.deps.stateMachine.getState() === SessionState.INPUT_RECORDING
      ) {
        if (!this.deps.recorder.getIsRecording()) {
          this.deps.recorder.start().catch((error) => {
            console.error('恢复录音失败:', error);
          });
        }
      }
    }
  }

  getTtsAudioDuration(): number {
    return this.deps.ttsPlayer.getTotalDuration();
  }

  hasPendingTtsAudio(): boolean {
    return this.deps.ttsPlayer.hasPendingAudio();
  }

  isTtsPlaying(): boolean {
    return this.deps.ttsPlayer.getIsPlaying();
  }

  getMemoryPressure(): 'normal' | 'warning' | 'critical' {
    return this.deps.ttsPlayer.getMemoryPressure();
  }

  isTtsPaused(): boolean {
    return this.deps.ttsPlayer.getIsPaused();
  }

  toggleTtsPlaybackRate(): number {
    return this.deps.ttsPlayer.togglePlaybackRate();
  }

  getTtsPlaybackRate(): number {
    return this.deps.ttsPlayer.getPlaybackRate();
  }

  getTtsPlaybackRateText(): string {
    return this.deps.ttsPlayer.getPlaybackRateText();
  }
}
