import { pinyin } from 'pinyin-pro';
import { normalizeSyllable } from './pinyin';

const RAW_PINYIN_SPLIT = /[\s,/|]+/;

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function parseRawToneSyllables(rawPinyin: unknown): string[] | null {
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

function toneSyllablesFromText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed || !hasCjk(trimmed)) {
    return [];
  }
  try {
    const arr = pinyin(trimmed, { toneType: 'num', type: 'array' }) as string[];
    return arr.map(normalizeSyllable).filter(Boolean);
  } catch {
    return [];
  }
}

export function textToToneSyllables(text: string, rawTonePinyin?: unknown): string[] {
  const fromRaw = parseRawToneSyllables(rawTonePinyin);
  if (fromRaw) {
    return fromRaw;
  }
  return toneSyllablesFromText(text);
}

export function toneSyllablesKey(syllables: string[]): string {
  return syllables.filter(Boolean).join('|');
}

/** Build tone_pinyin_key from plain syllables + acoustic tone digits (e.g. shao|bing + [3,1] → shao3|bing1). */
export function buildTonePinyinKeyFromSyllablesAndPattern(
  syllables: string[],
  tonePattern: number[] | null | undefined
): string | null {
  if (!syllables.length || !tonePattern?.length) {
    return null;
  }
  if (syllables.length !== tonePattern.length) {
    return null;
  }
  const parts: string[] = [];
  for (let i = 0; i < syllables.length; i++) {
    const syl = normalizeSyllable(syllables[i] ?? '');
    const tone = tonePattern[i];
    if (!syl || tone == null || !Number.isInteger(tone) || tone < 1 || tone > 5) {
      return null;
    }
    parts.push(`${syl}${tone}`);
  }
  return parts.join('|');
}

export function toneDistance(asrToneKey: string, candidateToneKey: string): number {
  if (!asrToneKey || !candidateToneKey) {
    return Number.MAX_SAFE_INTEGER;
  }
  const asrParts = asrToneKey.split('|').filter(Boolean);
  const candParts = candidateToneKey.split('|').filter(Boolean);
  if (asrParts.length !== candParts.length || asrParts.length === 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  let distance = 0;
  for (let i = 0; i < asrParts.length; i++) {
    if (asrParts[i] !== candParts[i]) {
      distance += 1;
    }
  }
  return distance;
}
