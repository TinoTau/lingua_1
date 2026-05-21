import { describe, expect, it } from '@jest/globals';
import type { LexiconRecallEvidence } from '../lexicon-types';
import { resolveSpanTextAndRange } from './resolve-span';
import { buildWindowPhoneticPreview } from './windowPhoneticPreview';

describe('resolveSpanTextAndRange', () => {
  it('uses ASR window span for pinyin recall', () => {
    const top1Text = '我们要做后选声城';
    const resolved = resolveSpanTextAndRange(top1Text, {
      term: '后选生城',
      replacement: '候选生成',
      source: 'confusion',
      priority: 10,
      raw: {},
      recallPath: 'pinyin',
      pinyinKey: 'hou|xuan|sheng|cheng',
      windowId: 'aw-1',
      windowText: '后选声城',
      windowStart: 4,
      windowEnd: 8,
      windowPinyin: ['hou', 'xuan', 'sheng', 'cheng'],
    });
    expect(resolved.spanText).toBe('后选声城');
    expect(resolved.spanStart).toBe(4);
    expect(resolved.spanEnd).toBe(8);
  });
});

describe('buildWindowPhoneticPreview', () => {
  const top1Text = '我们要做后选声城';

  const evidence: LexiconRecallEvidence = {
    term: '后选生城',
    replacement: '候选生成',
    source: 'confusion',
    priority: 10,
    raw: { pinyin: 'hou xuan sheng cheng' },
    recallPath: 'pinyin',
    pinyinKey: 'hou|xuan|sheng|cheng',
    windowId: 'aw-4-8-x',
    windowText: '后选声城',
    windowStart: 4,
    windowEnd: 8,
    windowPinyin: ['hou', 'xuan', 'sheng', 'cheng'],
  };

  it('produces bounded preview from evidence (from=ASR window)', () => {
    const { items, truncated } = buildWindowPhoneticPreview({
      top1Text,
      candidates: [evidence],
      options: { minScore: 0, maxItems: 32, includePinyin: true },
    });
    expect(truncated).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0].spanText).toBe('后选声城');
    expect(items[0].spanText).not.toBe('后选生城');
    expect(items[0].candidateText).toBe('候选生成');
    expect(items[0].phoneticScore).toBeGreaterThanOrEqual(0.8);
  });

  it('returns empty when candidates empty', () => {
    const { items } = buildWindowPhoneticPreview({
      top1Text,
      candidates: [],
    });
    expect(items).toHaveLength(0);
  });
});
