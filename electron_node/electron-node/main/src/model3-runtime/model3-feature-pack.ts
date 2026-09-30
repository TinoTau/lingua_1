/**
 * Model3 V1 feature packing — matches frozen training semantics (bigru_v1.span_features).
 * ONE definition per feature; no compatibility layers.
 */

import type { PathFineSpan } from '../fw-detector/span-assembly-v4/path-fine-span-types';

/** Utterance-level: featureAvailability.pinyinTextDerived (Node text-derived syllable SSOT). */
export function model3PinyinTextDerived(globalSyllables: readonly string[]): boolean {
  return globalSyllables.length > 0;
}

/** Per-span: recallEvidence.firstPassCandidateCount from lattice PathFineSpan candidates. */
export function model3FirstPassCandidateCount(span: PathFineSpan): number {
  return span.candidates.filter((c) => !c.isCovered).length;
}

export function packModel3SpanInferFields(args: {
  span: PathFineSpan;
  rawText: string;
  globalSyllables: readonly string[];
  isAnchor: boolean;
}): {
  surface: string;
  firstPassCandidateCount: number;
  pinyinChannelAvail: boolean;
  recallFirstPassAvail: boolean;
} {
  return {
    surface: args.rawText.slice(args.span.rawStart, args.span.rawEnd),
    firstPassCandidateCount: model3FirstPassCandidateCount(args.span),
    pinyinChannelAvail: model3PinyinTextDerived(args.globalSyllables),
    recallFirstPassAvail: true,
  };
}
