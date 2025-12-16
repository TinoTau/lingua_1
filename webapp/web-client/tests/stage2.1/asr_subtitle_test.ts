/**
 * ASR 字幕模块测试
 * 测试字幕更新和显示功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AsrSubtitle } from '../../src/asr_subtitle';

describe('AsrSubtitle', () => {
  let container: HTMLElement;
  let subtitle: AsrSubtitle;

  beforeEach(() => {
    // 创建测试容器
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);

    subtitle = new AsrSubtitle('test-container');
  });

  afterEach(() => {
    // 清理
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  describe('初始化', () => {
    it('应该创建字幕元素', () => {
      const subtitleElement = document.getElementById('asr-subtitle');
      expect(subtitleElement).not.toBeNull();
      expect(subtitleElement?.textContent).toBe('等待语音输入...');
    });

    it('应该在容器不存在时处理错误', () => {
      // 不应该抛出错误
      expect(() => {
        new AsrSubtitle('non-existent-container');
      }).not.toThrow();
    });
  });

  describe('字幕更新', () => {
    it('应该更新 partial 字幕', () => {
      subtitle.updatePartial('我想问一下');
      const subtitleElement = document.getElementById('asr-subtitle');
      expect(subtitleElement?.textContent).toBe('我想问一下');
    });

    it('应该更新 final 字幕', () => {
      subtitle.updatePartial('我想问一下');
      subtitle.updateFinal('我想问一下明天的天气');
      
      const subtitleElement = document.getElementById('asr-subtitle');
      expect(subtitleElement?.textContent).toBe('我想问一下明天的天气');
      expect(subtitle.getCurrentText()).toBe('我想问一下明天的天气');
    });

    it('应该支持空文本', () => {
      subtitle.updatePartial('');
      const subtitleElement = document.getElementById('asr-subtitle');
      expect(subtitleElement?.textContent).toBe('等待语音输入...');
    });
  });

  describe('清空字幕', () => {
    it('应该清空字幕内容', () => {
      subtitle.updatePartial('测试文本');
      subtitle.clear();
      
      const subtitleElement = document.getElementById('asr-subtitle');
      expect(subtitleElement?.textContent).toBe('等待语音输入...');
      expect(subtitle.getCurrentText()).toBe('');
    });
  });

  describe('获取当前文本', () => {
    it('应该返回当前字幕文本', () => {
      subtitle.updatePartial('测试文本');
      expect(subtitle.getCurrentText()).toBe('测试文本');
    });

    it('应该在清空后返回空字符串', () => {
      subtitle.updatePartial('测试文本');
      subtitle.clear();
      expect(subtitle.getCurrentText()).toBe('');
    });
  });
});

