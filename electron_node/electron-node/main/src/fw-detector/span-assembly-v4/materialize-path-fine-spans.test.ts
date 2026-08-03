import { describe, expect, it } from '@jest/globals';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import { derivePathId, buildBoundaryKey } from './build-boundary-key';
import { materializePathFineSpans } from './materialize-path-fine-spans';
import type { SegmentationPath } from './lattice-path-types';
import { assertPathFineSpansNonOverlapping } from './path-fine-span-types';

function fakeCandidate(partial: Partial<WindowCandidate> & { candidateId: string }): WindowCandidate {
  return {
    windowId: '0:2',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    windowPinyinKey: 'ce|shi',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    replacement: '测试',
    source: 'domain_term',
    recallSource: 'canonical_exact',
    repairTarget: true,
    ...partial,
  };
}

function makePath(edges: LexicalEdge[]): SegmentationPath {
  const boundaryKey = buildBoundaryKey(edges);
  return {
    pathId: derivePathId(boundaryKey),
    boundaryKey,
    edgeRefs: edges,
    lexicalEdgeCount: edges.filter((e) => e.edgeKind === 'lexical').length,
    fallbackEdgeCount: edges.filter((e) => e.edgeKind === 'fallback').length,
    structuralEvidence: {
      exactEdgeCount: edges.filter((e) => e.recallEvidence.hasExact).length,
      toneRelaxedEdgeCount: edges.filter((e) => e.recallEvidence.hasToneRelaxed).length,
      fuzzyEdgeCount: edges.filter((e) => e.recallEvidence.hasFuzzy).length,
    },
  };
}

describe('materializePathFineSpans', () => {
  it('maps edge order/coords and shares candidate array references', () => {
    const rawText = '测试一下';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const c0 = [
      fakeCandidate({ candidateId: 'c0a', syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 }),
    ];
    const c1 = [
      fakeCandidate({
        candidateId: 'c1a',
        windowId: '2:4',
        syllableStart: 2,
        syllableEnd: 4,
        rawStart: 2,
        rawEnd: 4,
        replacement: '一下',
      }),
    ];
    const edges: LexicalEdge[] = [
      {
        edgeId: '0:2',
        syllableStart: 0,
        syllableEnd: 2,
        edgeKind: 'lexical',
        sourceWindowId: '0:2',
        candidates: c0,
        recallEvidence: {
          hasExact: true,
          hasToneExact: false,
          hasToneRelaxed: false,
          hasFuzzy: false,
        },
      },
      {
        edgeId: '2:4',
        syllableStart: 2,
        syllableEnd: 4,
        edgeKind: 'lexical',
        sourceWindowId: '2:4',
        candidates: c1,
        recallEvidence: {
          hasExact: true,
          hasToneExact: false,
          hasToneRelaxed: false,
          hasFuzzy: false,
        },
      },
    ];
    const path = makePath(edges);
    const view = materializePathFineSpans(path, coordinate);
    expect(view.pathId).toBe(path.pathId);
    expect(view.boundaryKey).toBe(path.boundaryKey);
    expect(view.pathFineSpans).toHaveLength(2);
    expect(view.pathFineSpans[0]!.syllableStart).toBe(0);
    expect(view.pathFineSpans[0]!.syllableEnd).toBe(2);
    expect(view.pathFineSpans[1]!.syllableStart).toBe(2);
    expect(view.pathFineSpans[1]!.syllableEnd).toBe(4);
    expect(view.pathFineSpans[0]!.candidates).toBe(path.edgeRefs[0]!.candidates);
    expect(view.pathFineSpans[1]!.candidates).toBe(path.edgeRefs[1]!.candidates);
    expect(view.pathFineSpans.every((s) => s.selectionReason === 'lattice_path_edge')).toBe(true);
    assertPathFineSpansNonOverlapping(view.pathFineSpans);
  });

  it('materializes fallback edges with empty candidates and fallback windowSource', () => {
    const rawText = '测试';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const empty: WindowCandidate[] = [];
    const edges: LexicalEdge[] = [
      {
        edgeId: 'fallback:0:1',
        syllableStart: 0,
        syllableEnd: 1,
        edgeKind: 'fallback',
        sourceWindowId: 'fallback_injection',
        candidates: empty,
        recallEvidence: {
          hasExact: false,
          hasToneExact: false,
          hasToneRelaxed: false,
          hasFuzzy: false,
        },
      },
      {
        edgeId: '1:2',
        syllableStart: 1,
        syllableEnd: 2,
        edgeKind: 'lexical',
        sourceWindowId: '1:2',
        candidates: [
          fakeCandidate({
            candidateId: 'x',
            windowId: '1:2',
            syllableStart: 1,
            syllableEnd: 2,
            rawStart: 1,
            rawEnd: 2,
            replacement: '试',
          }),
        ],
        recallEvidence: {
          hasExact: true,
          hasToneExact: false,
          hasToneRelaxed: false,
          hasFuzzy: false,
        },
      },
    ];
    const path = makePath(edges);
    const view = materializePathFineSpans(path, coordinate);
    expect(view.pathFineSpans[0]!.windowSource).toBe('fallback');
    expect(view.pathFineSpans[0]!.candidates).toBe(empty);
    expect(view.pathFineSpans[0]!.selectionReason).toBe('lattice_path_edge');
    assertPathFineSpansNonOverlapping(view.pathFineSpans);
  });
});
