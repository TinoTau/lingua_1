/**
 * 状态变化处理逻辑（录音启停、播放模式切换等）
 * 从 App 拆出，保持行为不变
 */

import { SessionState } from '../types';
import { Recorder } from '../recorder';
import { SessionManager } from './session_manager';
import { StateMachine } from '../state_machine';

export interface StateChangeHandlerDeps {
  sessionManager: SessionManager;
  stateMachine: StateMachine;
  recorder: Recorder;
}

/**
 * 处理状态机状态变化（根据状态控制录音启停、播放模式屏蔽麦克风等）
 */
export function handleStateChange(
  deps: StateChangeHandlerDeps,
  newState: SessionState,
  oldState: SessionState
): void {
  const { sessionManager, stateMachine, recorder } = deps;

  console.log(`[App] State changed: ${oldState} -> ${newState}`, {
    isSessionActive: sessionManager.getIsSessionActive(),
    isRecording: recorder.getIsRecording(),
  });

  if (newState === SessionState.INPUT_READY || newState === SessionState.INPUT_RECORDING) {
    if (sessionManager.getIsSessionActive()) {
      if (newState === SessionState.INPUT_RECORDING) {
        if (!recorder.getIsRecording()) {
          console.log('[App] 录音器未运行，正在启动...');
          recorder.start().then(() => {
            console.log('[App] ✅ 录音器已成功启动');
          }).catch((error) => {
            console.error('[App] ❌ 启动录音器失败:', error);
          });
        } else {
          console.log('[App] 录音器已在运行');
        }
      }
    } else {
      if (newState === SessionState.INPUT_RECORDING && oldState === SessionState.INPUT_READY) {
        console.log('[App] 会话未开始，启动录音器...');
        recorder.start().then(() => {
          console.log('[App] ✅ 录音器已成功启动');
        }).catch((error) => {
          console.error('[App] ❌ 启动录音器失败:', error);
        });
      }
    }
  } else if (newState === SessionState.PLAYING_TTS) {
    if (sessionManager.getIsSessionActive()) {
      console.log('[App] 播放模式：正在屏蔽麦克风输入，避免声学回响');
      recorder.stop();
      console.log('[App] ✅ 播放模式：已屏蔽麦克风输入，避免声学回响', {
        isRecording: recorder.getIsRecording(),
      });
    } else {
      console.log('[App] 播放模式：会话未开始，关闭麦克风');
      recorder.stop();
      recorder.close();
    }
  }

  if (newState === SessionState.INPUT_RECORDING && oldState === SessionState.PLAYING_TTS) {
    const stateChangeTimestamp = Date.now();
    if (sessionManager.getIsSessionActive()) {
      console.log('[App] 从播放状态回到录音状态，正在恢复录音...', {
        timestamp: stateChangeTimestamp,
        timestampIso: new Date(stateChangeTimestamp).toISOString(),
        isRecording: recorder.getIsRecording(),
      });
      if (!recorder.getIsRecording()) {
        const requestAnimationFrameStart = Date.now();
        requestAnimationFrame(() => {
          const requestAnimationFrameEnd = Date.now();
          const rafDelay = requestAnimationFrameEnd - requestAnimationFrameStart;
          console.log('[App] requestAnimationFrame 回调执行', {
            rafStartTimestamp: requestAnimationFrameStart,
            rafEndTimestamp: requestAnimationFrameEnd,
            rafDelayMs: rafDelay,
          });
          if (
            sessionManager.getIsSessionActive() &&
            stateMachine.getState() === SessionState.INPUT_RECORDING &&
            !recorder.getIsRecording()
          ) {
            const recorderStartTimestamp = Date.now();
            recorder.start().then(() => {
              const recorderStartEndTimestamp = Date.now();
              const recorderStartDuration = recorderStartEndTimestamp - recorderStartTimestamp;
              console.log('[App] ✅ 已恢复录音，可以继续说话（事件驱动）', {
                recorderStartTimestamp,
                recorderStartEndTimestamp,
                recorderStartDurationMs: recorderStartDuration,
                timestampIso: new Date(recorderStartEndTimestamp).toISOString(),
                isRecording: recorder.getIsRecording(),
                currentUtteranceIndex: sessionManager.getCurrentUtteranceIndex(),
              });
              console.log('[App] ⏳ 等待音频流开始产生数据（通常需要 0-100ms）...');
            }).catch((error) => {
              const recorderStartEndTimestamp = Date.now();
              console.error('[App] ❌ 恢复录音失败（事件驱动）:', {
                error,
                recorderStartTimestamp,
                recorderStartEndTimestamp,
                timestampIso: new Date(recorderStartEndTimestamp).toISOString(),
              });
              console.warn('[App] ⚠️ 恢复录音失败，将在 500ms 后重试...');
              setTimeout(() => {
                const retryTimestamp = Date.now();
                recorder.start().then(() => {
                  console.log('[App] ✅ 重试恢复录音成功', {
                    retryTimestamp,
                    timestampIso: new Date(retryTimestamp).toISOString(),
                  });
                }).catch((retryError) => {
                  console.error('[App] ❌ 重试恢复录音失败:', {
                    error: retryError,
                    retryTimestamp,
                    timestampIso: new Date(retryTimestamp).toISOString(),
                  });
                });
              }, 500);
            });
          } else {
            console.log('[App] requestAnimationFrame 回调中检查失败，不恢复录音', {
              isSessionActive: sessionManager.getIsSessionActive(),
              currentState: stateMachine.getState(),
              isRecording: recorder.getIsRecording(),
            });
          }
        });

        setTimeout(() => {
          const fallbackTimestamp = Date.now();
          if (
            !recorder.getIsRecording() &&
            sessionManager.getIsSessionActive() &&
            stateMachine.getState() === SessionState.INPUT_RECORDING
          ) {
            console.warn('[App] ⚠️ 事件驱动恢复失败，使用fallback', {
              fallbackTimestamp,
              timestampIso: new Date(fallbackTimestamp).toISOString(),
            });
            recorder.start().then(() => {
              const fallbackEndTimestamp = Date.now();
              console.log('[App] ✅ 已恢复录音，可以继续说话（fallback）', {
                fallbackTimestamp,
                fallbackEndTimestamp,
                timestampIso: new Date(fallbackEndTimestamp).toISOString(),
                isRecording: recorder.getIsRecording(),
              });
            }).catch((error) => {
              console.error('[App] ❌ 恢复录音失败（fallback）:', {
                error,
                fallbackTimestamp,
                timestampIso: new Date(fallbackTimestamp).toISOString(),
              });
            });
          }
        }, 50);
      } else {
        console.log('[App] 录音器已在运行，无需恢复', {
          timestamp: stateChangeTimestamp,
          timestampIso: new Date(stateChangeTimestamp).toISOString(),
        });
      }
    }
  }
}
