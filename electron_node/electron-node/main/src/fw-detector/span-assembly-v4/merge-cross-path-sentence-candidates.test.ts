/**
 * Step 4 — Cross-Path Merge / Dedup / Global ≤16 unit tests.
 */

import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import type { SentenceCombination } from '../build-sentence-candidates';
import { RAW_REPAIR_SELECTION_META } from '../derive-repair-selection-completeness';
import { mergeCrossPathSentenceCandidates } from './merge-cross-path-sentence-candidates';

function combo(text: string, score = 1): SentenceCombination {
  return { text, replacements: [], candidateScore: score, ...RAW_REPAIR_SELECTION_META };
}

function pathInput(
  pathId: string,
  buckets: SentenceCombination[][],
  boundaryKey = pathId
) {
  return { pathId, boundaryKey, perBucketGenerated: buckets };
}

describe('mergeCrossPathSentenceCandidates', () => {
  it('Case A: single Path preserves order', () => {
    const out = mergeCrossPathSentenceCandidates(
      [pathInput('A', [[combo('s1', 2), combo('s2', 1)]])],
      16
    );
    expect(out.combinations.map((c) => c.text)).toEqual(['s1', 's2']);
    expect(out.trace.crossPathDuplicateCount).toBe(0);
    expect(out.trace.crossPathOutputCandidateCount).toBe(2);
  });

  it('Case B: multi Path no duplicates keeps all', () => {
    const out = mergeCrossPathSentenceCandidates(
      [
        pathInput('A', [[combo('A1'), combo('A2')]]),
        pathInput('B', [[combo('B1'), combo('B2')]]),
      ],
      16
    );
    expect(out.combinations.map((c) => c.text)).toEqual(['A1', 'A2', 'B1', 'B2']);
  });

  it('Case C: cross-Path duplicate keeps first occurrence only', () => {
    const first = combo('X', 1);
    const second = combo('X', 99);
    const out = mergeCrossPathSentenceCandidates(
      [
        pathInput('A', [[first, combo('A')]]),
        pathInput('B', [[second, combo('B')]]),
      ],
      16
    );
    expect(out.combinations.map((c) => c.text)).toEqual(['X', 'A', 'B']);
    expect(out.combinations.find((c) => c.text === 'X')?.candidateScore).toBe(1);
    expect(out.trace.crossPathDuplicateCount).toBe(1);
  });

  it('Case D: cross-bucket duplicate within/across Paths keeps once', () => {
    const out = mergeCrossPathSentenceCandidates(
      [
        pathInput('A', [[combo('same'), combo('a1')], [combo('same'), combo('a2')]]),
        pathInput('B', [[combo('same')]]),
      ],
      16
    );
    expect(out.combinations.map((c) => c.text)).toEqual(['same', 'a1', 'a2']);
    expect(out.trace.crossPathDuplicateCount).toBe(2);
  });

  it('Case E: dedup before cap when unique ≤16', () => {
    const many: SentenceCombination[] = [];
    for (let i = 0; i < 20; i += 1) {
      many.push(combo(`u${i}`));
    }
    // 20 unique + 10 duplicates of first 10
    const withDups = [...many, ...many.slice(0, 10)];
    const out = mergeCrossPathSentenceCandidates([pathInput('A', [withDups])], 16);
    expect(out.trace.crossPathInputCandidateCount).toBe(30);
    expect(out.trace.crossPathUniqueCandidateCount).toBe(20);
    expect(out.combinations).toHaveLength(16);
    expect(out.combinations.map((c) => c.text)).toEqual(
      Array.from({ length: 16 }, (_, i) => `u${i}`)
    );
    expect(out.trace.crossPathTruncatedCount).toBe(4);
  });

  it('Case F: unique >16 truncates strictly to 16', () => {
    const many = Array.from({ length: 25 }, (_, i) => combo(`t${i}`));
    const out = mergeCrossPathSentenceCandidates([pathInput('A', [many])], 16);
    expect(out.combinations).toHaveLength(16);
    expect(out.trace.crossPathOutputCandidateCount).toBe(16);
    expect(out.trace.globalCandidateCap).toBe(16);
  });

  it('Case G: fewer than 16 does not pad', () => {
    const out = mergeCrossPathSentenceCandidates(
      [pathInput('A', [[combo('only')]])],
      16
    );
    expect(out.combinations).toHaveLength(1);
    expect(out.combinations[0]!.text).toBe('only');
  });

  it('Case H: zero candidates yields empty pool (no LTR)', () => {
    const out = mergeCrossPathSentenceCandidates(
      [pathInput('A', [[]]), pathInput('B', [])],
      16
    );
    expect(out.combinations).toEqual([]);
    expect(out.trace.crossPathInputCandidateCount).toBe(0);
    expect(out.trace.kenlmInputSource).toBe('cross_path_merge');
  });

  it('stability: identical inputs → identical merge', () => {
    const input = [
      pathInput('A', [[combo('X', 1), combo('Y', 2)]]),
      pathInput('B', [[combo('X', 9), combo('Z', 3)]]),
    ];
    const a = mergeCrossPathSentenceCandidates(input, 16);
    const b = mergeCrossPathSentenceCandidates(input, 16);
    expect(a.combinations).toEqual(b.combinations);
    expect(a.trace).toEqual(b.trace);
  });

  it('does not re-rank by candidateScore across Paths', () => {
    const out = mergeCrossPathSentenceCandidates(
      [
        pathInput('A', [[combo('low', 1)]]),
        pathInput('B', [[combo('high', 100)]]),
      ],
      16
    );
    expect(out.combinations.map((c) => c.text)).toEqual(['low', 'high']);
  });

  it('production ownership static scan', () => {
    const mergeSrc = fs.readFileSync(
      path.join(__dirname, 'merge-cross-path-sentence-candidates.ts'),
      'utf8'
    );
    const orch = fs.readFileSync(path.join(__dirname, 'span-assembly-v4-orchestrator.ts'), 'utf8');
    const ban = (...parts: string[]) => parts.join('');
    expect(mergeSrc).toContain('export function mergeCrossPathSentenceCandidates');
    expect(orch).toContain('mergeCrossPathSentenceCandidates');
    expect(orch).not.toMatch(/STEP3_TEMPORARY_PRE_STEP4_COLLECTION|temporaryPreStep4Collection/);
    expect(orch).not.toContain(ban('runL', 'trFineSpanGeneration'));
    // Path-local cross-bucket helper must not be the KenLM owner in orchestrator.
    expect(orch).not.toContain(ban('mergeCrossBucket', 'SentenceCandidates'));
  });
});
