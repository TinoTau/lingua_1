/**
 * Segment chunks for sliding-window enumeration (punctuation-bounded CJK runs).
 */

export type TextSpan = {
  text: string;
  start: number;
  end: number;
};

const CHUNK_RE = /[^。！？，、；：\s]+/g;

export function detectSuspiciousSpans(top1Text: string): TextSpan[] {
  const text = top1Text.trim();
  if (!text) {
    return [];
  }
  const spans: TextSpan[] = [];
  let match: RegExpExecArray | null;
  CHUNK_RE.lastIndex = 0;
  while ((match = CHUNK_RE.exec(text)) !== null) {
    const chunk = match[0].trim();
    if (chunk.length >= 2) {
      spans.push({
        text: chunk,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  if (spans.length === 0 && text.length >= 2) {
    spans.push({ text, start: 0, end: text.length });
  }
  return spans;
}
