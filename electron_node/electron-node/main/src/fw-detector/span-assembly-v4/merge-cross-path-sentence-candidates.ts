/**
 * Cross-Path Merge Owner — formal Step 4 KenLM input pipeline.
 *
 * PathAssemblyResult[] → collect → textual dedup (first-wins) → global cap ≤16.
 *
 * Path-local Cross-Bucket generation remains in buildSentenceCandidates / Path Assembly.
 * This module owns only the Path-to-Path merge into the unique KenLM pool.
 *
 * Does NOT: re-score, Path-rank, merge scores, per-path caps, or call KenLM.
 */

import type { SentenceCombination } from '../build-sentence-candidates';

/** Minimal Path Assembly surface required for merge (avoids circular orchestrator import). */
export type CrossPathMergePathInput = {
  pathId: string;
  boundaryKey: string;
  /** Path-local bucket grids in stable bucket order. */
  perBucketGenerated: readonly (readonly SentenceCombination[])[];
};

export type CrossPathMergeTrace = {
  crossPathInputCandidateCount: number;
  crossPathDuplicateCount: number;
  crossPathUniqueCandidateCount: number;
  crossPathOutputCandidateCount: number;
  crossPathTruncatedCount: number;
  globalCandidateCap: number;
  kenlmInputSource: 'cross_path_merge';
  /** Contract facts — diagnostics only; never feed Vote/Assembly/KenLM scoring. */
  dedupKey: 'exact_text';
  duplicateRetention: 'first_wins';
  collectionOrder: 'path_bucket_candidate';
};

export type CrossPathMergeResult = {
  combinations: SentenceCombination[];
  /** Unique candidates before global cap (stable first-wins order). */
  uniqueBeforeCap: SentenceCombination[];
  trace: CrossPathMergeTrace;
};

/**
 * Collect all Path / SameDomain-bucket sentence candidates in deterministic order:
 * SegmentationPath enumeration order → bucket order → Assembly candidate order.
 *
 * Dedup key = candidate.text (exact). First occurrence wins — no score merge / re-rank.
 * Cap applies only after dedup (dedup-before-cap).
 */
export function mergeCrossPathSentenceCandidates(
  pathAssemblyResults: readonly CrossPathMergePathInput[],
  globalCandidateCap: number
): CrossPathMergeResult {
  const cap = Math.max(0, globalCandidateCap);
  const seen = new Set<string>();
  const uniqueBeforeCap: SentenceCombination[] = [];
  let inputCandidateCount = 0;
  let duplicateCandidateCount = 0;

  for (const path of pathAssemblyResults) {
    for (const bucketList of path.perBucketGenerated) {
      for (const combo of bucketList) {
        inputCandidateCount += 1;
        if (seen.has(combo.text)) {
          duplicateCandidateCount += 1;
          continue;
        }
        seen.add(combo.text);
        uniqueBeforeCap.push(combo);
      }
    }
  }

  const combinations = uniqueBeforeCap.slice(0, cap);
  const truncatedCandidateCount = Math.max(0, uniqueBeforeCap.length - combinations.length);

  return {
    combinations,
    uniqueBeforeCap,
    trace: {
      crossPathInputCandidateCount: inputCandidateCount,
      crossPathDuplicateCount: duplicateCandidateCount,
      crossPathUniqueCandidateCount: uniqueBeforeCap.length,
      crossPathOutputCandidateCount: combinations.length,
      crossPathTruncatedCount: truncatedCandidateCount,
      globalCandidateCap: cap,
      kenlmInputSource: 'cross_path_merge',
      dedupKey: 'exact_text',
      duplicateRetention: 'first_wins',
      collectionOrder: 'path_bucket_candidate',
    },
  };
}
