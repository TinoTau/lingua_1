export type {
  BoundaryAlignmentScore,
  LexiconNearNeighborProbe,
  LocalRawImeDiffBuildDiagnostics,
  LocalRawImeDiffExampleSpan,
  PinyinImeV2Candidate,
  PinyinImeV2DecodeDiagnostics,
  PinyinImeV2DiffSpan,
  PinyinImeV2Dict,
  PinyinImeV2DictEntry,
  PinyinImeV2DictEntrySource,
  PinyinImeV2Token,
  PinyinImeV2InstabilityRegion,
  PinyinImeV2ProposalDiagnostics,
  PinyinImeV2RuntimeConfig,
  PinyinImeV2SelectedSpan,
  PinyinImeV2SelectedSpanReason,
  PinyinImeV2SpanSelectorDiagnostics,
  PinyinImeV2SpanSelectorInput,
  PinyinImeV2SpanSelectorResult,
  PinyinImeV2SpanSelectionMode,
  PinyinImeV2SpanProposal,
} from './pinyin-ime-v2-types';

export { loadPinyinImeV2RuntimeConfig, DEFAULT_PINYIN_IME_V2 } from './pinyin-ime-v2-config';
export {
  buildPinyinImeV2DictFromEntries,
  defaultPinyinImeV2DictDir,
  resolvePinyinImeV2DictDir,
  loadPinyinImeV2Dictionaries,
} from './pinyin-ime-v2-dict-load';
export { decodeRawTextTopK, decodeSyllablesTopK } from './pinyin-ime-v2-decoder';
export {
  buildLocalRawImeDiffSpans,
  shouldActivateLocalRawImeDiffFallback,
} from './pinyin-ime-v2-local-raw-ime-diff';
export type { LocalRawImeDiffBuildResult, LocalRawImeDiffInput } from './pinyin-ime-v2-local-raw-ime-diff';
export { diffReplacementSpans, collectDiffSpansFromCandidates } from './pinyin-ime-v2-diff-spans';
export { buildInstabilityRegions, aggregateDiffSpanSupport } from './pinyin-ime-v2-instability';
export { applyBoundaryDiscovery } from './pinyin-ime-v2-boundary';
export {
  normalizeForImeAlignment,
  normalizeTraditionalChinese,
  mapNormalizedSpanToRaw,
  resetOpenccConverterForTest,
} from './normalize-for-ime-alignment';
export type { NormalizedText } from './normalize-for-ime-alignment';
export { extractRawCoarseBoundaries } from './extract-raw-coarse-boundaries';
export {
  BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD,
  BOUNDARY_SYLLABLE_MATCH_TOLERANCE,
  computeBoundaryAlignmentDiagnostics,
  scoreBoundaryAlignmentForCandidate,
} from './pinyin-ime-v2-boundary-align';
export {
  buildBoundaryCompatibleTopKDiff,
  selectTrustedTopKCandidates,
  countTokenSourceConflictDiagnostic,
} from './pinyin-ime-v2-boundary-compatible-topk-diff';
export type { BoundaryCompatibleTopKSpan } from './pinyin-ime-v2-boundary-compatible-topk-diff';
export type { RawBoundary, RawBoundaryKind } from './extract-raw-coarse-boundaries';
export { normalizePinyinImeV2Spans } from './pinyin-ime-v2-span-normalizer';
export { selectPinyinImeV2Spans } from './pinyin-ime-v2-span-selector';
export { mapSelectedSpanToFwSpan, mapSelectedSpansToFwSpans } from './map-selected-span-to-fw';
export { runPinyinImeV2SpanProposal } from './run-pinyin-ime-v2-span-proposal';
export { resolvePinyinImeV2Spans, resetPinyinImeV2DictCacheForTest } from './resolve-pinyin-ime-v2-spans';
export type { PinyinImeV2SpanResolution } from './resolve-pinyin-ime-v2-spans';
