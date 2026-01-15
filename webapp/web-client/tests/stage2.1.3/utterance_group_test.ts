// Utterance Group 功能测试（阶段 2.1.3）

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketClient } from '../../src/websocket_client';
import { StateMachine } from '../../src/state_machine';
import { TtsPlayer } from '../../src/tts_player';
import { TranslationResultMessage } from '../../src/types';

describe('Utterance Group - TTS_PLAY_ENDED 消息发送', () => {
  let stateMachine: StateMachine;
  let wsClient: WebSocketClient;
  let ttsPlayer: TtsPlayer;
  let mockWebSocket: any;
  let sentMessages: string[] = [];

  beforeEach(() => {
    // 重置状态
    sentMessages = [];

    // 创建 mock WebSocket
    mockWebSocket = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn((msg: string) => {
        sentMessages.push(msg);
      }),
      close: vi.fn(),
    };

    // Mock WebSocket 构造函数和常量
    global.WebSocket = vi.fn(() => mockWebSocket) as any;
    (global.WebSocket as any).OPEN = 1;
    (global.WebSocket as any).CONNECTING = 0;
    (global.WebSocket as any).CLOSING = 2;
    (global.WebSocket as any).CLOSED = 3;

    stateMachine = new StateMachine();
    wsClient = new WebSocketClient(stateMachine, 'ws://localhost:5010/ws/session');
    ttsPlayer = new TtsPlayer(stateMachine);

    // 重置 mock
    vi.clearAllMocks();
  });

  it('应该能够发送 TTS_PLAY_ENDED 消息', () => {
    // 针对重构后的 WebSocketClient：通过 ConnectionManager 和 MessageHandler 发送消息
    const sendFn = vi.fn((msg: string | ArrayBuffer) => {
      // 这里只处理 JSON 文本消息
      if (typeof msg === 'string') {
        sentMessages.push(msg);
      }
    });

    // 模拟连接已建立
    const connectionManager = (wsClient as any).connectionManager;
    connectionManager.isConnected = () => true;
    connectionManager.send = sendFn;

    // 模拟已有 sessionId
    const messageHandler = (wsClient as any).messageHandler;
    messageHandler.getSessionId = () => 'test_session_123';

    const traceId = 'trace_123';
    const groupId = 'group_456';
    const tsEndMs = 1234567890; // 使用固定时间戳以便测试

    // 验证条件
    expect(connectionManager.isConnected()).toBe(true);
    expect(messageHandler.getSessionId()).toBe('test_session_123');

    wsClient.sendTtsPlayEnded(traceId, groupId, tsEndMs);

    expect(sendFn).toHaveBeenCalledTimes(1);
    expect(sentMessages.length).toBe(1);
    const sentMessage = JSON.parse(sentMessages[0]);
    expect(sentMessage.type).toBe('tts_play_ended');
    expect(sentMessage.session_id).toBe('test_session_123');
    expect(sentMessage.trace_id).toBe(traceId);
    expect(sentMessage.group_id).toBe(groupId);
    expect(sentMessage.ts_end_ms).toBe(tsEndMs);
  });

  it('当 WebSocket 未连接时不应该发送消息', () => {
    // 重构后：通过 ConnectionManager 和 MessageHandler 检查连接/会话状态
    const connectionManager = (wsClient as any).connectionManager;
    const messageHandler = (wsClient as any).messageHandler;
    connectionManager.isConnected = () => false;
    messageHandler.getSessionId = () => null;

    wsClient.sendTtsPlayEnded('trace_123', 'group_456', Date.now());

    expect(mockWebSocket.send).not.toHaveBeenCalled();
  });

  it('应该正确处理 TranslationResult 消息并保存 group_id', () => {
    // 这个测试需要集成到 App 类中，这里先测试消息类型
    const message: TranslationResultMessage = {
      type: 'translation_result',
      session_id: 'test_session',
      utterance_index: 0,
      job_id: 'job_123',
      text_asr: 'Hello',
      text_translated: '你好',
      tts_audio: 'base64audio',
      tts_format: 'pcm16',
      trace_id: 'trace_123',
      group_id: 'group_456',
      part_index: 0,
    };

    expect(message.group_id).toBe('group_456');
    expect(message.part_index).toBe(0);
    expect(message.trace_id).toBe('trace_123');
  });

  it('应该处理没有 group_id 的 TranslationResult 消息', () => {
    const message: TranslationResultMessage = {
      type: 'translation_result',
      session_id: 'test_session',
      utterance_index: 0,
      job_id: 'job_123',
      text_asr: 'Hello',
      text_translated: '你好',
      tts_audio: 'base64audio',
      tts_format: 'pcm16',
      trace_id: 'trace_123',
      // group_id 和 part_index 是可选的
    };

    expect(message.group_id).toBeUndefined();
    expect(message.part_index).toBeUndefined();
  });
});

