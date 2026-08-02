import { pinyin } from 'pinyin-pro';
import { hasCjk, normalizePinyin } from './normalize.mjs';

export function completePinyinForText(text) {
  const trimmed = text.trim();
  if (!trimmed || !hasCjk(trimmed)) {
    return '';
  }
  try {
    const syllables = pinyin(trimmed, { toneType: 'none', type: 'array' });
    return syllables.map((s) => s.trim().toLowerCase()).filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

export function resolvePinyin(word, rawPinyin) {
  const normalized = normalizePinyin(rawPinyin);
  if (normalized) {
    return normalized;
  }
  return completePinyinForText(word);
}

export function pinyinSyllables(rawPinyin) {
  const normalized = normalizePinyin(rawPinyin);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\s+/)
    .map((s) => s.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
}
