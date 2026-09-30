/**
 * ACP V1 RecallQueryEvidence — T1–T14 targeted acceptance (Jest).
 */
import { coarseSpansAsPathFineSpansForTests } from '../fw-detector/span-assembly-v4/assemble-domain-aware-span-sets';
import type { CoarseSpan } from '../fw-detector/span-assembly-shared/types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import {
  RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
  mapEvidenceToStage2Window,
  upsertRecallQueryEvidence,
  type RecallQueryEvidence,
} from '../lexicon-v2/recall-query-evidence';
import { routeModel3Retry } from './model3-retry-router';
import type { Model3SpanDecision } from './model3-types';

function ev(
  partial: Partial<RecallQueryEvidence> &
    Pick<RecallQueryEvidence, 'pinyinKey' | 'syllableStart' | 'syllableEnd' | 'rawStart' | 'rawEnd'>
): RecallQueryEvidence {
  return {
    source: RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
    ...partial,
  };
}

function makeSpan(id: string, text: string, start: number): CoarseSpan {
  return {
    id,
    text,
    rawStart: start,
    rawEnd: start + text.length,
    syllableStart: start,
    syllableEnd: start + text.length,
    source: 'ime_token_boundary',
    boundaryConfidence: 1,
  };
}

function wc(
  overrides: Partial<WindowCandidate> &
    Pick<WindowCandidate, 'candidateId' | 'replacement' | 'anchorCoarseSpanId'>
): WindowCandidate {
  const replacement = overrides.replacement;
  const inferredEnd =
    typeof replacement === 'string' && replacement.length > 0 ? replacement.length : 2;
  return {
    windowId: 'w0',
    windowSource: 'in_span_window',
    syllableStart: 0,
    syllableEnd: inferredEnd,
    rawStart: 0,
    rawEnd: inferredEnd,
    windowPinyinKey: 'x|y',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 1,
    candidateRank: 1,
    hitKind: 'exact_term',
    source: 'base_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: true,
    termId: overrides.termId ?? overrides.candidateId,
    ...overrides,
  };
}

describe('RecallQueryEvidence mapper T1–T8 T13', () => {
  const storeBase: RecallQueryEvidence[] = [
    ev({ pinyinKey: 'nei|ke', syllableStart: 4, syllableEnd: 6, rawStart: 4, rawEnd: 6 }),
    ev({
      pinyinKey: 'yi|xian|tan|nei|ke',
      syllableStart: 1,
      syllableEnd: 6,
      rawStart: 1,
      rawEnd: 6,
    }),
  ];

  it('T1 EXACT positive', () => {
    const r = mapEvidenceToStage2Window(storeBase, {
      syllableStart: 4,
      syllableEnd: 6,
      rawStart: 4,
      rawEnd: 6,
    });
    expect(r.querySource).toBe('RECALL_QUERY_EVIDENCE');
    expect(r.reason).toBe('EXACT');
    expect(r.mappedPinyinKey).toBe('nei|ke');
  });

  it('T2 SUBSPAN positive', () => {
    const onlyLarge = storeBase.filter((e) => e.pinyinKey.startsWith('yi|'));
    const r2 = mapEvidenceToStage2Window(onlyLarge, {
      syllableStart: 4,
      syllableEnd: 6,
      rawStart: 4,
      rawEnd: 6,
    });
    expect(r2.reason).toBe('SUBSPAN');
    expect(r2.mappedPinyinKey).toBe('nei|ke');
  });

  it('T3 no evidence', () => {
    const r = mapEvidenceToStage2Window([], {
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
    });
    expect(r.querySource).toBe('ASR');
    expect(r.reason).toBe('NONE');
    expect(r.mappedPinyinKey).toBeNull();
  });

  it('T4 raw conflict fail-closed', () => {
    const r = mapEvidenceToStage2Window(
      [ev({ pinyinKey: 'nei|ke', syllableStart: 4, syllableEnd: 6, rawStart: 4, rawEnd: 6 })],
      { syllableStart: 4, syllableEnd: 6, rawStart: 0, rawEnd: 2 }
    );
    expect(r.querySource).toBe('ASR');
    expect(r.reason).toBe('RAW_CONFLICT_REJECT');
    expect(r.mappedPinyinKey).toBeNull();
  });

  it('T5 SUPERSPAN unsupported', () => {
    const r = mapEvidenceToStage2Window(
      [ev({ pinyinKey: 'nei|ke', syllableStart: 4, syllableEnd: 6, rawStart: 4, rawEnd: 6 })],
      { syllableStart: 3, syllableEnd: 7, rawStart: 3, rawEnd: 7 }
    );
    expect(r.querySource).toBe('ASR');
    expect(r.reason).toBe('UNSUPPORTED_GEOMETRY');
  });

  it('T6 partial overlap unsupported', () => {
    const r = mapEvidenceToStage2Window(
      [ev({ pinyinKey: 'nei|ke', syllableStart: 4, syllableEnd: 6, rawStart: 4, rawEnd: 6 })],
      { syllableStart: 5, syllableEnd: 7, rawStart: 5, rawEnd: 7 }
    );
    expect(r.querySource).toBe('ASR');
    expect(r.reason).toBe('UNSUPPORTED_GEOMETRY');
  });

  it('T7 DISJOINT unsupported', () => {
    const r = mapEvidenceToStage2Window(
      [ev({ pinyinKey: 'nei|ke', syllableStart: 4, syllableEnd: 6, rawStart: 4, rawEnd: 6 })],
      { syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 }
    );
    expect(r.querySource).toBe('ASR');
    expect(r.reason).toBe('UNSUPPORTED_GEOMETRY');
  });

  it('T8 multiple evidence prefers EXACT then smallest SUBSPAN', () => {
    const store: RecallQueryEvidence[] = [
      ev({
        pinyinKey: 'a|b|c|d|e',
        syllableStart: 0,
        syllableEnd: 5,
        rawStart: 0,
        rawEnd: 5,
      }),
      ev({ pinyinKey: 'c|d', syllableStart: 2, syllableEnd: 4, rawStart: 2, rawEnd: 4 }),
      ev({
        pinyinKey: 'b|c|d',
        syllableStart: 1,
        syllableEnd: 4,
        rawStart: 1,
        rawEnd: 4,
      }),
    ];
    const r = mapEvidenceToStage2Window(store, {
      syllableStart: 2,
      syllableEnd: 4,
      rawStart: 2,
      rawEnd: 4,
    });
    expect(r.reason).toBe('EXACT');
    expect(r.mappedPinyinKey).toBe('c|d');
  });

  it('T13 invalid pinyin alignment rejected from store', () => {
    const store: RecallQueryEvidence[] = [];
    const ok = upsertRecallQueryEvidence(store, {
      pinyinKey: 'nei',
      syllableStart: 0,
      syllableEnd: 2,
      rawStart: 0,
      rawEnd: 2,
      source: RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
    });
    expect(ok).toBe(false);
    expect(store).toHaveLength(0);
    const r = mapEvidenceToStage2Window(
      [
        {
          pinyinKey: 'nei',
          syllableStart: 0,
          syllableEnd: 2,
          rawStart: 0,
          rawEnd: 2,
          source: RECALL_QUERY_EVIDENCE_SOURCE_MODEL2_FIRST_PASS,
        },
      ],
      { syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 }
    );
    expect(r.reason).toBe('INVALID_EVIDENCE');
    expect(r.mappedPinyinKey).toBeNull();
  });

  it('dedup by identity', () => {
    const store: RecallQueryEvidence[] = [];
    const e = ev({ pinyinKey: 'nei|ke', syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 });
    expect(upsertRecallQueryEvidence(store, e)).toBe(true);
    expect(upsertRecallQueryEvidence(store, e)).toBe(false);
    expect(store).toHaveLength(1);
  });
});

describe('routeModel3Retry REPLACE seam T9–T14', () => {
  // ASCII identity fixture: rawText.length === globalSyllables.length (Stage2 enumerator).
  const spans = [makeSpan('c0', 'AB', 0), makeSpan('c1', 'CD', 2)];
  const pathFineSpans = coarseSpansAsPathFineSpansForTests(spans);
  const decisions: Model3SpanDecision[] = [
    { spanId: pathFineSpans[0]!.spanId, decision: 'RETRY', eligible: true },
    { spanId: pathFineSpans[1]!.spanId, decision: 'KEEP', eligible: true },
  ];
  const active: WindowCandidate[] = pathFineSpans.map((s, i) =>
    wc({
      candidateId: `b${i}`,
      replacement: 'x',
      anchorCoarseSpanId: spans[i]!.id,
      originSpanId: s.spanId,
      syllableStart: s.syllableStart,
      syllableEnd: s.syllableEnd,
      rawStart: s.rawStart,
      rawEnd: s.rawEnd,
    })
  );

  const baseRetryArgs = {
    decisions,
    anchors: [] as const,
    pathFineSpans,
    retainedDomains: [] as string[],
    rawText: 'ABCD',
    globalSyllables: ['a', 'b', 'c', 'd'],
  };

  it('T9 candidate independence: evidence maps without surviving candidates', async () => {
    const evidence = [
      ev({ pinyinKey: 'nei|ke', syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 }),
    ];
    const recall = jest.fn(async ({ syllables, windowPinyinKey }) => {
      expect(syllables.join('|')).toBe(windowPinyinKey);
      return [];
    });
    await routeModel3Retry({
      ...baseRetryArgs,
      activeCandidates: [],
      retainedDomains: ['domain_x'],
      recallQueryEvidence: evidence,
      recall,
    });
    expect(recall).toHaveBeenCalled();
    const mappedCalls = recall.mock.calls.filter(
      (c) => (c[0] as { syllables: string[] }).syllables.join('|') === 'nei|ke'
    );
    expect(mappedCalls.length).toBeGreaterThan(0);
  });

  it('T10 path-local retainedDomains with evidence pinyin', async () => {
    const recall = jest.fn(async ({ retainedDomains }) => {
      expect(retainedDomains).toEqual(['path_domain_only']);
      return [];
    });
    await routeModel3Retry({
      ...baseRetryArgs,
      activeCandidates: active,
      retainedDomains: ['path_domain_only'],
      recallQueryEvidence: [
        ev({ pinyinKey: 'nei|ke', syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 }),
      ],
      recall,
    });
    expect(recall).toHaveBeenCalled();
    const mappedCalls = recall.mock.calls.filter(
      (c) => (c[0] as { syllables: string[] }).syllables.join('|') === 'nei|ke'
    );
    expect(mappedCalls.length).toBeGreaterThan(0);
  });

  it('T11 WRONG_PROFILE evidence may map without special gate', async () => {
    const recall = jest.fn(async () => []);
    await routeModel3Retry({
      ...baseRetryArgs,
      activeCandidates: active,
      recallQueryEvidence: [
        ev({ pinyinKey: 'wrong|py', syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 }),
      ],
      recall,
    });
    expect(recall).toHaveBeenCalled();
    const mappedCalls = recall.mock.calls.filter(
      (c) => (c[0] as { syllables: string[] }).syllables.join('|') === 'wrong|py'
    );
    expect(mappedCalls.length).toBeGreaterThan(0);
  });

  it('T12 compound residual does not fabricate target without evidence', async () => {
    const recall = jest.fn(async ({ syllables }) => {
      // No evidence → ASR syllables only; never invent 换乘/牛肉串/礼宾员 targets.
      expect(syllables.join('|')).not.toBe('huan|cheng');
      expect(syllables.join('|')).not.toBe('niu|rou|chuan');
      expect(syllables.join('|')).not.toBe('li|bin|yuan');
      return [];
    });
    await routeModel3Retry({
      ...baseRetryArgs,
      activeCandidates: active,
      recallQueryEvidence: [],
      recall,
    });
    expect(recall).toHaveBeenCalled();
    for (const call of recall.mock.calls) {
      const arg = call[0] as { syllables: string[]; windowPinyinKey: string };
      expect(arg.windowPinyinKey).toBe(arg.syllables.join('|'));
      expect(['a', 'b', 'c', 'd'].join('|')).toContain(arg.syllables[0]!);
    }
  });

  it('T14 one Stage2 window → at most one recall invocation', async () => {
    const recall = jest.fn(async () => []);
    const path2 = coarseSpansAsPathFineSpansForTests([makeSpan('c0', 'AB', 0)]);
    await routeModel3Retry({
      ...baseRetryArgs,
      activeCandidates: [
        wc({
          candidateId: 'b0',
          replacement: 'x',
          anchorCoarseSpanId: 'c0',
          originSpanId: path2[0]!.spanId,
          syllableStart: 0,
          syllableEnd: 2,
          rawStart: 0,
          rawEnd: 2,
        }),
      ],
      rawText: 'AB',
      globalSyllables: ['a', 'b'],
      pathFineSpans: path2,
      decisions: [{ spanId: path2[0]!.spanId, decision: 'RETRY', eligible: true }],
      recallQueryEvidence: [
        ev({ pinyinKey: 'nei|ke', syllableStart: 0, syllableEnd: 2, rawStart: 0, rawEnd: 2 }),
      ],
      recall,
    });
    const byWindow = new Map<string, number>();
    for (const call of recall.mock.calls) {
      const arg = call[0] as {
        local: { syllableStart: number; syllableEnd: number };
        syllables: string[];
        windowPinyinKey: string;
      };
      expect(arg.windowPinyinKey).toBe(arg.syllables.join('|'));
      const k = `${arg.local.syllableStart}:${arg.local.syllableEnd}`;
      byWindow.set(k, (byWindow.get(k) ?? 0) + 1);
    }
    expect(byWindow.size).toBeGreaterThan(0);
    for (const n of byWindow.values()) {
      expect(n).toBeLessThanOrEqual(1);
    }
  });
});
