import {
  findFuzzyConfusionObservedSpans,
  isPinyinAlignedObservedMatch,
} from './confusion-observed-spans';

describe('isPinyinAlignedObservedMatch', () => {
  it('同音不同字可匹配', () => {
    expect(isPinyinAlignedObservedMatch('后选生城', '候选生成')).toBe(true);
  });

  it('无关文本不匹配', () => {
    expect(isPinyinAlignedObservedMatch('今天天气', '候选生成')).toBe(false);
  });
});

describe('findFuzzyConfusionObservedSpans', () => {
  it('拼音对齐可生成窗', () => {
    const spans = findFuzzyConfusionObservedSpans('我们要做后选生城', ['候选生成']);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.some((s) => s.text.includes('后选') || s.text.includes('生城'))).toBe(true);
  });
});
