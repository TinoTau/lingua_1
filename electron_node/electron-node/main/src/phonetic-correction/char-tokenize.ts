/**
 * 字符级 tokenize，与 KenLM 训练语料一致：CJK + 字母数字 + 保留标点，空格分隔。
 * 推理时必须与训练使用同一规则。
 */

/** 与 KenLM 训练时保留的标点一致 */
const KEEP_PUNCT = new Set('，。！？；：、""\'\'（）()《》<>【】[]—-…·,.!?;:"\'');

export function tokenizeForLm(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const out: string[] = [];
  for (const ch of t) {
    if ('\u4e00' <= ch && ch <= '\u9fff') {
      out.push(ch);
    } else if (/\w/.test(ch) || /\d/.test(ch)) {
      out.push(ch);
    } else if (KEEP_PUNCT.has(ch)) {
      out.push(ch);
    }
  }
  return out.join(' ');
}
