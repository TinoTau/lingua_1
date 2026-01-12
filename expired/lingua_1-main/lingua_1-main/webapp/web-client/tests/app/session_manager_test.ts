/**
 * 会话管理模块单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../src/app/session_manager';
import { StateMachine } from '../../src/state_machine';
import { Recorder } from '../../src/recorder';
import { WebSocketClient } from '../../src/websocket_client';
import { TtsPlayer } from '../../src/tts_player';
import { AsrSubtitle } from '../../src/asr_subtitle';
import { TranslationDisplayManager } from '../../src/app/translation_display';
import { SessionState } from '../../src/types';

describe('SessionManager', () => {
  let manager: SessionManager;
  let stateMachine: StateMachine;
  let recorder: Recorder;
  let wsClient: WebSocketClient;
  let ttsPlayer: TtsPlayer;
  let asrSubtitle: AsrSubtitle;
  let translationDisplay: TranslationDisplayManager;

  beforeEach(() => {
    stateMachine = new StateMachine();
    recorder = new Recorder(stateMachine, {});
    wsClient = new WebSocketClient(stateMachine, 'ws://localhost:8080');
    ttsPlayer = new TtsPlayer(stateMachine);
    asrSubtitle = new AsrSubtitle('app');
    translationDisplay = new TranslationDisplayManager();

    manager = new SessionManager(
      stateMachine,
      recorder,
      wsClient,
      ttsPlayer,
      asrSubtitle,
      translationDisplay
    );
  });

  it('应该能够获取会话状态', () => {
    expect(manager.getIsSessionActive()).toBe(false);
  });

  it('应该能够获取当前utterance索引', () => {
    expect(manager.getCurrentUtteranceIndex()).toBe(0);
  });

  it('应该能够设置和获取trace信息', () => {
    manager.setCurrentTraceInfo('trace-123', 'group-456');
    const info = manager.getCurrentTraceInfo();
    
    expect(info.traceId).toBe('trace-123');
    expect(info.groupId).toBe('group-456');
  });

  it('应该能够清空trace信息', () => {
    manager.setCurrentTraceInfo('trace-123', 'group-456');
    manager.setCurrentTraceInfo(null, null);
    
    const info = manager.getCurrentTraceInfo();
    expect(info.traceId).toBeNull();
    expect(info.groupId).toBeNull();
  });
});

