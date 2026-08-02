import { CJK_RE, LATIN_RE } from './constants.mjs';

export function hasCjk(text) {
  return CJK_RE.test(text);
}

export function isMixedLatinToken(word) {
  const w = word.trim();
  if (!w) {
    return false;
  }
  return LATIN_RE.test(w) && !CJK_RE.test(w);
}

export function normalizeWord(word) {
  const collapsed = word.trim().replace(/\s+/g, ' ').replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
  if (!collapsed) {
    return '';
  }
  if (/^[A-Za-z0-9._\s-]+$/.test(collapsed)) {
    return collapsed.toLowerCase();
  }
  return collapsed;
}

export function normalizePinyin(raw) {
  if (!raw?.trim()) {
    return '';
  }
  return raw.trim().toLowerCase();
}

export function tokenCount(word) {
  return word.trim().split(/\s+/).filter(Boolean).length;
}

export function coerceEnabled(raw) {
  if (raw === false || raw === 0 || raw === '0') {
    return false;
  }
  if (raw === true || raw === 1 || raw === '1') {
    return true;
  }
  return raw !== undefined ? Boolean(raw) : true;
}
