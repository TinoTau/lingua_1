import type { TierPatchEntry, LexiconTierTable } from './patch-types';
import { pinyinKeyFromCjkText, resolvePinyinKey, resolveTonePinyinKey } from './pinyin-resolve';

export type TierSqlRow = {
  id: string;
  pinyin_key: string;
  tone_pinyin_key: string;
  word: string;
  normalized: string;
  prior_score: number;
  repair_target: number;
  enabled: number;
  aliases: string;
  source: string;
  canonical_word: string | null;
  is_alias: number;
};

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function slugId(prefix: string, text: string): string {
  return `${prefix}-${Buffer.from(text, 'utf8').toString('hex').slice(0, 12)}`;
}

export function entryToTierRow(entry: TierPatchEntry, tier: LexiconTierTable): TierSqlRow {
  const word = entry.word.trim();
  const pinyinKey = resolvePinyinKey(word, entry.pinyinKey);
  const tonePinyinKey = resolveTonePinyinKey(word, { tonePinyinKey: entry.tonePinyinKey });
  const aliases = entry.aliases?.length ? entry.aliases : [word];
  const enabled = entry.enabled === false ? 0 : 1;

  return {
    id: entry.id?.trim() || slugId('v3', word),
    pinyin_key: pinyinKey,
    tone_pinyin_key: tonePinyinKey,
    word,
    normalized: word,
    prior_score: entry.priorScore,
    repair_target: entry.repairTarget === true ? 1 : 0,
    enabled,
    aliases: JSON.stringify(aliases),
    source: entry.source?.trim() || 'patch-v3',
    canonical_word: null,
    is_alias: 0,
  };
}

export function materializeTierAliasRows(
  tier: LexiconTierTable,
  entry: TierPatchEntry,
  canonical: TierSqlRow
): TierSqlRow[] {
  const aliases = entry.aliases?.length ? entry.aliases : [];
  const out: TierSqlRow[] = [];
  const canonicalWord = canonical.word;

  for (const alias of aliases) {
    if (alias === canonicalWord || !hasCjk(alias)) {
      continue;
    }
    const pinyinKey = pinyinKeyFromCjkText(alias);
    if (!pinyinKey) {
      continue;
    }
    out.push({
      id: slugId('alias', `${canonicalWord}:${alias}`),
      pinyin_key: pinyinKey,
      tone_pinyin_key: resolveTonePinyinKey(alias),
      word: alias,
      normalized: alias,
      prior_score: canonical.prior_score,
      repair_target: canonical.repair_target,
      enabled: canonical.enabled,
      source: canonical.source,
      aliases: '[]',
      canonical_word: canonicalWord,
      is_alias: 1,
    });
  }

  return out;
}

export function sqlTierTableName(tier: Exclude<LexiconTierTable, 'term'>): string {
  if (tier === 'base') {
    return 'base_lexicon';
  }
  return 'idiom_lexicon';
}
