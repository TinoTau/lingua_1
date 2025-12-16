/**
 * WebClient 会话模式集成测试
 * 
 * 测试 webClient 中会话模式相关的状态机逻辑：
 * - startSession() / endSession() 的状态转换
 * - sendCurrentUtterance() 的状态转换
 * - 播放完成后的状态切换（会话模式 vs 非会话模式）
 * 
 * 注意：
 * - 这里主要测试状态机的会话模式逻辑，因为 App 类依赖浏览器 API（Recorder、WebSocket、TTS Player）
 * - App 类的完整集成测试需要在浏览器环境中进行
 * - 本测试验证的是 webClient 中会话模式的核心状态转换逻辑
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/state_machine';
import { SessionState } from '../../src/types';

describe('WebClient Session Mode - State Machine Integration', () => {
  let stateMachine: StateMachine;
  let stateChangeHistory: Array<{ newState: SessionState; oldState: SessionState }> = [];

  beforeEach(() => {
    stateMachine = new StateMachine();
    stateChangeHistory = [];
    
    // 记录所有状态变化
    stateMachine.onStateChange((newState, oldState) => {
      stateChangeHistory.push({ newState, oldState });
    });
  });

  describe('会话生命周期', () => {
    it('应该正确开始和结束会话', () => {
      // 初始状态
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);

      // 开始会话
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);
      expect(stateChangeHistory).toHaveLength(1);
      expect(stateChangeHistory[0]).toEqual({
        newState: SessionState.INPUT_RECORDING,
        oldState: SessionState.INPUT_READY,
      });

      // 结束会话
      stateMachine.endSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
      expect(stateChangeHistory).toHaveLength(2);
      expect(stateChangeHistory[1]).toEqual({
        newState: SessionState.INPUT_READY,
        oldState: SessionState.INPUT_RECORDING,
      });
    });

    it('不应该在非 INPUT_READY 状态下开始会话', () => {
      stateMachine.startSession();
      stateMachine.stopRecording();
      
      const currentState = stateMachine.getState();
      const initialState = currentState;
      stateChangeHistory = [];
      
      // 尝试在非 INPUT_READY 状态下开始会话
      stateMachine.startSession();
      
      // 状态不应该改变
      expect(stateMachine.getState()).toBe(initialState);
      expect(stateChangeHistory).toHaveLength(0);
    });
  });

  describe('发送当前话语流程', () => {
    it('应该在会话进行中时，发送后继续监听', () => {
      // 开始会话
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);

      // 发送当前话语（停止录音）
      stateMachine.stopRecording();
      expect(stateMachine.getState()).toBe(SessionState.WAITING_RESULT);
      expect(stateMachine.getIsSessionActive()).toBe(true); // 会话仍然进行中

      // 开始播放
      stateMachine.startPlaying();
      expect(stateMachine.getState()).toBe(SessionState.PLAYING_TTS);
      expect(stateMachine.getIsSessionActive()).toBe(true);

      // 播放完成，应该自动回到录音状态（继续监听）
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true); // 会话仍然进行中
    });

    it('应该在非会话模式下，发送后回到 INPUT_READY', () => {
      // 非会话模式：直接开始录音
      stateMachine.startRecording();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(false);

      // 停止录音
      stateMachine.stopRecording();
      expect(stateMachine.getState()).toBe(SessionState.WAITING_RESULT);

      // 开始播放
      stateMachine.startPlaying();
      expect(stateMachine.getState()).toBe(SessionState.PLAYING_TTS);

      // 播放完成，应该回到 INPUT_READY（需要再次点击开始）
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
    });
  });

  describe('多次发送流程', () => {
    it('应该在会话进行中时，支持多次发送', () => {
      // 开始会话
      stateMachine.startSession();
      expect(stateMachine.getIsSessionActive()).toBe(true);

      // 第一次发送
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);

      // 第二次发送
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);

      // 第三次发送
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);

      // 验证会话在整个过程中保持活跃
      expect(stateMachine.getIsSessionActive()).toBe(true);
    });
  });

  describe('状态转换序列', () => {
    it('应该正确记录会话模式下的状态转换序列', () => {
      stateMachine.startSession();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();
      stateMachine.endSession();

      // 验证状态转换序列
      expect(stateChangeHistory).toEqual([
        { newState: SessionState.INPUT_RECORDING, oldState: SessionState.INPUT_READY },
        { newState: SessionState.WAITING_RESULT, oldState: SessionState.INPUT_RECORDING },
        { newState: SessionState.PLAYING_TTS, oldState: SessionState.WAITING_RESULT },
        { newState: SessionState.INPUT_RECORDING, oldState: SessionState.PLAYING_TTS },
        { newState: SessionState.WAITING_RESULT, oldState: SessionState.INPUT_RECORDING },
        { newState: SessionState.PLAYING_TTS, oldState: SessionState.WAITING_RESULT },
        { newState: SessionState.INPUT_RECORDING, oldState: SessionState.PLAYING_TTS },
        { newState: SessionState.INPUT_READY, oldState: SessionState.INPUT_RECORDING },
      ]);
    });

    it('应该正确记录非会话模式下的状态转换序列', () => {
      stateMachine.startRecording();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      stateMachine.finishPlaying();

      // 验证状态转换序列
      expect(stateChangeHistory).toEqual([
        { newState: SessionState.INPUT_RECORDING, oldState: SessionState.INPUT_READY },
        { newState: SessionState.WAITING_RESULT, oldState: SessionState.INPUT_RECORDING },
        { newState: SessionState.PLAYING_TTS, oldState: SessionState.WAITING_RESULT },
        { newState: SessionState.INPUT_READY, oldState: SessionState.PLAYING_TTS },
      ]);
    });
  });

  describe('边界情况', () => {
    it('应该在会话进行中时，即使多次调用 finishPlaying 也能正确处理', () => {
      stateMachine.startSession();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      
      // 第一次 finishPlaying
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      
      // 再次调用 finishPlaying（不应该改变状态）
      const currentState = stateMachine.getState();
      stateMachine.finishPlaying();
      expect(stateMachine.getState()).toBe(currentState);
    });

    it('应该在结束会话后，状态机正确重置', () => {
      stateMachine.startSession();
      stateMachine.stopRecording();
      stateMachine.startPlaying();
      
      expect(stateMachine.getIsSessionActive()).toBe(true);
      
      // 结束会话
      stateMachine.endSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_READY);
      expect(stateMachine.getIsSessionActive()).toBe(false);
      
      // 可以重新开始会话
      stateMachine.startSession();
      expect(stateMachine.getState()).toBe(SessionState.INPUT_RECORDING);
      expect(stateMachine.getIsSessionActive()).toBe(true);
    });
  });
});

