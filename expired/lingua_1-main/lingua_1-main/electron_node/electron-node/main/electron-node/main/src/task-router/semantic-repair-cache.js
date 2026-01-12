"use strict";
/**
 * 语义修复结果缓存管理器
 * P2-1: 实现修复结果缓存机制，降低重复调用成本
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairCache = void 0;
const lru_cache_1 = require("lru-cache");
const logger_1 = __importDefault(require("../logger"));
/**
 * 语义修复结果缓存
 */
class SemanticRepairCache {
    constructor(config = {}) {
        const maxSize = config.maxSize || 200;
        const ttlMs = config.ttlMs || 5 * 60 * 1000; // 默认5分钟
        this.modelVersion = config.modelVersion || 'default';
        this.cache = new lru_cache_1.LRUCache({
            max: maxSize,
            ttl: ttlMs,
        });
        logger_1.default.info({
            maxSize,
            ttlMs,
            modelVersion: this.modelVersion,
        }, 'SemanticRepairCache: Initialized');
    }
    /**
     * 生成缓存键
     * 格式：lang:text_in:model_version
     * @param lang 语言
     * @param textIn 输入文本
     * @returns 缓存键
     */
    generateCacheKey(lang, textIn) {
        // 规范化文本（去除首尾空格，规范化空白字符）
        const normalizedText = this.normalizeText(textIn);
        // 如果文本太长，使用哈希
        let textKey;
        if (normalizedText.length > 100) {
            const hash = this.simpleHash(normalizedText);
            textKey = `${normalizedText.substring(0, 30)}...${normalizedText.substring(normalizedText.length - 30)}|${hash}`;
        }
        else {
            textKey = normalizedText;
        }
        return `${lang}:${textKey}:${this.modelVersion}`;
    }
    /**
     * 规范化文本（用于缓存键生成）
     */
    normalizeText(text) {
        if (!text)
            return '';
        // 去除首尾空格
        let normalized = text.trim();
        // 规范化空白字符：多个空格/换行/制表符合并为一个空格
        normalized = normalized.replace(/\s+/g, ' ');
        return normalized;
    }
    /**
     * 简单哈希函数（用于长文本）
     */
    simpleHash(text) {
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
     */
    shouldCache(text) {
        const normalized = this.normalizeText(text);
        return normalized.length >= 3 && normalized.length <= 500;
    }
    /**
     * 获取缓存结果
     * @param lang 语言
     * @param textIn 输入文本
     * @returns 缓存结果，如果未命中则返回null
     */
    get(lang, textIn) {
        if (!this.shouldCache(textIn)) {
            return undefined;
        }
        const key = this.generateCacheKey(lang, textIn);
        const result = this.cache.get(key);
        if (result) {
            logger_1.default.debug({
                lang,
                textInPreview: textIn.substring(0, 50),
                decision: result.decision,
                confidence: result.confidence,
            }, 'SemanticRepairCache: Cache hit');
        }
        return result;
    }
    /**
     * 设置缓存结果
     * @param lang 语言
     * @param textIn 输入文本
     * @param result 修复结果
     */
    set(lang, textIn, result) {
        if (!this.shouldCache(textIn)) {
            return;
        }
        // 只缓存REPAIR决策的结果（PASS不需要缓存）
        if (result.decision !== 'REPAIR') {
            return;
        }
        const key = this.generateCacheKey(lang, textIn);
        this.cache.set(key, result);
        logger_1.default.debug({
            lang,
            textInPreview: textIn.substring(0, 50),
            decision: result.decision,
            confidence: result.confidence,
            cacheSize: this.cache.size,
        }, 'SemanticRepairCache: Cache set');
    }
    /**
     * 清除缓存
     */
    clear() {
        this.cache.clear();
        logger_1.default.info({}, 'SemanticRepairCache: Cache cleared');
    }
    /**
     * 获取缓存统计信息
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.cache.max,
            modelVersion: this.modelVersion,
        };
    }
    /**
     * 更新模型版本（当模型更新时调用）
     * 注意：更新模型版本会清除所有缓存
     */
    updateModelVersion(newVersion) {
        if (newVersion !== this.modelVersion) {
            logger_1.default.info({
                oldVersion: this.modelVersion,
                newVersion,
            }, 'SemanticRepairCache: Model version updated, clearing cache');
            this.modelVersion = newVersion;
            this.cache.clear();
        }
    }
}
exports.SemanticRepairCache = SemanticRepairCache;
