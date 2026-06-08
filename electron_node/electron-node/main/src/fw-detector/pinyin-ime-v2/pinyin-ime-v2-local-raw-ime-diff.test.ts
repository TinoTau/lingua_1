import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { applyBoundaryDiscovery } from './pinyin-ime-v2-boundary';
import { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } from './pinyin-ime-v2-dict-load';
import { mapSelectedSpansToFwSpans } from './map-selected-span-to-fw';
import {
  buildLocalRawImeDiffSpans,
  shouldActivateLocalRawImeDiffFallback,
} from './pinyin-ime-v2-local-raw-ime-diff';
import { normalizePinyinImeV2Spans } from './pinyin-ime-v2-span-normalizer';
import { runPinyinImeV2SpanProposal } from './run-pinyin-ime-v2-span-proposal';
import { DEFAULT_PINYIN_IME_V2 } from './pinyin-ime-v2-config';
import type { BoundaryAlignmentScore, PinyinImeV2Candidate } from './pinyin-ime-v2-types';

const D001_RAW =
  '你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?';

function alignmentScore(rank: number, compat = 0.8): BoundaryAlignmentScore {
  return {
    candidateRank: rank,
    matchedBoundaryCount: 1,
    conflictedBoundaryCount: 0,
    compatibilityScore: compat,
  };
}

function loadRuntimeDict() {
  const dictDir = resolvePinyinImeV2DictDir(
    path.join(process.cwd(), '../../node_runtime/pinyin-ime-v2/dict')
  );
  return loadPinyinImeV2Dictionaries(dictDir);
}

describe('shouldActivateLocalRawImeDiffFallback', () => {
  it('activates only when all evaluated candidates align-failed', () => {
    expect(shouldActivateLocalRawImeDiffFallback(5, 5, 5)).toBe(true);
    expect(shouldActivateLocalRawImeDiffFallback(2, 2, 5)).toBe(true);
    expect(shouldActivateLocalRawImeDiffFallback(3, 5, 5)).toBe(false);
    expect(shouldActivateLocalRawImeDiffFallback(0, 0, 5)).toBe(false);
  });
});

describe('buildLocalRawImeDiffSpans', () => {
  it('T1: emits diff span when raw slice differs from token word', () => {
    const candidates: PinyinImeV2Candidate[] = [
      {
        text: 'x',
        score: 1,
        rank: 1,
        tokens: [{ word: '中杯', syllableStart: 10, syllableEnd: 12, source: 'target' }],
      },
    ];
    const { spans, diagnostics } = buildLocalRawImeDiffSpans({
      rawAsrText: D001_RAW,
      candidates,
      alignmentScores: [alignmentScore(1)],
    });
    expect(spans.some((s) => s.rawSpan === '钟贝' && s.start === 11 && s.end === 13)).toBe(true);
    expect(diagnostics.localRawImeDiffSpanCount).toBeGreaterThanOrEqual(1);
    expect(spans.every((s) => !('imeWord' in s))).toBe(true);
  });

  it('T11: returns empty spans when trusted set is empty', () => {
    const { spans, diagnostics } = buildLocalRawImeDiffSpans({
      rawAsrText: D001_RAW,
      candidates: [{ text: 'x', score: 1, rank: 1, tokens: [] }],
      alignmentScores: [alignmentScore(1, 0.1)],
    });
    expect(spans).toEqual([]);
    expect(diagnostics.localRawImeDiffTrustedCandidateCount).toBe(0);
  });
});

describe('runPinyinImeV2SpanProposal local raw-ime diff', () => {
  const dict = loadRuntimeDict();

  it('T2/T3: d001 activates fallback with 钟贝 span', () => {
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: D001_RAW,
      dict,
      config: { topK: 5 },
    });
    expect(proposal.diagnostics.localRawImeDiffActivated).toBe(1);
    expect(proposal.diagnostics.localRawImeDiffSpanCount).toBeGreaterThanOrEqual(2);
    expect(proposal.diagnostics.diffSpanCount).toBeGreaterThanOrEqual(2);
    expect(proposal.diffSpans.some((s) => s.rawSpan === '钟贝')).toBe(true);
    expect(proposal.diagnostics.localRawImeDiffExampleSpans.some((e) => e.rawSlice === '钟贝')).toBe(
      true
    );
  });

  it('T4: d001 normalized spans cover 蓝美马分 region', () => {
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: D001_RAW,
      dict,
      config: { topK: 5 },
    });
    const normalized = normalizePinyinImeV2Spans(
      D001_RAW,
      proposal.diffSpans,
      proposal.instabilityRegions,
      proposal.boundaryCompatibleTopKSpans,
      DEFAULT_PINYIN_IME_V2
    );
    const coversLanmei = normalized.spans.some(
      (s) => s.start <= 25 && s.end >= 29 && s.rawSpan.includes('马分')
    );
    expect(coversLanmei).toBe(true);
  });

  it('T5: d002 does not activate local fallback', () => {
    const raw = '麻烦帮我做一杯美食带走大悲就行谢谢';
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: raw,
      dict,
      config: { topK: 5 },
    });
    expect(proposal.diagnostics.localRawImeDiffActivated).toBe(0);
    expect(proposal.diagnostics.alignFailedCount).toBeLessThan(proposal.candidates.length);
    expect(proposal.diffSpans.length).toBeGreaterThan(0);
  });

  it('T6: d003 normalized span count does not decrease', () => {
    const raw = '请问,这款燕麦拿铁可以少病吗?我赶时间小背';
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: raw,
      dict,
      config: { topK: 5 },
    });
    const withLocal = normalizePinyinImeV2Spans(
      raw,
      proposal.diffSpans,
      proposal.instabilityRegions,
      proposal.boundaryCompatibleTopKSpans,
      DEFAULT_PINYIN_IME_V2
    );
    const withoutLocal = normalizePinyinImeV2Spans(
      raw,
      [],
      proposal.instabilityRegions,
      proposal.boundaryCompatibleTopKSpans,
      DEFAULT_PINYIN_IME_V2
    );
    expect(withLocal.spans.length).toBeGreaterThanOrEqual(withoutLocal.spans.length);
  });

  it('T7: imeWord stays in diagnostics only', () => {
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: D001_RAW,
      dict,
      config: { topK: 5 },
    });
    expect(proposal.diagnostics.localRawImeDiffExampleSpans.some((e) => e.imeWord === '中杯')).toBe(
      true
    );
    const fwSpans = mapSelectedSpansToFwSpans(
      proposal.diffSpans.map((s) => ({
        rawSpan: s.rawSpan,
        start: s.start,
        end: s.end,
        confidence: 0.8,
        reason: 'ime_v2_diff' as const,
      }))
    );
    for (const span of fwSpans) {
      expect(span.text).not.toBe('中杯');
      expect(JSON.stringify(span)).not.toContain('imeWord');
    }
  });

  it('T10: 钟贝 span survives boundary snap', () => {
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: D001_RAW,
      dict,
      config: { topK: 5 },
    });
    const zhongbei = proposal.diffSpans.find((s) => s.rawSpan === '钟贝');
    expect(zhongbei).toBeDefined();
    expect(zhongbei!.start).toBeLessThanOrEqual(11);
    expect(zhongbei!.end).toBeGreaterThanOrEqual(13);
  });

  it('T9: partial alignFailed keeps sentence diff path (d002 all align succeed)', () => {
    const raw = '麻烦帮我做一杯美食带走大悲就行谢谢';
    const proposal = runPinyinImeV2SpanProposal({
      rawAsrText: raw,
      dict,
      config: { topK: 5 },
    });
    expect(proposal.diagnostics.localRawImeDiffActivated).toBe(0);
    expect(proposal.diagnostics.alignFailedCount).toBe(0);
    expect(proposal.diffSpans.length).toBeGreaterThan(0);
  });
});

describe('applyBoundaryDiscovery T10 unit', () => {
  it('keeps 钟贝 coordinates on d001 raw text', () => {
    const bounded = applyBoundaryDiscovery(
      D001_RAW,
      [{ rawSpan: '钟贝', start: 11, end: 13, candidateRank: 1, supportCount: 5 }],
      []
    );
    expect(bounded.diffSpans[0].rawSpan).toBe('钟贝');
    expect(bounded.diffSpans[0].start).toBe(11);
    expect(bounded.diffSpans[0].end).toBe(13);
  });
});
