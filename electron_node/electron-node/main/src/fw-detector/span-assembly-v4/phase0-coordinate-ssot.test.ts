import { describe, expect, it } from '@jest/globals';
import {
  buildUtteranceSyllableCoordinate,
  textToPinyinStream,
} from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import { blockedFilter } from './blocked-window-filter';
import { generateLocalOptionsAtCursor, runLtrFineSpanGeneration } from './ltr-fine-span-generator';
import type { CoarseSpan } from '../span-assembly-shared/types';

function span(
  id: string,
  sylStart: number,
  sylEnd: number,
  rawStart: number,
  rawEnd: number,
  text: string
): CoarseSpan {
  return {
    id,
    text,
    rawStart,
    rawEnd,
    syllableStart: sylStart,
    syllableEnd: sylEnd,
    source: 'punctuation_fallback',
    boundaryConfidence: 0.3,
  };
}

describe('Phase 0 FineSpan syllable coordinate SSOT', () => {
  it('excludes Latin letters from FineSpan syllables (去望京SOHO测试)', () => {
    const raw = '去望京SOHO测试';
    const coord = buildUtteranceSyllableCoordinate(raw);
    expect(coord.syllables).toEqual(['qu', 'wang', 'jing', 'ce', 'shi']);
    expect(coord.coverage.coverageOk).toBe(true);
    expect(coord.ranges).toHaveLength(2);
    expect(coord.ranges[0]).toMatchObject({ charStart: 0, charEnd: 3, syllableStart: 0, syllableEnd: 3 });
    expect(coord.ranges[1]).toMatchObject({ charStart: 7, charEnd: 9, syllableStart: 3, syllableEnd: 5 });
    expect(textToPinyinStream(raw).syllables).toEqual(coord.syllables);
  });

  it('maps multi-run syllable window raw range across Latin gap for blockedFilter', () => {
    const raw = '去望京SOHO测试';
    const coord = buildUtteranceSyllableCoordinate(raw);
    // jing(2) + ce(3) spans SOHO gap
    const charRange = syllableRangeToRawCharRange(coord.ranges, 2, 4);
    expect(charRange).toEqual({ start: 2, end: 8 });
    expect(raw.slice(charRange!.start, charRange!.end)).toBe('京SOHO测');
  });

  it('blocks windows that cross Latin gap via non_cjk_syllable', () => {
    const raw = '去望京SOHO测试';
    const coord = buildUtteranceSyllableCoordinate(raw);
    const coarseSpans = [
      span('c0', 0, 3, 0, 3, '去望京'),
      span('c1', 3, 5, 7, 9, '测试'),
    ];
    const options = generateLocalOptionsAtCursor({
      cursor: 2,
      rawText: raw,
      globalSyllables: coord.syllables,
      coarseSpans,
      charSyllableRanges: coord.ranges,
    });
    const cross = options.find((o) => o.syllableStart === 2 && o.syllableEnd === 4);
    expect(cross).toBeDefined();
    expect(cross!.windowText).toContain('SOHO');
    const filtered = blockedFilter({
      windows: [cross!],
      rawText: raw,
      coarseSpans,
      wordTimeSpans: [],
    });
    expect(filtered[0]?.blocked).toBe(true);
    expect(['non_cjk_syllable', 'raw_gap_between_spans']).toContain(
      filtered[0]?.blockedBoundaryReason
    );
  });

  it.each([
    ['去望京SOHO，不走四环可以吗？那边现在堵不堵？', 'd009/d189'],
    ['去望京SOHO，不走机场高速可以吗？那边现在堵不堵？', 'd099'],
    ['去望京SOHO测试', 'latin-mixed-min'],
    ['去A酒店', 'latinA'],
    ['USB接口坏了', 'usb'],
    ['WiFi密码是多少', 'wifi'],
    ['去OK便利店', 'ok'],
    ['机场T2航站楼', 't2'],
  ])('LTR completes without throw: %s', (raw) => {
    const coord = buildUtteranceSyllableCoordinate(raw);
    expect(coord.coverage.coverageOk).toBe(true);
    expect(coord.syllables.every((s) => /^[a-z0-9]+$/i.test(s))).toBe(true);
    // no single-letter latin tokens from SOHO
    expect(coord.syllables.includes('s') && coord.syllables.includes('o')).toBe(false);

    const spans: CoarseSpan[] = coord.ranges.map((r, i) =>
      span(
        `c${i}`,
        r.syllableStart,
        r.syllableEnd,
        r.charStart,
        r.charEnd,
        raw.slice(r.charStart, r.charEnd)
      )
    );

    const result = runLtrFineSpanGeneration({
      rawText: raw,
      globalSyllables: coord.syllables,
      coarseSpans: spans,
      domainPriors: [],
      charSyllableRanges: coord.ranges,
      recallForWindows: () => [],
    });
    expect(result.formalSpans.length).toBeGreaterThan(0);
    expect(result.formalSpans[result.formalSpans.length - 1]!.syllableEnd).toBe(coord.syllables.length);
    for (let i = 1; i < result.formalSpans.length; i += 1) {
      expect(result.formalSpans[i]!.syllableStart).toBe(result.formalSpans[i - 1]!.syllableEnd);
    }
  });
});
