/**
 * 缓存键生成器
 * 优化缓存键生成策略，提高缓存命中率
 */

/**
 * 规范化文本（用于缓存键生成）
 * - 去除首尾空格
 * - 规范化空白字符（多个空格合并为一个）
 * - 去除标点符号前后的空格
 * @param text 原始文本
 * @returns 规范化后的文本
 */
export function normalizeTextForCache(text: string): string {
  if (!text) return '';
  
  // 去除首尾空格
  let normalized = text.trim();
  
  // 规范化空白字符：多个空格/换行/制表符合并为一个空格
  normalized = normalized.replace(/\s+/g, ' ');
  
  // 去除标点符号前后的空格（可选，可能影响语义）
  // normalized = normalized.replace(/\s+([，。！？、；：])/g, '$1');
  // normalized = normalized.replace(/([，。！？、；：])\s+/g, '$1');
  
  return normalized;
}

/**
 * 生成缓存键
 * @param srcLang 源语言
 * @param tgtLang 目标语言
 * @param text 文本（会被规范化）
 * @param contextText 上下文文本（可选，用于区分上下文）
 * @returns 缓存键
 */
export function generateCacheKey(
  srcLang: string,
  tgtLang: string,
  text: string,
  contextText?: string
): string {
  // 规范化文本
  const normalizedText = normalizeTextForCache(text);
  
  // 如果文本太长，使用哈希（避免缓存键过长）
  // 对于短文本（< 100 字符），直接使用文本
  // 对于长文本，使用哈希
  let textKey: string;
  if (normalizedText.length > 100) {
    // 使用简单的哈希（实际可以使用更复杂的哈希算法）
    // 这里使用文本的前50个字符 + 长度 + 后50个字符的哈希
    const hash = simpleHash(normalizedText);
    textKey = `${normalizedText.substring(0, 30)}...${normalizedText.substring(normalizedText.length - 30)}|${hash}`;
  } else {
    textKey = normalizedText;
  }
  
  // 如果有上下文，包含上下文（但只使用前50个字符，避免键过长）
  const contextKey = contextText 
    ? `|ctx:${normalizeTextForCache(contextText).substring(0, 50)}` 
    : '';
  
  return `${srcLang}-${tgtLang}-${textKey}${contextKey}`;
}

/**
 * 简单哈希函数（用于长文本）
 * @param text 文本
 * @returns 哈希值（字符串）
 */
function simpleHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * 检查文本是否适合缓存
 * - 太短的文本（< 3 字符）可能不值得缓存
 * - 太长的文本（> 500 字符）可能缓存命中率低
 * @param text 文本
 * @returns 是否适合缓存
 */
export function shouldCache(text: string): boolean {
  const normalized = normalizeTextForCache(text);
  return normalized.length >= 3 && normalized.length <= 500;
}

