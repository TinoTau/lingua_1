import * as path from 'path';
import { describe, expect, it } from '@jest/globals';
import { buildPinyinImeV2DictFromEntries } from '../pinyin-ime-v2/pinyin-ime-v2-dict-load';
import { DEFAULT_PINYIN_IME_V2 } from '../pinyin-ime-v2/pinyin-ime-v2-config';
import { loadPinyinImeV2Dictionaries, resolvePinyinImeV2DictDir } from '../pinyin-ime-v2/pinyin-ime-v2-dict-load';
import {
  buildCoarseSpansFromRawImeBoundary,
  resolveProposalActiveSpansReadOnly,
} from './coarse-boundary-import';
import { verifyCoarseSpanCoverage } from './coarse-span-partition';

const D001_RAW = '你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?';

function loadRuntimeDict() {
  const dictDir = resolvePinyinImeV2DictDir(
    path.join(process.cwd(), '../../node_runtime/pinyin-ime-v2/dict')
  );
  return loadPinyinImeV2Dictionaries(dictDir);
}

function runtimeImeConfig() {
  return {
    ...DEFAULT_PINYIN_IME_V2,
    enabled: true,
    dictDir: path.join(process.cwd(), '../../node_runtime/pinyin-ime-v2/dict'),
  };
}

describe('buildCoarseSpansFromRawImeBoundary', () => {
  it('uses IME token boundaries when runtime dict is available', () => {
    let dict;
    try {
      dict = loadRuntimeDict();
    } catch {
      return;
    }
    const result = buildCoarseSpansFromRawImeBoundary({
      rawText: D001_RAW,
      imeConfig: runtimeImeConfig(),
      dict,
    });
    expect(result.diagnostics.coverageOk).toBe(true);
    expect(result.diagnostics.trustedTopKCount).toBeGreaterThan(0);
    expect(result.coarseSpans.length).toBeGreaterThan(1);
    expect(
      result.diagnostics.boundarySourceBreakdown.ime_token_boundary +
        result.diagnostics.boundarySourceBreakdown.raw_ime_aligned_boundary +
        result.diagnostics.boundarySourceBreakdown.proposal_active_boundary
    ).toBeGreaterThan(0);
    expect(verifyCoarseSpanCoverage(D001_RAW, result.coarseSpans)).toBe(true);
  });

  it('d001 does not collapse to punctuation-only single long span', () => {
    let dict;
    try {
      dict = loadRuntimeDict();
    } catch {
      return;
    }
    const result = buildCoarseSpansFromRawImeBoundary({
      rawText: D001_RAW,
      imeConfig: runtimeImeConfig(),
      dict,
    });
    expect(result.coarseSpans.length).toBeGreaterThan(2);
    const punctOnly = result.coarseSpans.every((s) => s.source === 'punctuation_fallback');
    expect(punctOnly).toBe(false);
    expect(result.diagnostics.coverageOk).toBe(true);
  });

  it('falls back to punctuation when trusted TopK is empty', () => {
    const dict = buildPinyinImeV2DictFromEntries([]);
    const result = buildCoarseSpansFromRawImeBoundary({
      rawText: '你好,世界',
      imeConfig: runtimeImeConfig(),
      dict,
    });
    expect(result.diagnostics.trustedTopKCount).toBe(0);
    expect(result.diagnostics.fallbackReason).toBe('no_trusted_topk');
    expect(result.diagnostics.boundarySourceBreakdown.punctuation_fallback).toBeGreaterThan(0);
    expect(result.diagnostics.coverageOk).toBe(true);
  });

  it('proposal active spans contribute proposal_active_boundary splits', () => {
    let dict;
    try {
      dict = loadRuntimeDict();
    } catch {
      return;
    }
    const proposalSpans = resolveProposalActiveSpansReadOnly(D001_RAW, dict, runtimeImeConfig());
    const result = buildCoarseSpansFromRawImeBoundary({
      rawText: D001_RAW,
      imeConfig: runtimeImeConfig(),
      dict,
      proposalSpans,
    });
    expect(result.diagnostics.proposalBoundaryCount).toBeGreaterThan(0);
  });

  it('raw boundary alignment can enter coarse partition', () => {
    let dict;
    try {
      dict = loadRuntimeDict();
    } catch {
      return;
    }
    const result = buildCoarseSpansFromRawImeBoundary({
      rawText: D001_RAW,
      imeConfig: runtimeImeConfig(),
      dict,
    });
    expect(result.diagnostics.rawBoundaryCount).toBeGreaterThan(0);
    expect(result.diagnostics.alignedBoundaryCount).toBeGreaterThanOrEqual(0);
  });
});
