"use strict";
/**
 * Semantic Repair Validator
 * P1-2: Prompt与输出校验增强
 * 验证修复后的文本是否符合要求
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairValidator = void 0;
const logger_1 = __importDefault(require("../../logger"));
class SemanticRepairValidator {
    constructor(config = {}) {
        this.config = {
            maxLengthChangeRatio: config.maxLengthChangeRatio ?? 0.2,
            strictNumberPreservation: config.strictNumberPreservation ?? true,
            strictUrlPreservation: config.strictUrlPreservation ?? true,
            strictEmailPreservation: config.strictEmailPreservation ?? true,
        };
    }
    /**
     * 验证修复后的文本
     */
    validate(originalText, repairedText) {
        const reasonCodes = [];
        const details = {
            originalLength: originalText.length,
            repairedLength: repairedText.length,
        };
        // 1. 长度变化检查
        const lengthChangeRatio = Math.abs(repairedText.length - originalText.length) / originalText.length;
        details.lengthChangeRatio = lengthChangeRatio;
        if (lengthChangeRatio > this.config.maxLengthChangeRatio) {
            reasonCodes.push('LENGTH_CHANGE_EXCEEDED');
            logger_1.default.warn({
                originalLength: originalText.length,
                repairedLength: repairedText.length,
                lengthChangeRatio,
                maxRatio: this.config.maxLengthChangeRatio,
            }, 'SemanticRepairValidator: Length change exceeded threshold');
        }
        // 2. 数字保护检查
        if (this.config.strictNumberPreservation) {
            const originalNumbers = this.extractNumbers(originalText);
            const repairedNumbers = this.extractNumbers(repairedText);
            if (originalNumbers.length > 0) {
                if (repairedNumbers.length === 0) {
                    // 所有数字都丢失
                    reasonCodes.push('NUMBERS_MISSING');
                    details.missingNumbers = true;
                    logger_1.default.warn({
                        originalText: originalText.substring(0, 100),
                        repairedText: repairedText.substring(0, 100),
                        originalNumbers,
                    }, 'SemanticRepairValidator: Numbers missing in repaired text');
                }
                else {
                    // 检查关键数字是否保留（至少保留一个）
                    const matchedNumbers = originalNumbers.filter(num => repairedNumbers.some(rNum => rNum === num || rNum.includes(num) || num.includes(rNum)));
                    if (matchedNumbers.length === 0) {
                        // 所有数字都不匹配（可能被修改）
                        reasonCodes.push('NUMBERS_MISSING');
                        details.missingNumbers = true;
                    }
                }
            }
        }
        // 3. URL保护检查
        if (this.config.strictUrlPreservation) {
            const originalUrls = this.extractUrls(originalText);
            const repairedUrls = this.extractUrls(repairedText);
            if (originalUrls.length > 0 && repairedUrls.length === 0) {
                reasonCodes.push('URLS_MISSING');
                details.missingUrls = true;
                logger_1.default.warn({
                    originalText: originalText.substring(0, 100),
                    repairedText: repairedText.substring(0, 100),
                    originalUrls,
                }, 'SemanticRepairValidator: URLs missing in repaired text');
            }
        }
        // 4. 邮箱保护检查
        if (this.config.strictEmailPreservation) {
            const originalEmails = this.extractEmails(originalText);
            const repairedEmails = this.extractEmails(repairedText);
            if (originalEmails.length > 0 && repairedEmails.length === 0) {
                reasonCodes.push('EMAILS_MISSING');
                details.missingEmails = true;
                logger_1.default.warn({
                    originalText: originalText.substring(0, 100),
                    repairedText: repairedText.substring(0, 100),
                    originalEmails,
                }, 'SemanticRepairValidator: Emails missing in repaired text');
            }
        }
        const isValid = reasonCodes.length === 0;
        return {
            isValid,
            reasonCodes,
            details,
        };
    }
    /**
     * 提取文本中的数字
     */
    extractNumbers(text) {
        // 匹配数字（包括整数、小数、百分比等）
        const numberPattern = /\d+(?:\.\d+)?(?:%|万|千|百|十)?/g;
        const matches = text.match(numberPattern);
        return matches || [];
    }
    /**
     * 提取文本中的URL
     */
    extractUrls(text) {
        // 匹配URL（http/https/www开头）
        const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
        const matches = text.match(urlPattern);
        return matches || [];
    }
    /**
     * 提取文本中的邮箱
     */
    extractEmails(text) {
        // 匹配邮箱地址
        const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const matches = text.match(emailPattern);
        return matches || [];
    }
}
exports.SemanticRepairValidator = SemanticRepairValidator;
