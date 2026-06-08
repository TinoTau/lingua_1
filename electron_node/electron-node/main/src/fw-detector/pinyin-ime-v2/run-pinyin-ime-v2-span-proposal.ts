import { applyBoundaryDiscovery } from './pinyin-ime-v2-boundary';
import { computeBoundaryAlignmentDiagnostics } from './pinyin-ime-v2-boundary-align';
import { buildBoundaryCompatibleTopKDiff } from './pinyin-ime-v2-boundary-compatible-topk-diff';
import { decodeRawTextTopK } from './pinyin-ime-v2-decoder';
import { collectDiffSpansFromCandidates } from './pinyin-ime-v2-diff-spans';
import { emptyProposalDiagnostics } from './pinyin-ime-v2-diagnostics';
import {
  buildLocalRawImeDiffSpans,
  shouldActivateLocalRawImeDiffFallback,
} from './pinyin-ime-v2-local-raw-ime-diff';
import { extractRawCoarseBoundaries } from './extract-raw-coarse-boundaries';
import { normalizeForImeAlignment } from './normalize-for-ime-alignment';
import type { PinyinImeV2Dict, PinyinImeV2RuntimeConfig, PinyinImeV2SpanProposal } from './pinyin-ime-v2-types';
import { buildInstabilityRegions, aggregateDiffSpanSupport } from './pinyin-ime-v2-instability';
import { textToPinyinStream } from './pinyin-ime-v2-pinyin-stream';

export type RunPinyinImeV2SpanProposalInput = {
  rawAsrText: string;
  dict: PinyinImeV2Dict;
  config: Pick<PinyinImeV2RuntimeConfig, 'topK'>;
};

/**
 * Span proposal stage: decode → diff → instability → boundary.
 * Does not write segmentForJobResult or perform Recall/KenLM/Apply.
 */
export function runPinyinImeV2SpanProposal(input: RunPinyinImeV2SpanProposalInput): PinyinImeV2SpanProposal {
  const rawAsrText = (input.rawAsrText ?? '').trim();
  const diagnostics = emptyProposalDiagnostics();

  if (!rawAsrText) {
    return {
      rawAsrText: '',
      candidates: [],
      diffSpans: [],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      diagnostics,
    };
  }

  const aligned = normalizeForImeAlignment(rawAsrText);
  const rawBoundaries = extractRawCoarseBoundaries(rawAsrText);
  diagnostics.normalizedCharCount = aligned.normalized.length;
  diagnostics.rawBoundaryCount = rawBoundaries.length;
  diagnostics.traditionalCharCount = aligned.traditionalCharCount;
  diagnostics.openccConvertedCount = aligned.openccConvertedCount;

  const { syllables, hasCjk } = textToPinyinStream(rawAsrText);
  if (!hasCjk || !syllables.length) {
    return {
      rawAsrText,
      candidates: [],
      diffSpans: [],
      instabilityRegions: [],
      boundaryCompatibleTopKSpans: [],
      diagnostics,
    };
  }

  const { candidates, diagnostics: decodeDiag } = decodeRawTextTopK(
    syllables,
    input.dict,
    input.config.topK
  );
  diagnostics.decode = decodeDiag;
  diagnostics.candidateCount = candidates.length;

  const boundaryAlign = computeBoundaryAlignmentDiagnostics(
    rawBoundaries,
    candidates,
    syllables.length
  );
  diagnostics.boundaryAlignmentScores = boundaryAlign.scores;
  diagnostics.rawBoundaryMatchedTopKCount = boundaryAlign.rawBoundaryMatchedTopKCount;
  diagnostics.boundaryCompatibilityScoreMax = boundaryAlign.boundaryCompatibilityScoreMax;
  diagnostics.boundaryCompatibilityScoreAvg = boundaryAlign.boundaryCompatibilityScoreAvg;

  const { diffSpans: sentenceDiffSpans, alignFailedCount } = collectDiffSpansFromCandidates(
    rawAsrText,
    candidates,
    input.config.topK
  );
  diagnostics.alignFailedCount = alignFailedCount;

  const localBuild = buildLocalRawImeDiffSpans({
    rawAsrText,
    candidates,
    alignmentScores: boundaryAlign.scores,
  });
  diagnostics.localRawImeDiffSpanCount = localBuild.diagnostics.localRawImeDiffSpanCount;
  diagnostics.localRawImeDiffCandidateCount = localBuild.diagnostics.localRawImeDiffCandidateCount;
  diagnostics.localRawImeDiffTrustedCandidateCount =
    localBuild.diagnostics.localRawImeDiffTrustedCandidateCount;
  diagnostics.localRawImeDiffDroppedCount = localBuild.diagnostics.localRawImeDiffDroppedCount;
  diagnostics.localRawImeDiffSingleCharCount = localBuild.diagnostics.localRawImeDiffSingleCharCount;
  diagnostics.localRawImeDiffExampleSpans = localBuild.diagnostics.localRawImeDiffExampleSpans;

  const localActivated = shouldActivateLocalRawImeDiffFallback(
    alignFailedCount,
    candidates.length,
    input.config.topK
  );
  diagnostics.localRawImeDiffActivated = localActivated ? 1 : 0;

  const rawDiffSpans = localActivated ? localBuild.spans : sentenceDiffSpans;

  const diffSpans = aggregateDiffSpanSupport(rawDiffSpans);
  diagnostics.diffSpanCount = diffSpans.length;

  const instabilityRegions = buildInstabilityRegions(diffSpans);
  diagnostics.instabilityRegionCount = instabilityRegions.length;

  const bounded = applyBoundaryDiscovery(rawAsrText, diffSpans, instabilityRegions);
  diagnostics.boundaryAdjustedCount = bounded.boundaryAdjustedCount;

  const boundaryTopK = buildBoundaryCompatibleTopKDiff({
    rawAsrText,
    candidates,
    alignmentScores: boundaryAlign.scores,
    totalSyllables: syllables.length,
  });
  diagnostics.trustedTopKCount = boundaryTopK.trustedTopKCount;
  diagnostics.boundaryCompatibleTopKSpanCount = boundaryTopK.spans.length;
  diagnostics.tokenSourceConflictDiagnosticCount =
    boundaryTopK.tokenSourceConflictDiagnosticCount;
  diagnostics.normalizedTextDiffDiagnosticCount = candidates.filter(
    (c) => c.text !== rawAsrText
  ).length;
  diagnostics.diffZeroBoundaryPositive =
    diffSpans.length === 0 && boundaryTopK.spans.length > 0 ? 1 : 0;

  return {
    rawAsrText,
    candidates,
    diffSpans: bounded.diffSpans,
    instabilityRegions: bounded.instabilityRegions,
    boundaryCompatibleTopKSpans: boundaryTopK.spans,
    diagnostics,
    alignmentNormalizedLength: aligned.normalized.length,
    rawBoundaryCount: rawBoundaries.length,
  };
}
