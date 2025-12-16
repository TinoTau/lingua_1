/**
 * 双向模式（面对面模式）测试
 * 
 * 测试范围：
 * - 双向模式连接逻辑
 * - WebSocket 消息格式
 * - 语言配置传递
 * - 模式切换逻辑
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 模拟双向模式连接配置
interface TwoWayModeConfig {
  langA: string;
  langB: string;
  mode: 'two_way_auto';
  srcLang: 'auto';
  autoLangs: string[];
}

// 模拟单向模式连接配置
interface OneWayModeConfig {
  srcLang: string;
  tgtLang: string;
  mode: 'one_way';
}

// 模拟 WebSocket 消息
interface SessionInitMessage {
  type: 'session_init';
  client_version: string;
  platform: string;
  src_lang: string;
  tgt_lang: string;
  dialect: null;
  features: Record<string, boolean>;
  pairing_code: null;
  mode?: string;
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
}

// 模拟双向模式连接管理器
class TwoWayModeManager {
  private sentMessages: SessionInitMessage[] = [];

  /**
   * 连接（单向模式）
   */
  connectOneWay(srcLang: string, tgtLang: string, features?: Record<string, boolean>): SessionInitMessage {
    const message: SessionInitMessage = {
      type: 'session_init',
      client_version: 'web-client-v1.0',
      platform: 'web',
      src_lang: srcLang,
      tgt_lang: tgtLang,
      dialect: null,
      features: features || {},
      pairing_code: null,
      mode: 'one_way',
    };
    this.sentMessages.push(message);
    return message;
  }

  /**
   * 连接（双向模式）
   */
  connectTwoWay(langA: string, langB: string, features?: Record<string, boolean>): SessionInitMessage {
    const message: SessionInitMessage = {
      type: 'session_init',
      client_version: 'web-client-v1.0',
      platform: 'web',
      src_lang: 'auto', // 双向模式使用自动检测
      tgt_lang: langB, // 临时目标语言
      dialect: null,
      features: features || {},
      pairing_code: null,
      mode: 'two_way_auto',
      lang_a: langA,
      lang_b: langB,
      auto_langs: [langA, langB], // 限制识别范围
    };
    this.sentMessages.push(message);
    return message;
  }

  /**
   * 获取发送的消息列表
   */
  getSentMessages(): SessionInitMessage[] {
    return [...this.sentMessages];
  }

  /**
   * 清空消息列表
   */
  clearMessages(): void {
    this.sentMessages = [];
  }
}

describe('双向模式（面对面模式）', () => {
  let manager: TwoWayModeManager;

  beforeEach(() => {
    manager = new TwoWayModeManager();
  });

  describe('连接逻辑', () => {
    it('应该正确发送双向模式的连接消息', () => {
      const message = manager.connectTwoWay('zh', 'en');

      expect(message.type).toBe('session_init');
      expect(message.mode).toBe('two_way_auto');
      expect(message.src_lang).toBe('auto');
      expect(message.tgt_lang).toBe('en');
      expect(message.lang_a).toBe('zh');
      expect(message.lang_b).toBe('en');
      expect(message.auto_langs).toEqual(['zh', 'en']);
    });

    it('应该正确发送单向模式的连接消息', () => {
      const message = manager.connectOneWay('zh', 'en');

      expect(message.type).toBe('session_init');
      expect(message.mode).toBe('one_way');
      expect(message.src_lang).toBe('zh');
      expect(message.tgt_lang).toBe('en');
      expect(message.lang_a).toBeUndefined();
      expect(message.lang_b).toBeUndefined();
      expect(message.auto_langs).toBeUndefined();
    });

    it('双向模式应该包含 auto_langs 限制识别范围', () => {
      const message = manager.connectTwoWay('ja', 'en');

      expect(message.auto_langs).toEqual(['ja', 'en']);
      expect(message.auto_langs).toHaveLength(2);
    });
  });

  describe('语言配置', () => {
    it('应该支持中英双向模式', () => {
      const message = manager.connectTwoWay('zh', 'en');

      expect(message.lang_a).toBe('zh');
      expect(message.lang_b).toBe('en');
      expect(message.auto_langs).toEqual(['zh', 'en']);
    });

    it('应该支持日英双向模式', () => {
      const message = manager.connectTwoWay('ja', 'en');

      expect(message.lang_a).toBe('ja');
      expect(message.lang_b).toBe('en');
      expect(message.auto_langs).toEqual(['ja', 'en']);
    });

    it('应该支持韩英双向模式', () => {
      const message = manager.connectTwoWay('ko', 'en');

      expect(message.lang_a).toBe('ko');
      expect(message.lang_b).toBe('en');
      expect(message.auto_langs).toEqual(['ko', 'en']);
    });

    it('应该支持语言顺序互换', () => {
      const message1 = manager.connectTwoWay('zh', 'en');
      manager.clearMessages();
      const message2 = manager.connectTwoWay('en', 'zh');

      expect(message1.lang_a).toBe('zh');
      expect(message1.lang_b).toBe('en');
      expect(message2.lang_a).toBe('en');
      expect(message2.lang_b).toBe('zh');
    });
  });

  describe('功能标志传递', () => {
    it('双向模式应该正确传递功能标志', () => {
      const features = {
        emotion_detection: true,
        speaker_identification: true,
      };

      const message = manager.connectTwoWay('zh', 'en', features);

      expect(message.features).toEqual(features);
      expect(message.features.emotion_detection).toBe(true);
      expect(message.features.speaker_identification).toBe(true);
    });

    it('双向模式应该支持空功能标志', () => {
      const message = manager.connectTwoWay('zh', 'en');

      expect(message.features).toEqual({});
    });
  });

  describe('消息格式验证', () => {
    it('双向模式消息应该包含所有必需字段', () => {
      const message = manager.connectTwoWay('zh', 'en');

      expect(message).toHaveProperty('type');
      expect(message).toHaveProperty('client_version');
      expect(message).toHaveProperty('platform');
      expect(message).toHaveProperty('src_lang');
      expect(message).toHaveProperty('tgt_lang');
      expect(message).toHaveProperty('mode');
      expect(message).toHaveProperty('lang_a');
      expect(message).toHaveProperty('lang_b');
      expect(message).toHaveProperty('auto_langs');
    });

    it('单向模式消息不应该包含双向模式字段', () => {
      const message = manager.connectOneWay('zh', 'en');

      expect(message).toHaveProperty('mode');
      expect(message.mode).toBe('one_way');
      expect(message.lang_a).toBeUndefined();
      expect(message.lang_b).toBeUndefined();
      expect(message.auto_langs).toBeUndefined();
    });
  });

  describe('模式对比', () => {
    it('双向模式和单向模式应该有不同的配置', () => {
      const oneWayMessage = manager.connectOneWay('zh', 'en');
      manager.clearMessages();
      const twoWayMessage = manager.connectTwoWay('zh', 'en');

      expect(oneWayMessage.mode).toBe('one_way');
      expect(oneWayMessage.src_lang).toBe('zh');
      expect(oneWayMessage.tgt_lang).toBe('en');

      expect(twoWayMessage.mode).toBe('two_way_auto');
      expect(twoWayMessage.src_lang).toBe('auto');
      expect(twoWayMessage.tgt_lang).toBe('en');
      expect(twoWayMessage.lang_a).toBe('zh');
      expect(twoWayMessage.lang_b).toBe('en');
    });
  });

  describe('边界情况', () => {
    it('应该正确处理相同的语言 A 和 B', () => {
      const message = manager.connectTwoWay('zh', 'zh');

      expect(message.lang_a).toBe('zh');
      expect(message.lang_b).toBe('zh');
      expect(message.auto_langs).toEqual(['zh', 'zh']);
    });

    it('应该支持多次连接', () => {
      manager.connectTwoWay('zh', 'en');
      manager.connectTwoWay('ja', 'en');
      manager.connectTwoWay('ko', 'zh');

      const messages = manager.getSentMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0].lang_a).toBe('zh');
      expect(messages[1].lang_a).toBe('ja');
      expect(messages[2].lang_a).toBe('ko');
    });
  });
});

