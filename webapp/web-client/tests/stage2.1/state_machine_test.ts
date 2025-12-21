/**
 * 状态机模块测试
 * 测试状态转换逻辑和回调机制
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine } from '../../src/state_machine';
import { SessionState } from '../../src/types';

describe('StateMachine', () => {
  let stateMachine: StateMachine;
  let stateChangeCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stateMachine = new StateMachine();
    stateChangeCallback = vi.fn();
    stateMachine.onStateChange(stateChangeCallback);
  });

  describe('初始状态', () => {
    it('应该初始化为 INPUT_READY 状态', () => {
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
    });
  });

  describe('状态转换', () => {
    it('应该从 INPUT_READY 转换到 INPUT_RECORDING', () => {
      stateMachine.startRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateChangeCallback).toHaveBeenCalledWith(
        SessionState.INPUT_RECORDING,
        SessionState.INPUT_READY
      );
    });

    it('stopRecording应该不改变状态（重构后行为）', () => {
      stateMachine.startRecording();
      stateChangeCallback.mockClear();
      
      // 重构后：stopRecording不再切换状态，保持在INPUT_RECORDING
      stateMachine.stopRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      // 不应该触发状态变化回调
      expect(stateChangeCallback).not.toHaveBeenCalled();
    });

    it('应该从 INPUT_RECORDING 直接转换到 PLAYING_TTS', () => {
      stateMachine.startRecording();
      stateChangeCallback.mockClear();
      
      // 可以直接从INPUT_RECORDING开始播放（不需要WAITING_RESULT）
      stateMachine.startPlaying();
      expect(stateMachine.getState()).toBe(SessionState.PLAYING_TTS);
      expect(stateChangeCallback).toHaveBeenCalledWith(
        SessionState.PLAYING_TTS,
        SessionState.INPUT_RECORDING
      );
    });

    it('应该从 PLAYING_TTS 转换到 INPUT_READY（非会话模式）', () => {
      stateMachine.startRecording();
      stateMachine.startPlaying();
      stateChangeCallback.mockClear();
      
      // 非会话模式：播放完成后回到INPUT_READY
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateChangeCallback).toHaveBeenCalledWith(
        SessionState.INPUT_READY,
        SessionState.PLAYING_TTS
      );
    });
  });

  describe('无效状态转换', () => {
    it('不应该从非 INPUT_READY 状态开始录音', () => {
      stateMachine.startRecording();
      stateChangeCallback.mockClear();
      
      // 尝试在 INPUT_RECORDING 状态下再次开始录音
      stateMachine.startRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateChangeCallback).not.toHaveBeenCalled();
    });

    it('不应该从非 INPUT_RECORDING 状态停止录音', () => {
      stateChangeCallback.mockClear();
      
      // 尝试在 INPUT_READY 状态下停止录音
      stateMachine.stopRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateChangeCallback).not.toHaveBeenCalled();
    });

    it('应该允许从 INPUT_RECORDING 状态开始播放（重构后行为）', () => {
      stateMachine.startRecording();
      stateChangeCallback.mockClear();
      
      // 重构后：允许从INPUT_RECORDING直接开始播放
      stateMachine.startPlaying();
      expect(stateMachine.getState()).toBe(SessionState.PLAYING_TTS);
      expect(stateChangeCallback).toHaveBeenCalledWith(
        SessionState.PLAYING_TTS,
        SessionState.INPUT_RECORDING
      );
    });

    it('不应该从非 PLAYING_TTS 状态完成播放', () => {
      stateMachine.startRecording();
      stateChangeCallback.mockClear();
      
      // 尝试在 INPUT_RECORDING 状态下完成播放
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateChangeCallback).not.toHaveBeenCalled();
    });
  });

  describe('完整状态循环', () => {
    it('应该完成完整的状态循环（重构后）', () => {
      const states: SessionState[] = [];
      const callback = (newState: SessionState) => {
        states.push(newState);
      };
      stateMachine.onStateChange(callback);

      // INPUT_READY -> INPUT_RECORDING
      stateMachine.startRecording();
      expect(states[states.length - 1]).toBe(SessionState.INPUT_RECORDING);

      // 重构后：stopRecording不再切换状态
      stateMachine.stopRecording();
      expect(states[states.length - 1]).toBe(SessionState.INPUT_RECORDING);

      // INPUT_RECORDING -> PLAYING_TTS（可以直接转换）
      stateMachine.startPlaying();
      expect(states[states.length - 1]).toBe(SessionState.PLAYING_TTS);

      // PLAYING_TTS -> INPUT_READY（非会话模式）
      stateMachine.finishPlaying();
      expect(states[states.length - 1]).toBe(SessionState.INPUT_READY);
    });
  });

  describe('回调管理', () => {
    it('应该支持多个回调', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      
      stateMachine.onStateChange(callback1);
      stateMachine.onStateChange(callback2);
      
      stateMachine.startRecording();
      
      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('应该支持移除回调', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      
      stateMachine.onStateChange(callback1);
      stateMachine.onStateChange(callback2);
      
      stateMachine.removeStateChangeCallback(callback1);
      
      stateMachine.startRecording();
      
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('应该处理回调中的错误', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalCallback = vi.fn();
      
      stateMachine.onStateChange(errorCallback);
      stateMachine.onStateChange(normalCallback);
      
      // 不应该因为错误回调而阻止其他回调执行
      expect(() => stateMachine.startRecording()).not.toThrow();
      expect(normalCallback).toHaveBeenCalled();
    });
  });

  describe('重置功能', () => {
    it('应该重置到 INPUT_READY 状态', () => {
      stateMachine.startRecording();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      
      expect(stateMachine.getState()).toBe(SessionState.PLAYING_TTS);
      
      stateMachine.reset();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
    });
  });
});

