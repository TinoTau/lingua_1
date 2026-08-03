import { describe, expect, it } from '@jest/globals';
import {
  buildUtteranceSyllableCoordinate,
  textToPinyinStream,
} from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import { syllableRangeToRawCharRange } from '../pinyin-ime-v2/pinyin-ime-v2-boundary-compatible-topk-diff';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { buildLexicalWindowQueries } from './build-lexical-window-queries';
import { latticeHardBlockFilter } from './lattice-hard-block-filter';
import { runLatticeFineSpanGenerationFromLexicalEdges } from './lattice-fine-span-runtime';
import { assertPathFineSpansNonOverlapping } from './path-fine-span-types';

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

  it('blocks Lattice windows that cross Latin gap via non_cjk_syllable', () => {
    const raw = '去望京SOHO测试';
    const coord = buildUtteranceSyllableCoordinate(raw);
    const coarseSpans = [
      span('c0', 0, 3, 0, 3, '去望京'),
      span('c1', 3, 5, 7, 9, '测试'),
    ];
    const windows = buildLexicalWindowQueries({
      rawText: raw,
      globalSyllables: coord.syllables,
      coarseSpans,
      charSyllableRanges: coord.ranges,
    });
    const cross = windows.find((o) => o.syllableStart === 2 && o.syllableEnd === 4);
    expect(cross).toBeDefined();
    expect(cross!.windowText).toContain('SOHO');
    const filtered = latticeHardBlockFilter({
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
  ])('Lattice Path materialization covers utterance: %s', (raw) => {
    const coord = buildUtteranceSyllableCoordinate(raw);
    expect(coord.coverage.coverageOk).toBe(true);
    expect(coord.syllables.every((s) => /^[a-z0-9]+$/i.test(s))).toBe(true);
    // no single-letter latin tokens from SOHO
    expect(coord.syllables.includes('s') && coord.syllables.includes('o')).toBe(false);

    const n = coord.syllables.length;
    const result = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText: raw,
      coordinate: coord,
      syllableCount: n,
      lexicalEdges: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trace.fallbackEdgeCount).toBeGreaterThan(0);
    expect(result.pathFineSpanViews.length).toBeGreaterThan(0);
    for (const view of result.pathFineSpanViews) {
      assertPathFineSpansNonOverlapping(view.pathFineSpans);
      expect(view.pathFineSpans.length).toBeGreaterThan(0);
      expect(view.pathFineSpans[0]!.syllableStart).toBe(0);
      expect(view.pathFineSpans[view.pathFineSpans.length - 1]!.syllableEnd).toBe(n);
      for (let i = 1; i < view.pathFineSpans.length; i += 1) {
        expect(view.pathFineSpans[i]!.syllableStart).toBe(view.pathFineSpans[i - 1]!.syllableEnd);
      }
      for (const s of view.pathFineSpans) {
        expect(s.rawEnd).toBeGreaterThan(s.rawStart);
        expect(s.syllableEnd).toBeGreaterThan(s.syllableStart);
      }
    }
  });
});
