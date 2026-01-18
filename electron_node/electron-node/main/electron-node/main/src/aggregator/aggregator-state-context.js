"use strict";
/**
 * Aggregator State Context Manager
 * 处理上下文相关的逻辑（翻译文本、关键词等）
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AggregatorStateContextManager = void 0;
const aggregator_state_utils_1 = require("./aggregator-state-utils");
class AggregatorStateContextManager {
    constructor() {
        this.lastTranslatedText = null;
        this.lastTranslatedTextTimestamp = 0;
        this.CONTEXT_TTL_MS = 60 * 1000; // 1分钟过期
        this.recentCommittedText = [];
        this.recentKeywords = [];
        this.lastCommitQuality = undefined;
        this.MAX_RECENT_COMMITS = 10;
    }
    /**
     * 获取上一个 utterance 的翻译文本
     */
    getLastTranslatedText() {
        const now = Date.now();
        // 如果超过1分钟，返回 null
        if (this.lastTranslatedText && (now - this.lastTranslatedTextTimestamp) <= this.CONTEXT_TTL_MS) {
            return this.lastTranslatedText;
        }
        // 过期或不存在，返回 null
        this.lastTranslatedText = null;
        this.lastTranslatedTextTimestamp = 0;
        return null;
    }
    /**
     * 设置上一个 utterance 的翻译文本
     */
    setLastTranslatedText(translatedText) {
        this.lastTranslatedText = translatedText;
        this.lastTranslatedTextTimestamp = Date.now();
    }
    /**
     * 清理翻译文本（NEW_STREAM 时可选调用）
     */
    clearLastTranslatedText() {
        this.lastTranslatedText = null;
        this.lastTranslatedTextTimestamp = 0;
    }
    /**
     * S1/S2: 更新最近提交的文本
     */
    updateRecentCommittedText(text, utteranceIndex) {
        if (!text || !text.trim())
            return;
        this.recentCommittedText.push({
            utteranceIndex,
            text: text.trim(),
        });
        // 保持最多MAX_RECENT_COMMITS条
        if (this.recentCommittedText.length > this.MAX_RECENT_COMMITS) {
            this.recentCommittedText.shift();
        }
        // 按utteranceIndex排序，确保顺序正确
        this.recentCommittedText.sort((a, b) => a.utteranceIndex - b.utteranceIndex);
    }
    /**
     * 更新最后一个提交的文本（用于语义修复后更新）
     * 根据utteranceIndex查找并更新对应的文本
     */
    updateLastCommittedText(utteranceIndex, originalText, repairedText) {
        if (!repairedText || !repairedText.trim())
            return;
        // 查找是否有相同utteranceIndex的文本
        const index = this.recentCommittedText.findIndex(item => item.utteranceIndex === utteranceIndex);
        if (index !== -1) {
            // 如果找到，更新文本
            this.recentCommittedText[index].text = repairedText.trim();
        }
        else {
            // 如果没找到，添加新条目
            this.recentCommittedText.push({
                utteranceIndex,
                text: repairedText.trim(),
            });
            // 保持最多MAX_RECENT_COMMITS条
            if (this.recentCommittedText.length > this.MAX_RECENT_COMMITS) {
                this.recentCommittedText.shift();
            }
            // 按utteranceIndex排序
            this.recentCommittedText.sort((a, b) => a.utteranceIndex - b.utteranceIndex);
        }
    }
    /**
     * 根据utteranceIndex获取已提交的文本
     */
    getLastCommittedText(currentUtteranceIndex) {
        if (!this.recentCommittedText || this.recentCommittedText.length === 0) {
            return null;
        }
        // 从后往前找第一条utteranceIndex < currentUtteranceIndex的文本
        for (let i = this.recentCommittedText.length - 1; i >= 0; i--) {
            const item = this.recentCommittedText[i];
            if (item.utteranceIndex < currentUtteranceIndex) {
                return item.text;
            }
        }
        // 没有比当前index小的，说明这是第一句
        return null;
    }
    /**
     * S1/S2: 获取最近提交的文本（返回文本数组，用于关键词提取等）
     */
    getRecentCommittedText() {
        return this.recentCommittedText.map(item => item.text);
    }
    /**
     * S1/S2: 获取最近关键词
     */
    getRecentKeywords() {
        return [...this.recentKeywords];
    }
    /**
     * S1/S2: 设置用户关键词
     */
    setUserKeywords(keywords) {
        this.recentKeywords = [...keywords];
    }
    /**
     * S1/S2: 更新关键词（从最近文本中提取）
     */
    updateKeywordsFromRecent() {
        // 从最近提交的文本中提取关键词
        // 使用getRecentCommittedText()获取文本数组（string[]），而不是直接使用recentCommittedText（CommittedText[]）
        const recentTexts = this.getRecentCommittedText();
        const extractedKeywords = aggregator_state_utils_1.AggregatorStateUtils.extractKeywordsFromRecent(recentTexts);
        // 合并到现有关键词（保留用户配置的）
        this.recentKeywords = aggregator_state_utils_1.AggregatorStateUtils.mergeKeywords(this.recentKeywords, extractedKeywords);
    }
    /**
     * S1/S2: 获取上一次提交的质量分数
     */
    getLastCommitQuality() {
        return this.lastCommitQuality;
    }
    /**
     * S1/S2: 设置上一次提交的质量分数
     */
    setLastCommitQuality(quality) {
        this.lastCommitQuality = quality;
    }
    /**
     * 清理上下文
     */
    clearContext() {
        this.recentCommittedText = [];
        this.recentKeywords = [];
        this.lastCommitQuality = undefined;
        this.clearLastTranslatedText();
    }
    /**
     * 获取所有已提交的文本记录（用于调试和测试）
     */
    getAllCommittedTexts() {
        return [...this.recentCommittedText];
    }
}
exports.AggregatorStateContextManager = AggregatorStateContextManager;
