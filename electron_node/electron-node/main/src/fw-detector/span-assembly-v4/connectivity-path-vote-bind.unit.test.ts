/**
 * Unit-only Path / Vote / bindLexiconHitsToWindow (hand-built inputs).
 * Not SQLite / not LexiconRuntimeV2 / not E2E Recall.
 * Real Recall→Path/Vote: see length1-recall-edge-path.sqlite.integration.test.ts
 */
import { describe, expect, it } from '@jest/globals';
import { runPhase2PathHarnessFromLexicalEdges } from './phase2-path-harness';
import { bindLexiconHitsToWindow } from './recall-topk-for-windows';
import { voteUtteranceDomainFromPool } from '../span-assembly-shared/utterance-domain-vote';
import type { GlobalWindowDescriptor } from './v4-types';
import type { LexicalEdge } from './build-lexical-edges';
import { buildUtteranceSyllableCoordinate } from '../pinyin-ime-v2/pinyin-ime-v2-pinyin-stream';

function makeWindow(
  partial: Partial<GlobalWindowDescriptor> &
    Pick<
      GlobalWindowDescriptor,
      'windowId' | 'syllableStart' | 'syllableEnd' | 'rawStart' | 'rawEnd' | 'windowText' | 'windowPinyinKey'
    >
): GlobalWindowDescriptor {
  return {
    spanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    blocked: false,
    ...partial,
  };
}

function baseCand(partial: {
  candidateId: string;
  syllableStart: number;
  syllableEnd: number;
  replacement: string;
  domains?: readonly string[];
  source?: 'base_term' | 'domain_term';
}) {
  return {
    candidateId: partial.candidateId,
    windowId: `${partial.syllableStart}:${partial.syllableEnd}`,
    windowSource: 'in_span_window' as const,
    anchorCoarseSpanId: 'c0',
    syllableStart: partial.syllableStart,
    syllableEnd: partial.syllableEnd,
    rawStart: partial.syllableStart,
    rawEnd: partial.syllableEnd,
    windowPinyinKey: 'x',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term' as const,
    replacement: partial.replacement,
    domains: partial.domains,
    source: partial.source ?? 'base_term',
    recallSource: 'lexicon_pinyin_topk' as const,
    repairTarget: false,
    recallCandidateKind: 'exact_base' as const,
  };
}

describe('Batch 1 unit-only (no fake runtime / not E2E Recall)', () => {
  it('unit Path: hand-built edges [2syl][1syl][2syl] yield lexical-only complete path', () => {
    const rawText = '测试段路径';
    const coordinate = buildUtteranceSyllableCoordinate(rawText);
    const edges: LexicalEdge[] = [
      {
        edgeId: '0:2',
        syllableStart: 0,
        syllableEnd: 2,
        edgeKind: 'lexical',
        sourceWindowId: '0:2',
        candidates: [baseCand({ candidateId: 'a', syllableStart: 0, syllableEnd: 2, replacement: '测试' })],
        recallEvidence: {
          hasExact: true,
          hasToneExact: false,
          hasToneRelaxed: false,
          hasFuzzy: false,
        },
      },
      {
        edgeId: '2:3',
        syllableStart: 2,
        syllableEnd: 3,
        edgeKind: 'lexical',
        sourceWindowId: '2:3',
        candidates: [baseCand({ candidateId: 'b', syllableStart: 2, syllableEnd: 3, replacement: '段' })],
        recallEvidence: {
          hasExact: true,
          hasToneExact: false,
          hasToneRelaxed: false,
          hasFuzzy: false,
        },
      },
      {
        edgeId: '3:5',
        syllableStart: 3,
        syllableEnd: 5,
        edgeKind: 'lexical',
        sourceWindowId: '3:5',
        candidates: [baseCand({ candidateId: 'c', syllableStart: 3, syllableEnd: 5, replacement: '路径' })],
        recallEvidence: {
          hasExact: true,
          hasToneExact: false,
          hasToneRelaxed: false,
          hasFuzzy: false,
        },
      },
    ];
    const out = runPhase2PathHarnessFromLexicalEdges({
      sentenceId: 'batch1-path-unit',
      rawText,
      coordinate,
      syllableCount: 5,
      lexicalEdges: edges,
    });
    expect(out.diagnostics.singleCharLexicalEdgeCount).toBe(1);
    expect(out.retainedCompletePathCount).toBeGreaterThanOrEqual(1);
    const lexicalOnly = out.paths.filter((p) => p.fallbackEdgeCount === 0);
    expect(lexicalOnly.length).toBeGreaterThanOrEqual(1);
    expect(out.diagnostics.singleCharLexicalEdgeUsedCount).toBeGreaterThanOrEqual(1);
    for (const path of lexicalOnly) {
      const mid = path.edgeRefs.find((e) => e.syllableStart === 2 && e.syllableEnd === 3);
      expect(mid?.edgeKind).toBe('lexical');
    }
  });

  it('unit Vote: base_term single-char contributes 0; domain_term bigram votes', () => {
    const pool = [
      {
        candidates: [
          baseCand({
            candidateId: 'char',
            syllableStart: 0,
            syllableEnd: 1,
            replacement: '字',
            domains: [],
            source: 'base_term',
          }),
        ],
      },
      {
        candidates: [
          baseCand({
            candidateId: 'dom',
            syllableStart: 1,
            syllableEnd: 3,
            replacement: '领域',
            domains: ['coffee'],
            source: 'domain_term',
          }),
        ],
      },
    ];
    const vote = voteUtteranceDomainFromPool(pool);
    expect(vote.domainScores).not.toHaveProperty('base_term');
    expect(vote.domainScores.coffee).toBe(1);
  });

  it('unit bindLexiconHitsToWindow: empty domains → source=base_term (mapping only)', () => {
    const window = makeWindow({
      windowId: '0:1',
      syllableStart: 0,
      syllableEnd: 1,
      rawStart: 0,
      rawEnd: 1,
      windowText: '字',
      windowPinyinKey: 'zi',
    });
    const bound = bindLexiconHitsToWindow({
      window,
      hits: [
        {
          hitKind: 'exact_term',
          hotword: {
            id: 'u_zi',
            word: '字',
            pinyin: ['zi'],
            priorScore: 0.9,
            frequency: 1,
            enabled: true,
            domains: [],
            repairTarget: false,
          },
          phoneticScore: 1,
          candidateScore: 1,
          candidateScoreBreakdown: {
            priorScore: 0.9,
            phoneticSimilarity: 1,
            exactLengthBonus: 0.5,
            domainBoost: 0,
            editDistancePenalty: 0,
            fuzzyPenalty: 0,
            recallCandidateKind: 'exact_base',
          },
          recallCandidateKind: 'exact_base',
          source: 'lexicon_pinyin_topk',
        },
      ],
      minPrior: 0.5,
      boundaryPenalty: 1,
      candidateSeqStart: 0,
    });
    expect(bound.candidates).toHaveLength(1);
    expect(bound.candidates[0]!.source).toBe('base_term');
    expect(bound.candidates[0]!.domains == null || bound.candidates[0]!.domains!.length === 0).toBe(
      true
    );
  });
});
