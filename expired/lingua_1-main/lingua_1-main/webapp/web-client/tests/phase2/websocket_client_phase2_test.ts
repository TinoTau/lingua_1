import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketClient } from '../../src/websocket_client';
import { StateMachine } from '../../src/state_machine';
import { AudioCodecConfig } from '../../src/audio_codec';

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
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
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

  simulateMessage(data: string | ArrayBuffer): void {
    if (this.onmessage) {
      const event = new MessageEvent('message', {
        data: typeof data === 'string' ? data : data,
      });
      this.onmessage(event);
    }
  }
}

// 替换全局 WebSocket
(global as any).WebSocket = MockWebSocket;

describe('WebSocketClient Phase 2', () => {
  let client: WebSocketClient;
  let stateMachine: StateMachine;
  const testUrl = 'ws://test.example.com';

  beforeEach(() => {
    stateMachine = new StateMachine();
    client = new WebSocketClient(stateMachine, testUrl);
  });

  describe('Protocol Version Negotiation', () => {
    it('should send Phase 2 protocol version in session init', async () => {
      const connectPromise = client.connect('zh', 'en');
      
      // 等待连接建立
      await new Promise(resolve => setTimeout(resolve, 20));
      
      // 模拟服务器响应
      const mockWs = (global as any).WebSocket.prototype;
      const wsInstance = (client as any).ws as MockWebSocket;
      
      if (wsInstance) {
        wsInstance.simulateMessage(JSON.stringify({
          type: 'session_init_ack',
          session_id: 'test-session-123',
          assigned_node_id: 'node-1',
          message: 'OK',
          trace_id: 'trace-123',
          protocol_version: '2.0',
          use_binary_frame: true,
          negotiated_codec: 'pcm16',
          negotiated_audio_format: 'pcm16',
          negotiated_sample_rate: 16000,
          negotiated_channel_count: 1,
        }));
      }
      
      await connectPromise;
      
      // 验证协议版本
      expect(client.getProtocolVersion()).toBe('2.0');
      expect(client.getNegotiatedCodec()).toBe('pcm16');
    });

    it('should fallback to Phase 1 if server does not support binary frame', async () => {
      const connectPromise = client.connect('zh', 'en');
      
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const wsInstance = (client as any).ws as MockWebSocket;
      if (wsInstance) {
        wsInstance.simulateMessage(JSON.stringify({
          type: 'session_init_ack',
          session_id: 'test-session-123',
          assigned_node_id: 'node-1',
          message: 'OK',
          trace_id: 'trace-123',
          protocol_version: '1.0',
          use_binary_frame: false,
          negotiated_audio_format: 'pcm16',
          negotiated_sample_rate: 16000,
          negotiated_channel_count: 1,
        }));
      }
      
      await connectPromise;
      
      // 应该降级到 Phase 1
      expect(client.getProtocolVersion()).toBe('1.0');
    });
  });

  describe('Audio Codec Configuration', () => {
    it('should set audio codec config', () => {
      const config: AudioCodecConfig = {
        codec: 'pcm16',
        sampleRate: 16000,
        channelCount: 1,
      };
      
      expect(() => client.setAudioCodecConfig(config)).not.toThrow();
      expect(client.getNegotiatedCodec()).toBe('pcm16');
    });

    it('should create encoder when codec config is set', () => {
      const config: AudioCodecConfig = {
        codec: 'pcm16',
        sampleRate: 16000,
        channelCount: 1,
      };
      
      client.setAudioCodecConfig(config);
      
      // 编码器应该已创建（通过内部状态验证）
      const hasEncoder = (client as any).audioEncoder !== null;
      expect(hasEncoder).toBe(true);
    });
  });

  describe('Binary Frame Sending', () => {
    it('should send binary frame when use_binary_frame is true', async () => {
      // 设置编解码器
      const config: AudioCodecConfig = {
        codec: 'pcm16',
        sampleRate: 16000,
        channelCount: 1,
      };
      client.setAudioCodecConfig(config);
      
      // 连接并协商使用 Binary Frame
      const connectPromise = client.connect('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const wsInstance = (client as any).ws as MockWebSocket;
      if (wsInstance) {
        wsInstance.simulateMessage(JSON.stringify({
          type: 'session_init_ack',
          session_id: 'test-session',
          assigned_node_id: 'node-1',
          message: 'OK',
          trace_id: 'trace-123',
          protocol_version: '2.0',
          use_binary_frame: true,
          negotiated_codec: 'pcm16',
        }));
      }
      
      await connectPromise;
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 发送音频数据
      const audioData = new Float32Array(100).fill(0.5);
      client.sendAudioChunk(audioData, false);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 验证发送的消息
      const sentMessages = wsInstance.getSentMessages();
      expect(sentMessages.length).toBeGreaterThan(0);
      
      // 最后一条消息应该是二进制帧（ArrayBuffer 或 Uint8Array）
      const lastMessage = sentMessages[sentMessages.length - 1];
      const isBinary = lastMessage instanceof ArrayBuffer || 
                       lastMessage instanceof Uint8Array ||
                       (lastMessage && typeof lastMessage === 'object' && 'byteLength' in lastMessage);
      expect(isBinary).toBe(true);
      expect(typeof lastMessage).not.toBe('string');
    });

    it('should fallback to JSON if binary encoding fails', async () => {
      // 设置编解码器
      const config: AudioCodecConfig = {
        codec: 'pcm16',
        sampleRate: 16000,
        channelCount: 1,
      };
      client.setAudioCodecConfig(config);
      
      // 连接并协商使用 Binary Frame
      const connectPromise = client.connect('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const wsInstance = (client as any).ws as MockWebSocket;
      if (wsInstance) {
        wsInstance.simulateMessage(JSON.stringify({
          type: 'session_init_ack',
          session_id: 'test-session',
          assigned_node_id: 'node-1',
          message: 'OK',
          trace_id: 'trace-123',
          protocol_version: '2.0',
          use_binary_frame: true,
          negotiated_codec: 'pcm16',
        }));
      }
      
      await connectPromise;
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 破坏编码器以触发降级
      (client as any).audioEncoder = null;
      
      // 发送音频数据
      const audioData = new Float32Array(100).fill(0.5);
      client.sendAudioChunk(audioData, false);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 应该降级到 JSON
      const sentMessages = wsInstance.getSentMessages();
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(typeof lastMessage).toBe('string');
      const parsed = JSON.parse(lastMessage as string);
      expect(parsed.type).toBe('audio_chunk');
    });
  });

  describe('Final Frame', () => {
    it('should send binary final frame when use_binary_frame is true', async () => {
      const connectPromise = client.connect('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const wsInstance = (client as any).ws as MockWebSocket;
      if (wsInstance) {
        wsInstance.simulateMessage(JSON.stringify({
          type: 'session_init_ack',
          session_id: 'test-session',
          assigned_node_id: 'node-1',
          message: 'OK',
          trace_id: 'trace-123',
          protocol_version: '2.0',
          use_binary_frame: true,
          negotiated_codec: 'pcm16',
        }));
      }
      
      await connectPromise;
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 发送结束帧
      client.sendFinal();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 验证发送的是二进制帧
      const sentMessages = wsInstance.getSentMessages();
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(lastMessage instanceof ArrayBuffer || lastMessage instanceof Uint8Array).toBe(true);
    });

    it('should send JSON final frame when use_binary_frame is false', async () => {
      const connectPromise = client.connect('zh', 'en');
      await new Promise(resolve => setTimeout(resolve, 20));
      
      const wsInstance = (client as any).ws as MockWebSocket;
      if (wsInstance) {
        wsInstance.simulateMessage(JSON.stringify({
          type: 'session_init_ack',
          session_id: 'test-session',
          assigned_node_id: 'node-1',
          message: 'OK',
          trace_id: 'trace-123',
          protocol_version: '1.0',
          use_binary_frame: false,
        }));
      }
      
      await connectPromise;
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 发送结束帧
      client.sendFinal();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 验证发送的是 JSON
      const sentMessages = wsInstance.getSentMessages();
      const lastMessage = sentMessages[sentMessages.length - 1];
      expect(typeof lastMessage).toBe('string');
      const parsed = JSON.parse(lastMessage as string);
      expect(parsed.type).toBe('audio_chunk');
      expect(parsed.is_final).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup encoder on disconnect', async () => {
      const config: AudioCodecConfig = {
        codec: 'pcm16',
        sampleRate: 16000,
        channelCount: 1,
      };
      client.setAudioCodecConfig(config);
      
      // 验证编码器存在
      expect((client as any).audioEncoder).not.toBeNull();
      
      // 断开连接
      client.disconnect();
      
      // 验证编码器已清理
      expect((client as any).audioEncoder).toBeNull();
    });
  });
});

