/** Apply bounded span replacements on a fixed original coordinate system (right-to-left). */

export function applySingleSpanReplacement(
  text: string,
  start: number,
  end: number,
  to: string
): string {
  return text.slice(0, start) + to + text.slice(end);
}

export function applyReplacementsRightToLeft(
  originalText: string,
  items: Array<{ start: number; end: number; to: string }>
): string {
  const sorted = [...items].sort((a, b) => b.end - a.end);
  let text = originalText;
  for (const item of sorted) {
    text = applySingleSpanReplacement(text, item.start, item.end, item.to);
  }
  return text;
}

/** Half-open [start, end); touching spans (endA === startB) are not overlap. */
export function spansOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}
