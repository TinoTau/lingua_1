/**
 * MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION — snapshot hash / mutation / symmetry unit tests.
 * No Model3 host required.
 */

import {
  buildAcceptanceHashPayload,
  canonicalJson,
  hashAcceptanceUpstream,
  hashPackedOnly,
  keepOverrideFromPacked,
  sha256Canonical,
  type Model3AcceptancePackedSpan,
} from './model3-acceptance-snapshot';
import type { Model3SpanDecision } from './model3-types';
import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';
import type { WindowCandidate } from '../fw-detector/span-assembly-v4/v4-types';

function makeSpan(id: string, start: number, end: number, surface: string): PathFineSpan {
  return {
    spanId: id,
    coarseSpanIds: ['c0'],
    rawStart: start,
    rawEnd: end,
    syllableStart: start,
    syllableEnd: end,
    windowSource: 'in_span_window',
    candidates: [],
  } as unknown as PathFineSpan;
}

function makeCand(id: string, replacement: string): WindowCandidate {
  return {
    candidateId: id,
    windowId: 'w0',
    windowSource: 'in_span_window',
    anchorCoarseSpanId: 'c0',
    syllableStart: 0,
    syllableEnd: 1,
    rawStart: 0,
    rawEnd: 1,
    windowPinyinKey: 'x',
    candidateScore: 1,
    score: 1,
    boundaryPenalty: 0,
    candidateRank: 0,
    hitKind: 'exact_term',
    replacement,
    source: 'base_term',
    recallSource: 'exact',
    repairTarget: false,
  } as unknown as WindowCandidate;
}

function makePacked(spanId: string, decision: 'KEEP' | 'RETRY' = 'RETRY'): Model3SpanDecision {
  return {
    spanId,
    decision,
    eligible: true,
    isAnchor: false,
    surface: '测',
    rawStart: 0,
    rawEnd: 1,
    seqIndex: 0,
    tokenIds: [1, 2, 3, 4, 5, 6, 7, 8],
    featVector: [0, 0.69, 0.5, 0.69, 0.69, 1],
    availMask: [1, 1, 1, 1, 1, 1],
    features: {
      isAnchor: 0,
      span_len_log1p: 0.69,
      span_rel_position: 0.5,
      first_pass_cand_log1p: 0.69,
      current_cjk_len_log1p: 0.69,
      pinyin_channel_avail: 1,
    },
    rawFirstPassCandidateCount: 1,
    rawPinyinChannelAvail: true,
  };
}

describe('model3-acceptance-snapshot', () => {
  const raw = '测试文本';
  const spans = [makeSpan('fine:a:0', 0, 1, '测'), makeSpan('fine:a:1', 1, 2, '试')];
  const cands = [makeCand('c1', '测'), makeCand('c2', '试')];
  const packed = [makePacked('fine:a:0'), makePacked('fine:a:1', 'KEEP')];

  it('canonicalJson sorts keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('snapshot hash is stable across identical payloads', () => {
    const p1 = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathId: 'p0',
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: ['cafe', 'general'],
      anchors: [],
      packedDecisions: packed,
    });
    const p2 = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathId: 'p0',
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: ['general', 'cafe'],
      anchors: [],
      packedDecisions: packed,
    });
    expect(hashAcceptanceUpstream(p1)).toBe(hashAcceptanceUpstream(p2));
  });

  it('mutation gate: changed rawAsr changes hash', () => {
    const base = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [],
      packedDecisions: packed,
    });
    const mut = buildAcceptanceHashPayload({
      rawAsrText: '其它文本',
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [],
      packedDecisions: packed,
    });
    expect(hashAcceptanceUpstream(base)).not.toBe(hashAcceptanceUpstream(mut));
  });

  it('mutation gate: changed FineSpan offset changes hash', () => {
    const base = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [],
      packedDecisions: packed,
    });
    const mutSpans = [makeSpan('fine:a:0', 0, 2, '测试'), spans[1]!];
    const mut = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathFineSpans: mutSpans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [],
      packedDecisions: packed,
    });
    expect(hashAcceptanceUpstream(base)).not.toBe(hashAcceptanceUpstream(mut));
  });

  it('mutation gate: changed feature vector changes packed hash', () => {
    const a: Model3AcceptancePackedSpan[] = [
      {
        spanId: 's0',
        surface: 'x',
        isAnchor: false,
        rawStart: 0,
        rawEnd: 1,
        seqIndex: 0,
        tokenIds: [1],
        featVector: [0, 1, 0, 0, 0, 1],
        availMask: [1, 1, 1, 1, 1, 1],
        features: null,
        rawFirstPassCandidateCount: 0,
        rawPinyinChannelAvail: true,
      },
    ];
    const b = [{ ...a[0]!, featVector: [0, 2, 0, 0, 0, 1] }];
    expect(hashPackedOnly(a)).not.toBe(hashPackedOnly(b));
  });

  it('mutation gate: changed Anchor changes hash', () => {
    const base = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [],
      packedDecisions: packed,
    });
    const mut = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [
        {
          spanId: 'fine:a:0',
          surface: '测',
          rawStart: 0,
          rawEnd: 1,
          source: 'MODEL2',
        },
      ],
      packedDecisions: packed,
    });
    expect(hashAcceptanceUpstream(base)).not.toBe(hashAcceptanceUpstream(mut));
  });

  it('keepOverride preserves packed tensors and forces KEEP', () => {
    const kept = keepOverrideFromPacked(packed, new Set());
    expect(kept.every((d) => d.decision === 'KEEP')).toBe(true);
    expect(kept[0]!.tokenIds).toEqual(packed[0]!.tokenIds);
    expect(kept[0]!.featVector).toEqual(packed[0]!.featVector);
    expect(kept[0]!.features).toEqual(packed[0]!.features);
    // Isolation: mutating override copy does not mutate original
    kept[0]!.featVector![0] = 99;
    expect(packed[0]!.featVector![0]).toBe(0);
  });

  it('baseline and s3 packed hashes equal when same packed decisions', () => {
    const payload = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [],
      packedDecisions: packed,
    });
    const baselineDec = keepOverrideFromPacked(packed, new Set());
    const baselinePayload = buildAcceptanceHashPayload({
      rawAsrText: raw,
      pathFineSpans: spans,
      activeCandidates: cands,
      retainedDomains: [],
      anchors: [],
      packedDecisions: baselineDec,
    });
    // Decision label differs but packed tensors must match for symmetry gate
    expect(hashPackedOnly(payload.packedSpans)).toBe(
      hashPackedOnly(baselinePayload.packedSpans)
    );
  });

  it('sha256Canonical is deterministic', () => {
    expect(sha256Canonical({ z: 1, a: [2, 3] })).toBe(sha256Canonical({ a: [2, 3], z: 1 }));
  });
});
