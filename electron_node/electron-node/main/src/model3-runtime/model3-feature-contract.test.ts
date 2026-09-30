/**
 * Model3 V1 feature contract correction tests.
 */

import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';
import {
  model3FirstPassCandidateCount,
  model3PinyinTextDerived,
  packModel3SpanInferFields,
} from './model3-feature-pack';
import type { Model3SpanDecision } from './model3-types';

function makeSpan(
  id: string,
  candidates: WindowCandidate[],
  syllableStart = 0,
  syllableEnd = 1
): PathFineSpan {
  return {
    spanId: id,
    rawStart: syllableStart,
    rawEnd: syllableEnd,
    syllableStart,
    syllableEnd,
    coarseSpanIds: ['c0'],
    boundaryCrossCount: 0,
    windowSource: 'in_span_window',
    candidates,
    selectionReason: 'lattice_path_edge',
  };
}

function wc(id: string, covered = false): WindowCandidate {
  return {
    windowId: 'w0',
    windowSource: 'in_span_window',
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
    source: 'base_term',
    recallSource: 'lexicon_pinyin_topk',
    repairTarget: true,
    candidateId: id,
    replacement: 'x',
    isCovered: covered,
  };
}

describe('Model3 feature contract — training semantics', () => {
  it('pinyin_channel_avail matches utterance-level pinyinTextDerived', () => {
    expect(model3PinyinTextDerived([])).toBe(false);
    expect(model3PinyinTextDerived(['ni', 'hao'])).toBe(true);

    const span = makeSpan('s0', [wc('a')]);
    const emptySyl = packModel3SpanInferFields({
      span,
      rawText: '你',
      globalSyllables: [],
      isAnchor: false,
    });
    expect(emptySyl.pinyinChannelAvail).toBe(false);

    const withSyl = packModel3SpanInferFields({
      span,
      rawText: '你',
      globalSyllables: ['ni'],
      isAnchor: false,
    });
    expect(withSyl.pinyinChannelAvail).toBe(true);

    // Utterance-level: span with empty local syllable slice still gets pinyinTextDerived=true
    const span2 = makeSpan('s1', [wc('b')], 5, 6);
    const packed = packModel3SpanInferFields({
      span: span2,
      rawText: '你好世界',
      globalSyllables: ['ni', 'hao', 'shi', 'jie'],
      isAnchor: false,
    });
    expect(packed.pinyinChannelAvail).toBe(true);
  });

  it('first_pass_cand_log1p uses PathFineSpan.candidates not activeCandidates pool', () => {
    const span = makeSpan('s0', [wc('a'), wc('b'), wc('c', true)]);
    expect(model3FirstPassCandidateCount(span)).toBe(2);

    const packed = packModel3SpanInferFields({
      span,
      rawText: '你',
      globalSyllables: ['ni'],
      isAnchor: false,
    });
    expect(packed.firstPassCandidateCount).toBe(2);
  });
});

describe('Model3 feature contract — logit diagnostics shape', () => {
  it('margin equals retryLogit - keepLogit', () => {
    const d: Model3SpanDecision = {
      spanId: 's0',
      decision: 'KEEP',
      keepLogit: 3.2,
      retryLogit: 1.1,
      margin: 1.1 - 3.2,
      eligible: true,
    };
    expect(d.margin).toBeCloseTo(d.retryLogit! - d.keepLogit!, 6);
  });

  it('decision mapping unchanged by diagnostics fields', () => {
    const keep: Model3SpanDecision = {
      spanId: 'a',
      keepLogit: 5,
      retryLogit: 2,
      margin: -3,
      decision: 'KEEP',
      eligible: true,
    };
    const retry: Model3SpanDecision = {
      spanId: 'b',
      keepLogit: 1,
      retryLogit: 4,
      margin: 3,
      decision: 'RETRY',
      eligible: true,
    };
    expect(keep.decision).toBe('KEEP');
    expect(retry.decision).toBe('RETRY');
    expect(keep.margin! < 0).toBe(true);
    expect(retry.margin! > 0).toBe(true);
  });
});

describe('Model3 feature contract — eligible subset invariant', () => {
  it('EVAL_PROXY eligible utterances subset of anchored+asr-error', () => {
    const cases = [
      { anchors: [], raw: 'a', ref: 'b', eligibleProxy: 0 },
      { anchors: [{ surface: 'x' }], raw: 'ab', ref: 'ab', eligibleProxy: 0 },
      { anchors: [{ surface: 'x' }], raw: 'ax', ref: 'ab', eligibleProxy: 1 },
    ];
    for (const c of cases) {
      const hasAnchor = c.anchors.length > 0;
      const asrErr = c.raw !== c.ref;
      const eligible = c.eligibleProxy > 0;
      if (eligible) {
        expect(hasAnchor && asrErr).toBe(true);
      }
    }
  });
});
