/* Dedup: 边界重叠裁剪
   用于解决跨 utterance 的边界重复问题（如 "我们 我们可以..."）
*/

export interface DedupConfig {
  minOverlap: number;  // 最小重叠字符数（3-5 字符 / 1-2 词）
  maxOverlap: number;  // 最大重叠字符数（10-18 字符 / 5-8 词）
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  minOverlap: 2,   // 降低：检测更短的重复
  maxOverlap: 20,  // 提高：检测更长的重复
};

/**
 * 标准化文本（用于重叠检测）
 */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * 查找最长重叠前后缀
 * @param prevTail 上一段的尾部
 * @param currHead 当前段的开头
 * @returns 重叠字符数，如果没有重叠则返回 0
 */
function findLongestOverlap(prevTail: string, currHead: string): number {
  const prevNorm = normalize(prevTail);
  const currNorm = normalize(currHead);
  
  if (!prevNorm || !currNorm) return 0;
  
  // 从最大可能重叠开始，逐步减小
  const maxLen = Math.min(prevNorm.length, currNorm.length);
  for (let len = maxLen; len >= 1; len--) {
    const prevSuffix = prevNorm.slice(-len);
    const currPrefix = currNorm.slice(0, len);
    if (prevSuffix === currPrefix) {
      return len;
    }
  }
  
  return 0;
}

/**
 * 去重合并：检测并裁剪边界重叠
 * @param prevTail 上一段的尾部文本
 * @param currHead 当前段的开头文本
 * @param config 去重配置
 * @returns 裁剪后的当前段文本，以及是否发生了去重
 */
export function dedupMerge(
  prevTail: string,
  currHead: string,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): { text: string; deduped: boolean; overlapChars: number } {
  if (!prevTail || !currHead) {
    return { text: currHead, deduped: false, overlapChars: 0 };
  }

  // 查找重叠
  const overlap = findLongestOverlap(prevTail, currHead);
  
  // 如果重叠在阈值范围内，进行裁剪
  if (overlap >= config.minOverlap && overlap <= config.maxOverlap) {
    // 计算原始文本中的重叠位置（考虑空格和大小写）
    // 简化处理：使用 normalize 后的重叠长度，在原始文本中查找
    const prevNorm = normalize(prevTail);
    const currNorm = normalize(currHead);
    
    // 找到重叠部分在原始文本中的位置
    const prevSuffix = prevNorm.slice(-overlap);
    const currPrefix = currNorm.slice(0, overlap);
    
    if (prevSuffix === currPrefix) {
      // 在原始文本中查找重叠部分
      // 从 prevTail 末尾开始查找，从 currHead 开头开始查找
      let prevMatchStart = -1;
      let currMatchEnd = -1;
      
      // 在 prevTail 中查找重叠部分（从末尾开始）
      const prevLower = prevTail.toLowerCase().replace(/\s+/g, '');
      const suffixLower = prevSuffix.toLowerCase();
      const lastIndex = prevLower.lastIndexOf(suffixLower);
      if (lastIndex !== -1) {
        prevMatchStart = lastIndex;
      }
      
      // 在 currHead 中查找重叠部分（从开头开始）
      const currLower = currHead.toLowerCase().replace(/\s+/g, '');
      const prefixLower = currPrefix.toLowerCase();
      const firstIndex = currLower.indexOf(prefixLower);
      if (firstIndex !== -1) {
        currMatchEnd = firstIndex + overlap;
      }
      
      // 如果找到了重叠，裁剪 currHead
      if (prevMatchStart !== -1 && currMatchEnd !== -1) {
        // 需要将 normalize 后的位置映射回原始文本
        // 简化：直接使用字符数裁剪（可能不够精确，但通常足够）
        const currNorm = normalize(currHead);
        const remaining = currNorm.slice(overlap);
        
        // 从原始 currHead 中提取剩余部分
        // 由于 normalize 会移除空格，我们需要更智能的方法
        // 简化处理：使用字符数估算
        const overlapRatio = overlap / currNorm.length;
        const estimatedOverlapChars = Math.ceil(currHead.length * overlapRatio);
        const dedupedText = currHead.slice(estimatedOverlapChars);
        
        return {
          text: dedupedText.trim(),
          deduped: true,
          overlapChars: overlap,
        };
      }
    }
  }
  
  return { text: currHead, deduped: false, overlapChars: 0 };
}

/**
 * 更精确的去重合并（基于字符匹配）
 */
export function dedupMergePrecise(
  prevTail: string,
  currHead: string,
  config: DedupConfig = DEFAULT_DEDUP_CONFIG
): { text: string; deduped: boolean; overlapChars: number } {
  if (!prevTail || !currHead) {
    return { text: currHead, deduped: false, overlapChars: 0 };
  }

  const prevNorm = normalize(prevTail);
  const currNorm = normalize(currHead);
  
  if (!prevNorm || !currNorm) {
    return { text: currHead, deduped: false, overlapChars: 0 };
  }

  // 查找最长重叠
  const maxLen = Math.min(prevNorm.length, currNorm.length);
  let bestOverlap = 0;
  
  for (let len = maxLen; len >= config.minOverlap; len--) {
    const prevSuffix = prevNorm.slice(-len);
    const currPrefix = currNorm.slice(0, len);
    if (prevSuffix === currPrefix && len <= config.maxOverlap) {
      bestOverlap = len;
      break;
    }
  }
  
  if (bestOverlap > 0) {
    // 将 normalize 后的重叠长度映射回原始文本
    // 策略：在原始文本中查找对应的重叠部分
    const prevLower = prevTail.toLowerCase();
    const currLower = currHead.toLowerCase();
    
    // 从 prevTail 末尾查找重叠部分
    let prevMatchPos = -1;
    for (let i = prevTail.length; i >= bestOverlap; i--) {
      const substr = normalize(prevTail.slice(i - bestOverlap, i));
      if (substr === prevNorm.slice(-bestOverlap)) {
        prevMatchPos = i - bestOverlap;
        break;
      }
    }
    
    // 从 currHead 开头查找重叠部分
    let currMatchPos = -1;
    for (let i = 0; i <= currHead.length - bestOverlap; i++) {
      const substr = normalize(currHead.slice(i, i + bestOverlap));
      if (substr === currNorm.slice(0, bestOverlap)) {
        currMatchPos = i + bestOverlap;
        break;
      }
    }
    
    if (currMatchPos > 0) {
      const dedupedText = currHead.slice(currMatchPos);
      return {
        text: dedupedText.trim(),
        deduped: true,
        overlapChars: bestOverlap,
      };
    }
  }
  
  return { text: currHead, deduped: false, overlapChars: 0 };
}

/**
 * 检测文本内部重复（如 "要大量的语音别丢弃要大量的语音别丢弃"）
 */
export function detectInternalRepetition(text: string): string {
  if (!text || text.length < 6) return text;
  
  // 检测完全重复（50% 重复）
  const mid = Math.floor(text.length / 2);
  const firstHalf = text.substring(0, mid);
  const secondHalf = text.substring(mid);
  
  // 检查后半部分是否以前半部分开头
  if (secondHalf.startsWith(firstHalf)) {
    // 完全重复，只保留前半部分
    return firstHalf.trim();
  }
  
  // 检测部分重复（60%-90% 重复）
  for (let ratio = 0.6; ratio <= 0.9; ratio += 0.1) {
    const splitPoint = Math.floor(text.length * ratio);
    if (splitPoint < 2) continue;
    
    const part1 = text.substring(0, splitPoint);
    const part2 = text.substring(splitPoint);
    
    // 检查 part2 是否以 part1 开头（至少 3 个字符）
    if (part2.length >= 3 && part2.startsWith(part1.substring(0, Math.min(part1.length, part2.length)))) {
      // 发现重复，只保留 part1
      return part1.trim();
    }
  }
  
  return text;
}

