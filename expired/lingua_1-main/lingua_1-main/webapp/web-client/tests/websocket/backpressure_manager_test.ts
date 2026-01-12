/**
 * 背压管理模块单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackpressureManager, BackpressureState } from '../../src/websocket/backpressure_manager';

describe('BackpressureManager', () => {
  let manager: BackpressureManager;
  let sendCallback: (data: Float32Array, isFinal: boolean) => Promise<void>;

  beforeEach(() => {
    sendCallback = vi.fn().mockResolvedValue(undefined);
    manager = new BackpressureManager();
  });

  it('应该初始化为正常状态', () => {
    expect(manager.getBackpressureState()).toBe(BackpressureState.NORMAL);
    expect(manager.shouldSendImmediately()).toBe(true);
    expect(manager.shouldPause()).toBe(false);
  });

  it('应该能够处理背压消息', () => {
    const callback = vi.fn();
    manager.setBackpressureStateCallback(callback);

    manager.handleBackpressure(
      { action: 'BUSY', resume_after_ms: 1000 },
      sendCallback
    );

    expect(manager.getBackpressureState()).toBe(BackpressureState.BUSY);
    expect(manager.shouldSendImmediately()).toBe(false);
  });

  it('应该能够暂停发送', () => {
    manager.handleBackpressure(
      { action: 'PAUSE', resume_after_ms: 1000 },
      sendCallback
    );

    expect(manager.getBackpressureState()).toBe(BackpressureState.PAUSED);
    expect(manager.shouldPause()).toBe(true);
  });

  it('应该能够清空发送队列', () => {
    const audioData = new Float32Array([0.1, 0.2, 0.3]);
    manager.enqueueAudio(audioData, false);
    
    manager.clearSendQueue();
    
    expect(manager.getBackpressureState()).toBe(BackpressureState.NORMAL);
  });
});

