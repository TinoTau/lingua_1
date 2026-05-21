import { pinyin } from 'pinyin-pro';

const RAW_PINYIN_SPLIT = /[\s,/|]+/;

export function normalizeSyllable(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseRawPinyin(rawPinyin: unknown): string[] | null {
  if (Array.isArray(rawPinyin)) {
    const out = rawPinyin
      .map((x) => (typeof x === 'string' ? normalizeSyllable(x) : ''))
      .filter(Boolean);
    return out.length > 0 ? out : null;
  }
  if (typeof rawPinyin === 'string' && rawPinyin.trim()) {
    const out = rawPinyin
      .split(RAW_PINYIN_SPLIT)
      .map(normalizeSyllable)
      .filter(Boolean);
    return out.length > 0 ? out : null;
  }
  return null;
}

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function syllablesFromText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed || !hasCjk(trimmed)) {
    return [];
  }
  try {
    const arr = pinyin(trimmed, { toneType: 'none', type: 'array' }) as string[];
    return arr.map(normalizeSyllable).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Syllables for phonetic scoring; prefers raw bundle pinyin when present.
 */
export function textToSyllables(text: string, rawPinyin?: unknown): string[] {
  const fromRaw = parseRawPinyin(rawPinyin);
  if (fromRaw) {
    return fromRaw;
  }
  return syllablesFromText(text);
}

function levenshteinDistance(a: string[], b: string[]): number {
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) {
    row[j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return row[b.length];
}

/**
 * Normalized syllable similarity in [0, 1].
 */
export function scorePinyinSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const distance = levenshteinDistance(a, b);
  const denom = Math.max(a.length, b.length);
  if (denom === 0) {
    return 0;
  }
  const score = 1 - distance / denom;
  return Math.max(0, Math.min(1, score));
}

export function readCandidateRawPinyin(raw: unknown): string | string[] | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const p = (raw as { pinyin?: string | string[] }).pinyin;
  return p === undefined ? undefined : p;
}
