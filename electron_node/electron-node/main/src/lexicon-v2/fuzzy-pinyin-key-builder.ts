/**
 * P0 — plain pinyin variant builder (trim / function syllable strip only).
 */

export type FuzzyPinyinVariantKind =
  | 'exact'
  | 'trim_head'
  | 'trim_tail'
  | 'trim_both'
  | 'function_syllable_strip';

export type FuzzyPinyinVariant = {
  syllables: string[];
  kind: FuzzyPinyinVariantKind;
  isFuzzy: boolean;
};

/** Frozen function syllables (normalize 后 plain syllable，与 textToSyllables 一致). */
export const FUZZY_FUNCTION_SYLLABLES = new Set([
  'you',
  'yi',
  'xiang',
  'dian',
  'qing',
  'wo',
  'ge',
  'de',
  'le',
  'ma',
  'ne',
  'jiu',
  'xing',
  'bang',
  'xie',
  'gan',
  'shi',
  'jian',
  'xia',
  'wen',
  're',
  'gei',
  'rang',
  'ba',
  'zai',
  'lai',
  'qu',
  'zhe',
  'guo',
  'hai',
  'ye',
  'dou',
  'bei',
  'hao',
  'hen',
  'neng',
  'yao',
  'zuo',
]);

const MIN_SYLLABLES = 2;
const MAX_SYLLABLES = 5;
const MAX_VARIANTS = 4;

function isValidSyllableCount(count: number): boolean {
  return count >= MIN_SYLLABLES && count <= MAX_SYLLABLES;
}

function addVariant(
  out: Map<string, FuzzyPinyinVariant>,
  syllables: string[],
  kind: FuzzyPinyinVariantKind,
  isFuzzy: boolean
): void {
  if (!isValidSyllableCount(syllables.length)) {
    return;
  }
  const key = syllables.join('|');
  if (out.has(key)) {
    return;
  }
  out.set(key, { syllables: [...syllables], kind, isFuzzy });
}

export function buildFuzzyPinyinVariants(originalSyllables: string[]): FuzzyPinyinVariant[] {
  if (!originalSyllables.length || !isValidSyllableCount(originalSyllables.length)) {
    return [];
  }

  const variants = new Map<string, FuzzyPinyinVariant>();
  addVariant(variants, originalSyllables, 'exact', false);

  if (originalSyllables.length >= 3) {
    addVariant(variants, originalSyllables.slice(1), 'trim_head', true);
    addVariant(variants, originalSyllables.slice(0, -1), 'trim_tail', true);
    addVariant(variants, originalSyllables.slice(1, -1), 'trim_both', true);
  }

  if (
    originalSyllables.length >= 3 &&
    FUZZY_FUNCTION_SYLLABLES.has(originalSyllables[0]!)
  ) {
    addVariant(variants, originalSyllables.slice(1), 'function_syllable_strip', true);
  }

  return Array.from(variants.values()).slice(0, MAX_VARIANTS);
}

export function exactFuzzyPinyinVariant(syllables: string[]): FuzzyPinyinVariant {
  return { syllables: [...syllables], kind: 'exact', isFuzzy: false };
}

export function alignVariantWindowText(windowText: string, variant: FuzzyPinyinVariant): string {
  const plain = windowText.replace(/[\s,，。！？、；：.!?;:'"()（）\[\]【】\-—…]/g, '');
  const n = variant.syllables.length;
  if (!plain.length || n >= plain.length) {
    return windowText;
  }

  switch (variant.kind) {
    case 'exact':
      return windowText;
    case 'trim_tail':
    case 'function_syllable_strip':
      return plain.slice(0, n);
    case 'trim_head':
      return plain.slice(-n);
    case 'trim_both':
      return plain.slice(1, 1 + n);
    default:
      return windowText;
  }
}
