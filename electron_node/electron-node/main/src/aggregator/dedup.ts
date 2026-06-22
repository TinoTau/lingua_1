/* Dedup: 边界重叠裁剪
   用于解决跨 utterance 的边界重复问题（如 "我们 我们可以..."）
*/

export interface DedupConfig {
  minOverlap: number;  // 最小重叠字符数（3-5 字符 / 1-2 词）
  maxOverlap: number;  // 最大重叠字符数（10-18 字符 / 5-8 词）
}

export const DEFAULT_DEDUP_CONFIG: DedupConfig = {
  minOverlap: 2,   // 最小重叠：2个字符
  maxOverlap: 50,  // 最大重叠：50个字符（支持hangover重叠，通常hangover在500ms左右，约10-20个字符，但为了安全起见提高到50）
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
): { text: string; deduped: boolean; overlapChars: number; isCompletelyContained?: boolean } {
  if (!prevTail || !currHead) {
    return { text: currHead, deduped: false, overlapChars: 0 };
  }

  const prevNorm = normalize(prevTail);
  const currNorm = normalize(currHead);
  
  if (!prevNorm || !currNorm) {
    return { text: currHead, deduped: false, overlapChars: 0 };
  }

  // 修复：检测完全包含的情况
  // 如果currHead完全等于prevTail的某个后缀，或者currHead完全被prevTail包含
  // 例如：prevTail="继续"，currHead="继续" -> 完全重复，应该丢弃
  if (prevNorm.endsWith(currNorm) && currNorm.length >= config.minOverlap) {
    // 完全重复，返回空文本
    return {
      text: '',
      deduped: true,
      overlapChars: currNorm.length,
      isCompletelyContained: true,
    };
  }

  // 查找最长重叠
  const maxLen = Math.min(prevNorm.length, currNorm.length);
  let bestOverlap = 0;
  
  // 方法1：完全匹配（原有逻辑）
  for (let len = maxLen; len >= config.minOverlap; len--) {
    const prevSuffix = prevNorm.slice(-len);
    const currPrefix = currNorm.slice(0, len);
    if (prevSuffix === currPrefix && len <= config.maxOverlap) {
      bestOverlap = len;
      break;
    }
  }
  
  // 方法2：部分匹配（新增）- 如果完全匹配失败，尝试部分匹配
  // 例如：prevTail="继续使用"，currHead="使用" -> 检测到"使用"包含在"继续使用"中
  if (bestOverlap === 0) {
    // 检查currHead的开头是否包含在prevTail的末尾中
    // 从currHead的开头开始，逐步增加长度，检查是否包含在prevTail的末尾
    for (let len = Math.min(currNorm.length, prevNorm.length, config.maxOverlap); len >= config.minOverlap; len--) {
      const currPrefix = currNorm.slice(0, len);
      // 检查prevTail的末尾是否包含currPrefix
      const prevTailSuffix = prevNorm.slice(-Math.min(prevNorm.length, len + 5)); // 检查末尾稍长一点的范围
      if (prevTailSuffix.includes(currPrefix)) {
        // 找到包含关系，计算重叠长度
        const overlapIndex = prevTailSuffix.indexOf(currPrefix);
        const actualOverlap = prevTailSuffix.length - overlapIndex;
        if (actualOverlap >= config.minOverlap && actualOverlap <= config.maxOverlap) {
          bestOverlap = actualOverlap;
          break;
        }
      }
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

// --- Duplicate Guard (final output sanitize) ---

export type DuplicateRule =
  | 'prefix_repeat'
  | 'half_duplicate'
  | 'tail_duplicate'
  | 'partial_duplicate'
  | 'none';

export interface DuplicateSanitizeTrace {
  applied: boolean;
  rule: DuplicateRule;
  repeatUnit?: string;
  repeatCount?: number;
  beforeLength: number;
  afterLength: number;
}

export interface SanitizeSegmentResult {
  text: string;
  trace: DuplicateSanitizeTrace;
}

const PREFIX_MIN_REPEAT = 3;
const PREFIX_MIN_UNIT_LEN = 2;
const PREFIX_MAX_UNIT_LEN = 16;

interface PrefixRepeatHit {
  unit: string;
  count: number;
  suffix: string;
}

function countLeadingRepeats(text: string, unitLen: number): { count: number; suffix: string } {
  const unit = text.slice(0, unitLen);
  if (unit.length < unitLen) {
    return { count: 0, suffix: text };
  }
  let count = 0;
  let pos = 0;
  while (text.slice(pos, pos + unitLen) === unit) {
    count += 1;
    pos += unitLen;
  }
  return { count, suffix: text.slice(pos) };
}

function findPrefixRepeatHit(text: string): PrefixRepeatHit | null {
  let best: (PrefixRepeatHit & { unitLen: number }) | null = null;

  for (let unitLen = PREFIX_MIN_UNIT_LEN; unitLen <= PREFIX_MAX_UNIT_LEN && unitLen <= text.length; unitLen += 1) {
    const { count, suffix } = countLeadingRepeats(text, unitLen);
    if (count < PREFIX_MIN_REPEAT) {
      continue;
    }
    const unit = text.slice(0, unitLen);
    if (
      !best
      || count > best.count
      || (count === best.count && unitLen < best.unitLen)
    ) {
      best = { unit, count, suffix, unitLen };
    }
  }

  return best ? { unit: best.unit, count: best.count, suffix: best.suffix } : null;
}

function collapsePrefixRepeat(text: string): { text: string; unit: string; count: number } | null {
  const hit = findPrefixRepeatHit(text);
  if (!hit) {
    return null;
  }
  const output = hit.suffix.length > 0 ? hit.suffix.trim() : hit.unit;
  return { text: output, unit: hit.unit, count: hit.count };
}

/** Migrated from legacy detectInternalRepetition — half / tail / partial only. */
function collapseHalfTailPartialDuplicate(text: string): { text: string; rule: DuplicateRule } | null {
  if (!text || text.length < 4) {
    return null;
  }

  const trimmedText = text.trim();

  const mid = Math.floor(trimmedText.length / 2);
  const firstHalf = trimmedText.substring(0, mid);
  const secondHalf = trimmedText.substring(mid);
  const firstHalfNormalized = firstHalf.trim().replace(/\s+/g, ' ');
  const secondHalfNormalized = secondHalf.trim().replace(/\s+/g, ' ');

  if (secondHalfNormalized.startsWith(firstHalfNormalized) && firstHalfNormalized.length >= 3) {
    return { text: firstHalf.trim(), rule: 'half_duplicate' };
  }

  if (firstHalfNormalized.length >= 3 && secondHalfNormalized.length >= 3) {
    const compareLen = Math.min(firstHalfNormalized.length, secondHalfNormalized.length);
    let matchCount = 0;
    for (let i = 0; i < compareLen; i += 1) {
      if (firstHalfNormalized[i] === secondHalfNormalized[i]) {
        matchCount += 1;
      }
    }
    const similarity = matchCount / compareLen;
    if (similarity >= 0.9 && compareLen >= 3) {
      return { text: firstHalf.trim(), rule: 'half_duplicate' };
    }
  }

  const words = trimmedText.split(/\s+/);
  if (words.length >= 4) {
    for (let repeatLen = 2; repeatLen <= Math.min(words.length / 2, 10); repeatLen += 1) {
      const lastWords = words.slice(-repeatLen).join(' ');
      const beforeLastWords = words.slice(-repeatLen * 2, -repeatLen).join(' ');
      if (lastWords === beforeLastWords && lastWords.length >= 3) {
        return { text: words.slice(0, words.length - repeatLen).join(' ').trim(), rule: 'tail_duplicate' };
      }
    }
  }

  for (let ratio = 0.6; ratio <= 0.9; ratio += 0.1) {
    const splitPoint = Math.floor(trimmedText.length * ratio);
    if (splitPoint < 2) {
      continue;
    }
    const part1 = trimmedText.substring(0, splitPoint);
    const part2 = trimmedText.substring(splitPoint);
    const part1Normalized = part1.trim().replace(/\s+/g, ' ');
    const part2Normalized = part2.trim().replace(/\s+/g, ' ');
    if (
      part2Normalized.length >= 3
      && part2Normalized.startsWith(
        part1Normalized.substring(0, Math.min(part1Normalized.length, part2Normalized.length))
      )
    ) {
      return { text: part1.trim(), rule: 'partial_duplicate' };
    }
  }

  return null;
}

function noneTrace(beforeLength: number, afterLength: number): DuplicateSanitizeTrace {
  return { applied: false, rule: 'none', beforeLength, afterLength };
}

/** Final-output duplicate sanitize — single entry (Implementation Contract V1.0). */
export function sanitizeSegmentForOutput(text: string): SanitizeSegmentResult {
  const beforeLength = text.length;

  if (!text || text.trim().length === 0) {
    return { text: '', trace: noneTrace(beforeLength, 0) };
  }

  let working = text;
  let prefixHit: ReturnType<typeof collapsePrefixRepeat> = null;
  let phase2Hit: ReturnType<typeof collapseHalfTailPartialDuplicate> = null;

  prefixHit = collapsePrefixRepeat(working);
  if (prefixHit) {
    working = prefixHit.text;
  }

  phase2Hit = collapseHalfTailPartialDuplicate(working);
  if (phase2Hit) {
    working = phase2Hit.text;
  }

  working = working.trim();
  const afterLength = working.length;

  if (prefixHit) {
    return {
      text: working,
      trace: {
        applied: true,
        rule: 'prefix_repeat',
        repeatUnit: prefixHit.unit,
        repeatCount: prefixHit.count,
        beforeLength,
        afterLength,
      },
    };
  }

  if (phase2Hit) {
    return {
      text: working,
      trace: {
        applied: true,
        rule: phase2Hit.rule,
        beforeLength,
        afterLength,
      },
    };
  }

  return { text: working, trace: noneTrace(beforeLength, afterLength) };
}

