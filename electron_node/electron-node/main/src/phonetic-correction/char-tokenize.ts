/**
 * 字符级 tokenize，与 KenLM 训练语料一致（scripts/kenlm/lib/tokenize_char.py）：
 * NFKC、CJK 逐字、英文/数字连续段为单 token、保留标点，空格分隔。
 */

/** 与 KenLM 训练时保留的标点一致 */
const KEEP_PUNCT = new Set('，。！？；：、""\'\'（）()《》<>【】[]—-…·,.!?;:"\'');

const LATIN_TOKEN_RE = /^[A-Za-z][A-Za-z0-9]*/;
const DIGIT_RUN_RE = /^\d+/;

/** NFKC 全角半角归一 + trim */
export function normalizeTextForLm(text: string): string {
  return text.normalize('NFKC').trim();
}

export function tokenizeForLm(text: string): string {
  const normalized = normalizeTextForLm(text);
  if (!normalized) return '';

  const tokens: string[] = [];
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch >= '\u4e00' && ch <= '\u9fff') {
      tokens.push(ch);
      i += 1;
      continue;
    }
    const latin = LATIN_TOKEN_RE.exec(normalized.slice(i));
    if (latin) {
      tokens.push(latin[0]);
      i += latin[0].length;
      continue;
    }
    const digits = DIGIT_RUN_RE.exec(normalized.slice(i));
    if (digits) {
      tokens.push(digits[0]);
      i += digits[0].length;
      continue;
    }
    if (KEEP_PUNCT.has(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    i += 1;
  }
  return tokens.join(' ');
}
