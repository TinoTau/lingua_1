/**
 * 翻译显示模块单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranslationDisplayManager } from '../../src/app/translation_display';

describe('TranslationDisplayManager', () => {
  let manager: TranslationDisplayManager;
  let mockContainer: HTMLElement;
  let mockAsrContainer: HTMLElement;

  beforeEach(() => {
    manager = new TranslationDisplayManager();
    
    // 创建模拟DOM元素
    mockAsrContainer = document.createElement('div');
    mockAsrContainer.id = 'asr-subtitle-container';
    document.body.appendChild(mockAsrContainer);

    mockContainer = document.createElement('div');
    mockContainer.id = 'app';
    document.body.appendChild(mockContainer);
  });

  it('应该能够保存和获取翻译结果', () => {
    const result = {
      originalText: '你好',
      translatedText: 'Hello'
    };

    manager.saveTranslationResult(0, result);
    const retrieved = manager.getTranslationResult(0);

    expect(retrieved).toEqual(result);
  });

  it('应该能够检查是否已显示', () => {
    manager.markAsDisplayed(0);
    expect(manager.isDisplayed(0)).toBe(true);
    expect(manager.isDisplayed(1)).toBe(false);
  });

  it('应该能够清空所有翻译结果', () => {
    manager.saveTranslationResult(0, { originalText: 'test', translatedText: 'test' });
    manager.markAsDisplayed(0);
    
    manager.clear();
    
    expect(manager.getTranslationResult(0)).toBeUndefined();
    expect(manager.isDisplayed(0)).toBe(false);
  });

  it('应该能够显示翻译结果', () => {
    const result = manager.displayTranslationResult('你好', 'Hello');
    expect(result).toBe(true);

    const originalDiv = document.getElementById('translation-original');
    const translatedDiv = document.getElementById('translation-translated');

    expect(originalDiv?.textContent).toBe('你好');
    expect(translatedDiv?.textContent).toBe('Hello');
  });

  it('应该跳过空文本', () => {
    const result = manager.displayTranslationResult('', '');
    expect(result).toBe(false);
  });

  it('应该避免重复显示相同的文本', () => {
    // 第一次显示
    manager.displayTranslationResult('你好', 'Hello');
    
    // 第二次显示相同内容
    const result = manager.displayTranslationResult('你好', 'Hello');
    
    // 应该返回false，表示未成功显示（因为已存在）
    expect(result).toBe(false);
  });
});

