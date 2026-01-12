/**
 * 功能选择模块测试
 * 测试功能选择逻辑和 FeatureFlags 构建
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FeatureFlags } from '../../src/types';

describe('FeatureFlags 类型和功能选择', () => {
  describe('FeatureFlags 接口', () => {
    it('应该支持所有可选功能字段', () => {
      const features: FeatureFlags = {
        emotion_detection: true,
        voice_style_detection: true,
        speech_rate_detection: true,
        speech_rate_control: true,
        speaker_identification: true,
        persona_adaptation: true,
      };

      expect(features.emotion_detection).toBe(true);
      expect(features.voice_style_detection).toBe(true);
      expect(features.speech_rate_detection).toBe(true);
      expect(features.speech_rate_control).toBe(true);
      expect(features.speaker_identification).toBe(true);
      expect(features.persona_adaptation).toBe(true);
    });

    it('应该支持部分功能选择', () => {
      const features: FeatureFlags = {
        emotion_detection: true,
        speaker_identification: true,
      };

      expect(features.emotion_detection).toBe(true);
      expect(features.speaker_identification).toBe(true);
      expect(features.voice_style_detection).toBeUndefined();
      expect(features.speech_rate_detection).toBeUndefined();
    });

    it('应该支持空的功能选择', () => {
      const features: FeatureFlags = {};
      expect(Object.keys(features).length).toBe(0);
    });
  });

  describe('功能选择逻辑', () => {
    it('应该正确构建 FeatureFlags 对象（所有功能选中）', () => {
      const features: FeatureFlags = {};
      
      // 模拟用户选择所有功能
      const emotionSelected = true;
      const voiceStyleSelected = true;
      const speechRateDetectionSelected = true;
      const speechRateControlSelected = true;
      const speakerIdSelected = true;
      const personaSelected = true;

      if (emotionSelected) features.emotion_detection = true;
      if (voiceStyleSelected) features.voice_style_detection = true;
      if (speechRateDetectionSelected) features.speech_rate_detection = true;
      if (speechRateControlSelected) features.speech_rate_control = true;
      if (speakerIdSelected) features.speaker_identification = true;
      if (personaSelected) features.persona_adaptation = true;

      expect(Object.keys(features).length).toBe(6);
      expect(features.emotion_detection).toBe(true);
      expect(features.voice_style_detection).toBe(true);
      expect(features.speech_rate_detection).toBe(true);
      expect(features.speech_rate_control).toBe(true);
      expect(features.speaker_identification).toBe(true);
      expect(features.persona_adaptation).toBe(true);
    });

    it('应该正确构建 FeatureFlags 对象（部分功能选中）', () => {
      const features: FeatureFlags = {};
      
      // 模拟用户只选择部分功能
      const emotionSelected = true;
      const voiceStyleSelected = false;
      const speechRateDetectionSelected = true;
      const speechRateControlSelected = false;
      const speakerIdSelected = false;
      const personaSelected = false;

      if (emotionSelected) features.emotion_detection = true;
      if (voiceStyleSelected) features.voice_style_detection = true;
      if (speechRateDetectionSelected) features.speech_rate_detection = true;
      if (speechRateControlSelected) features.speech_rate_control = true;
      if (speakerIdSelected) features.speaker_identification = true;
      if (personaSelected) features.persona_adaptation = true;

      expect(Object.keys(features).length).toBe(2);
      expect(features.emotion_detection).toBe(true);
      expect(features.speech_rate_detection).toBe(true);
      expect(features.voice_style_detection).toBeUndefined();
      expect(features.speech_rate_control).toBeUndefined();
      expect(features.speaker_identification).toBeUndefined();
      expect(features.persona_adaptation).toBeUndefined();
    });

    it('应该正确构建 FeatureFlags 对象（无功能选中）', () => {
      const features: FeatureFlags = {};
      
      // 模拟用户未选择任何功能
      const emotionSelected = false;
      const voiceStyleSelected = false;
      const speechRateDetectionSelected = false;
      const speechRateControlSelected = false;
      const speakerIdSelected = false;
      const personaSelected = false;

      if (emotionSelected) features.emotion_detection = true;
      if (voiceStyleSelected) features.voice_style_detection = true;
      if (speechRateDetectionSelected) features.speech_rate_detection = true;
      if (speechRateControlSelected) features.speech_rate_control = true;
      if (speakerIdSelected) features.speaker_identification = true;
      if (personaSelected) features.persona_adaptation = true;

      expect(Object.keys(features).length).toBe(0);
    });

    it('应该正确处理功能依赖关系（语速控制依赖语速检测）', () => {
      // 注意：这个测试验证逻辑，实际依赖关系由后端处理
      const features: FeatureFlags = {};
      
      // 用户选择了语速控制，理论上也应该需要语速检测
      const speechRateDetectionSelected = true;
      const speechRateControlSelected = true;

      if (speechRateDetectionSelected) features.speech_rate_detection = true;
      if (speechRateControlSelected) features.speech_rate_control = true;

      // 前端只负责收集用户选择，依赖检查由后端 ModuleManager 处理
      expect(features.speech_rate_detection).toBe(true);
      expect(features.speech_rate_control).toBe(true);
    });
  });

  describe('功能选择序列化', () => {
    it('应该能够正确序列化为 JSON', () => {
      const features: FeatureFlags = {
        emotion_detection: true,
        speaker_identification: true,
      };

      const json = JSON.stringify(features);
      const parsed = JSON.parse(json) as FeatureFlags;

      expect(parsed.emotion_detection).toBe(true);
      expect(parsed.speaker_identification).toBe(true);
      expect(parsed.voice_style_detection).toBeUndefined();
    });

    it('应该能够正确反序列化 JSON', () => {
      const json = '{"emotion_detection":true,"speech_rate_detection":true}';
      const features = JSON.parse(json) as FeatureFlags;

      expect(features.emotion_detection).toBe(true);
      expect(features.speech_rate_detection).toBe(true);
      expect(features.speaker_identification).toBeUndefined();
    });
  });
});

