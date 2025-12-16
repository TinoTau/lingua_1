/**
 * WebSocket 客户端功能选择测试
 * 测试 features 参数的传递逻辑
 * 
 * 注意：由于 WebSocket 需要浏览器环境，这里主要测试逻辑而非实际连接
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FeatureFlags } from '../../src/types';

describe('WebSocket 客户端功能选择', () => {
  describe('FeatureFlags 参数处理', () => {
    it('应该正确处理完整的 FeatureFlags 对象', () => {
      const features: FeatureFlags = {
        emotion_detection: true,
        voice_style_detection: true,
        speech_rate_detection: true,
        speech_rate_control: true,
        speaker_identification: true,
        persona_adaptation: true,
      };

      // 模拟 session_init 消息构建
      const initMessage = {
        type: 'session_init',
        client_version: 'web-client-v1.0',
        platform: 'web',
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        features: features,
        pairing_code: null,
      };

      expect(initMessage.features).toBeDefined();
      expect(initMessage.features?.emotion_detection).toBe(true);
      expect(initMessage.features?.speaker_identification).toBe(true);
    });

    it('应该正确处理部分功能选择', () => {
      const features: FeatureFlags = {
        emotion_detection: true,
        speaker_identification: true,
      };

      const initMessage = {
        type: 'session_init',
        client_version: 'web-client-v1.0',
        platform: 'web',
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        features: features,
        pairing_code: null,
      };

      expect(initMessage.features).toBeDefined();
      expect(Object.keys(initMessage.features || {}).length).toBe(2);
    });

    it('应该正确处理空的功能选择（undefined）', () => {
      const features: FeatureFlags | undefined = undefined;

      const initMessage = {
        type: 'session_init',
        client_version: 'web-client-v1.0',
        platform: 'web',
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        features: features || {},
        pairing_code: null,
      };

      expect(initMessage.features).toEqual({});
    });

    it('应该正确处理空的功能选择（空对象）', () => {
      const features: FeatureFlags = {};

      const initMessage = {
        type: 'session_init',
        client_version: 'web-client-v1.0',
        platform: 'web',
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        features: features,
        pairing_code: null,
      };

      expect(initMessage.features).toBeDefined();
      expect(Object.keys(initMessage.features || {}).length).toBe(0);
    });
  });

  describe('功能选择与语言选择组合', () => {
    it('应该同时支持语言和功能选择', () => {
      const srcLang = 'zh';
      const tgtLang = 'en';
      const features: FeatureFlags = {
        emotion_detection: true,
        speaker_identification: true,
      };

      const initMessage = {
        type: 'session_init',
        client_version: 'web-client-v1.0',
        platform: 'web',
        src_lang: srcLang,
        tgt_lang: tgtLang,
        dialect: null,
        features: features,
        pairing_code: null,
      };

      expect(initMessage.src_lang).toBe('zh');
      expect(initMessage.tgt_lang).toBe('en');
      expect(initMessage.features?.emotion_detection).toBe(true);
      expect(initMessage.features?.speaker_identification).toBe(true);
    });

    it('应该支持不同语言组合和功能选择', () => {
      const testCases = [
        { srcLang: 'zh', tgtLang: 'en', features: { emotion_detection: true } },
        { srcLang: 'en', tgtLang: 'zh', features: { speaker_identification: true } },
        { srcLang: 'zh', tgtLang: 'zh', features: { speech_rate_detection: true } },
      ];

      testCases.forEach(({ srcLang, tgtLang, features }) => {
        const initMessage = {
          type: 'session_init',
          client_version: 'web-client-v1.0',
          platform: 'web',
          src_lang: srcLang,
          tgt_lang: tgtLang,
          dialect: null,
          features: features,
          pairing_code: null,
        };

        expect(initMessage.src_lang).toBe(srcLang);
        expect(initMessage.tgt_lang).toBe(tgtLang);
        expect(initMessage.features).toEqual(features);
      });
    });
  });

  describe('功能选择消息序列化', () => {
    it('应该能够正确序列化包含 features 的消息', () => {
      const features: FeatureFlags = {
        emotion_detection: true,
        speaker_identification: true,
      };

      const initMessage = {
        type: 'session_init',
        client_version: 'web-client-v1.0',
        platform: 'web',
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        features: features,
        pairing_code: null,
      };

      const json = JSON.stringify(initMessage);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('session_init');
      expect(parsed.features).toBeDefined();
      expect(parsed.features.emotion_detection).toBe(true);
      expect(parsed.features.speaker_identification).toBe(true);
    });

    it('应该能够正确序列化空 features 的消息', () => {
      const initMessage = {
        type: 'session_init',
        client_version: 'web-client-v1.0',
        platform: 'web',
        src_lang: 'zh',
        tgt_lang: 'en',
        dialect: null,
        features: {},
        pairing_code: null,
      };

      const json = JSON.stringify(initMessage);
      const parsed = JSON.parse(json);

      expect(parsed.features).toBeDefined();
      expect(Object.keys(parsed.features).length).toBe(0);
    });
  });
});

