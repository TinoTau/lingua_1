import { describe, expect, it } from '@jest/globals';
import { DEFAULT_CONFIG } from '../../node-config-defaults';
import { loadFwDetectorRuntimeConfig } from '../fw-config';
import { generateGlobalWindows } from './generate-global-windows';
import { blockedFilter, truncateWindows } from './blocked-window-filter';
import { V4_LIMITS } from './v4-limits';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { buildCharSyllableRanges, textToPinyinStream } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';

function syllableIndexForCharOffset(
  ranges: ReturnType<typeof buildCharSyllableRanges>,
  charOffset: number
): number {
  for (const range of ranges) {
    if (charOffset < range.charStart) {
      return range.syllableStart;
    }
    if (charOffset >= range.charStart && charOffset < range.charEnd) {
      const runLen = range.charEnd - range.charStart;
      const syllableCount = range.syllableEnd - range.syllableStart;
      if (runLen <= 0 || syllableCount <= 0) {
        return range.syllableStart;
      }
      const rel = charOffset - range.charStart;
      const idx = Math.floor((rel / runLen) * syllableCount);
      return Math.min(range.syllableEnd - 1, range.syllableStart + idx);
    }
  }
  const last = ranges[ranges.length - 1];
  return last ? last.syllableEnd : 0;
}

function rawRangeToSyllableBounds(rawText: string, rawStart: number, rawEnd: number) {
  const ranges = buildCharSyllableRanges(rawText);
  const lastChar = Math.max(rawStart, rawEnd - 1);
  return {
    syllableStart: syllableIndexForCharOffset(ranges, rawStart),
    syllableEnd: syllableIndexForCharOffset(ranges, lastChar) + 1,
  };
}

function buildD001CoarseSpans(rawText: string): CoarseSpan[] {
  const specs: Array<{ id: string; rawStart: number; rawEnd: number; text: string }> = [
    { id: 'c0', rawStart: 0, rawEnd: 11, text: '你好,我想點一杯熱拿鐵' },
    { id: 'c1', rawStart: 11, rawEnd: 12, text: '鐘' },
    { id: 'c2', rawStart: 12, rawEnd: 15, text: '貝少糖' },
    { id: 'c3', rawStart: 16, rawEnd: 17, text: '深' },
    { id: 'c4', rawStart: 17, rawEnd: 19, text: '便溫' },
    { id: 'c5', rawStart: 20, rawEnd: 24, text: '以下今天' },
    { id: 'c6', rawStart: 24, rawEnd: 25, text: '有' },
    { id: 'c7', rawStart: 25, rawEnd: 30, text: '蓝美马分吗' },
  ];
  return specs.map((spec) => {
    const { syllableStart, syllableEnd } = rawRangeToSyllableBounds(rawText, spec.rawStart, spec.rawEnd);
    return {
      id: spec.id,
      rawStart: spec.rawStart,
      rawEnd: spec.rawEnd,
      syllableStart,
      syllableEnd,
      text: spec.text,
      source: 'asr_word_boundary' as const,
      boundaryConfidence: 1,
    };
  });
}

describe('generateGlobalWindows', () => {
  const rawText = '你好,我想點一杯熱拿鐵鐘貝少糖 深便溫 以下今天有蓝美马分吗?';
  const { syllables } = textToPinyinStream(rawText);
  const coarseSpans = buildD001CoarseSpans(rawText);

  it('V4_LIMITS frozen values', () => {
    expect(V4_LIMITS.windowMinSyllables).toBe(2);
    expect(V4_LIMITS.windowMaxSyllables).toBe(5);
    expect(V4_LIMITS.maxBoundaryCrossCount).toBe(1);
    expect(V4_LIMITS.boundaryPenalty).toBe(0.85);
    expect(V4_LIMITS.asrWordGapMs).toBe(400);
    expect(V4_LIMITS.anchorStrategy).toBe('right_preferred');
  });

  it('d001 zhong|bei boundary window anchors to c2', () => {
    const generated = generateGlobalWindows({ rawText, globalSyllables: syllables, coarseSpans });
    const filtered = blockedFilter({
      windows: generated,
      rawText,
      coarseSpans,
      wordTimeSpans: [],
    });
    const { windows } = truncateWindows(filtered);

    const zhongBei = windows.find((w) => w.windowPinyinKey === 'zhong|bei');
    expect(zhongBei).toBeDefined();
    expect(zhongBei?.windowSource).toBe('boundary_window');
    expect(zhongBei?.boundaryCrossCount).toBe(1);
    expect(zhongBei?.anchorCoarseSpanId).toBe('c2');
    expect(zhongBei?.spanIds).toEqual(expect.arrayContaining(['c1', 'c2']));
  });

  it('boundaryCrossCount > 1 windows are blocked', () => {
    const generated = generateGlobalWindows({ rawText, globalSyllables: syllables, coarseSpans });
    const tripleCross = generated.filter((w) => w.boundaryCrossCount > 1);
    expect(tripleCross.length).toBeGreaterThan(0);
    for (const w of tripleCross) {
      expect(w.blocked).toBe(true);
      expect(w.windowSource).toBe('blocked');
    }
  });
});

describe('span-assembly-v4 routing defaults', () => {
  it('spanAssemblyV4Enabled defaults to true (V4-only promotion)', () => {
    expect(DEFAULT_CONFIG.features?.fwDetector?.spanAssemblyV4Enabled).toBe(true);
    expect(loadFwDetectorRuntimeConfig().spanAssemblyV4Enabled).toBe(true);
  });
});
