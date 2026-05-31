/**
 * Alias exact-hit span scan — only alias index keys, no base lexicon walk.
 */

export type AliasSpanHit = {
  text: string;
  start: number;
  end: number;
};

export function scanAliasExactHitsInText(
  text: string,
  aliasKeys: readonly string[],
  maxSpans: number
): AliasSpanHit[] {
  if (!text.trim() || maxSpans <= 0 || aliasKeys.length === 0) {
    return [];
  }

  const sorted = [...aliasKeys]
    .filter((key) => key.length >= 2)
    .sort((a, b) => b.length - a.length);

  const hits: AliasSpanHit[] = [];
  const occupied: Array<[number, number]> = [];

  for (const alias of sorted) {
    let searchFrom = 0;
    while (searchFrom < text.length && hits.length < maxSpans) {
      const idx = text.indexOf(alias, searchFrom);
      if (idx < 0) {
        break;
      }
      const end = idx + alias.length;
      const overlaps = occupied.some(([start, stop]) => end > start && idx < stop);
      if (!overlaps) {
        hits.push({ text: alias, start: idx, end });
        occupied.push([idx, end]);
      }
      searchFrom = idx + 1;
    }
    if (hits.length >= maxSpans) {
      break;
    }
  }

  return hits;
}
