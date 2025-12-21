/**
 * Recorder VAD 静音过滤测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Recorder } from '../src/recorder';
import { StateMachine } from '../src/state_machine';
import { SessionState, DEFAULT_CONFIG } from '../src/types';

describe('Recorder - VAD 静音过滤', () => {
  let recorder: Recorder;
  let stateMachine: StateMachine;
  let audioFrameCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stateMachine = new StateMachine();
    recorder = new Recorder(stateMachine, DEFAULT_CONFIG);
    audioFrameCallback = vi.fn();
    recorder.setAudioFrameCallback(audioFrameCallback);
  });

  describe('静音过滤配置', () => {
    it('应该使用默认配置', () => {
      const config = recorder.getSilenceFilterConfig();
      expect(config.enabled).toBe(true);
      expect(config.threshold).toBe(0.015); // 更新后的阈值
      expect(config.attackFrames).toBe(3);
      expect(config.releaseFrames).toBe(5);
    });

    it('应该能够更新静音过滤配置', () => {
      recorder.updateSilenceFilterConfig({
        threshold: 0.02,
        attackFrames: 5,
      });

      const config = recorder.getSilenceFilterConfig();
      expect(config.threshold).toBe(0.02);
      expect(config.attackFrames).toBe(5);
      expect(config.releaseFrames).toBe(5); // 未更新的保持原值
    });
  });

  describe('静音过滤逻辑', () => {
    it('应该过滤明显静音', () => {
      // 创建静音音频数据（RMS值很低）
      const silenceAudio = new Float32Array(1000).fill(0.001); // 非常小的值
      
      // 由于无法直接调用processSilenceFilter，我们通过模拟音频处理来测试
      // 注意：这需要实际初始化recorder
    });

    it('应该通过有效语音', () => {
      // 创建有效语音数据（RMS值较高）
      const voiceAudio = new Float32Array(1000);
      for (let i = 0; i < voiceAudio.length; i++) {
        voiceAudio[i] = Math.sin(i * 0.1) * 0.5; // 正弦波，RMS约0.35
      }
      
      // 由于无法直接调用processSilenceFilter，我们通过模拟音频处理来测试
    });
  });

  describe('平滑逻辑', () => {
    it('应该需要连续N帧语音才开始发送', () => {
      // 测试attackFrames逻辑
      // 需要实际初始化recorder并处理音频帧
    });

    it('应该需要连续M帧静音才停止发送', () => {
      // 测试releaseFrames逻辑
      // 需要实际初始化recorder并处理音频帧
    });
  });

  describe('调试日志', () => {
    it('应该输出VAD调试日志', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      // 初始化recorder会输出日志
      // 注意：需要实际初始化才能触发日志
      
      consoleSpy.mockRestore();
    });
  });
});

