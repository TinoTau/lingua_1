import type { SentenceCandidate } from '../sentence-expansion/types';

export type NearTieDiagnostics = {
  applied: boolean;
  pickedCandidateSource: string;
  topCombinedScore: number;
  pickedCombinedScore: number;
  scoreGapSingleVsPicked: number;
  bestMultiCombinedScore: number;
  multiCandidateCount: number;
};

function isMultiSource(source: string): boolean {
  return source === 'window_pair' || source === 'window_multi';
}

/**
 * 策略 C：仅当与 top combined 差距 ≤ epsilon 时，优先 replacements 更多的候选。
 * 不修改 combinedScore 分量权重。
 */
export function pickWithNearTieCoverageGuardrail(
  scored: SentenceCandidate[],
  epsilon: number
): { picked: SentenceCandidate; diagnostics: NearTieDiagnostics } {
  const sorted = [...scored].sort((a, b) => (b.combinedScore ?? 0) - (a.combinedScore ?? 0));
  const top = sorted[0];
  const topScore = top.combinedScore ?? 0;
  const multi = sorted.filter((c) => isMultiSource(c.candidateSource));
  const bestMultiScore = multi.length
    ? Math.max(...multi.map((c) => c.combinedScore ?? 0))
    : 0;

  const nearTie = sorted.filter((c) => topScore - (c.combinedScore ?? 0) <= epsilon + 1e-9);
  const coveragePick = [...nearTie].sort((a, b) => {
    if (b.replacements.length !== a.replacements.length) {
      return b.replacements.length - a.replacements.length;
    }
    return (b.combinedScore ?? 0) - (a.combinedScore ?? 0);
  })[0];

  const picked = coveragePick;
  const singleTop = sorted.find((c) => c.candidateSource === 'window_single') ?? top;

  return {
    picked,
    diagnostics: {
      applied: picked !== singleTop || picked.replacements.length > singleTop.replacements.length,
      pickedCandidateSource: picked.candidateSource,
      topCombinedScore: topScore,
      pickedCombinedScore: picked.combinedScore ?? 0,
      scoreGapSingleVsPicked: (singleTop.combinedScore ?? 0) - (picked.combinedScore ?? 0),
      bestMultiCombinedScore: bestMultiScore,
      multiCandidateCount: multi.length,
    },
  };
}
