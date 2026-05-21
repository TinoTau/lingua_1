import { normalizeTextForLm, tokenizeForLm } from './char-tokenize';

describe('char-tokenize (KenLM train/infer parity)', () => {
  it('NFKC 全角数字与半角一致分词', () => {
    expect(tokenizeForLm('ＡＩ芯片')).toBe(tokenizeForLm('AI芯片'));
  });

  it('中文逐字、英文整段 token', () => {
    expect(tokenizeForLm('使用 RTX4060 显卡')).toBe('使 用 RTX4060 显 卡');
    expect(tokenizeForLm('AI GPU 测试')).toBe('AI GPU 测 试');
  });

  it('保留数字段', () => {
    expect(tokenizeForLm('2024年快递')).toContain('2024');
  });

  it('空行归一为空', () => {
    expect(normalizeTextForLm('   ')).toBe('');
    expect(tokenizeForLm('')).toBe('');
  });
});
