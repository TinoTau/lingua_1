import { computeImeWeight } from './pinyin-ime-v2-dict-weight';
import type { PinyinImeV2SingleCharRole } from './pinyin-ime-v2-types';
import { isKnownSingleCharRole } from './pinyin-ime-v2-single-char-roles';

export type ParsedDictRow = {
  dictionaryType: string;
  surface: string;
  canonical: string;
  pinyin: string;
  tonePinyin: string;
  weight: number;
  targetBoost: number;
  domainId: string;
  isAlias: number;
  imeWeight: number;
  singleCharRole?: PinyinImeV2SingleCharRole;
};

export function entryKey(surface: string, pinyin: string): string {
  return `${surface}\t${pinyin}`;
}

export function parseDictLine(line: string): ParsedDictRow | null {
  const t = line.trim();
  if (!t || t.startsWith('#')) {
    return null;
  }
  const parts = t.split('\t');
  if (parts.length >= 10 && parts[0] !== 'word') {
    const imeWeight =
      parseFloat(parts[9])
      || computeImeWeight({
        prior_score: parseFloat(parts[5]),
        repair_target: parseInt(parts[6], 10),
        is_alias: parseInt(parts[8], 10),
      });
    return {
      dictionaryType: parts[0],
      surface: parts[1],
      canonical: parts[2] || parts[1],
      pinyin: parts[3],
      tonePinyin: parts[4] || '',
      weight: parseFloat(parts[5]) || 0.5,
      targetBoost: parseInt(parts[6], 10) || 0,
      domainId: parts[7] || '',
      isAlias: parseInt(parts[8], 10) || 0,
      imeWeight,
    };
  }
  if (parts.length >= 2) {
    const surface = parts[0];
    const pinyin = parts[1];
    const weight = parseFloat(parts[2]) || 0.5;
    const targetBoost = parseInt(parts[3], 10) || 0;
    const isAlias = parseInt(parts[5], 10) || 0;
    return {
      dictionaryType: 'legacy',
      surface,
      canonical: surface,
      pinyin,
      tonePinyin: '',
      weight,
      targetBoost,
      domainId: parts[4] || '',
      isAlias,
      imeWeight: computeImeWeight({
        prior_score: weight,
        repair_target: targetBoost,
        is_alias: isAlias,
      }),
    };
  }
  return null;
}

export function parseSingleCharDictLine(line: string): ParsedDictRow | null {
  const t = line.trim();
  if (!t || t.startsWith('#')) {
    return null;
  }
  const parts = t.split('\t');
  if (parts[0] === 'dictionary_type' || parts.length < 13) {
    return null;
  }
  const role = parts[9];
  if (!isKnownSingleCharRole(role)) {
    return null;
  }
  const weight = parseFloat(parts[5]) || 0.12;
  const targetBoost = parseInt(parts[6], 10) || 0;
  const isAlias = parseInt(parts[8], 10) || 0;
  return {
    dictionaryType: parts[0],
    surface: parts[1],
    canonical: parts[2] || parts[1],
    pinyin: parts[3],
    tonePinyin: parts[4] || '',
    weight,
    targetBoost,
    domainId: parts[7] || '',
    isAlias,
    singleCharRole: role,
    imeWeight: computeImeWeight({
      prior_score: weight,
      repair_target: targetBoost,
      is_alias: isAlias,
    }),
  };
}
