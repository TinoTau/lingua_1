/**
 * Step 2 — Lattice Fine Span Production Entry unit tests (no Vote / Assembly).
 */

import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import {
  runLatticeFineSpanGenerationFromLexicalEdges,
} from './lattice-fine-span-runtime';
import { assertPathFineSpansNonOverlapping } from './path-fine-span-types';

function fakeCandidate(partial: Partial<WindowCandidate> & { candidateId: string }): WindowCandidate {
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

function lex(
  start: number,
  end: number,
  evidence: Partial<LexicalEdge['recallEvidence']> = {},
  candidates?: WindowCandidate[]
): LexicalEdge {
  const cands =
    candidates ??
    [
      fakeCandidate({
        candidateId: `${start}:${end}:c0`,
        windowId: `${start}:${end}`,
        syllableStart: start,
        syllableEnd: end,
        rawStart: start,
        rawEnd: end,
      }),
    ];
  return {
    edgeId: `${start}:${end}`,
    syllableStart: start,
    syllableEnd: end,
    edgeKind: 'lexical',
    sourceWindowId: `${start}:${end}`,
    candidates: cands,
    recallEvidence: {
      hasExact: false,
      hasToneExact: false,
      hasToneRelaxed: false,
      hasFuzzy: false,
      ...evidence,
    },
  };
}

describe('lattice-fine-span-runtime (from LexicalEdges)', () => {
  it('pure lexical edges → ≥1 complete path, no gap/overlap, stable ids', () => {
    const rawText = '测试';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const edges = [lex(0, 2, { hasExact: true })];
    const a = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText,
      coordinate,
      syllableCount: 2,
      lexicalEdges: edges,
    });
    const b = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText,
      coordinate,
      syllableCount: 2,
      lexicalEdges: edges,
    });
    expect(a.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.trace.fallbackInjectionCount).toBe(0);
    expect(a.segmentationPaths.length).toBeGreaterThan(0);
    expect(a.pathFineSpanViews).toHaveLength(a.segmentationPaths.length);
    expect(a.segmentationPaths.map((p) => p.pathId)).toEqual(b.segmentationPaths.map((p) => p.pathId));
    expect(a.segmentationPaths.map((p) => p.boundaryKey)).toEqual(
      b.segmentationPaths.map((p) => p.boundaryKey)
    );
    for (const path of a.segmentationPaths) {
      let pos = 0;
      for (const e of path.edgeRefs) {
        expect(e.syllableStart).toBe(pos);
        expect(e.syllableEnd).toBeGreaterThan(pos);
        pos = e.syllableEnd;
      }
      expect(pos).toBe(2);
    }
    for (const view of a.pathFineSpanViews) {
      assertPathFineSpansNonOverlapping(view.pathFineSpans);
    }
  });

  it('lexical + fallback hybrid → coverage without fabricating lexicon candidates', () => {
    const rawText = '测试一下';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const edges = [lex(0, 1, { hasExact: true }), lex(3, 4, { hasExact: true })];
    const out = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText,
      coordinate,
      syllableCount: 4,
      lexicalEdges: edges,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.trace.fallbackInjectionCount).toBeGreaterThan(0);
    expect(out.segmentationPaths.length).toBeGreaterThan(0);
    for (const e of out.edgesAfterFallback.filter((x) => x.edgeKind === 'fallback')) {
      expect(e.candidates).toEqual([]);
      expect(e.edgeId.startsWith('fallback:')).toBe(true);
    }
    const path = out.segmentationPaths[0]!;
    const view = out.pathFineSpanViews[0]!;
    expect(view.pathId).toBe(path.pathId);
    expect(view.boundaryKey).toBe(path.boundaryKey);
    for (let i = 0; i < path.edgeRefs.length; i += 1) {
      expect(view.pathFineSpans[i]!.candidates).toBe(path.edgeRefs[i]!.candidates);
    }
  });

  it('all-fallback minimum coverage when no lexical edges', () => {
    const rawText = '你好';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const out = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText,
      coordinate,
      syllableCount: 2,
      lexicalEdges: [],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.trace.fallbackEdgeCount).toBe(2);
    expect(out.segmentationPaths).toHaveLength(1);
    expect(out.segmentationPaths[0]!.edgeRefs.every((e) => e.edgeKind === 'fallback')).toBe(true);
  });

  it('multi-path enumerate + prune is deterministic under caps', () => {
    const rawText = '一二三四';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    // Dense overlapping length-1/2 edges → multiple complete paths.
    const edges = [
      lex(0, 1, { hasExact: true }),
      lex(1, 2, { hasExact: true }),
      lex(2, 3, { hasExact: true }),
      lex(3, 4, { hasExact: true }),
      lex(0, 2, { hasExact: true }),
      lex(2, 4, { hasExact: true }),
      lex(1, 3, { hasExact: true }),
    ];
    const limits = { maxActivePathsPerPosition: 2, maxCompleteSegmentationPaths: 2 };
    const a = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText,
      coordinate,
      syllableCount: 4,
      lexicalEdges: edges,
      limits,
    });
    const b = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText,
      coordinate,
      syllableCount: 4,
      lexicalEdges: edges,
      limits,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.segmentationPaths.length).toBeLessThanOrEqual(2);
    expect(a.segmentationPaths.map((p) => p.boundaryKey)).toEqual(
      b.segmentationPaths.map((p) => p.boundaryKey)
    );
  });

  it('EMPTY_INPUT structured failure', () => {
    const coordinate = buildUtteranceSyllableCoordinate('测');
    const out = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText: '',
      coordinate,
      syllableCount: 1,
      lexicalEdges: [],
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('EMPTY_INPUT');
  });

  it('production entry does not import legacy Fine Span generator / harness / fixtures', () => {
    const src = fs.readFileSync(path.join(__dirname, 'lattice-fine-span-runtime.ts'), 'utf8');
    const ban = (...parts: string[]) => parts.join('');
    expect(src).not.toContain(ban('ltr', '-fine-span-generator'));
    expect(src).not.toMatch(/from ['"]\.\/phase2-path-harness['"]/);
    expect(src).not.toMatch(/from ['"]\.\/phase1-window-edge-harness['"]/);
    expect(src).not.toMatch(/_audit_scratch|test-tone-fixtures/);
    expect(src).toMatch(/recallTopKForWindows/);
    expect(src).toMatch(/injectFallbackEdges/);
    expect(src).toMatch(/enumerateCompleteSegmentationPaths/);
    expect(src).toMatch(/materializePathFineSpans/);
  });

  it('orchestrator uses Lattice production entry (Step 3 cutover)', () => {
    const orch = fs.readFileSync(path.join(__dirname, 'span-assembly-v4-orchestrator.ts'), 'utf8');
    const ban = (...parts: string[]) => parts.join('');
    expect(orch).toMatch(/runLatticeFineSpanGenerationWithPreEdgeModel2/);
    expect(orch).not.toContain(ban('runL', 'trFineSpanGeneration'));
  });
});
