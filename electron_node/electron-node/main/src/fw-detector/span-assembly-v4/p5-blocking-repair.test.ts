/**
 * P5 Blocking Repair — topicShift contract continuity + PathFineSpan pool + Tone fine-span rebind.
 */

import { describe, expect, it } from '@jest/globals';
import {
  buildLexiconSessionIntentFromDecision,
  cloneLexiconSessionIntent,
} from '../../lexicon-v2/lexicon-session-intent';
import {
  buildFineSpanCandidatePool,
  coarseSpansAsPathFineSpansForTests,
} from './assemble-domain-aware-span-sets';
import { rebindToneForFineSpan } from './tone-fine-span-rebind';
import type { PathFineSpan } from './path-fine-span-types';
import type { WindowCandidate } from './v4-types';
import type { CoarseSpan } from '../span-assembly-shared/types';

describe('P5 topicShift contract continuity', () => {
  it('topicShift=true survives decision → session intent → clone → result projection shape', () => {
    const intent = buildLexiconSessionIntentFromDecision({
      summary: '换话题',
      topicKeywords: ['酒店'],
      primaryDomain: 'travel',
      secondaryDomains: [],
      confidence: 0.9,
      shouldSwitch: false,
      topicShift: true,
      reason: ['topic changed'],
      effectiveFromTurn: 2,
    });
    expect(intent.topicShift).toBe(true);
    expect(cloneLexiconSessionIntent(intent).topicShift).toBe(true);
    // Mirrors session-result-extra / result-builder projection rule
    expect(intent.topicShift === true).toBe(true);
  });

  it('topicShift=false survives end-to-end', () => {
    const intent = buildLexiconSessionIntentFromDecision({
      summary: '同话题',
      topicKeywords: [],
      primaryDomain: 'travel',
      secondaryDomains: [],
      confidence: 0.9,
      shouldSwitch: true,
      topicShift: false,
      reason: [],
      effectiveFromTurn: 1,
    });
    expect(intent.topicShift).toBe(false);
    expect(cloneLexiconSessionIntent(intent).topicShift).toBe(false);
  });
});

describe('P5 Formal pool API (PathFineSpan)', () => {
  const coarse: CoarseSpan[] = [
    {
      id: 'c0',
      text: '中杯',
      rawStart: 0,
      rawEnd: 2,
      syllableStart: 0,
      syllableEnd: 2,
      source: 'ime_token_boundary',
      boundaryConfidence: 1,
    },
  ];

  it('missing PathFineSpan[] hard-fails (no coarse silent fallback)', () => {
    expect(() => buildFineSpanCandidatePool([], coarse, [])).toThrow(/PATH_FINE_SPAN_POOL/);
  });

  it('accepts PathFineSpan pool', () => {
    const formal = coarseSpansAsPathFineSpansForTests(coarse);
    const pool = buildFineSpanCandidatePool([], coarse, formal);
    expect(pool).toHaveLength(1);
    expect(pool[0]?.fineSpanId).toMatch(/^fine:/);
  });
});

describe('P5 Tone fine-span rebind', () => {
  it('final tone range equals PathFineSpan range; recomputedAfterRebind=true', () => {
    const span: PathFineSpan = {
      spanId: 'fine:0:2',
      rawStart: 0,
      rawEnd: 2,
      syllableStart: 0,
      syllableEnd: 2,
      coarseSpanIds: ['c0'],
      boundaryCrossCount: 0,
      windowSource: 'in_span_window',
      selectionReason: 'complete_in_span',
      candidates: [
        {
          candidateId: 'win',
          windowId: '0:2',
          windowSource: 'in_span_window',
          anchorCoarseSpanId: 'c0',
          syllableStart: 0,
          syllableEnd: 2,
          rawStart: 0,
          rawEnd: 2,
          windowPinyinKey: 'a|b',
          candidateScore: 1,
          score: 1,
          boundaryPenalty: 1,
          candidateRank: 1,
          hitKind: 'exact_term',
          replacement: '中杯',
          source: 'base_term',
          recallSource: 'lexicon_pinyin_topk',
          repairTarget: true,
        } satisfies WindowCandidate,
      ],
    };
    const loserOptionRaw = { rawStart: 1, rawEnd: 3 };
    // Simulate option range that differed before commit (loser would have been 1:3).
    span.candidates[0]!.rawStart = loserOptionRaw.rawStart;
    span.candidates[0]!.rawEnd = loserOptionRaw.rawEnd;

    const trace = rebindToneForFineSpan(span, undefined, [], false);
    expect(trace.recomputedAfterRebind).toBe(true);
    expect(trace.pathRawStart).toBe(0);
    expect(trace.pathRawEnd).toBe(2);
    expect(trace.finalToneRawStart).toBe(0);
    expect(trace.finalToneRawEnd).toBe(2);
    expect(span.candidates[0]!.rawStart).toBe(0);
    expect(span.candidates[0]!.rawEnd).toBe(2);
    expect(span.toneRebindTrace?.recomputedAfterRebind).toBe(true);
  });
});
