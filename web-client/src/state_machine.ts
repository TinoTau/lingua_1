import { SessionState } from './types';

export type StateChangeCallback = (newState: SessionState, oldState: SessionState) => void;

/**
 * 状态机模块
 * 控制输入/输出状态切换
 */
export class StateMachine {
  private state: SessionState = SessionState.INPUT_READY;
  private callbacks: StateChangeCallback[] = [];

  constructor() {
    console.log('StateMachine initialized, initial state:', this.state);
  }

  /**
   * 获取当前状态
   */
  getState(): SessionState {
    return this.state;
  }

  /**
   * 注册状态变化回调
   */
  onStateChange(callback: StateChangeCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * 移除状态变化回调
   */
  removeStateChangeCallback(callback: StateChangeCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * 切换到新状态
   */
  private transitionTo(newState: SessionState): void {
    if (this.state === newState) {
      return;
    }

    const oldState = this.state;
    this.state = newState;
    console.log(`State transition: ${oldState} -> ${newState}`);

    // 通知所有回调
    this.callbacks.forEach(callback => {
      try {
        callback(newState, oldState);
      } catch (error) {
        console.error('Error in state change callback:', error);
      }
    });
  }

  /**
   * 开始录音（检测到语音活动）
   */
  startRecording(): void {
    if (this.state === SessionState.INPUT_READY) {
      this.transitionTo(SessionState.INPUT_RECORDING);
    }
  }

  /**
   * 停止录音（Send 按钮或静音超时）
   */
  stopRecording(): void {
    if (this.state === SessionState.INPUT_RECORDING) {
      this.transitionTo(SessionState.WAITING_RESULT);
    }
  }

  /**
   * 收到翻译结果，开始播放
   */
  startPlaying(): void {
    if (this.state === SessionState.WAITING_RESULT) {
      this.transitionTo(SessionState.PLAYING_TTS);
    }
  }

  /**
   * 播放完成，恢复输入模式
   */
  finishPlaying(): void {
    if (this.state === SessionState.PLAYING_TTS) {
      this.transitionTo(SessionState.INPUT_READY);
    }
  }

  /**
   * 重置到初始状态
   */
  reset(): void {
    this.transitionTo(SessionState.INPUT_READY);
  }
}

