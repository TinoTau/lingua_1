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

  describe('音频chunk发送控制（canSendChunks）', () => {
    it('在禁止发送时，onAudioFrame 不应调用 sendAudioChunk', () => {
      // 模拟会话已激活且处于录音状态
      (manager as any).isSessionActive = true;
      const sm = (manager as any).stateMachine as StateMachine;
      sm.startSession();
      expect(sm.getState()).toBe(SessionState.INPUT_RECORDING);

      // 禁止发送chunk
      manager.setCanSendChunks(false);

      // 监控 WebSocketClient.sendAudioChunk 调用情况
      const sendAudioChunkSpy = vi
        .spyOn(wsClient as any, 'sendAudioChunk')
        .mockImplementation(async () => {});

      // 构造一帧伪造音频数据
      const frame = new Float32Array(4096).fill(0.1);

      // 调用 onAudioFrame，多次以确保不会意外触发发送
      manager.onAudioFrame(frame);
      manager.onAudioFrame(frame);

      expect(sendAudioChunkSpy).not.toHaveBeenCalled();
    });

    it('在允许发送时，onAudioFrame 应按帧长发送chunk（约256ms一包）', () => {
      // 模拟会话已激活且处于录音状态
      (manager as any).isSessionActive = true;
      const sm = (manager as any).stateMachine as StateMachine;
      sm.startSession();
      expect(sm.getState()).toBe(SessionState.INPUT_RECORDING);

      // 允许发送chunk
      manager.setCanSendChunks(true);

      // 监控 WebSocketClient.sendAudioChunk 调用情况
      const sendAudioChunkSpy = vi
        .spyOn(wsClient as any, 'sendAudioChunk')
        .mockImplementation(async () => {});

      // 构造一帧伪造音频数据（长度用于推算帧时长）
      const frame = new Float32Array(4096).fill(0.2);

      // 第一次 onAudioFrame：初始化 samplesPerFrame 和 framesPerChunk，并立即发送第一个chunk
      manager.onAudioFrame(frame);

      expect(sendAudioChunkSpy).toHaveBeenCalledTimes(1);

      // 检查 hasSentAudioChunksForCurrentUtterance 被标记为 true（通过内部状态）
      expect((manager as any).hasSentAudioChunksForCurrentUtterance).toBe(true);

      // 再来一帧，audioBuffer 中会累积新帧，根据 framesPerChunk（当前配置下为1）再次发送
      manager.onAudioFrame(frame);
      expect(sendAudioChunkSpy).toHaveBeenCalledTimes(2);
    });
  });
});

