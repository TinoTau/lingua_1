"use strict";
/**
 * Memory Analyzer - 内存分析工具
 * 用于分析节点端的内存占用情况
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryAnalyzer = void 0;
const logger_1 = __importDefault(require("../logger"));
class MemoryAnalyzer {
    /**
     * 估算字符串占用的内存（字节）
     */
    static estimateStringMemory(str) {
        // JavaScript 字符串：每个字符约 2 字节（UTF-16）
        return str.length * 2;
    }
    /**
     * 分析 AggregatorManager 的内存占用
     */
    static analyzeAggregatorManager(manager) {
        if (!manager) {
            return null;
        }
        const stats = manager.getStats();
        const totalSessions = stats.totalSessions;
        // 估算每个 AggregatorState 的内存占用
        // - sessionId: ~50 bytes
        // - pendingText: ~100 bytes (平均)
        // - lastUtterance: ~200 bytes
        // - tailBuffer: ~50 bytes
        // - recentCommittedText: ~500 bytes (5条，每条100字节)
        // - recentKeywords: ~200 bytes (10个关键词，每个20字节)
        // - metrics: ~100 bytes
        // 总计：约 1200 bytes per session
        const bytesPerSession = 1200;
        const estimatedMemoryBytes = totalSessions * bytesPerSession;
        const estimatedMemoryMB = estimatedMemoryBytes / (1024 * 1024);
        return {
            totalSessions,
            activeSessions: stats.activeSessions,
            estimatedMemoryMB,
        };
    }
    /**
     * 分析 TranslationCache 的内存占用
     */
    static analyzeTranslationCache(cache) {
        if (!cache) {
            return null;
        }
        // LRUCache 的 size 方法
        const size = cache.size || 0;
        const maxSize = cache.max || 200;
        // 估算每条缓存的内存占用
        // - key: ~100 bytes (cacheKey)
        // - value: ~200 bytes (翻译文本，平均)
        // 总计：约 300 bytes per entry
        const bytesPerEntry = 300;
        const estimatedMemoryBytes = size * bytesPerEntry;
        const estimatedMemoryMB = estimatedMemoryBytes / (1024 * 1024);
        return {
            size,
            maxSize,
            estimatedMemoryMB,
        };
    }
    /**
     * 分析 DedupStage 的内存占用
     */
    static analyzeDedupStage(lastSentTextMap) {
        if (!lastSentTextMap) {
            return null;
        }
        const count = lastSentTextMap.size;
        // 估算每条记录的内存占用
        // - key (sessionId): ~50 bytes
        // - value (text): ~200 bytes (平均)
        // 总计：约 250 bytes per entry
        const bytesPerEntry = 250;
        const estimatedMemoryBytes = count * bytesPerEntry;
        const estimatedMemoryMB = estimatedMemoryBytes / (1024 * 1024);
        return {
            lastSentTextCount: count,
            estimatedMemoryMB,
        };
    }
    /**
     * 综合内存分析
     */
    static analyzeMemory(aggregatorManager, translationCache, dedupLastSentText) {
        const result = {
            totalEstimatedMemoryMB: 0,
        };
        // 分析 AggregatorManager
        const aggregatorInfo = this.analyzeAggregatorManager(aggregatorManager);
        if (aggregatorInfo) {
            result.aggregatorManager = aggregatorInfo;
            result.totalEstimatedMemoryMB += aggregatorInfo.estimatedMemoryMB;
        }
        // 分析 TranslationCache
        const cacheInfo = this.analyzeTranslationCache(translationCache);
        if (cacheInfo) {
            result.translationCache = cacheInfo;
            result.totalEstimatedMemoryMB += cacheInfo.estimatedMemoryMB;
        }
        // 分析 DedupStage
        const dedupInfo = this.analyzeDedupStage(dedupLastSentText || new Map());
        if (dedupInfo) {
            result.dedupStage = dedupInfo;
            result.totalEstimatedMemoryMB += dedupInfo.estimatedMemoryMB;
        }
        return result;
    }
    /**
     * 记录内存使用情况到日志
     */
    static logMemoryUsage(info) {
        logger_1.default.info({
            aggregatorManager: info.aggregatorManager,
            translationCache: info.translationCache,
            dedupStage: info.dedupStage,
            totalEstimatedMemoryMB: info.totalEstimatedMemoryMB.toFixed(2),
        }, 'Memory usage analysis');
    }
}
exports.MemoryAnalyzer = MemoryAnalyzer;
