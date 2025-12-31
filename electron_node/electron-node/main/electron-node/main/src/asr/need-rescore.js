"use strict";
/* S2: NeedRescore 判定 - 判断是否需要复核
   对每个 commit_text 计算是否需要复核
*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeedRescoreDetector = void 0;
const aggregator_decision_1 = require("../aggregator/aggregator-decision");
const DEFAULT_CONFIG = {
    shortCjkChars: 18,
    shortEnWords: 9,
    qLowOffline: 0.45,
    qLowRoom: 0.50,
    riskWordPatterns: [
        /\d+/, // 数字
        /[0-9]+%/, // 百分比
        /\$\d+/, // 金额
        /\d+点/, // 时间点
        /\d+:\d+/, // 时间格式
        /[0-9]+[年月日时分秒]/, // 中文时间
    ],
};
class NeedRescoreDetector {
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * 判定是否需要复核
     */
    detect(ctx) {
        const reasons = [];
        // (A) 短句条件
        const isShort = this.checkShortUtterance(ctx.commitText);
        if (isShort) {
            reasons.push('short_utterance');
        }
        // (B) 低置信条件
        const isLowQuality = this.checkLowQuality(ctx.qualityScore, ctx.mode);
        if (isLowQuality) {
            reasons.push('low_quality');
        }
        // (C) 高风险特征
        const hasRiskFeatures = this.checkRiskFeatures(ctx);
        if (hasRiskFeatures) {
            reasons.push('risk_features');
        }
        // 不触发条件检查
        if (this.shouldSkip(ctx, reasons)) {
            return { needRescore: false, reasons: [] };
        }
        return {
            needRescore: reasons.length > 0,
            reasons,
        };
    }
    /**
     * 检查短句条件
     */
    checkShortUtterance(text) {
        if (!text || !text.trim())
            return false;
        const isCjk = (0, aggregator_decision_1.looksLikeCjk)(text);
        if (isCjk) {
            const chars = (0, aggregator_decision_1.countCjkChars)(text);
            return chars < this.config.shortCjkChars;
        }
        else {
            const words = (0, aggregator_decision_1.countWords)(text);
            return words < this.config.shortEnWords;
        }
    }
    /**
     * 检查低质量条件
     */
    checkLowQuality(qualityScore, mode) {
        if (qualityScore === undefined)
            return false;
        const threshold = mode === 'room' ? this.config.qLowRoom : this.config.qLowOffline;
        return qualityScore < threshold;
    }
    /**
     * 检查高风险特征
     */
    checkRiskFeatures(ctx) {
        const text = ctx.commitText || '';
        // 1. 含数字/单位/金额/时间
        if (ctx.hasNumbers !== undefined) {
            if (ctx.hasNumbers)
                return true;
        }
        else {
            // 自动检测
            for (const pattern of this.config.riskWordPatterns) {
                if (pattern.test(text)) {
                    return true;
                }
            }
        }
        // 2. 命中用户关键词
        if (ctx.hasUserKeywords !== undefined) {
            if (ctx.hasUserKeywords)
                return true;
        }
        else if (ctx.userKeywords && ctx.userKeywords.length > 0) {
            // 自动检测
            const lowerText = text.toLowerCase();
            for (const kw of ctx.userKeywords) {
                if (lowerText.includes(kw.toLowerCase())) {
                    return true;
                }
            }
        }
        // 3. dedup裁剪量异常高（边界抖动信号）
        if (ctx.dedupCharsRemoved !== undefined && ctx.dedupCharsRemoved > 10) {
            return true;
        }
        return false;
    }
    /**
     * 检查是否应该跳过复核
     */
    shouldSkip(ctx, reasons) {
        // 文本过长且质量高：不触发
        if (reasons.length === 0)
            return true;
        const text = ctx.commitText || '';
        const isCjk = (0, aggregator_decision_1.looksLikeCjk)(text);
        const isLong = isCjk ? (0, aggregator_decision_1.countCjkChars)(text) > 30 : (0, aggregator_decision_1.countWords)(text) > 15;
        const isHighQuality = ctx.qualityScore !== undefined && ctx.qualityScore >= 0.7;
        if (isLong && isHighQuality) {
            return true; // 跳过复核
        }
        // 优化：如果没有qualityScore且文本较长，也跳过（避免对长文本进行不必要的处理）
        if (ctx.qualityScore === undefined && isLong) {
            return true;
        }
        return false;
    }
    /**
     * 更新配置
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
}
exports.NeedRescoreDetector = NeedRescoreDetector;
