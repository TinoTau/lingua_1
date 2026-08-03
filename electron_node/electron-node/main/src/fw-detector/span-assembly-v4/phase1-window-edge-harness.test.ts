/**
 * Lattice Phase 1 — WindowQuery + LexicalEdge unit / contract / isolation tests.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { CoarseSpan } from '../span-assembly-shared/types';
import { blockedFilter } from './blocked-window-filter';
import { buildLexicalEdges } from './build-lexical-edges';
import { buildLexicalWindowQueries } from './build-lexical-window-queries';
import { latticeHardBlockFilter } from './lattice-hard-block-filter';
import {
  buildSpanV3CanonicalQuery,
  serializeCanonicalRecallQueryKey,
} from './utterance-recall-cache';
import type { WindowCandidate } from './v4-types';
import {
  theoreticalLexicalWindowCount,
} from './window-construction-core';

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

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function fakeCandidate(partial: Partial<WindowCandidate> & Pick<WindowCandidate, 'candidateId'>): WindowCandidate {
  return {
    windowId: '0:1',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 1,
    rawStart: 0,
    rawEnd: 1,
    windowPinyinKey: 'ce',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    replacement: '测',
    source: 'domain_term',
    recallSource: 'canonical_exact',
    repairTarget: true,
    ...partial,
  };
}

describe('Phase 1 buildLexicalWindowQueries', () => {
  it.each([
    [1, 1],
    [2, 3],
    [5, 15],
    [6, 20],
  ])('N=%i yields theoretical window count %i', (n, expected) => {
    expect(theoreticalLexicalWindowCount(n)).toBe(expected);
    const syllables = Array.from({ length: n }, (_, i) => `s${i}`);
    const rawText = '测'.repeat(n);
    const coord = buildUtteranceSyllableCoordinate(rawText);
    // Prefer synthetic syllables when coordinate may differ for repeated chars.
    const globalSyllables = coord.syllables.length === n ? coord.syllables : syllables;
    const coarse = [span('c0', 0, globalSyllables.length, 0, rawText.length, rawText)];
    const windows = buildLexicalWindowQueries({
      rawText,
      globalSyllables,
      coarseSpans: coarse,
      charSyllableRanges: coord.ranges.length
        ? coord.ranges
        : [{ charStart: 0, charEnd: rawText.length, syllableStart: 0, syllableEnd: n }],
    });
    expect(windows.length).toBe(theoreticalLexicalWindowCount(globalSyllables.length));
    expect(windows.every((w) => w.syllableEnd - w.syllableStart >= 1)).toBe(true);
    expect(windows.every((w) => w.syllableEnd - w.syllableStart <= 5)).toBe(true);
    const ids = windows.map((w) => w.windowId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const w of windows) {
      expect(w.windowId).toBe(`${w.syllableStart}:${w.syllableEnd}`);
    }
  });

  it('is deterministic across runs and independent of call order of unrelated work', () => {
    const rawText = '去望京测试一下';
    const coord = buildUtteranceSyllableCoordinate(rawText);
    const coarse = [
      span('a', 0, 3, 0, 3, '去望京'),
      span('b', 3, coord.syllables.length, 3, rawText.length, rawText.slice(3)),
    ];
    const a = buildLexicalWindowQueries({
      rawText,
      globalSyllables: coord.syllables,
      coarseSpans: coarse,
      charSyllableRanges: coord.ranges,
    });
    const shuffledCoarse = [coarse[1], coarse[0]];
    const b = buildLexicalWindowQueries({
      rawText,
      globalSyllables: coord.syllables,
      coarseSpans: shuffledCoarse,
      charSyllableRanges: coord.ranges,
    });
    expect(fingerprint(a.map((w) => w.windowId))).toBe(fingerprint(b.map((w) => w.windowId)));
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('allows empty coarseBoundaryRefs without deleting the window', () => {
    const rawText = '测试';
    const coord = buildUtteranceSyllableCoordinate(rawText);
    const windows = buildLexicalWindowQueries({
      rawText,
      globalSyllables: coord.syllables,
      coarseSpans: [],
      charSyllableRanges: coord.ranges,
    });
    expect(windows.length).toBe(theoreticalLexicalWindowCount(coord.syllables.length));
    expect(windows.every((w) => w.spanIds.length === 0)).toBe(true);
    expect(windows.every((w) => w.blocked === false)).toBe(true);
  });

  it('keeps cross-coarse windows and does not hard-block solely for coarse cross', () => {
    const rawText = '去望京测试';
    const coord = buildUtteranceSyllableCoordinate(rawText);
    const coarse = [
      span('a', 0, 3, 0, 3, '去望京'),
      span('b', 3, 5, 3, 5, '测试'),
    ];
    const windows = buildLexicalWindowQueries({
      rawText,
      globalSyllables: coord.syllables,
      coarseSpans: coarse,
      charSyllableRanges: coord.ranges,
    });
    const cross = windows.find((w) => w.syllableStart === 2 && w.syllableEnd === 4);
    expect(cross).toBeDefined();
    expect(cross!.boundaryCrossCount).toBeGreaterThanOrEqual(1);
    expect(cross!.blocked).toBe(false);
    expect(cross!.blockedBoundaryReason).toBeUndefined();

    const filtered = latticeHardBlockFilter({
      windows: [cross!],
      rawText,
      coarseSpans: coarse,
      wordTimeSpans: [],
    });
    expect(filtered[0]!.blocked).toBe(false);
    expect(filtered[0]!.blockedBoundaryReason).not.toBe('boundary_cross_count');
  });
});

describe('Phase 1 Latin/CJK gap hard blocks', () => {
  it.each(['去望京SOHO测试', 'USB接口', '机场T2航站楼'])(
    'does not allow recallable windows that embed Latin/digits for %s',
    (rawText) => {
      const coord = buildUtteranceSyllableCoordinate(rawText);
      const coarse = [span('all', 0, coord.syllables.length, 0, rawText.length, rawText)];
      const windows = buildLexicalWindowQueries({
        rawText,
        globalSyllables: coord.syllables,
        coarseSpans: coarse,
        charSyllableRanges: coord.ranges,
      });
      const filtered = latticeHardBlockFilter({
        windows,
        rawText,
        coarseSpans: coarse,
        wordTimeSpans: [],
      });
      const latinEmbedded = filtered.filter((w) => /[A-Za-z0-9]/.test(w.windowText));
      if (latinEmbedded.length > 0) {
        expect(latinEmbedded.every((w) => w.blocked)).toBe(true);
        expect(
          latinEmbedded.every(
            (w) =>
              w.blockedBoundaryReason === 'non_cjk_syllable' ||
              w.blockedBoundaryReason === 'raw_gap_between_spans'
          )
        ).toBe(true);
      } else {
        // Prefix/suffix Latin never enters syllable windows (Phase 0 Coordinate SSOT).
        expect(coord.syllables.length).toBeGreaterThan(0);
        expect(filtered.some((w) => !w.blocked)).toBe(true);
      }
    }
  );

  it('legacy blockedFilter still hard-blocks boundary_cross_count (unchanged contract)', () => {
    const rawText = '一二三四五六';
    const coord = buildUtteranceSyllableCoordinate(rawText);
    const coarse = [
      span('a', 0, 2, 0, 2, '一二'),
      span('b', 2, 4, 2, 4, '三四'),
      span('c', 4, 6, 4, 6, '五六'),
    ];
    const windows = buildLexicalWindowQueries({
      rawText,
      globalSyllables: coord.syllables,
      coarseSpans: coarse,
      charSyllableRanges: coord.ranges,
    });
    const multiCross = windows.find((o) => o.boundaryCrossCount > 1);
    expect(multiCross).toBeDefined();
    const filtered = blockedFilter({
      windows: [multiCross!],
      rawText,
      coarseSpans: coarse,
      wordTimeSpans: [],
    });
    expect(filtered[0]!.blocked).toBe(true);
    expect(filtered[0]!.blockedBoundaryReason).toBe('boundary_cross_count');
  });
});

describe('Phase 1 buildLexicalEdges', () => {
  it('creates one edge per boundary and preserves candidate order', () => {
    const c1 = fakeCandidate({
      candidateId: '0:2:1',
      windowId: '0:2',
      syllableStart: 0,
      syllableEnd: 2,
      termId: 't-a',
      replacement: '望京',
      domains: ['tourism_pickup', 'hotel'],
    });
    const c2 = fakeCandidate({
      candidateId: '0:2:2',
      windowId: '0:2',
      syllableStart: 0,
      syllableEnd: 2,
      termId: 't-b',
      replacement: '望京',
      candidateRank: 2,
      domains: ['tourism_pickup'],
    });
    const edges = buildLexicalEdges({
      recalledWindows: [
        {
          windowId: '0:2',
          syllableStart: 0,
          syllableEnd: 2,
          candidates: [c1, c2],
        },
      ],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.edgeId).toBe('0:2');
    expect(edges[0]!.edgeKind).toBe('lexical');
    expect(edges[0]!.candidates.map((c) => c.termId)).toEqual(['t-a', 't-b']);
    expect(edges[0]!.candidates[0]!.domains).toEqual(['tourism_pickup', 'hotel']);
    expect(edges[0]!.candidates[0]!.domains!.length).toBeGreaterThanOrEqual(2);
  });

  it('Edge-Level evidence OR keeps first-wins subject for same termId multi-source', () => {
    const a = fakeCandidate({
      candidateId: '0:2:1',
      windowId: '0:2',
      syllableStart: 0,
      syllableEnd: 2,
      termId: 'T1',
      hitKind: 'exact_term',
      toneLookupStage: 'tone_exact',
    });
    const b = fakeCandidate({
      candidateId: '0:2:2',
      windowId: '0:2',
      syllableStart: 0,
      syllableEnd: 2,
      termId: 'T1',
      hitKind: 'exact_term',
      toneLookupStage: 'tone_exact',
      recallCandidateKind: 'fuzzy_plain',
    });
    const edges = buildLexicalEdges({
      recalledWindows: [
        { windowId: '0:2', syllableStart: 0, syllableEnd: 2, candidates: [a, b] },
      ],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.candidates).toHaveLength(1);
    expect(edges[0]!.candidates[0]!.candidateId).toBe('0:2:1');
    // Edge-level evidence is OR-combined across all same-termId candidates even though
    // the dedup keeps only the first-wins subject candidate (T1's fuzzy hit still counts).
    expect(edges[0]!.recallEvidence).toEqual({
      hasExact: true,
      hasToneExact: true,
      hasToneRelaxed: false,
      hasFuzzy: true,
    });
  });

  it('maps hasFuzzy from recallCandidateKind thin pass-through', () => {
    const fuzzy = fakeCandidate({
      candidateId: '0:1:1',
      termId: 'fz',
      recallCandidateKind: 'fuzzy_plain',
      hitKind: 'exact_term',
    });
    const exact = fakeCandidate({
      candidateId: '0:1:2',
      termId: 'ex',
      recallCandidateKind: 'exact_base',
      hitKind: 'exact_term',
    });
    const edges = buildLexicalEdges({
      recalledWindows: [
        { windowId: '0:1', syllableStart: 0, syllableEnd: 1, candidates: [fuzzy, exact] },
      ],
    });
    expect(edges[0]!.recallEvidence.hasFuzzy).toBe(true);
    expect(edges[0]!.candidates).toHaveLength(2);
  });

  it('does not create lexical or fallback edge when candidates empty', () => {
    const edges = buildLexicalEdges({
      recalledWindows: [{ windowId: '0:1', syllableStart: 0, syllableEnd: 1, candidates: [] }],
    });
    expect(edges).toHaveLength(0);
  });

  it('dedupes by termId while keeping first occurrence order', () => {
    const a = fakeCandidate({ candidateId: '0:1:1', termId: 'same', replacement: '测' });
    const dup = fakeCandidate({ candidateId: '0:1:2', termId: 'same', replacement: '测' });
    const b = fakeCandidate({ candidateId: '0:1:3', termId: 'other', replacement: '试' });
    const edges = buildLexicalEdges({
      recalledWindows: [
        { windowId: '0:1', syllableStart: 0, syllableEnd: 1, candidates: [a, dup, b] },
      ],
    });
    expect(edges[0]!.candidates.map((c) => c.candidateId)).toEqual(['0:1:1', '0:1:3']);
  });

  it('edge determinism: identical fingerprints across two builds', () => {
    const candidates = [
      fakeCandidate({ candidateId: '1:3:1', windowId: '1:3', syllableStart: 1, syllableEnd: 3, termId: 'x' }),
      fakeCandidate({ candidateId: '1:3:2', windowId: '1:3', syllableStart: 1, syllableEnd: 3, termId: 'y' }),
    ];
    const input = {
      recalledWindows: [
        { windowId: '1:3', syllableStart: 1, syllableEnd: 3, candidates },
      ],
    };
    expect(fingerprint(buildLexicalEdges(input))).toBe(fingerprint(buildLexicalEdges(input)));
  });
});

describe('Phase 1 RecallQueryKey surfaceText contract', () => {
  it('same pinyin + different surfaceText → different keys', () => {
    const base = {
      pinyinKey: 'ji|chang',
      toneNorm: '',
      domainIds: ['airport'] as string[],
      exactTopK: 2,
      lexiconVersion: 'v',
    };
    const k1 = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, surfaceText: '机场' })
    );
    const k2 = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, surfaceText: '鸡场' })
    );
    expect(k1).not.toBe(k2);
  });

  it('domainScope / tone differences change key', () => {
    const base = {
      pinyinKey: 'jiu|dian',
      toneNorm: '',
      domainIds: ['hotel'] as string[],
      exactTopK: 2,
      lexiconVersion: 'v',
      surfaceText: '酒店',
    };
    const k0 = serializeCanonicalRecallQueryKey(buildSpanV3CanonicalQuery(base));
    const kDom = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, domainIds: ['airport'] })
    );
    const kTone = serializeCanonicalRecallQueryKey(
      buildSpanV3CanonicalQuery({ ...base, toneNorm: '1,2' })
    );
    expect(k0).not.toBe(kDom);
    expect(k0).not.toBe(kTone);
  });
});

describe('Phase 1 production orchestrator isolation', () => {
  it('span-assembly-v4-orchestrator does not import Phase 1 lattice modules', () => {
    const orchestratorPath = path.join(__dirname, 'span-assembly-v4-orchestrator.ts');
    const src = fs.readFileSync(orchestratorPath, 'utf8');
    expect(src).not.toMatch(/buildLexicalWindowQueries/);
    expect(src).not.toMatch(/buildLexicalEdges/);
    expect(src).not.toMatch(/runPhase1WindowEdgeHarness/);
    expect(src).not.toMatch(/latticeHardBlockFilter/);
    expect(src).not.toMatch(/phase1-window-edge-harness/);
    expect(src).not.toMatch(/build-lexical-window-queries/);
    expect(src).not.toMatch(/build-lexical-edges/);
    expect(src).not.toMatch(/FEATURE_.*LATTICE|enableLattice|shadowLattice/i);
  });
});
