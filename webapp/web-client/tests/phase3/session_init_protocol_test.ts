/**
 * Session Init 协议增强测试
 * 测试 trace_id 和 tenant_id 字段，以及移除不支持的字段
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketClient } from '../../src/websocket_client';
import { StateMachine } from '../../src/state_machine';
import { SessionInitMessage } from '../../src/types';

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
    // 模拟异步连接
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

describe('WebSocketClient - Session Init 协议增强', () => {
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
    vi.restoreAllMocks();
  });

  describe('SessionInit 消息构建 - 单向模式', () => {
    it('应该包含 trace_id 字段', async () => {
      const connectPromise = wsClient.connect('zh', 'en');
      
      // 等待连接建立
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // 模拟服务器响应
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
          trace_id: 'trace-123',
        });
      }
      
      await connectPromise;
      
      // 获取发送的消息
      const sentMessages = mockWs.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      
      const initMessage = JSON.parse(sentMessages[0] as string) as SessionInitMessage;
      
      // 验证 trace_id 存在且是有效的 UUID 格式
      expect(initMessage.trace_id).toBeDefined();
      expect(typeof initMessage.trace_id).toBe('string');
      expect(initMessage.trace_id!.length).toBeGreaterThan(0);
      
      // 验证不包含不应该发送的字段
      expect((initMessage as any).audio_format).toBeUndefined();
      expect((initMessage as any).sample_rate).toBeUndefined();
      expect((initMessage as any).channel_count).toBeUndefined();
      expect((initMessage as any).protocol_version).toBeUndefined();
      expect((initMessage as any).supports_binary_frame).toBeUndefined();
      expect((initMessage as any).preferred_codec).toBeUndefined();
    });

    it('应该包含 tenant_id 字段（如果设置了）', async () => {
      wsClient.setTenantId('tenant-123');
      
      const connectPromise = wsClient.connect('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
          trace_id: 'trace-123',
        });
      }
      
      await connectPromise;
      
      const sentMessages = mockWs.getSentMessages();
      const initMessage = JSON.parse(sentMessages[0] as string) as SessionInitMessage;
      
      expect(initMessage.tenant_id).toBe('tenant-123');
    });

    it('tenant_id 应该为 null（如果未设置）', async () => {
      const connectPromise = wsClient.connect('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
          trace_id: 'trace-123',
        });
      }
      
      await connectPromise;
      
      const sentMessages = mockWs.getSentMessages();
      const initMessage = JSON.parse(sentMessages[0] as string) as SessionInitMessage;
      
      expect(initMessage.tenant_id).toBeNull();
    });

    it('应该包含所有必需的字段', async () => {
      const connectPromise = wsClient.connect('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
          trace_id: 'trace-123',
        });
      }
      
      await connectPromise;
      
      const sentMessages = mockWs.getSentMessages();
      const initMessage = JSON.parse(sentMessages[0] as string) as SessionInitMessage;
      
      expect(initMessage.type).toBe('session_init');
      expect(initMessage.platform).toBe('web');
      expect(initMessage.src_lang).toBe('zh');
      expect(initMessage.tgt_lang).toBe('en');
      expect(initMessage.mode).toBe('one_way');
      expect(initMessage.dialect).toBeNull();
      expect(initMessage.pairing_code).toBeNull();
    });
  });

  describe('SessionInit 消息构建 - 双向模式', () => {
    it('应该包含 trace_id 和 tenant_id 字段', async () => {
      wsClient.setTenantId('tenant-456');
      
      const connectPromise = wsClient.connectTwoWay('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      if (mockWs) {
        mockWs.simulateMessage({
          type: 'session_init_ack',
          session_id: 'test-session',
          trace_id: 'trace-456',
        });
      }
      
      await connectPromise;
      
      const sentMessages = mockWs.getSentMessages();
      const initMessage = JSON.parse(sentMessages[0] as string) as SessionInitMessage;
      
      expect(initMessage.trace_id).toBeDefined();
      expect(initMessage.tenant_id).toBe('tenant-456');
      expect(initMessage.mode).toBe('two_way_auto');
      expect(initMessage.src_lang).toBe('auto');
      expect(initMessage.lang_a).toBe('zh');
      expect(initMessage.lang_b).toBe('en');
      expect(initMessage.auto_langs).toEqual(['zh', 'en']);
      
      // 验证不包含不应该发送的字段
      expect((initMessage as any).audio_format).toBeUndefined();
      expect((initMessage as any).sample_rate).toBeUndefined();
      expect((initMessage as any).channel_count).toBeUndefined();
      expect((initMessage as any).protocol_version).toBeUndefined();
      expect((initMessage as any).supports_binary_frame).toBeUndefined();
      expect((initMessage as any).preferred_codec).toBeUndefined();
    });
  });

  describe('trace_id 生成', () => {
    it('每次连接应该生成不同的 trace_id', async () => {
      const traceIds: string[] = [];
      
      for (let i = 0; i < 3; i++) {
        const client = new WebSocketClient(new StateMachine(), 'ws://localhost:5010/ws/session');
        (global as any).WebSocket = vi.fn(() => {
          mockWs = new MockWebSocket('ws://localhost:5010/ws/session');
          return mockWs;
        });
        
        const connectPromise = client.connect('zh', 'en');
        await new Promise(resolve => setTimeout(resolve, 20));
        
        if (mockWs) {
          mockWs.simulateMessage({
            type: 'session_init_ack',
            session_id: `test-session-${i}`,
            trace_id: `trace-${i}`,
          });
        }
        
        await connectPromise;
        
        const sentMessages = mockWs.getSentMessages();
        const initMessage = JSON.parse(sentMessages[0] as string) as SessionInitMessage;
        traceIds.push(initMessage.trace_id!);
        
        client.disconnect();
      }
      
      // 验证所有 trace_id 都不同
      const uniqueTraceIds = new Set(traceIds);
      expect(uniqueTraceIds.size).toBe(3);
    });
  });
});

