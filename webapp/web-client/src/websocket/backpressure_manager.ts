/**
 * 背压管理模块
 * 负责处理背压状态和发送队列管理
 */

export enum BackpressureState {
  NORMAL = 'normal',
  BUSY = 'busy',
  PAUSED = 'paused',
  SLOW_DOWN = 'slow_down',
}

export type BackpressureStateCallback = (state: BackpressureState) => void;

export interface BackpressureMessage {
  action: 'BUSY' | 'PAUSE' | 'SLOW_DOWN';
  resume_after_ms?: number;
}

/**
 * 背压管理器
 */
export class BackpressureManager {
  private backpressureState: BackpressureState = BackpressureState.NORMAL;
  private backpressureResumeTime: number = 0;
  private lastBackpressureMessageTime: number = 0;
  private backpressureDebounceMs: number = 500;
  private backpressureStateCallback: BackpressureStateCallback | null = null;
  private audioSendQueue: Array<{ data: Float32Array; isFinal: boolean }> = [];
  private sendInterval: number | null = null;
  private normalSendIntervalMs: number = 100;
  private slowDownSendIntervalMs: number = 500;
  private sendCallback: ((data: Float32Array, isFinal: boolean) => Promise<void>) | null = null;

  /**
   * 设置背压状态变化回调
   */
  setBackpressureStateCallback(callback: BackpressureStateCallback): void {
    this.backpressureStateCallback = callback;
  }

  /**
   * 设置发送回调
   */
  setSendCallback(callback: (data: Float32Array, isFinal: boolean) => Promise<void>): void {
    this.sendCallback = callback;
  }

  /**
   * 处理背压消息
   */
  handleBackpressure(message: BackpressureMessage, sendCallback?: (data: Float32Array, isFinal: boolean) => Promise<void>): void {
    const callback = sendCallback || this.sendCallback;
    if (!callback) {
      console.warn('[BackpressureManager] No send callback available');
      return;
    }
    const now = Date.now();

    // 去抖：如果距离上次背压消息时间太短，忽略
    if (now - this.lastBackpressureMessageTime < this.backpressureDebounceMs) {
      console.log('[BackpressureManager] 背压消息被忽略（去抖）');
      return;
    }

    this.lastBackpressureMessageTime = now;

    // 更新背压状态
    const oldState = this.backpressureState;
    const action = message.action;
    if (action === 'BUSY' || action === 'PAUSE') {
      this.backpressureState = action === 'BUSY' ? BackpressureState.BUSY : BackpressureState.PAUSED;
    } else if (action === 'SLOW_DOWN') {
      this.backpressureState = BackpressureState.SLOW_DOWN;
    }

    // 设置恢复时间
    if (message.resume_after_ms) {
      this.backpressureResumeTime = now + message.resume_after_ms;
    } else {
      // 如果没有指定恢复时间，默认 5 秒后恢复
      this.backpressureResumeTime = now + 5000;
    }

    console.log(`[BackpressureManager] 背压: ${action}, resume after ${message.resume_after_ms || 5000}ms`);

    // 调整发送策略
    this.adjustSendStrategy(callback);

    // 通知背压状态变化回调
    if (this.backpressureStateCallback && oldState !== this.backpressureState) {
      this.backpressureStateCallback(this.backpressureState);
    }
  }

  /**
   * 调整发送策略（根据背压状态）
   */
  private adjustSendStrategy(sendCallback: (data: Float32Array, isFinal: boolean) => Promise<void>): void {
    if (!sendCallback) {
      return;
    }
    // 清除现有定时器
    if (this.sendInterval !== null) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }

    if (this.backpressureState === BackpressureState.PAUSED) {
      // 暂停发送，但仍需要定时器检查恢复时间
      console.log('[BackpressureManager] 音频发送已暂停');
      // 使用较短的间隔检查恢复（100ms）
      this.sendInterval = window.setInterval(() => {
        this.processSendQueue(sendCallback);
      }, 100);
      return;
    }

    // 只有在BUSY或SLOW_DOWN状态下才需要定时器处理队列
    // NORMAL状态下直接发送，不需要定时器
    if (this.backpressureState === BackpressureState.NORMAL) {
      // 正常状态：立即处理队列中的剩余数据（如果有）
      this.processSendQueue(sendCallback);
      return;
    }

    // BUSY 和 SLOW_DOWN 状态：使用定时器降速发送
    const intervalMs = (this.backpressureState === BackpressureState.SLOW_DOWN ||
      this.backpressureState === BackpressureState.BUSY)
      ? this.slowDownSendIntervalMs
      : this.normalSendIntervalMs;

    // 启动定时发送
    this.sendInterval = window.setInterval(() => {
      this.processSendQueue();
    }, intervalMs);
  }

  /**
   * 处理发送队列
   */
  private processSendQueue(sendCallback?: (data: Float32Array, isFinal: boolean) => Promise<void>): void {
    const callback = sendCallback || this.sendCallback;
    if (!callback) {
      return;
    }
    // 检查是否应该恢复
    if (this.backpressureResumeTime > 0 && Date.now() >= this.backpressureResumeTime) {
      console.log('[BackpressureManager] 背压已恢复');
      const oldState = this.backpressureState;
      this.backpressureState = BackpressureState.NORMAL;
      this.backpressureResumeTime = 0;

      // 清除定时器（恢复正常后不需要定时器）
      if (this.sendInterval !== null) {
        clearInterval(this.sendInterval);
        this.sendInterval = null;
      }

      // 立即处理队列中的剩余数据
      this.flushSendQueue(callback);

      // 通知背压状态变化回调
      if (this.backpressureStateCallback && oldState !== BackpressureState.NORMAL) {
        this.backpressureStateCallback(BackpressureState.NORMAL);
      }
      return;
    }

    // 如果暂停，不发送
    if (this.backpressureState === BackpressureState.PAUSED) {
      return;
    }

    // 发送队列中的数据（每次只处理一个，避免阻塞）
    if (this.audioSendQueue.length > 0) {
      const item = this.audioSendQueue.shift()!;
      callback(item.data, item.isFinal).catch(error => {
        console.error('[BackpressureManager] 发送队列中的音频块失败:', error);
      });
    } else {
      // 队列为空时，如果是BUSY或SLOW_DOWN状态，停止定时器
      // 下次有数据时会重新启动
      if ((this.backpressureState === BackpressureState.BUSY ||
        this.backpressureState === BackpressureState.SLOW_DOWN) &&
        this.sendInterval !== null) {
        clearInterval(this.sendInterval);
        this.sendInterval = null;
      }
    }
  }

  /**
   * 立即处理发送队列中的所有数据（用于恢复正常状态时）
   */
  private flushSendQueue(sendCallback: (data: Float32Array, isFinal: boolean) => Promise<void>): void {
    if (!sendCallback) {
      return;
    }
    while (this.audioSendQueue.length > 0) {
      const item = this.audioSendQueue.shift()!;
      sendCallback(item.data, item.isFinal).catch(error => {
        console.error('[BackpressureManager] 刷新队列中的音频块失败:', error);
      });
    }
  }

  /**
   * 添加音频到发送队列
   */
  enqueueAudio(data: Float32Array, isFinal: boolean): void {
    this.audioSendQueue.push({ data, isFinal });
  }

  /**
   * 清空发送队列
   */
  clearSendQueue(): void {
    this.audioSendQueue = [];
    if (this.sendInterval !== null) {
      clearInterval(this.sendInterval);
      this.sendInterval = null;
    }
    // 重置背压状态
    this.backpressureState = BackpressureState.NORMAL;
    this.backpressureResumeTime = 0;
  }

  /**
   * 获取背压状态
   */
  getBackpressureState(): BackpressureState {
    return this.backpressureState;
  }

  /**
   * 检查是否应该立即发送（正常状态）
   */
  shouldSendImmediately(): boolean {
    return this.backpressureState === BackpressureState.NORMAL;
  }

  /**
   * 检查是否应该暂停发送
   */
  shouldPause(): boolean {
    return this.backpressureState === BackpressureState.PAUSED;
  }
}

