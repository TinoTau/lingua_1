import { pinyin } from 'pinyin-pro';
import { normalizeSyllable, syllablesKey } from '../lexicon/pinyin-index';

function hasCjk(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

function syllablesFromPinyinField(pinyinField: string): string[] {
  return pinyinField
    .trim()
    .split(/[\s,/|]+/)
    .map(normalizeSyllable)
    .filter(Boolean);
}

export function pinyinKeyFromPinyinField(pinyinField: string): string {
  const syllables = syllablesFromPinyinField(pinyinField);
  return syllables.length ? syllablesKey(syllables) : '';
}

export function pinyinKeyFromCjkText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || !hasCjk(trimmed)) {
    return '';
  }
  try {
    const arr = pinyin(trimmed, { toneType: 'none', type: 'array' }) as string[];
    return syllablesKey(arr.map(normalizeSyllable).filter(Boolean));
  } catch {
    return '';
  }
}

export function resolvePinyinKey(word: string, pinyinKeyField?: string, pinyinField?: string): string {
  if (pinyinKeyField?.trim()) {
    return pinyinKeyField.trim();
  }
  if (pinyinField?.trim()) {
    const fromField = pinyinKeyFromPinyinField(pinyinField);
    if (fromField) {
      return fromField;
    }
  }
  return pinyinKeyFromCjkText(word);
}

export function resolveTonePinyinKey(
  word: string,
  opts: { tonePinyinKey?: string; pinyinField?: string } = {}
): string {
  if (opts.tonePinyinKey?.trim()) {
    return opts.tonePinyinKey.trim();
  }
  if (opts.pinyinField?.trim()) {
    const parts = opts.pinyinField.trim().split(/[\s,/|]+/);
    const toned = parts.map(normalizeSyllable).filter(Boolean);
    if (toned.length) {
      return toned.join('|');
    }
  }
  const trimmed = word.trim();
  if (!trimmed || !hasCjk(trimmed)) {
    return '';
  }
  try {
    const arr = pinyin(trimmed, { toneType: 'num', type: 'array' }) as string[];
    return syllablesKey(arr.map(normalizeSyllable).filter(Boolean));
  } catch {
    return '';
  }
}
