/**
 * 文本验证工具
 * 提供文本验证相关的工具函数
 */

/**
 * 无意义单词列表
 */
const MEANINGLESS_WORDS = ['the', 'a', 'an', 'this', 'that', 'it'];

/**
 * 检查文本是否为无意义单词
 */
export function isMeaninglessWord(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return MEANINGLESS_WORDS.includes(trimmed);
}

/**
 * 检查文本是否为空
 */
export function isEmptyText(text: string | null | undefined): boolean {
  return !text || text.trim().length === 0;
}
