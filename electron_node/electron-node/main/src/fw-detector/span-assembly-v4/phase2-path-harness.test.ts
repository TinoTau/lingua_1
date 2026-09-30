import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { LexicalEdge } from './build-lexical-edges';
import type { WindowCandidate } from './v4-types';
import { runPhase2PathHarnessFromLexicalEdges } from './phase2-path-harness';

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

function lex(start: number, end: number, evidence: Partial<LexicalEdge['recallEvidence']> = {}): LexicalEdge {
  return {
    edgeId: `${start}:${end}`,
    syllableStart: start,
    syllableEnd: end,
    edgeKind: 'lexical',
    sourceWindowId: `${start}:${end}`,
    candidates: [
      fakeCandidate({
        candidateId: `${start}:${end}:c0`,
        windowId: `${start}:${end}`,
        syllableStart: start,
        syllableEnd: end,
        rawStart: start,
        rawEnd: end,
      }),
    ],
    recallEvidence: {
      hasExact: false,
      hasToneExact: false,
      hasToneRelaxed: false,
      hasFuzzy: false,
      ...evidence,
    },
  };
}

describe('phase2-path-harness isolation + pipeline', () => {
  it('injects fallback then enumerates and materializes PathFineSpanView', () => {
    const rawText = '测试一下';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    // Missing middle: only 0:1 and 3:4 — requires fallbacks for connectivity on N=4.
    const edges = [lex(0, 1, { hasExact: true }), lex(3, 4, { hasExact: true })];
    const out = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: 'unit-gap',
      rawText,
      coordinate,
      syllableCount: coordinate.syllables.length,
      lexicalEdges: edges,
      limits: { maxActivePathsPerPosition: 8, maxCompleteSegmentationPaths: 8 },
    });
    expect(out.fallbackInjectionCount).toBeGreaterThan(0);
    expect(out.retainedCompletePathCount).toBeGreaterThan(0);
    expect(out.pathFineSpanViews).toHaveLength(out.paths.length);
    for (let i = 0; i < out.paths.length; i += 1) {
      const path = out.paths[i]!;
      const view = out.pathFineSpanViews[i]!;
      expect(view.pathId).toBe(path.pathId);
      expect(view.pathFineSpans).toHaveLength(path.edgeRefs.length);
      for (let j = 0; j < path.edgeRefs.length; j += 1) {
        expect(view.pathFineSpans[j]!.candidates).toBe(path.edgeRefs[j]!.candidates);
      }
    }
  });

  it('does not import Vote / Assembly / Compatibility / KenLM / Orchestrator', () => {
    const src = fs.readFileSync(path.join(__dirname, 'phase2-path-harness.ts'), 'utf8');
    const ban = (...parts: string[]) => parts.join('');
    expect(src).not.toMatch(/runDomainAwareAssembly|buildCandidateCompatibilityGraph|buildSentenceCandidates|KenLM|span-assembly-v4-orchestrator/);
    expect(src).not.toContain(ban('runL', 'trFineSpanGeneration'));
    expect(src).toMatch(/lattice-fine-span-runtime|runLatticeFineSpanGeneration/);
  });

  it('orchestrator uses Lattice production entry only', () => {
    const orch = fs.readFileSync(path.join(__dirname, 'span-assembly-v4-orchestrator.ts'), 'utf8');
    const ban = (...parts: string[]) => parts.join('');
    expect(orch).toMatch(/runLatticeFineSpanGenerationWithPreEdgeModel2/);
    expect(orch).not.toContain(ban('runL', 'trFineSpanGeneration'));
    expect(orch).not.toContain(ban('ltr', '-fine-span-generator'));
    expect(orch).not.toMatch(/phase2-path-harness/);
  });
});
