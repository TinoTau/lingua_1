import { recallSpanTopK } from '../../lexicon/local-span-recall';
import type { ActiveLexiconProfileSnapshot } from '../../session-runtime/types';
import type { FwSpanDiagnostics, PinyinImeV2ActiveDiagnostics } from '../types';
import { loadPinyinImeV2Dictionaries } from './pinyin-ime-v2-dict-load';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig } from './pinyin-ime-v2-types';
import { loadPinyinImeV2RuntimeConfig } from './pinyin-ime-v2-config';
import { mapApprovedSpansToFwSpans } from './map-approved-span-to-fw';
import { runPinyinImeV2HintGate } from './pinyin-ime-v2-hint-gate';
import { runPinyinImeV2SpanProposal } from './run-pinyin-ime-v2-span-proposal';

export type { PinyinImeV2ActiveDiagnostics } from '../types';

export type PinyinImeV2SpanResolution = {
  spans: FwSpanDiagnostics[];
  pinyinImeV2: PinyinImeV2ActiveDiagnostics;
};

let cachedDict: { dictDir: string; dict: PinyinImeV2Dict } | null = null;

export function resetPinyinImeV2DictCacheForTest(): void {
  cachedDict = null;
}

function getImeDict(config: PinyinImeV2RuntimeConfig): PinyinImeV2Dict {
  if (cachedDict && cachedDict.dictDir === config.dictDir) {
    return cachedDict.dict;
  }
  const dict = loadPinyinImeV2Dictionaries(config.dictDir, {
    enabledDomains: config.enabledDomains,
  });
  cachedDict = { dictDir: config.dictDir, dict };
  return dict;
}

function createLexiconNearNeighborProbe(
  profile: ActiveLexiconProfileSnapshot,
  minPrior: number,
  enabledDomains: string[]
): (rawSpan: string) => boolean {
  return (rawSpan: string) => {
    const recall = recallSpanTopK(rawSpan, profile, 1, minPrior, enabledDomains);
    return recall.hits.length > 0 && recall.skippedReason === undefined;
  };
}

export type ResolvePinyinImeV2SpansInput = {
  rawText: string;
  profile: ActiveLexiconProfileSnapshot;
  enabledDomains: string[];
  minPrior: number;
  imeConfig?: PinyinImeV2RuntimeConfig;
};

/**
 * Active-path span discovery: IME proposal → HintGate → FwSpanDiagnostics.
 */
export function resolvePinyinImeV2Spans(input: ResolvePinyinImeV2SpansInput): PinyinImeV2SpanResolution {
  const imeConfig = input.imeConfig ?? loadPinyinImeV2RuntimeConfig();
  const emptyDiag = (overrides: Partial<PinyinImeV2ActiveDiagnostics>): PinyinImeV2ActiveDiagnostics => ({
    enabled: true,
    candidateCount: 0,
    diffSpanCount: 0,
    instabilityRegionCount: 0,
    approvedSpanCount: 0,
    normalizerDroppedCount: 0,
    gateDroppedNoNeighbor: 0,
    gateDroppedSupport: 0,
    decodeMs: 0,
    ...overrides,
  });

  if (!imeConfig.enabled) {
    return {
      spans: [],
      pinyinImeV2: emptyDiag({ skippedReason: 'no_approved_spans' }),
    };
  }

  let dict: PinyinImeV2Dict;
  try {
    dict = getImeDict(imeConfig);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      spans: [],
      pinyinImeV2: emptyDiag({
        skippedReason: 'ime_dict_unavailable',
        loadError: message,
      }),
    };
  }

  const proposal = runPinyinImeV2SpanProposal({
    rawAsrText: input.rawText,
    dict,
    config: { topK: imeConfig.topK },
  });

  if (proposal.diagnostics.candidateCount === 0) {
    return {
      spans: [],
      pinyinImeV2: emptyDiag({
        skippedReason: proposal.candidates.length === 0 ? 'no_cjk' : 'no_candidates',
        decodeMs: proposal.diagnostics.decode.decodeMs,
      }),
    };
  }

  const hintGate = runPinyinImeV2HintGate({
    rawAsrText: input.rawText,
    diffSpans: proposal.diffSpans,
    instabilityRegions: proposal.instabilityRegions,
    boundaryCompatibleTopKSpans: proposal.boundaryCompatibleTopKSpans,
    config: imeConfig,
    lexiconNearNeighbor: createLexiconNearNeighborProbe(
      input.profile,
      input.minPrior,
      input.enabledDomains
    ),
  });

  const spans = mapApprovedSpansToFwSpans(hintGate.approved);

  return {
    spans,
    pinyinImeV2: {
      enabled: true,
      candidateCount: proposal.diagnostics.candidateCount,
      diffSpanCount: proposal.diagnostics.diffSpanCount,
      instabilityRegionCount: proposal.diagnostics.instabilityRegionCount,
      approvedSpanCount: hintGate.diagnostics.approvedSpanCount,
      normalizerDroppedCount: hintGate.diagnostics.normalizerDroppedCount,
      gateDroppedNoNeighbor: hintGate.diagnostics.gateDroppedNoNeighbor,
      gateDroppedSupport: hintGate.diagnostics.gateDroppedSupport,
      decodeMs: proposal.diagnostics.decode.decodeMs,
      traditionalCharCount: proposal.diagnostics.traditionalCharCount,
      openccConvertedCount: proposal.diagnostics.openccConvertedCount,
      normalizedCharCount: proposal.diagnostics.normalizedCharCount,
      rawBoundaryCount: proposal.diagnostics.rawBoundaryCount,
      rawBoundaryMatchedTopKCount: proposal.diagnostics.rawBoundaryMatchedTopKCount,
      boundaryCompatibilityScoreMax: proposal.diagnostics.boundaryCompatibilityScoreMax,
      boundaryCompatibilityScoreAvg: proposal.diagnostics.boundaryCompatibilityScoreAvg,
      trustedTopKCount: proposal.diagnostics.trustedTopKCount,
      boundaryCompatibleTopKSpanCount: proposal.diagnostics.boundaryCompatibleTopKSpanCount,
      diffZeroBoundaryPositive: proposal.diagnostics.diffZeroBoundaryPositive,
      skippedReason: spans.length === 0 ? 'no_approved_spans' : undefined,
    },
  };
}
