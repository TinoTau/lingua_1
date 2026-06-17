import { describe, expect, it } from '@jest/globals';
import {
  __testOnly,
  dropIncompatibleCandidates,
  resolveCompatibilityRelations,
} from './candidate-compatibility-graph';
import { emitParentEvidenceAndExactEdges } from './emit-v4-evidence';
import type { WindowCandidate } from './v4-types';
import { V4TraceCollector } from './v4-diagnostics-trace';

function makeCandidate(
  overrides: Partial<WindowCandidate> & Pick<WindowCandidate, 'candidateId' | 'replacement'>
): WindowCandidate {
  return {
    windowId: 'w1',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 2,
    rawStart: 0,
    rawEnd: 2,
    windowPinyinKey: 'lan|mei',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    source: 'base_term',
    recallSource: 'canonical_exact',
    repairTarget: true,
    ...overrides,
  };
}

describe('candidate-compatibility-graph coverage merge', () => {
  it('keeps parent and covered child in activeCandidates without dropping child', () => {
    const child = makeCandidate({
      candidateId: 'child',
      replacement: '蓝莓',
      score: 2,
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
    });
    const parent = makeCandidate({
      candidateId: 'parent',
      replacement: '蓝莓马芬',
      score: 0.5,
      syllableStart: 0,
      syllableEnd: 4,
      rawStart: 0,
      rawEnd: 4,
      windowPinyinKey: 'lan|mei|ma|fen',
    });

    const result = resolveCompatibilityRelations([child, parent]);
    expect(result.metrics.hardDropCount).toBe(0);
    expect(result.metrics.coverageCount).toBe(1);
    expect(result.activeCandidates).toHaveLength(2);
    expect(result.activeCandidates.find((c) => c.candidateId === 'parent')).toBeDefined();
    expect(result.activeCandidates.find((c) => c.candidateId === 'child')?.isCovered).toBe(true);
    expect(result.activeCandidates.find((c) => c.candidateId === 'child')?.coveredBy).toBe('parent');
  });

  it('emits parent edge but skips covered child', () => {
    const child = makeCandidate({
      candidateId: 'child',
      replacement: '蓝莓',
      score: 2,
      syllableStart: 0,
      syllableEnd: 2,
    });
    const parent = makeCandidate({
      candidateId: 'parent',
      replacement: '蓝莓马芬',
      score: 0.5,
      syllableStart: 0,
      syllableEnd: 4,
      rawStart: 0,
      rawEnd: 4,
    });
    const { activeCandidates } = resolveCompatibilityRelations([child, parent]);
    const emitted = emitParentEvidenceAndExactEdges(activeCandidates);
    expect(emitted.exactEdges).toHaveLength(1);
    expect(emitted.exactEdges[0]?.replacement).toBe('蓝莓马芬');
  });

  it('records ConflictRelation for 中杯 vs 焙烧 without dropping either', () => {
    const a = makeCandidate({ candidateId: 'a', replacement: '中杯', score: 1 });
    const b = makeCandidate({ candidateId: 'b', replacement: '焙烧', score: 0.5 });
    const result = resolveCompatibilityRelations([a, b]);
    expect(result.metrics.hardDropCount).toBe(0);
    expect(result.metrics.conflictRelationCount).toBe(1);
    expect(result.metrics.conflictRelationCount).not.toBe(result.metrics.hardDropCount);
    expect(result.activeCandidates).toHaveLength(2);
    expect(result.conflictRelations).toHaveLength(1);
    expect(result.conflictRelations[0]?.candidateIdA).toBeDefined();
    expect(result.conflictRelations[0]?.relationType).toBe('CONFLICT');
    expect(result.activeCandidates.map((c) => c.replacement).sort()).toEqual(['中杯', '焙烧']);
  });

  it('keeps covered child when parent has conflict relation with rival', () => {
    const child = makeCandidate({
      candidateId: 'child',
      replacement: '蓝莓',
      score: 2,
      syllableStart: 0,
      syllableEnd: 2,
    });
    const parent = makeCandidate({
      candidateId: 'parent',
      replacement: '蓝莓马芬',
      score: 0.5,
      syllableStart: 0,
      syllableEnd: 4,
      rawStart: 0,
      rawEnd: 4,
    });
    const rival = makeCandidate({
      candidateId: 'rival',
      replacement: '蓝霉马芬',
      score: 1.5,
      syllableStart: 0,
      syllableEnd: 4,
      rawStart: 0,
      rawEnd: 4,
    });

    const result = resolveCompatibilityRelations([child, parent, rival]);
    const coveredChild = result.activeCandidates.find((c) => c.candidateId === 'child');
    expect(coveredChild).toBeDefined();
    expect(coveredChild?.isCovered).toBe(true);
    expect(result.metrics.hardDropCount).toBe(0);
    expect(result.metrics.activeCandidateCount).toBe(3);
  });

  it('records overlapRelationType and lifecycle coverage in trace', () => {
    const trace = new V4TraceCollector(true);
    const child = makeCandidate({ candidateId: 'child', replacement: '蓝莓', score: 2 });
    const parent = makeCandidate({
      candidateId: 'parent',
      replacement: '蓝莓马芬',
      score: 0.5,
      syllableStart: 0,
      syllableEnd: 4,
      rawStart: 0,
      rawEnd: 4,
    });
    resolveCompatibilityRelations([child, parent], trace);
    const diagnostics = trace.toDiagnostics();
    expect(
      diagnostics.compatibilityEdges?.some((edge) => edge.overlapRelationType === 'COVERAGE')
    ).toBe(true);
    const childLifecycle = diagnostics.candidateLifecycle?.find((c) => c.candidateId === 'child');
    expect(childLifecycle?.lifecycleState).toBe('covered_by_parent');
    expect(childLifecycle?.coverageParentId).toBe('parent');
  });

  it('preserves all candidates when conflict relations exist', () => {
    const a = makeCandidate({ candidateId: 'a', replacement: '中杯', score: 1 });
    const b = makeCandidate({ candidateId: 'b', replacement: '焙烧', score: 0.5 });
    const result = resolveCompatibilityRelations([a, b]);
    expect(result.metrics.activeCandidateCount).toBe(2);
    expect(result.metrics.hardDropCount).toBe(0);
  });

  it('deprecated dropIncompatibleCandidates maps to resolveCompatibilityRelations', () => {
    const a = makeCandidate({ candidateId: 'a', replacement: '中杯', score: 1 });
    const b = makeCandidate({ candidateId: 'b', replacement: '焙烧', score: 0.5 });
    const legacy = dropIncompatibleCandidates([a, b]);
    expect(legacy.droppedCount).toBe(0);
    expect(legacy.survivors).toHaveLength(2);
  });

  it('pickDropCandidate remains available for narrow hardDrop stub tests only', () => {
    const parent = makeCandidate({
      candidateId: 'parent',
      replacement: '蓝莓马芬',
      score: 0.5,
      syllableStart: 0,
      syllableEnd: 4,
    });
    const rival = makeCandidate({
      candidateId: 'rival',
      replacement: '蓝霉马芬',
      score: 1.5,
      syllableStart: 0,
      syllableEnd: 4,
    });
    const loser = __testOnly.pickDropCandidate(parent, rival);
    expect(loser.candidateId).toBe('parent');
  });
});
