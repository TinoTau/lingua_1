import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine } from '../../src/state_machine';
import { SessionState } from '../../src/types';

describe('StateMachine - Session Mode', () => {
  let stateMachine: StateMachine;

  beforeEach(() => {
    stateMachine = new StateMachine();
  });

  describe('Session Lifecycle', () => {
    it('should start in INPUT_READY state with session inactive', () => {
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
    });

    it('should start session and enter INPUT_RECORDING', () => {
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);
    });

    it('should not start session if not in INPUT_READY', () => {
      stateMachine.startSession();
      stateMachine.stopRecording();
      // Now in WAITING_RESULT
      const initialState = stateMachine.getState();
      stateMachine.startSession(); // Should not change state
      expect(stateMachine.getState()).toBe(initialState);
    });

    it('should end session and return to INPUT_READY', () => {
      stateMachine.startSession();
      expect(stateMachine.getIsSessionActive()).toBe(true);
      
      stateMachine.endSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
    });
  });

  describe('finishPlaying() with Session Mode', () => {
    it('should return to INPUT_READY when session is inactive', () => {
      // Not in session mode
      stateMachine.startRecording();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
    });

    it('should return to INPUT_RECORDING when session is active', () => {
      // In session mode
      stateMachine.startSession();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);
    });

    it('should continue listening after playback in session mode', () => {
      stateMachine.startSession();
      
      // First utterance
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // Second utterance
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // Session should still be active
      expect(stateMachine.getIsSessionActive()).toBe(true);
    });
  });

  describe('State Transitions in Session Mode', () => {
    it('should transition correctly in session mode (refactored)', () => {
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // 重构后：stopRecording不再切换状态
      stateMachine.stopRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // 可以直接从INPUT_RECORDING开始播放
      stateMachine.startPlaying();
      expect(stateMachine.getState()).toBe(SessionState.PLAYING_TTS);
      
      // 播放完成后回到INPUT_RECORDING（会话进行中）
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);
    });

    it('should reset session state on reset()', () => {
      stateMachine.startSession();
      expect(stateMachine.getIsSessionActive()).toBe(true);
      
      stateMachine.reset();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
    });
  });

  describe('State Change Callbacks', () => {
    it('should call callbacks on state change', () => {
      const callback = vi.fn();
      stateMachine.onStateChange(callback);
      
      stateMachine.startSession();
      expect(callback).toHaveBeenCalledWith(
        SessionState.INPUT_RECORDING,
        SessionState.INPUT_READY
      );
    });

    it('should call callbacks on finishPlaying in session mode', () => {
      const callback = vi.fn();
      stateMachine.onStateChange(callback);
      
      stateMachine.startSession();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      callback.mockClear();
      
      stateMachine.finishPlaying();
      expect(callback).toHaveBeenCalledWith(
        SessionState.INPUT_RECORDING,
        SessionState.PLAYING_TTS
      );
    });
  });
});

