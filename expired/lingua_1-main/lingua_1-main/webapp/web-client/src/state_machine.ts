import { SessionState } from './types';

export type StateChangeCallback = (newState: SessionState, oldState: SessionState) => void;

/**
 * 状态机模块
 * 控制输入/输出状态切换
 */
export class StateMachine {
  private state: SessionState = SessionState.INPUT_READY;
  private callbacks: StateChangeCallback[] = [];
  private isSessionActive: boolean = false; // 会话是否进行中

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
   * 触发 UI 更新（不改变状态）
   * 用于在状态不变时通知 UI 更新（例如：TTS 音频缓冲区更新）
   */
  notifyUIUpdate(): void {
    // 使用当前状态作为 newState 和 oldState，触发回调但不改变状态
    const currentState = this.state;
    this.callbacks.forEach(callback => {
      try {
        callback(currentState, currentState);
      } catch (error) {
        console.error('Error in UI update callback:', error);
      }
    });
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
   * 注意：不再转换到 WAITING_RESULT，保持在 INPUT_RECORDING 状态
   */
  stopRecording(): void {
    // 保持在 INPUT_RECORDING 状态，允许持续输入
    // 状态不改变，只是发送结束帧
  }

  /**
   * 开始播放（用户手动触发）
   */
  startPlaying(): void {
    if (this.state === SessionState.INPUT_RECORDING || this.state === SessionState.PLAYING_TTS) {
      this.transitionTo(SessionState.PLAYING_TTS);
    }
  }
  
  /**
   * 暂停播放，回到监听状态
   */
  pausePlaying(): void {
    if (this.state === SessionState.PLAYING_TTS) {
      console.log('[StateMachine] 暂停播放，从 PLAYING_TTS 转换到 INPUT_RECORDING');
      this.transitionTo(SessionState.INPUT_RECORDING);
    } else {
      console.log('[StateMachine] pausePlaying 被调用，但当前状态不是 PLAYING_TTS:', this.state);
    }
  }

  /**
   * 播放完成，恢复输入模式
   * 如果会话进行中，自动回到 INPUT_RECORDING（继续监听）
   * 如果会话未开始，回到 INPUT_READY（需要再次点击开始）
   */
  finishPlaying(): void {
    if (this.state === SessionState.PLAYING_TTS) {
      if (this.isSessionActive) {
        // 会话进行中：自动回到 INPUT_RECORDING（继续监听）
        console.log('[StateMachine] 播放完成，从 PLAYING_TTS 转换到 INPUT_RECORDING (会话进行中)');
        this.transitionTo(SessionState.INPUT_RECORDING);
      } else {
        // 会话未开始：回到 INPUT_READY（需要再次点击开始）
        console.log('[StateMachine] 播放完成，从 PLAYING_TTS 转换到 INPUT_READY (会话未开始)');
        this.transitionTo(SessionState.INPUT_READY);
      }
    } else {
      console.log('[StateMachine] finishPlaying 被调用，但当前状态不是 PLAYING_TTS:', this.state, 'isSessionActive:', this.isSessionActive);
    }
  }
  
  /**
   * 检查是否可以发送（在 INPUT_RECORDING 状态下）
   */
  canSend(): boolean {
    return this.state === SessionState.INPUT_RECORDING;
  }
  
  /**
   * 检查是否可以播放（有音频累积时）
   */
  canPlay(): boolean {
    return this.state === SessionState.INPUT_RECORDING || this.state === SessionState.PLAYING_TTS;
  }

  /**
   * 开始整个会话（持续输入+输出模式）
   */
  startSession(): void {
    if (this.state === SessionState.INPUT_READY) {
      this.isSessionActive = true;
      this.transitionTo(SessionState.INPUT_RECORDING);
    }
  }

  /**
   * 结束整个会话
   */
  endSession(): void {
    this.isSessionActive = false;
    this.transitionTo(SessionState.INPUT_READY);
  }

  /**
   * 检查会话是否进行中
   */
  getIsSessionActive(): boolean {
    return this.isSessionActive;
  }

  /**
   * 重置到初始状态
   */
  reset(): void {
    this.isSessionActive = false;
    this.transitionTo(SessionState.INPUT_READY);
  }
}

