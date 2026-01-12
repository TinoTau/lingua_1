"use strict";
/* Tail Carry: 尾巴延迟归属
   每次 commit 时保留尾部 token/字符，不立即输出
   下一轮合并时作为 prefix 参与去重与归属判断
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TAIL_CARRY_CONFIG = void 0;
exports.calculateTailLength = calculateTailLength;
exports.extractTail = extractTail;
exports.removeTail = removeTail;
const aggregator_decision_1 = require("./aggregator-decision");
exports.DEFAULT_TAIL_CARRY_CONFIG = {
    tailCarryTokens: 3, // 提高：从 2 提高到 3
    tailCarryCjkChars: 6, // 提高：从 4 提高到 6
};
/**
 * 计算应该保留的尾部长度
 */
function calculateTailLength(text, config = exports.DEFAULT_TAIL_CARRY_CONFIG) {
    if (!text || text.trim().length === 0)
        return 0;
    const isCjk = (0, aggregator_decision_1.looksLikeCjk)(text);
    if (isCjk) {
        const cjkChars = (0, aggregator_decision_1.countCjkChars)(text);
        // 如果文本太短，不保留 tail
        if (cjkChars <= config.tailCarryCjkChars)
            return 0;
        return config.tailCarryCjkChars;
    }
    else {
        const words = (0, aggregator_decision_1.countWords)(text);
        // 如果文本太短，不保留 tail
        if (words <= config.tailCarryTokens)
            return 0;
        // 返回最后 N 个词的长度（近似）
        const wordsArray = text.trim().split(/\s+/);
        if (wordsArray.length <= config.tailCarryTokens)
            return 0;
        // 计算最后 N 个词的总字符数
        const tailWords = wordsArray.slice(-config.tailCarryTokens);
        return tailWords.join(' ').length;
    }
}
/**
 * 提取尾部文本（用于下一轮合并）
 */
function extractTail(text, config = exports.DEFAULT_TAIL_CARRY_CONFIG) {
    const tailLength = calculateTailLength(text, config);
    if (tailLength === 0)
        return '';
    // 从末尾提取指定长度的文本
    // 对于 CJK，直接按字符数提取
    // 对于英文，按词提取
    const isCjk = (0, aggregator_decision_1.looksLikeCjk)(text);
    if (isCjk) {
        // CJK 模式：提取最后 N 个字符
        const chars = Array.from(text);
        if (chars.length <= config.tailCarryCjkChars)
            return '';
        return chars.slice(-config.tailCarryCjkChars).join('');
    }
    else {
        // 英文模式：提取最后 N 个词
        const words = text.trim().split(/\s+/);
        if (words.length <= config.tailCarryTokens)
            return '';
        return words.slice(-config.tailCarryTokens).join(' ');
    }
}
/**
 * 检测文本末尾的重复（叠字叠词）
 * 例如："再提高了一点速度 再提高了一点速度" -> 检测到重复，返回重复部分的长度
 */
function detectTailRepetition(text) {
    if (!text || text.length < 4)
        return 0;
    const trimmedText = text.trim();
    const isCjk = (0, aggregator_decision_1.looksLikeCjk)(text);
    if (isCjk) {
        // CJK模式：检测末尾重复的字符或短语
        const chars = Array.from(trimmedText);
        const totalLen = chars.length;
        // 检测末尾重复的字符（如 "速度速度"）
        for (let repeatLen = 1; repeatLen <= Math.min(6, totalLen / 2); repeatLen++) {
            if (totalLen < repeatLen * 2)
                break;
            const lastRepeat = chars.slice(-repeatLen).join('');
            const beforeRepeat = chars.slice(-repeatLen * 2, -repeatLen).join('');
            if (lastRepeat === beforeRepeat) {
                return repeatLen; // 返回重复部分的长度
            }
        }
        // 检测末尾重复的短语（如 "再提高了一点速度 再提高了一点速度"）
        // 从较长的短语开始检测（最多检测到文本长度的一半）
        for (let phraseLen = 3; phraseLen <= Math.min(20, totalLen / 2); phraseLen++) {
            if (totalLen < phraseLen * 2)
                break;
            const lastPhrase = chars.slice(-phraseLen).join('');
            const beforePhrase = chars.slice(-phraseLen * 2, -phraseLen).join('');
            if (lastPhrase === beforePhrase) {
                return phraseLen; // 返回重复部分的长度
            }
        }
    }
    else {
        // 英文模式：检测末尾重复的词或短语
        const words = trimmedText.split(/\s+/);
        const totalWords = words.length;
        // 检测末尾重复的词（如 "speed speed"）
        for (let repeatWords = 1; repeatWords <= Math.min(3, totalWords / 2); repeatWords++) {
            if (totalWords < repeatWords * 2)
                break;
            const lastRepeat = words.slice(-repeatWords).join(' ');
            const beforeRepeat = words.slice(-repeatWords * 2, -repeatWords).join(' ');
            if (lastRepeat === beforeRepeat) {
                return lastRepeat.length; // 返回重复部分的字符长度
            }
        }
    }
    return 0; // 没有检测到重复
}
/**
 * 移除尾部文本（用于 commit）
 * 修复：优先检测并移除末尾的重复文本（叠字叠词），而不是固定移除字符数
 */
function removeTail(text, config = exports.DEFAULT_TAIL_CARRY_CONFIG) {
    if (!text || text.trim().length === 0)
        return text;
    const trimmedText = text.trim();
    // 优先检测末尾重复（叠字叠词）
    const repetitionLen = detectTailRepetition(trimmedText);
    if (repetitionLen > 0) {
        // 检测到重复，移除重复部分
        const isCjk = (0, aggregator_decision_1.looksLikeCjk)(text);
        if (isCjk) {
            const chars = Array.from(trimmedText);
            if (chars.length >= repetitionLen) {
                return chars.slice(0, chars.length - repetitionLen).join('').trim();
            }
        }
        else {
            // 英文模式：按词移除
            const words = trimmedText.split(/\s+/);
            // 计算重复部分包含的词数（近似）
            const repeatWords = Math.ceil(repetitionLen / 10); // 粗略估算：每个词约10个字符
            if (words.length >= repeatWords) {
                return words.slice(0, words.length - repeatWords).join(' ').trim();
            }
        }
    }
    // 如果没有检测到重复，使用原有的tail buffer逻辑
    const tail = extractTail(text, config);
    if (!tail)
        return text;
    // 从文本末尾精确移除 tail（不使用 lastIndexOf，因为 tail 可能在文本中间也出现）
    // 直接检查文本是否以 tail 结尾
    if (trimmedText.endsWith(tail)) {
        // 从末尾移除 tail
        return trimmedText.slice(0, trimmedText.length - tail.length).trim();
    }
    // 如果文本不以 tail 结尾（可能因为空格等），尝试从末尾按字符数移除（兜底逻辑）
    const isCjk = (0, aggregator_decision_1.looksLikeCjk)(text);
    if (isCjk) {
        const chars = Array.from(trimmedText);
        if (chars.length > config.tailCarryCjkChars) {
            return chars.slice(0, chars.length - config.tailCarryCjkChars).join('').trim();
        }
    }
    else {
        const words = trimmedText.split(/\s+/);
        if (words.length > config.tailCarryTokens) {
            return words.slice(0, words.length - config.tailCarryTokens).join(' ').trim();
        }
    }
    return text;
}
