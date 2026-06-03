import { describe, expect, it } from '@jest/globals';
import {
  mapNormalizedSpanToRaw,
  normalizeForImeAlignment,
  normalizeTraditionalChinese,
  resetOpenccConverterForTest,
} from './normalize-for-ime-alignment';

describe('normalizeTraditionalChinese', () => {
  it('converts traditional to simplified (t→cn)', () => {
    expect(normalizeTraditionalChinese('單字測試')).toBe('单字测试');
    expect(normalizeTraditionalChinese('後臺服務')).toBe('后台服务');
    expect(normalizeTraditionalChinese('發現問題')).toBe('发现问题');
    expect(normalizeTraditionalChinese('系統設定')).toBe('系统设定');
  });

  it('maps single traditional characters', () => {
    expect(normalizeTraditionalChinese('單')).toBe('单');
    expect(normalizeTraditionalChinese('發')).toBe('发');
    expect(normalizeTraditionalChinese('後')).toBe('后');
    expect(normalizeTraditionalChinese('臺')).toBe('台');
  });

  it('does not convert simplified to traditional', () => {
    expect(normalizeTraditionalChinese('后台服务')).toBe('后台服务');
  });
});

describe('normalizeForImeAlignment', () => {
  it('builds charMap from normalized index to raw index', () => {
    const { normalized, charMap } = normalizeForImeAlignment('你，好');
    expect(normalized).toBe('你好');
    expect(charMap).toEqual([0, 2]);
  });

  it('converts traditional phrase and preserves charMap to raw indices', () => {
    const raw = '單字測試';
    const { normalized, charMap, traditionalCharCount, openccConvertedCount } =
      normalizeForImeAlignment(raw);
    expect(normalized).toBe('单字测试');
    expect(charMap).toEqual([0, 1, 2, 3]);
    // 字 is identical in trad/simp; only 單/測/試 convert
    expect(traditionalCharCount).toBe(3);
    expect(openccConvertedCount).toBe(3);
    expect(raw.slice(charMap[0], charMap[3] + 1)).toBe('單字測試');
  });

  it('maps 後臺服務 with per-char raw index', () => {
    const raw = '後臺服務';
    const { normalized, charMap } = normalizeForImeAlignment(raw);
    expect(normalized).toBe('后台服务');
    expect(charMap).toEqual([0, 1, 2, 3]);
  });

  it('mapNormalizedSpanToRaw returns raw slice bounds across punctuation', () => {
    const { normalized, charMap } = normalizeForImeAlignment('A你，好B');
    expect(normalized).toBe('A你好B');
    const raw = mapNormalizedSpanToRaw(charMap, 1, 3);
    expect(raw).toEqual({ start: 1, end: 4 });
  });

  it('mixed latin and traditional keeps raw indices for CJK', () => {
    const raw = '系統設定OK';
    const { normalized, charMap } = normalizeForImeAlignment(raw);
    expect(normalized).toBe('系统设定OK');
    expect(charMap.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(charMap[4]).toBe(4);
    expect(charMap[5]).toBe(5);
  });
});

describe('normalizeForImeAlignment opencc reset', () => {
  it('allows converter reset in tests', () => {
    resetOpenccConverterForTest();
    expect(normalizeTraditionalChinese('後')).toBe('后');
  });
});
