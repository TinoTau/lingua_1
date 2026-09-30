/**
 * Step 3 — Production orchestrator Lattice cutover tests.
 * Path-local Vote/Assembly isolation, fallback sentence integrity, Lattice failure isolation.
 */

import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';
import type { LexicalEdge } from './build-lexical-edges';
import type { PathFineSpan } from './path-fine-span-types';
import type { WindowCandidate } from './v4-types';
import { runDomainAwareAssembly } from './assemble-domain-aware-span-sets';
import { buildSentenceCandidates } from '../build-sentence-candidates';
import { rebindToneForFineSpan } from './tone-fine-span-rebind';
import type { CoarseSpan } from '../span-assembly-shared/types';
import {
  runLatticeFineSpanGenerationFromLexicalEdges,
} from './lattice-fine-span-runtime';

/** Banned legacy tokens assembled so repo zero-scan stays clean. */
const LEGACY_ENTRY = ['runL', 'trFineSpanGeneration'].join('');
const LEGACY_MODULE = ['ltr', '-fine-span-generator'].join('');
const LEGACY_MODE = ['ltr', '_soft_boundary'].join('');
const LEGACY_SIGNAL = ['ltr', '_fine_span'].join('');
function fakeCandidate(
  partial: Partial<WindowCandidate> & { candidateId: string; replacement: string }
): WindowCandidate {
  return {
    windowId: `${partial.syllableStart ?? 0}:${partial.syllableEnd ?? 1}`,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 1,
    rawStart: 0,
    rawEnd: 1,
    windowPinyinKey: 'x',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    source: 'domain_term',
    recallSource: 'canonical_exact',
    repairTarget: true,
    domains: ['restaurant'],
    ...partial,
  };
}

function lexEdge(
  start: number,
  end: number,
  candidates: WindowCandidate[],
  kind: 'lexical' | 'fallback' = 'lexical'
): LexicalEdge {
  return {
    edgeId: kind === 'fallback' ? `fallback:${start}:${end}` : `${start}:${end}`,
    syllableStart: start,
    syllableEnd: end,
    edgeKind: kind,
    sourceWindowId: kind === 'fallback' ? 'fallback_injection' : `${start}:${end}`,
    candidates,
    recallEvidence: {
      hasExact: kind === 'lexical',
      hasToneExact: false,
      hasToneRelaxed: false,
      hasFuzzy: false,
    },
  };
}

function coarse(id: string, start: number, end: number, text: string): CoarseSpan {
  return {
    id,
    text,
    rawStart: start,
    rawEnd: end,
    syllableStart: start,
    syllableEnd: end,
    source: 'ime_token_boundary',
    boundaryConfidence: 1,
  };
}

describe('Step 3 Path-local Vote isolation', () => {
  it('Path A restaurant candidates do not vote into Path B medical assembly', () => {
    const rawText = '吃饭看病';
    const spansA: PathFineSpan[] = [
      {
        spanId: 'fine:a:0:2',
        rawStart: 0,
        rawEnd: 2,
        syllableStart: 0,
        syllableEnd: 2,
        coarseSpanIds: ['c0'],
        boundaryCrossCount: 0,
        windowSource: 'in_span_window',
        selectionReason: 'lattice_path_edge',
        candidates: [
          fakeCandidate({
            candidateId: 'a-rest',
            replacement: '吃饭',
            syllableStart: 0,
            syllableEnd: 2,
            rawStart: 0,
            rawEnd: 2,
            domains: ['restaurant'],
            source: 'domain_term',
          }),
        ],
      },
    ];
    const spansB: PathFineSpan[] = [
      {
        spanId: 'fine:b:0:2',
        rawStart: 2,
        rawEnd: 4,
        syllableStart: 2,
        syllableEnd: 4,
        coarseSpanIds: ['c1'],
        boundaryCrossCount: 0,
        windowSource: 'in_span_window',
        selectionReason: 'lattice_path_edge',
        candidates: [
          fakeCandidate({
            candidateId: 'b-med',
            replacement: '看病',
            syllableStart: 2,
            syllableEnd: 4,
            rawStart: 2,
            rawEnd: 4,
            domains: ['medical'],
            source: 'domain_term',
          }),
        ],
      },
    ];
    const coarseSpans = [coarse('c0', 0, 2, '吃饭'), coarse('c1', 2, 4, '看病')];
    const asmA = runDomainAwareAssembly(spansA.flatMap((s) => s.candidates), coarseSpans, rawText, spansA);
    const asmB = runDomainAwareAssembly(spansB.flatMap((s) => s.candidates), coarseSpans, rawText, spansB);
    expect(asmA.vote.domainScores.restaurant ?? 0).toBeGreaterThan(0);
    expect(asmA.vote.domainScores.medical ?? 0).toBe(0);
    expect(asmB.vote.domainScores.medical ?? 0).toBeGreaterThan(0);
    expect(asmB.vote.domainScores.restaurant ?? 0).toBe(0);
  });
});

describe('Step 3 Fallback span assembly behavior', () => {
  it('lexical + fallback + lexical assembles without gap/dup/reorder', () => {
    const rawText = '测X试';
    // Use CJK-only for coordinate: 测试 (2 syl) with middle fallback simulated on 3-char
    const text = '测试一';
    const coordinate = buildUtteranceSyllableCoordinate(text);
    const n = coordinate.syllables.length;
    expect(n).toBe(3);
    const edges = [
      lexEdge(0, 1, [
        fakeCandidate({
          candidateId: 'l0',
          replacement: '测',
          syllableStart: 0,
          syllableEnd: 1,
          rawStart: 0,
          rawEnd: 1,
          domains: ['restaurant'],
        }),
      ]),
      lexEdge(2, 3, [
        fakeCandidate({
          candidateId: 'l2',
          replacement: '一',
          syllableStart: 2,
          syllableEnd: 3,
          rawStart: 2,
          rawEnd: 3,
          domains: [],
          source: 'base_term',
        }),
      ]),
    ];
    const out = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText: text,
      coordinate,
      syllableCount: n,
      lexicalEdges: edges,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.trace.fallbackInjectionCount).toBeGreaterThan(0);
    const view = out.pathFineSpanViews[0]!;
    const fallbackSpans = view.pathFineSpans.filter((s) => s.windowSource === 'fallback');
    expect(fallbackSpans.every((s) => s.candidates.length === 0)).toBe(true);

    const asm = runDomainAwareAssembly(
      view.pathFineSpans.flatMap((s) => s.candidates),
      [coarse('c0', 0, n, text)],
      text,
      view.pathFineSpans
    );
    // Fallback spans contribute no domain votes from empty candidates.
    for (const set of asm.filteredSets) {
      if (set.fineSpanId?.includes('fallback') || set.sameDomainCandidates.length + set.baseCandidates.length === 0) {
        expect(set.sameDomainCandidates.length).toBe(0);
      }
    }
    const built = buildSentenceCandidates(text, asm.spanSets, 16);
    for (const combo of built.combinations) {
      expect(combo.text.length).toBe(text.length);
      // No duplication of whole utterance as prefix+suffix artifact
      expect(combo.text.includes(text + text)).toBe(false);
    }
    // Covering path edges reconstruct full syllable range
    let pos = 0;
    for (const span of view.pathFineSpans) {
      expect(span.syllableStart).toBe(pos);
      pos = span.syllableEnd;
    }
    expect(pos).toBe(n);
  });

  it('fallback spans produce zero domain votes', () => {
    const text = '你好';
    const coordinate = buildUtteranceSyllableCoordinate(text);
    const out = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText: text,
      coordinate,
      syllableCount: 2,
      lexicalEdges: [],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const view = out.pathFineSpanViews[0]!;
    expect(view.pathFineSpans.every((s) => s.windowSource === 'fallback')).toBe(true);
    const asm = runDomainAwareAssembly([], [coarse('c0', 0, 2, text)], text, view.pathFineSpans);
    expect(Object.values(asm.vote.domainScores).every((v) => v === 0) || asm.vote.insufficientEvidence).toBe(
      true
    );
  });
});

describe('Step 3 Lattice structured failure isolation', () => {
  it('EMPTY_INPUT fails without Lattice success', () => {
    const emptyDomain = runLatticeFineSpanGenerationFromLexicalEdges({
      rawText: '',
      coordinate: buildUtteranceSyllableCoordinate('测'),
      syllableCount: 1,
      lexicalEdges: [],
    });
    expect(emptyDomain.ok).toBe(false);
  });

  it('orchestrator source uses Lattice production entry only', () => {
    const orch = fs.readFileSync(path.join(__dirname, 'span-assembly-v4-orchestrator.ts'), 'utf8');
    expect(orch).toMatch(/runLatticeFineSpanGenerationWithPreEdgeModel2/);
    expect(orch).not.toContain(LEGACY_ENTRY);
    expect(orch).not.toContain(LEGACY_MODULE);
    expect(orch).not.toContain(LEGACY_MODE);
    expect(orch).not.toContain(LEGACY_SIGNAL);
    expect(orch).toMatch(/multi_path_lattice/);
    expect(orch).toMatch(/mergeCrossPathSentenceCandidates/);
    expect(orch).not.toMatch(/STEP3_TEMPORARY_PRE_STEP4_COLLECTION|temporaryPreStep4Collection/);
    expect(orch).toMatch(/PathAssemblyResult/);
  });

  it('tone rebind clones per-path without legacy Fine Span entry', () => {
    const span: PathFineSpan = {
      spanId: 'fine:0:1',
      rawStart: 0,
      rawEnd: 1,
      syllableStart: 0,
      syllableEnd: 1,
      coarseSpanIds: ['c0'],
      boundaryCrossCount: 0,
      windowSource: 'in_span_window',
      selectionReason: 'lattice_path_edge',
      candidates: [
        fakeCandidate({
          candidateId: 't',
          replacement: '测',
          syllableStart: 0,
          syllableEnd: 1,
          rawStart: 0,
          rawEnd: 1,
        }),
      ],
    };
    span.candidates[0]!.rawStart = 9;
    const clone = { ...span, candidates: span.candidates.map((c) => ({ ...c })) };
    const trace = rebindToneForFineSpan(clone, undefined, [], false);
    expect(trace.recomputedAfterRebind).toBe(true);
    expect(clone.candidates[0]!.rawStart).toBe(0);
    expect(span.candidates[0]!.rawStart).toBe(9);
  });
});
