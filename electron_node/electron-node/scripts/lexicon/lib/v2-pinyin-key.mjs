/**
 * Lexicon V2 — pinyin_key SSOT (align with main/src/lexicon/pinyin-index.ts syllablesKey).
 */

import { pinyin } from 'pinyin-pro';
import { hasCjk } from './normalize.mjs';
import { pinyinSyllables } from './pinyin-complete.mjs';

export function normalizeSyllable(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function syllablesKeyFromArray(syllables) {
  if (!Array.isArray(syllables)) {
    return '';
  }
  return syllables.map(normalizeSyllable).filter(Boolean).join('|');
}

export function pinyinKeyFromPinyinField(pinyinField) {
  const syllables = pinyinSyllables(pinyinField);
  if (!syllables.length) {
    return '';
  }
  return syllablesKeyFromArray(syllables);
}

export function pinyinKeyFromCjkText(text) {
  const trimmed = text.trim();
  if (!trimmed || !hasCjk(trimmed)) {
    return '';
  }
  try {
    const arr = pinyin(trimmed, { toneType: 'none', type: 'array' });
    return syllablesKeyFromArray(Array.isArray(arr) ? arr : []);
  } catch {
    return '';
  }
}

export function resolvePinyinKey({ word, pinyinField }) {
  const fromField = pinyinKeyFromPinyinField(pinyinField);
  if (fromField) {
    return fromField;
  }
  return pinyinKeyFromCjkText(word);
}

export function tonePinyinKeyFromPinyinField(pinyinField) {
  if (typeof pinyinField !== 'string' || !pinyinField.trim()) {
    return '';
  }
  try {
    const parts = pinyinField.trim().split(/[\s,/|]+/);
    const toned = parts.map((part) => normalizeSyllable(part)).filter(Boolean);
    return toned.length ? toned.join('|') : '';
  } catch {
    return '';
  }
}

export function tonePinyinKeyFromCjkText(text) {
  const trimmed = text.trim();
  if (!trimmed || !hasCjk(trimmed)) {
    return '';
  }
  try {
    const arr = pinyin(trimmed, { toneType: 'num', type: 'array' });
    return syllablesKeyFromArray(Array.isArray(arr) ? arr : []);
  } catch {
    return '';
  }
}

export function resolveTonePinyinKey({ word, pinyinField, tonePinyinField, tonePinyinKeyField }) {
  if (typeof tonePinyinKeyField === 'string' && tonePinyinKeyField.trim()) {
    return tonePinyinKeyField.trim();
  }
  if (typeof tonePinyinField === 'string' && tonePinyinField.trim()) {
    const fromTone = tonePinyinKeyFromPinyinField(tonePinyinField);
    if (fromTone) {
      return fromTone;
    }
  }
  const fromPinyin = tonePinyinKeyFromPinyinField(pinyinField);
  if (fromPinyin) {
    return fromPinyin;
  }
  return tonePinyinKeyFromCjkText(word);
}
