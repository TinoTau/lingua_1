"use strict";
/**
 * 文本验证工具
 * 提供文本验证相关的工具函数
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMeaninglessWord = isMeaninglessWord;
exports.isEmptyText = isEmptyText;
/**
 * 无意义单词列表
 */
const MEANINGLESS_WORDS = ['the', 'a', 'an', 'this', 'that', 'it'];
/**
 * 检查文本是否为无意义单词
 */
function isMeaninglessWord(text) {
    const trimmed = text.trim().toLowerCase();
    return MEANINGLESS_WORDS.includes(trimmed);
}
/**
 * 检查文本是否为空
 */
function isEmptyText(text) {
    return !text || text.trim().length === 0;
}
