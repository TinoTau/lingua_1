"use strict";
/* Dedup: 边界重叠裁剪
   用于解决跨 utterance 的边界重复问题（如 "我们 我们可以..."）
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DEDUP_CONFIG = void 0;
exports.dedupMerge = dedupMerge;
exports.dedupMergePrecise = dedupMergePrecise;
exports.detectInternalRepetition = detectInternalRepetition;
exports.DEFAULT_DEDUP_CONFIG = {
    minOverlap: 2, // 降低：检测更短的重复
    maxOverlap: 20, // 提高：检测更长的重复
};
/**
 * 标准化文本（用于重叠检测）
 */
function normalize(s) {
    return s.trim().toLowerCase().replace(/\s+/g, '');
}
/**
 * 查找最长重叠前后缀
 * @param prevTail 上一段的尾部
 * @param currHead 当前段的开头
 * @returns 重叠字符数，如果没有重叠则返回 0
 */
function findLongestOverlap(prevTail, currHead) {
    const prevNorm = normalize(prevTail);
    const currNorm = normalize(currHead);
    if (!prevNorm || !currNorm)
        return 0;
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
function dedupMerge(prevTail, currHead, config = exports.DEFAULT_DEDUP_CONFIG) {
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
function dedupMergePrecise(prevTail, currHead, config = exports.DEFAULT_DEDUP_CONFIG) {
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
/**
 * 检测文本内部重复（如 "要大量的语音别丢弃要大量的语音别丢弃" 或 "再提高了一点速度 再提高了一点速度"）
 * 修复：改进检测逻辑，支持检测末尾重复（叠字叠词）
 */
function detectInternalRepetition(text) {
    if (!text || text.length < 4)
        return text;
    const trimmedText = text.trim();
    // 方法1：检测完全重复（50% 重复）
    const mid = Math.floor(trimmedText.length / 2);
    const firstHalf = trimmedText.substring(0, mid);
    const secondHalf = trimmedText.substring(mid);
    // 检查后半部分是否以前半部分开头（允许少量差异，如空格）
    const firstHalfNormalized = firstHalf.trim().replace(/\s+/g, ' ');
    const secondHalfNormalized = secondHalf.trim().replace(/\s+/g, ' ');
    if (secondHalfNormalized.startsWith(firstHalfNormalized) && firstHalfNormalized.length >= 3) {
        // 完全重复，只保留前半部分
        return firstHalf.trim();
    }
    // 方法1.5：检测近似重复（允许少量字符差异）
    // 例如："这个语音阶段正常来我们就可以使用" vs "这个语音阶段正常来我们可以使用"
    // 差异："可以" vs "可以"（完全相同，但可能因为空格等原因导致不完全匹配）
    if (firstHalfNormalized.length >= 3 && secondHalfNormalized.length >= 3) {
        // 计算相似度：检查后半部分的前N个字符是否与前半部分高度相似
        const compareLen = Math.min(firstHalfNormalized.length, secondHalfNormalized.length);
        let matchCount = 0;
        for (let i = 0; i < compareLen; i++) {
            if (firstHalfNormalized[i] === secondHalfNormalized[i]) {
                matchCount++;
            }
        }
        const similarity = matchCount / compareLen;
        // 如果相似度 >= 0.9（90%），认为是重复
        if (similarity >= 0.9 && compareLen >= 3) {
            return firstHalf.trim();
        }
    }
    // 方法2：检测末尾重复（如 "再提高了一点速度 再提高了一点速度"）
    // 从文本末尾开始，检测是否有重复的短语
    const words = trimmedText.split(/\s+/);
    if (words.length >= 4) {
        // 检测末尾是否有重复的词或短语
        // 从末尾开始，尝试匹配前面的内容
        for (let repeatLen = 2; repeatLen <= Math.min(words.length / 2, 10); repeatLen++) {
            const lastWords = words.slice(-repeatLen).join(' ');
            const beforeLastWords = words.slice(-repeatLen * 2, -repeatLen).join(' ');
            if (lastWords === beforeLastWords && lastWords.length >= 3) {
                // 发现末尾重复，只保留前面的部分
                return words.slice(0, words.length - repeatLen).join(' ').trim();
            }
        }
    }
    // 方法3：检测部分重复（60%-90% 重复）
    for (let ratio = 0.6; ratio <= 0.9; ratio += 0.1) {
        const splitPoint = Math.floor(trimmedText.length * ratio);
        if (splitPoint < 2)
            continue;
        const part1 = trimmedText.substring(0, splitPoint);
        const part2 = trimmedText.substring(splitPoint);
        // 标准化空格后检查
        const part1Normalized = part1.trim().replace(/\s+/g, ' ');
        const part2Normalized = part2.trim().replace(/\s+/g, ' ');
        // 检查 part2 是否以 part1 开头（至少 3 个字符）
        if (part2Normalized.length >= 3 && part2Normalized.startsWith(part1Normalized.substring(0, Math.min(part1Normalized.length, part2Normalized.length)))) {
            // 发现重复，只保留 part1
            return part1.trim();
        }
    }
    return text;
}
