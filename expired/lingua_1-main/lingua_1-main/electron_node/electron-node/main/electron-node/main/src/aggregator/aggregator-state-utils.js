"use strict";
/**
 * Aggregator State Utilities
 * 处理时间计算和关键词提取等辅助方法
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStateUtils = void 0;
class AggregatorStateUtils {
    /**
     * 计算 utterance 的时间戳（从 segments 推导）
     */
    static calculateUtteranceTime(segments, sessionStartTimeMs, lastUtteranceEndTimeMs) {
        let startMs = 0;
        let endMs = 0;
        let newSessionStartTimeMs = sessionStartTimeMs;
        if (segments && segments.length > 0) {
            // 从 segments 推导时间戳
            const firstSegment = segments[0];
            const lastSegment = segments[segments.length - 1];
            if (firstSegment.start !== undefined) {
                // segments 的时间是相对于音频开始的（秒），需要转换为绝对时间
                // 第一个 utterance：使用会话开始时间
                // 后续 utterance：使用上一个 utterance 的结束时间作为参考
                if (sessionStartTimeMs === 0) {
                    // 第一个 utterance
                    newSessionStartTimeMs = Date.now();
                    startMs = newSessionStartTimeMs;
                }
                else {
                    // 后续 utterance：使用上一个 utterance 的结束时间 + segments 的相对时间
                    startMs = lastUtteranceEndTimeMs + (firstSegment.start * 1000);
                }
            }
            else {
                // segments 没有时间戳，使用当前时间
                startMs = Date.now();
                if (sessionStartTimeMs === 0) {
                    newSessionStartTimeMs = startMs;
                }
            }
            if (lastSegment.end !== undefined) {
                // 计算结束时间
                if (sessionStartTimeMs === 0) {
                    endMs = newSessionStartTimeMs + (lastSegment.end * 1000);
                }
                else {
                    endMs = startMs + ((lastSegment.end - (firstSegment.start || 0)) * 1000);
                }
            }
            else {
                // 估算：假设 utterance 持续 1 秒
                endMs = startMs + 1000;
            }
        }
        else {
            // 没有 segments，使用当前时间和估算
            const nowMs = Date.now();
            if (sessionStartTimeMs === 0) {
                newSessionStartTimeMs = nowMs;
                startMs = nowMs;
            }
            else {
                startMs = lastUtteranceEndTimeMs || nowMs;
            }
            endMs = startMs + 1000; // 估算 1 秒
        }
        // 计算 gap
        const gapMs = lastUtteranceEndTimeMs > 0
            ? Math.max(0, startMs - lastUtteranceEndTimeMs)
            : 0;
        return { startMs, endMs, gapMs, newSessionStartTimeMs };
    }
    /**
     * 从最近文本中提取关键词
     */
    static extractKeywordsFromRecent(recentCommittedText) {
        const keywords = new Set();
        for (const text of recentCommittedText) {
            // 提取可能的专名和术语
            const cjkMatches = text.match(/[\u4e00-\u9fff]{2,6}/g);
            if (cjkMatches) {
                for (const word of cjkMatches) {
                    keywords.add(word);
                }
            }
            const enMatches = text.match(/\b[A-Z][a-z]{2,}\b|\b[A-Z]{3,}\b/g);
            if (enMatches) {
                for (const word of enMatches) {
                    keywords.add(word);
                }
            }
        }
        return Array.from(keywords);
    }
    /**
     * 合并关键词列表（保留用户配置的）
     */
    static mergeKeywords(userKeywords, extractedKeywords) {
        const merged = [...userKeywords];
        for (const kw of extractedKeywords) {
            if (!merged.includes(kw)) {
                merged.push(kw);
            }
        }
        // 限制数量
        if (merged.length > 30) {
            return merged.slice(-30);
        }
        return merged;
    }
}
exports.AggregatorStateUtils = AggregatorStateUtils;
