import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { buildPinyinImeV2DictFromEntries } from '../pinyin-ime-v2/pinyin-ime-v2-dict-load';
import { DEFAULT_PINYIN_IME_V2 } from '../pinyin-ime-v2/pinyin-ime-v2-config';
import { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } from '../pinyin-ime-v2/pinyin-ime-v2-dict-load';
import { partitionCoarseSpans, verifyCoarseSpanCoverage } from './coarse-span-partition';

describe('partitionCoarseSpans', () => {
  it('covers all CJK syllables with mutually exclusive spans via boundary import', () => {
    let dict;
    try {
      const dictDir = resolvePinyinImeV2DictDir(
        path.join(process.cwd(), '../../node_runtime/pinyin-ime-v2/dict')
      );
      dict = loadPinyinImeV2Dictionaries(dictDir);
    } catch {
      dict = buildPinyinImeV2DictFromEntries([]);
    }
    const raw = '你好,我想点一杯热拿铁钟贝少糖,今天有蓝美马分吗?';
    const result = partitionCoarseSpans({
      rawText: raw,
      imeConfig: {
        ...DEFAULT_PINYIN_IME_V2,
        enabled: true,
        dictDir: path.join(process.cwd(), '../../node_runtime/pinyin-ime-v2/dict'),
      },
      dict,
    });
    expect(result.coarseSpans.length).toBeGreaterThan(0);
    expect(result.diagnostics.coverageOk).toBe(true);
    expect(verifyCoarseSpanCoverage(raw, result.coarseSpans)).toBe(true);
    for (let i = 0; i < result.coarseSpans.length; i++) {
      for (let j = i + 1; j < result.coarseSpans.length; j++) {
        const a = result.coarseSpans[i];
        const b = result.coarseSpans[j];
        const overlap =
          a.syllableStart < b.syllableEnd && b.syllableStart < a.syllableEnd;
        expect(overlap).toBe(false);
      }
    }
  });

  it('returns empty for non-CJK text', () => {
    const dict = buildPinyinImeV2DictFromEntries([]);
    const result = partitionCoarseSpans({
      rawText: 'hello world',
      imeConfig: DEFAULT_PINYIN_IME_V2,
      dict,
    });
    expect(result.coarseSpans).toEqual([]);
  });
});
