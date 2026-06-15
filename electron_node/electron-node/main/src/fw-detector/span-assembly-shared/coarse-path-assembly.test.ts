import { describe, expect, it } from '@jest/globals';
import { assembleCoarsePaths, edgeBelongsToSpan } from './coarse-path-assembly';
import { runCoarseSentenceBeamV4 } from '../span-assembly-v4/run-coarse-sentence-beam-v4';
import type { CoarseSpan, GraphEdge } from './types';

const span6: CoarseSpan = {
  id: 's6',
  rawStart: 24,
  rawEnd: 25,
  syllableStart: 23,
  syllableEnd: 24,
  text: '有',
  source: 'ime_token_boundary',
  boundaryConfidence: 1,
};

const span7: CoarseSpan = {
  id: 's7',
  rawStart: 25,
  rawEnd: 30,
  syllableStart: 24,
  syllableEnd: 28,
  text: '蓝美马分吗',
  source: 'ime_token_boundary',
  boundaryConfidence: 1,
};

function parentEdge(overrides: Partial<GraphEdge> = {}): GraphEdge {
  return {
    coarseSpanId: 's7',
    syllableStart: 24,
    syllableEnd: 29,
    rawStart: 25,
    rawEnd: 29,
    replacement: '蓝莓马芬',
    source: 'domain_term',
    score: 0.95,
    ngramKey: 'lan|mei|ma|fen',
    recallSource: 'canonical_exact',
    repairTarget: true,
    hitKind: 'parent_span_candidate',
    parentTerm: '蓝莓马芬',
    parentTermId: 'domain:restaurant:蓝莓马芬',
    ...overrides,
  };
}

describe('coarse-path-assembly edgeBelongsToSpan', () => {
  it('Case 1: parent_span_candidate uses coarseSpanId even when syllableEnd exceeds span syllableEnd', () => {
    const edge = parentEdge();
    expect(edge.syllableEnd).toBeGreaterThan(span7.syllableEnd);
    const legacyContained =
      edge.syllableStart >= span7.syllableStart && edge.syllableEnd <= span7.syllableEnd;
    expect(legacyContained).toBe(false);
    expect(edgeBelongsToSpan(edge, span7)).toBe(true);
    const paths = assembleCoarsePaths([span7], [edge]);
    const span7Paths = paths.filter((p) => p.coarseSpanId === 's7');
    expect(span7Paths.some((p) => p.edges.some((e) => e.replacement === '蓝莓马芬'))).toBe(true);
  });

  it('Case 2: without coarseSpanId falls back to syllable containment', () => {
    const edge: GraphEdge = {
      syllableStart: 24,
      syllableEnd: 28,
      rawStart: 25,
      rawEnd: 29,
      replacement: 'term',
      source: 'base_term',
      score: 0.5,
      ngramKey: 'a|b',
      recallSource: 'canonical_exact',
      repairTarget: false,
      hitKind: 'exact_term',
    };
    expect(edgeBelongsToSpan(edge, span7)).toBe(true);
    expect(edgeBelongsToSpan({ ...edge, syllableEnd: 30 }, span7)).toBe(false);
  });

  it('Case 3: different coarseSpanId does not belong to span7', () => {
    const edge = parentEdge({ coarseSpanId: 's6' });
    expect(edgeBelongsToSpan(edge, span7)).toBe(false);
    const paths = assembleCoarsePaths([span6, span7], [edge]);
    expect(paths.filter((p) => p.coarseSpanId === 's7' && p.edges.some((e) => e.replacement === '蓝莓马芬'))).toEqual([]);
  });
});

describe('coarse-path-assembly d001 span7 path', () => {
  const rawText = '你好,我想點一杯熱拿鐵鐘貝少糖 深便溫 以下今天有蓝美马分吗?';
  const edge = parentEdge();

  it('Case 5: span7 coarsePaths and beam carry 蓝莓马芬 without swallowing 吗', () => {
    const paths = assembleCoarsePaths([span6, span7], [edge]);
    const span7Paths = paths.filter((p) => p.coarseSpanId === 's7');
    expect(span7Paths.some((p) => p.edges.some((e) => e.hitKind === 'parent_span_candidate'))).toBe(true);

    const beam = runCoarseSentenceBeamV4(rawText, [span6, span7], paths);
    const span7Picks = beam.spanSets[1];
    const blueberry = span7Picks.find((p) => p.word === '蓝莓马芬');
    expect(blueberry).toBeDefined();
    expect(blueberry!.span.start).toBe(25);
    expect(blueberry!.span.end).toBe(29);
    expect(blueberry!.repairTarget).toBe(true);
    expect(rawText.slice(blueberry!.span.start, blueberry!.span.end)).toBe('蓝美马分');
    expect(beam.sentenceTexts.some((t) => t.includes('蓝莓马芬吗'))).toBe(true);
  });
});
