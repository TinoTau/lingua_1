/**
 * Phase 3 测试：SemanticRepairValidator
 * 验证语义修复输出校验功能
 */

import { SemanticRepairValidator } from './semantic-repair-validator';

describe('SemanticRepairValidator - Phase 3', () => {
  let validator: SemanticRepairValidator;

  beforeEach(() => {
    validator = new SemanticRepairValidator({
      maxLengthChangeRatio: 0.2,
      strictNumberPreservation: true,
      strictUrlPreservation: true,
      strictEmailPreservation: true,
    });
  });

  describe('validate', () => {
    it('应该在长度变化超过±20%时返回无效', () => {
      const original = '这是一个测试文本';
      const repaired = '这是一个被大幅修改的测试文本，长度变化超过了20%的限制';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(false);
      expect(result.reasonCodes).toContain('LENGTH_CHANGE_EXCEEDED');
      expect(result.details?.lengthChangeRatio).toBeGreaterThan(0.2);
    });

    it('应该在长度变化在±20%内时返回有效', () => {
      const original = '这是一个测试文本';  // 10个字符
      // 修复后文本长度应该在8-12之间（±20%）
      // 使用完全相同的文本，确保长度变化为0
      const repaired = '这是一个测试文本';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(true);
      expect(result.reasonCodes.length).toBe(0);
    });

    it('应该在数字丢失时返回无效', () => {
      const original = '价格是100元';
      const repaired = '价格是元';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(false);
      expect(result.reasonCodes).toContain('NUMBERS_MISSING');
      expect(result.details?.missingNumbers).toBe(true);
    });

    it('应该在数字保留时返回有效', () => {
      const original = '价格是100元';
      const repaired = '价格是100元';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(true);
    });

    it('应该在URL丢失时返回无效', () => {
      const original = '访问 https://example.com 获取更多信息';
      const repaired = '访问 获取更多信息';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(false);
      expect(result.reasonCodes).toContain('URLS_MISSING');
      expect(result.details?.missingUrls).toBe(true);
    });

    it('应该在URL保留时返回有效', () => {
      const original = '访问 https://example.com 获取更多信息';
      const repaired = '访问 https://example.com 以获取更多信息';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(true);
    });

    it('应该在邮箱丢失时返回无效', () => {
      const original = '联系 user@example.com 获取支持';
      const repaired = '联系 获取支持';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(false);
      expect(result.reasonCodes).toContain('EMAILS_MISSING');
      expect(result.details?.missingEmails).toBe(true);
    });

    it('应该在邮箱保留时返回有效', () => {
      const original = '联系 user@example.com 获取支持';
      const repaired = '请联系 user@example.com 以获取支持';

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(true);
    });

    it('应该能够检测多个问题', () => {
      const original = '价格是100元，访问 https://example.com';
      const repaired = '价格是元，访问';  // 数字和URL都丢失，且长度变化大

      const result = validator.validate(original, repaired);

      expect(result.isValid).toBe(false);
      expect(result.reasonCodes.length).toBeGreaterThan(1);
    });

    it('应该在严格保护关闭时允许数字丢失', () => {
      const lenientValidator = new SemanticRepairValidator({
        strictNumberPreservation: false,
      });

      const original = '价格是100元';
      const repaired = '价格是元';

      const result = lenientValidator.validate(original, repaired);

      // 数字丢失不应该导致验证失败
      expect(result.reasonCodes).not.toContain('NUMBERS_MISSING');
    });
  });

  describe('extractNumbers', () => {
    it('应该能够提取各种格式的数字', () => {
      const text = '价格是100元，折扣50%，数量1000个';
      const numbers = (validator as any).extractNumbers(text);

      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers).toContain('100');
      expect(numbers).toContain('50%');
    });
  });

  describe('extractUrls', () => {
    it('应该能够提取URL', () => {
      const text = '访问 https://example.com 或 www.test.com';
      const urls = (validator as any).extractUrls(text);

      expect(urls.length).toBeGreaterThan(0);
      expect(urls.some((url: string) => url.includes('example.com'))).toBe(true);
    });
  });

  describe('extractEmails', () => {
    it('应该能够提取邮箱', () => {
      const text = '联系 user@example.com 或 support@test.org';
      const emails = (validator as any).extractEmails(text);

      expect(emails.length).toBeGreaterThan(0);
      expect(emails).toContain('user@example.com');
    });
  });
});
