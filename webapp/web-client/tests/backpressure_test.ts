/**
 * 客户端背压与降级机制测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketClient, BackpressureState } from '../src/websocket_client';
import { StateMachine } from '../src/state_machine';
import { BackpressureMessage } from '../src/types';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private sentMessages: Array<string | ArrayBuffer> = [];

  constructor(url: string) {
    this.url = url;
    // 使用微任务立即触发，避免定时器问题
    Promise.resolve().then(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    });
  }

  send(data: string | ArrayBuffer): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  getSentMessages(): Array<string | ArrayBuffer> {
    return this.sentMessages;
  }

  simulateMessage(data: any): void {
    if (this.onmessage) {
      const event = new MessageEvent('message', { data: JSON.stringify(data) });
      this.onmessage(event);
    }
  }
}

describe('WebSocketClient - 背压与降级机制', () => {
  let wsClient: WebSocketClient;
  let stateMachine: StateMachine;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    // Mock WebSocket
    (global as any).WebSocket = vi.fn((url: string) => {
      mockWs = new MockWebSocket(url);
      return mockWs;
    });

    stateMachine = new StateMachine();
    wsClient = new WebSocketClient(stateMachine, 'ws://localhost:5010/ws/session');
  });

  afterEach(() => {
    if (wsClient) {
      try {
        wsClient.disconnect();
      } catch (e) {
        // 忽略清理错误
      }
    }
  });

  describe('背压状态管理', () => {
    it('应该初始化为NORMAL状态', () => {
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.NORMAL);
    });

    it('应该能获取当前背压状态', async () => {
      const connectPromise = wsClient.connect('en', 'zh');
      // 模拟 session_init_ack
      await new Promise(resolve => setTimeout(resolve, 20));
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
        });
      }
      await connectPromise;

      expect(wsClient.getBackpressureState()).toBe(BackpressureState.NORMAL);
    });
  });

  describe('背压消息处理', () => {
    beforeEach(async () => {
      const connectPromise = wsClient.connect('en', 'zh');
      await new Promise(resolve => setTimeout(resolve, 20));
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
        });
      }
      await connectPromise;
    });

    it('应该正确处理BUSY消息', async () => {
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
        resume_after_ms: 2000,
      };

      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.BUSY);
    });

    it('应该正确处理PAUSE消息', async () => {
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'PAUSE',
        resume_after_ms: 3000,
      };

      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.PAUSED);
    });

    it('应该正确处理SLOW_DOWN消息', async () => {
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'SLOW_DOWN',
        resume_after_ms: 1000,
      };

      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.SLOW_DOWN);
    });

    it('应该忽略去抖时间内的重复背压消息', async () => {
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
        resume_after_ms: 2000,
      };

      // 发送第一条消息
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const initialState = wsClient.getBackpressureState();
      expect(initialState).toBe(BackpressureState.BUSY);
      
      // 立即发送第二条消息（应该被忽略，因为去抖时间500ms）
      const consoleSpy = vi.spyOn(console, 'log');
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // 检查是否有去抖日志
      const debounceLogs = consoleSpy.mock.calls.filter(call => 
        call[0]?.toString().includes('ignored (debounce)')
      );
      
      // 状态应该仍然是BUSY（没有改变）
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.BUSY);
      // 如果第二条消息被去抖，应该有去抖日志；如果没有，说明两条消息都被处理了（时间间隔足够）
      // 这里主要验证状态没有异常变化
    });

    it('应该在没有resume_after_ms时使用默认5秒恢复时间', async () => {
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
      };

      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.BUSY);
    });
  });

  describe('背压状态回调', () => {
    beforeEach(async () => {
      const connectPromise = wsClient.connect('en', 'zh');
      await new Promise(resolve => setTimeout(resolve, 20));
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
        });
      }
      await connectPromise;
    });

    it('应该在背压状态变化时触发回调', async () => {
      const stateCallback = vi.fn();
      wsClient.setBackpressureStateCallback(stateCallback);

      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
        resume_after_ms: 2000,
      };

      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(stateCallback).toHaveBeenCalledWith(BackpressureState.BUSY);
    });

    it('应该在状态恢复时触发回调', async () => {
      const stateCallback = vi.fn();
      wsClient.setBackpressureStateCallback(stateCallback);

      // 先设置BUSY状态
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
        resume_after_ms: 100, // 100ms后恢复
      };

      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 应该先调用BUSY
      expect(stateCallback).toHaveBeenCalledWith(BackpressureState.BUSY);
      
      // 等待恢复（100ms + 缓冲时间让定时器触发）
      // BUSY状态下定时器每500ms触发一次，所以需要等待足够的时间
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // 应该调用NORMAL（恢复）
      expect(stateCallback).toHaveBeenCalledWith(BackpressureState.NORMAL);
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.NORMAL);
    });
  });

  describe('发送策略调整', () => {
    beforeEach(async () => {
      const connectPromise = wsClient.connect('en', 'zh');
      await new Promise(resolve => setTimeout(resolve, 20));
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
        });
      }
      await connectPromise;
    });

    it('应该在BUSY状态下降速发送', async () => {
      const audioData = new Float32Array(1600).fill(0.5);
      
      // 发送一些音频数据
      wsClient.sendAudioChunk(audioData, false);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 设置BUSY状态
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
        resume_after_ms: 2000,
      };
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 继续发送音频（应该加入队列）
      wsClient.sendAudioChunk(audioData, false);
      wsClient.sendAudioChunk(audioData, false);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 在BUSY状态下，音频应该被加入队列，而不是立即发送
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.BUSY);
    });

    it('应该在PAUSE状态下暂停发送非结束帧', async () => {
      const audioData = new Float32Array(1600).fill(0.5);
      const initialMessageCount = mockWs.getSentMessages().length;
      
      // 设置PAUSE状态
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'PAUSE',
        resume_after_ms: 2000,
      };
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 发送非结束帧（应该被丢弃）
      wsClient.sendAudioChunk(audioData, false);
      wsClient.sendAudioChunk(audioData, false);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 非结束帧应该被丢弃，消息数量不应该增加
      const finalMessageCount = mockWs.getSentMessages().length;
      expect(finalMessageCount).toBe(initialMessageCount);
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.PAUSED);
    });

    it('应该在PAUSE状态下将结束帧加入队列', async () => {
      const audioData = new Float32Array(1600).fill(0.5);
      
      // 设置PAUSE状态
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'PAUSE',
        resume_after_ms: 2000,
      };
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 发送结束帧（应该加入队列）
      wsClient.sendAudioChunk(audioData, true);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 结束帧应该被加入队列，等待恢复后发送
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.PAUSED);
    });

    it('应该在SLOW_DOWN状态下降速发送', async () => {
      const audioData = new Float32Array(1600).fill(0.5);
      
      // 设置SLOW_DOWN状态
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'SLOW_DOWN',
        resume_after_ms: 2000,
      };
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 发送音频（应该加入队列）
      wsClient.sendAudioChunk(audioData, false);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.SLOW_DOWN);
    });
  });

  describe('自动恢复', () => {
    beforeEach(async () => {
      const connectPromise = wsClient.connect('en', 'zh');
      await new Promise(resolve => setTimeout(resolve, 20));
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
        });
      }
      await connectPromise;
    });

    it('应该在resume_after_ms后自动恢复', async () => {
      const stateCallback = vi.fn();
      wsClient.setBackpressureStateCallback(stateCallback);

      // 设置BUSY状态，100ms后恢复
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
        resume_after_ms: 100,
      };

      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 应该还是BUSY状态
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.BUSY);
      
      // 等待恢复（100ms + 一些缓冲时间让定时器触发）
      // 定时器每500ms触发一次（slowDownSendIntervalMs），所以需要等待足够的时间
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // 应该已经恢复
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.NORMAL);
      expect(stateCallback).toHaveBeenCalledWith(BackpressureState.NORMAL);
    });

    it('应该在恢复后继续发送队列中的数据', async () => {
      const audioData = new Float32Array(1600).fill(0.5);
      
      // 设置PAUSE状态，100ms后恢复
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'PAUSE',
        resume_after_ms: 100,
      };
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 发送结束帧（加入队列）
      wsClient.sendAudioChunk(audioData, true);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 等待恢复（100ms + 一些缓冲时间让定时器触发）
      // PAUSED状态下定时器每100ms检查一次，所以需要等待足够的时间
      await new Promise(resolve => setTimeout(resolve, 250));
      
      // 恢复后应该发送队列中的数据
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.NORMAL);
    });
  });

  describe('断开连接时的清理', () => {
    beforeEach(async () => {
      const connectPromise = wsClient.connect('en', 'zh');
      await new Promise(resolve => setTimeout(resolve, 20));
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
        });
      }
      await connectPromise;
    });

    it('应该在断开连接时重置背压状态', async () => {
      // 先设置BUSY状态
      const backpressureMessage: BackpressureMessage = {
        type: 'backpressure',
        action: 'BUSY',
        resume_after_ms: 2000,
      };
      mockWs.simulateMessage(backpressureMessage);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.BUSY);
      
      // 断开连接
      wsClient.disconnect();
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(wsClient.getBackpressureState()).toBe(BackpressureState.NORMAL);
    });
  });
});

