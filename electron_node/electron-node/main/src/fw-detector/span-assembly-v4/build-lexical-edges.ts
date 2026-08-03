/**
 * Lattice Phase 1 — LexicalEdge builder.
 * One edge per (syllableStart, syllableEnd); no fallback edges; preserve Recall order.
 * Edge-Level evidence OR over all input candidates; Candidate subject remains identity first-wins.
 */

import { isFuzzyRecallCandidateKind } from '../../lexicon/candidate-score';
import type { WindowCandidate } from './v4-types';

export type LexicalEdgeRecallEvidence = {
  hasExact: boolean;
  hasToneExact: boolean;
  hasToneRelaxed: boolean;
  hasFuzzy: boolean;
};

export type LexicalEdge = {
  edgeId: string;
  syllableStart: number;
  syllableEnd: number;
  edgeKind: 'lexical' | 'fallback';
  sourceWindowId: string;
  candidates: WindowCandidate[];
  recallEvidence: LexicalEdgeRecallEvidence;
};

export type RecalledWindowBundle = {
  windowId: string;
  syllableStart: number;
  syllableEnd: number;
  candidates: WindowCandidate[];
};

function candidateMergeKey(c: WindowCandidate): string {
  if (c.termId != null && String(c.termId).length > 0) {
    return `term:${c.termId}`;
  }
  // Frozen identity fallback — never merge solely by replacement text.
  return `cand:${c.candidateId}`;
}

function emptyEvidence(): LexicalEdgeRecallEvidence {
  return {
    hasExact: false,
    hasToneExact: false,
    hasToneRelaxed: false,
    hasFuzzy: false,
  };
}

function orCandidateEvidence(
  evidence: LexicalEdgeRecallEvidence,
  c: WindowCandidate
): void {
  if (c.hitKind === 'exact_term') {
    evidence.hasExact = true;
  }
  if (c.toneLookupStage === 'tone_exact') {
    evidence.hasToneExact = true;
  }
  // Batch 1.1C: Mandatory Tone Recall no longer emits plain_fallback; hasToneRelaxed stays false from this path.
  if (isFuzzyRecallCandidateKind(c.recallCandidateKind)) {
    evidence.hasFuzzy = true;
  }
}

/**
 * Single-pass: Edge evidence OR over all inputs, then identity first-wins keep subjects.
 */
function buildEdgeCandidatesAndEvidence(candidates: readonly WindowCandidate[]): {
  kept: WindowCandidate[];
  evidence: LexicalEdgeRecallEvidence;
} {
  const evidence = emptyEvidence();
  const seen = new Set<string>();
  const kept: WindowCandidate[] = [];
  for (const c of candidates) {
    orCandidateEvidence(evidence, c);
    const key = candidateMergeKey(c);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(c);
  }
  return { kept, evidence };
}

/**
 * Build lexical edges from recalled non-empty windows.
 * Edge order follows first corresponding window order. Candidates keep Recall first-seen order.
 */
export function buildLexicalEdges(input: {
  recalledWindows: readonly RecalledWindowBundle[];
}): LexicalEdge[] {
  const edges: LexicalEdge[] = [];
  const seenBoundary = new Set<string>();

  for (const bundle of input.recalledWindows) {
    const { kept, evidence } = buildEdgeCandidatesAndEvidence(bundle.candidates);
    if (!kept.length) {
      continue;
    }
    const edgeId = `${bundle.syllableStart}:${bundle.syllableEnd}`;
    if (seenBoundary.has(edgeId)) {
      continue;
    }
    seenBoundary.add(edgeId);
    edges.push({
      edgeId,
      syllableStart: bundle.syllableStart,
      syllableEnd: bundle.syllableEnd,
      edgeKind: 'lexical',
      sourceWindowId: bundle.windowId,
      candidates: kept,
      recallEvidence: evidence,
    });
  }

  return edges;
}
