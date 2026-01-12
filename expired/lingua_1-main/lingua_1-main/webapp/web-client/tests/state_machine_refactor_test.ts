/**
 * 状态机重构测试
 * 测试Send按钮不再切换状态的行为
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine } from '../src/state_machine';
import { SessionState } from '../src/types';

describe('StateMachine - 重构后的行为', () => {
  let stateMachine: StateMachine;
  let stateChangeCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stateMachine = new StateMachine();
    stateChangeCallback = vi.fn();
    stateMachine.onStateChange(stateChangeCallback);
  });

  describe('Send按钮行为（不再切换状态）', () => {
    it('stopRecording应该不改变状态', () => {
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      stateChangeCallback.mockClear();
      
      // stopRecording应该不改变状态
      stateMachine.stopRecording();
      
      // 状态应该仍然是INPUT_RECORDING
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // 不应该触发状态变化回调
      expect(stateChangeCallback).not.toHaveBeenCalled();
    });

    it('应该在INPUT_RECORDING状态下允许持续输入', () => {
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // 多次调用stopRecording，状态应该保持不变
      stateMachine.stopRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      stateMachine.stopRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
    });
  });

  describe('状态流转（输入和输出）', () => {
    it('应该正确切换输入和输出状态', () => {
      // 开始会话：INPUT_READY -> INPUT_RECORDING
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);
      
      // 开始播放：INPUT_RECORDING -> PLAYING_TTS
      stateMachine.startPlaying();
      expect(stateMachine.getState()).toBe(SessionState.PLAYING_TTS);
      
      // 暂停播放：PLAYING_TTS -> INPUT_RECORDING
      stateMachine.pausePlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // 播放完成：PLAYING_TTS -> INPUT_RECORDING（会话进行中）
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);
    });

    it('应该在会话未开始时，播放完成后回到INPUT_READY', () => {
      // 不在会话模式
      stateMachine.startRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
    });
  });

  describe('canSend检查', () => {
    it('应该在INPUT_RECORDING状态下允许发送', () => {
      stateMachine.startSession();
      expect(stateMachine.canSend()).toBe(true);
    });

    it('不应该在其他状态下允许发送', () => {
      expect(stateMachine.canSend()).toBe(false); // INPUT_READY
      
      stateMachine.startRecording();
      stateMachine.startPlaying();
      expect(stateMachine.canSend()).toBe(false); // PLAYING_TTS
    });
  });

  describe('canPlay检查', () => {
    it('应该在INPUT_RECORDING或PLAYING_TTS状态下允许播放', () => {
      stateMachine.startSession();
      expect(stateMachine.canPlay()).toBe(true); // INPUT_RECORDING
      
      stateMachine.startPlaying();
      expect(stateMachine.canPlay()).toBe(true); // PLAYING_TTS
    });
  });
});

