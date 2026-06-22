import type { HotwordEntry } from '../lexicon/hotword-types';

export type TierHotwordRow = HotwordEntry & {
  isAlias: boolean;
  tier: 'domain' | 'base' | 'idiom';
};

function dedupeByWordAndPinyin(rows: TierHotwordRow[]): TierHotwordRow[] {
  const seen = new Set<string>();
  const out: TierHotwordRow[] = [];
  for (const row of rows) {
    const pinyinKey = row.pinyin.join('|');
    const key = `${row.word}|${pinyinKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * P4 merge: domain > alias > base, combined limit (not tier叠加).
 */
export function mergeSpanCandidatesCombined(
  rows: TierHotwordRow[],
  limit: number,
  hasActiveDomain: boolean
): TierHotwordRow[] {
  const domainCanonical = rows.filter((r) => r.tier === 'domain' && !r.isAlias);
  const aliases = rows.filter((r) => r.isAlias);
  const baseCanonical = rows.filter((r) => (r.tier === 'base' || r.tier === 'idiom') && !r.isAlias);

  const ordered = hasActiveDomain
    ? dedupeByWordAndPinyin([...domainCanonical, ...aliases, ...baseCanonical])
    : dedupeByWordAndPinyin([...baseCanonical, ...aliases]);

  return ordered.slice(0, Math.max(0, limit));
}
