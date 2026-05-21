import { detectSuspiciousSpans } from '../lexicon/suspicious-span-detector';

/** Q1.8-03：仅报告，不开启 cross-segment recall。 */
export type CrossBoundaryRiskReport = {
  crossBoundaryRisk: boolean;
  leftSegment: string;
  rightSegment: string;
  possibleObserved: string;
  boundaryStart: number;
  boundaryEnd: number;
};

/**
 * 相邻标点 chunk 之间是否存在「整段 observed 仅跨边界可见」的风险。
 */
export function buildCrossBoundaryRiskReport(
  segmentText: string,
  observedStrings: readonly string[]
): CrossBoundaryRiskReport | null {
  const text = segmentText.trim();
  if (!text || observedStrings.length === 0) {
    return null;
  }

  const chunks = detectSuspiciousSpans(text);
  if (chunks.length < 2) {
    return null;
  }

  const sorted = [...observedStrings].filter((o) => o.length >= 2).sort((a, b) => b.length - a.length);

  for (let i = 0; i < chunks.length - 1; i++) {
    const left = chunks[i];
    const right = chunks[i + 1];
    const bridge = text.slice(left.start, right.end);

    for (const observed of sorted) {
      if (!bridge.includes(observed)) {
        continue;
      }
      if (left.text.includes(observed) || right.text.includes(observed)) {
        continue;
      }
      return {
        crossBoundaryRisk: true,
        leftSegment: left.text,
        rightSegment: right.text,
        possibleObserved: observed,
        boundaryStart: left.end,
        boundaryEnd: right.start,
      };
    }
  }

  return null;
}
