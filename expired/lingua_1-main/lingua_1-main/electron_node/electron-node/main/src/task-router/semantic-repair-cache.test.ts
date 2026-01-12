/**
 * P2-1 测试：SemanticRepairCache
 * 验证语义修复结果缓存功能
 */

import { SemanticRepairCache } from './semantic-repair-cache';
import { SemanticRepairResult } from './types';

describe('SemanticRepairCache - P2-1', () => {
  let cache: SemanticRepairCache;

  beforeEach(() => {
    cache = new SemanticRepairCache({
      maxSize: 10,
      ttlMs: 1000,  // 1秒，便于测试
      modelVersion: 'test-v1',
    });
  });

  describe('缓存基本功能', () => {
    it('应该能够设置和获取缓存', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后的文本',
        confidence: 0.9,
        reason_codes: ['LOW_QUALITY'],
      };

      cache.set('zh', '测试文本', result);
      const cached = cache.get('zh', '测试文本');

      expect(cached).toBeDefined();
      expect(cached?.decision).toBe('REPAIR');
      expect(cached?.text_out).toBe('修复后的文本');
      expect(cached?.confidence).toBe(0.9);
    });

    it('应该只缓存REPAIR决策的结果', () => {
      const passResult: SemanticRepairResult = {
        decision: 'PASS',
        text_out: '原文',
        confidence: 1.0,
        reason_codes: [],
      };

      cache.set('zh', '测试文本', passResult);
      const cached = cache.get('zh', '测试文本');

      expect(cached).toBeUndefined();
    });

    it('应该支持不同语言的独立缓存', () => {
      const zhResult: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '中文修复',
        confidence: 0.9,
        reason_codes: [],
      };

      const enResult: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: 'English repair',
        confidence: 0.85,
        reason_codes: [],
      };

      const zhText = '测试文本';
      const enText = 'test text';

      cache.set('zh', zhText, zhResult);
      cache.set('en', enText, enResult);

      expect(cache.get('zh', zhText)?.text_out).toBe('中文修复');
      expect(cache.get('en', enText)?.text_out).toBe('English repair');
    });
  });

  describe('缓存键生成', () => {
    it('应该规范化文本（去除首尾空格）', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '  测试文本  ', result);
      const cached1 = cache.get('zh', '测试文本');
      const cached2 = cache.get('zh', '  测试文本  ');

      expect(cached1).toBeDefined();
      expect(cached2).toBeDefined();
    });

    it('应该规范化空白字符（多个空格合并）', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '测试  文本', result);
      const cached = cache.get('zh', '测试 文本');

      expect(cached).toBeDefined();
    });

    it('应该包含模型版本在缓存键中', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '测试文本', result);
      
      // 更新模型版本应该清除缓存
      cache.updateModelVersion('test-v2');
      const cached = cache.get('zh', '测试文本');

      expect(cached).toBeUndefined();
    });
  });

  describe('缓存限制', () => {
    it('应该拒绝太短的文本（< 3字符）', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', 'ab', result);  // 2字符
      const cached = cache.get('zh', 'ab');

      expect(cached).toBeUndefined();
    });

    it('应该拒绝太长的文本（> 500字符）', () => {
      const longText = 'a'.repeat(501);
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', longText, result);
      const cached = cache.get('zh', longText);

      expect(cached).toBeUndefined();
    });

    it('应该支持3-500字符的文本', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      // 3字符
      cache.set('zh', 'abc', result);
      expect(cache.get('zh', 'abc')).toBeDefined();

      // 500字符
      const text500 = 'a'.repeat(500);
      cache.set('zh', text500, result);
      expect(cache.get('zh', text500)).toBeDefined();
    });
  });

  describe('TTL机制', () => {
    it('应该在TTL过期后清除缓存', async () => {
      const cache = new SemanticRepairCache({
        maxSize: 10,
        ttlMs: 100,  // 100ms
        modelVersion: 'test-v1',
      });

      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '测试文本', result);
      expect(cache.get('zh', '测试文本')).toBeDefined();

      // 等待TTL过期
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(cache.get('zh', '测试文本')).toBeUndefined();
    });
  });

  describe('LRU机制', () => {
    it('应该在超过maxSize时移除最旧的条目', () => {
      const cache = new SemanticRepairCache({
        maxSize: 3,
        ttlMs: 1000,
        modelVersion: 'test-v1',
      });

      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      // 设置4个条目（超过maxSize=3）
      cache.set('zh', '文本1', result);
      cache.set('zh', '文本2', result);
      cache.set('zh', '文本3', result);
      cache.set('zh', '文本4', result);

      // 第一个应该被移除
      expect(cache.get('zh', '文本1')).toBeUndefined();
      // 其他应该还在
      expect(cache.get('zh', '文本2')).toBeDefined();
      expect(cache.get('zh', '文本3')).toBeDefined();
      expect(cache.get('zh', '文本4')).toBeDefined();
    });

    it('应该在访问时更新LRU顺序', () => {
      const cache = new SemanticRepairCache({
        maxSize: 3,
        ttlMs: 1000,
        modelVersion: 'test-v1',
      });

      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '文本1', result);
      cache.set('zh', '文本2', result);
      cache.set('zh', '文本3', result);

      // 访问文本1，使其成为最新的
      cache.get('zh', '文本1');

      // 添加新条目，文本2应该被移除（文本1被访问过，文本3是最新的）
      cache.set('zh', '文本4', result);

      expect(cache.get('zh', '文本1')).toBeDefined();
      expect(cache.get('zh', '文本2')).toBeUndefined();
      expect(cache.get('zh', '文本3')).toBeDefined();
      expect(cache.get('zh', '文本4')).toBeDefined();
    });
  });

  describe('缓存管理', () => {
    it('应该能够清除所有缓存', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '文本1', result);
      cache.set('zh', '文本2', result);

      expect(cache.get('zh', '文本1')).toBeDefined();
      expect(cache.get('zh', '文本2')).toBeDefined();

      cache.clear();

      expect(cache.get('zh', '文本1')).toBeUndefined();
      expect(cache.get('zh', '文本2')).toBeUndefined();
    });

    it('应该能够获取缓存统计信息', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '文本1', result);
      cache.set('zh', '文本2', result);

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10);
      expect(stats.modelVersion).toBe('test-v1');
    });

    it('应该在更新模型版本时清除缓存', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '测试文本', result);
      expect(cache.get('zh', '测试文本')).toBeDefined();

      cache.updateModelVersion('test-v2');

      expect(cache.get('zh', '测试文本')).toBeUndefined();
      const stats = cache.getStats();
      expect(stats.modelVersion).toBe('test-v2');
      expect(stats.size).toBe(0);
    });

    it('应该在模型版本相同时不清除缓存', () => {
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', '测试文本', result);
      expect(cache.get('zh', '测试文本')).toBeDefined();

      cache.updateModelVersion('test-v1');  // 相同版本

      expect(cache.get('zh', '测试文本')).toBeDefined();
    });
  });

  describe('长文本处理', () => {
    it('应该对长文本使用哈希优化', () => {
      const longText = '这是一个很长的文本'.repeat(20);  // 超过100字符
      const result: SemanticRepairResult = {
        decision: 'REPAIR',
        text_out: '修复后',
        confidence: 0.9,
        reason_codes: [],
      };

      cache.set('zh', longText, result);
      const cached = cache.get('zh', longText);

      expect(cached).toBeDefined();
    });
  });
});
