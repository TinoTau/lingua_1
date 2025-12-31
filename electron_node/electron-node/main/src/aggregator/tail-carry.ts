/* Tail Carry: 尾巴延迟归属
   每次 commit 时保留尾部 token/字符，不立即输出
   下一轮合并时作为 prefix 参与去重与归属判断
*/

import { looksLikeCjk, countCjkChars, countWords } from './aggregator-decision';

export interface TailCarryConfig {
  tailCarryTokens: number;  // 保留的 token 数（1-3 token / CJK 2-6 字）
  tailCarryCjkChars: number;  // CJK 模式下保留的字符数（2-6 字）
}

export const DEFAULT_TAIL_CARRY_CONFIG: TailCarryConfig = {
  tailCarryTokens: 3,      // 提高：从 2 提高到 3
  tailCarryCjkChars: 6,    // 提高：从 4 提高到 6
};

/**
 * 计算应该保留的尾部长度
 */
export function calculateTailLength(
  text: string,
  config: TailCarryConfig = DEFAULT_TAIL_CARRY_CONFIG
): number {
  if (!text || text.trim().length === 0) return 0;
  
  const isCjk = looksLikeCjk(text);
  
  if (isCjk) {
    const cjkChars = countCjkChars(text);
    // 如果文本太短，不保留 tail
    if (cjkChars <= config.tailCarryCjkChars) return 0;
    return config.tailCarryCjkChars;
  } else {
    const words = countWords(text);
    // 如果文本太短，不保留 tail
    if (words <= config.tailCarryTokens) return 0;
    // 返回最后 N 个词的长度（近似）
    const wordsArray = text.trim().split(/\s+/);
    if (wordsArray.length <= config.tailCarryTokens) return 0;
    
    // 计算最后 N 个词的总字符数
    const tailWords = wordsArray.slice(-config.tailCarryTokens);
    return tailWords.join(' ').length;
  }
}

/**
 * 提取尾部文本（用于下一轮合并）
 */
export function extractTail(
  text: string,
  config: TailCarryConfig = DEFAULT_TAIL_CARRY_CONFIG
): string {
  const tailLength = calculateTailLength(text, config);
  if (tailLength === 0) return '';
  
  // 从末尾提取指定长度的文本
  // 对于 CJK，直接按字符数提取
  // 对于英文，按词提取
  const isCjk = looksLikeCjk(text);
  
  if (isCjk) {
    // CJK 模式：提取最后 N 个字符
    const chars = Array.from(text);
    if (chars.length <= config.tailCarryCjkChars) return '';
    return chars.slice(-config.tailCarryCjkChars).join('');
  } else {
    // 英文模式：提取最后 N 个词
    const words = text.trim().split(/\s+/);
    if (words.length <= config.tailCarryTokens) return '';
    return words.slice(-config.tailCarryTokens).join(' ');
  }
}

/**
 * 移除尾部文本（用于 commit）
 */
export function removeTail(
  text: string,
  config: TailCarryConfig = DEFAULT_TAIL_CARRY_CONFIG
): string {
  const tail = extractTail(text, config);
  if (!tail) return text;
  
  // 从文本末尾精确移除 tail（不使用 lastIndexOf，因为 tail 可能在文本中间也出现）
  // 直接检查文本是否以 tail 结尾
  const trimmedText = text.trim();
  if (trimmedText.endsWith(tail)) {
    // 从末尾移除 tail
    return trimmedText.slice(0, trimmedText.length - tail.length).trim();
  }
  
  // 如果文本不以 tail 结尾（可能因为空格等），尝试从末尾按字符数移除
  const isCjk = looksLikeCjk(text);
  if (isCjk) {
    const chars = Array.from(trimmedText);
    if (chars.length > config.tailCarryCjkChars) {
      return chars.slice(0, chars.length - config.tailCarryCjkChars).join('').trim();
    }
  } else {
    const words = trimmedText.split(/\s+/);
    if (words.length > config.tailCarryTokens) {
      return words.slice(0, words.length - config.tailCarryTokens).join(' ').trim();
    }
  }
  
  return text;
}

