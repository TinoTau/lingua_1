"use strict";
/**
 * Semantic Repair Scorer
 * P1-1: 将触发逻辑改为打分器，而非布尔条件
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticRepairScorer = void 0;
const logger_1 = __importDefault(require("../../logger"));
class SemanticRepairScorer {
    constructor(config = {}) {
        this.config = {
            qualityThreshold: config.qualityThreshold ?? 0.70,
            shortSentenceLength: config.shortSentenceLength ?? 16,
            nonChineseRatioThreshold: config.nonChineseRatioThreshold ?? 0.3,
            languageProbabilityThreshold: config.languageProbabilityThreshold ?? 0.7,
            qualityScoreWeight: config.qualityScoreWeight ?? 0.4,
            shortSentenceWeight: config.shortSentenceWeight ?? 0.2,
            nonChineseRatioWeight: config.nonChineseRatioWeight ?? 0.2,
            syntaxWeight: config.syntaxWeight ?? 0.1,
            languageProbabilityWeight: config.languageProbabilityWeight ?? 0.1,
            triggerThreshold: config.triggerThreshold ?? 0.3, // 降低阈值，提高敏感度
        };
        // 验证权重总和为1
        const totalWeight = this.config.qualityScoreWeight +
            this.config.shortSentenceWeight +
            this.config.nonChineseRatioWeight +
            this.config.syntaxWeight +
            this.config.languageProbabilityWeight;
        if (Math.abs(totalWeight - 1.0) > 0.01) {
            logger_1.default.warn({ totalWeight, config: this.config }, 'SemanticRepairScorer: Weights do not sum to 1.0, normalizing');
            // 归一化权重
            this.config.qualityScoreWeight /= totalWeight;
            this.config.shortSentenceWeight /= totalWeight;
            this.config.nonChineseRatioWeight /= totalWeight;
            this.config.syntaxWeight /= totalWeight;
            this.config.languageProbabilityWeight /= totalWeight;
        }
    }
    /**
     * 计算综合评分
     */
    score(text, qualityScore, meta) {
        const reasonCodes = [];
        const details = {};
        // 1. 质量分评分
        let qualityScoreValue = 0;
        if (qualityScore !== undefined) {
            details.qualityScore = qualityScore;
            details.qualityScoreWeight = this.config.qualityScoreWeight;
            if (qualityScore < this.config.qualityThreshold) {
                // 质量分越低，评分越高（需要修复）
                qualityScoreValue = 1 - (qualityScore / this.config.qualityThreshold);
                reasonCodes.push('LOW_QUALITY_SCORE');
            }
            else {
                // 质量分高于阈值，但可能仍有轻微问题
                qualityScoreValue = Math.max(0, (this.config.qualityThreshold - qualityScore) / this.config.qualityThreshold) * 0.3;
            }
        }
        // 2. 短句评分
        let shortSentenceScore = 0;
        if (text.length <= this.config.shortSentenceLength) {
            details.shortSentenceScore = 1.0;
            details.shortSentenceWeight = this.config.shortSentenceWeight;
            shortSentenceScore = 1.0;
            reasonCodes.push('SHORT_SENTENCE');
        }
        // 3. 非中文比例评分
        let nonChineseRatioScore = 0;
        const nonChineseRatio = this.countNonChineseChars(text) / text.length;
        if (nonChineseRatio > this.config.nonChineseRatioThreshold) {
            details.nonChineseRatio = nonChineseRatio;
            details.nonChineseRatioWeight = this.config.nonChineseRatioWeight;
            nonChineseRatioScore = Math.min(1.0, nonChineseRatio / this.config.nonChineseRatioThreshold);
            reasonCodes.push('HIGH_NON_CHINESE_RATIO');
        }
        // 4. 句法评分
        let syntaxScore = 0;
        if (!this.hasBasicSyntax(text)) {
            details.syntaxScore = 1.0;
            details.syntaxWeight = this.config.syntaxWeight;
            syntaxScore = 1.0;
            reasonCodes.push('MISSING_BASIC_SYNTAX');
        }
        // P1-4: 垃圾字符检测
        if (this.hasGarbageChars(text)) {
            syntaxScore = Math.max(syntaxScore, 0.8);
            reasonCodes.push('GARBAGE_CHARS');
        }
        // P1-4: 异常词形检测
        if (this.hasAbnormalWordForm(text)) {
            syntaxScore = Math.max(syntaxScore, 0.7);
            reasonCodes.push('ABNORMAL_WORD_FORM');
        }
        // P1-4: 垃圾字符检测
        if (this.hasGarbageChars(text)) {
            syntaxScore = Math.max(syntaxScore, 0.8);
            reasonCodes.push('GARBAGE_CHARS');
        }
        // P1-4: 异常词形检测
        if (this.hasAbnormalWordForm(text)) {
            syntaxScore = Math.max(syntaxScore, 0.7);
            reasonCodes.push('ABNORMAL_WORD_FORM');
        }
        // 5. 语言概率评分
        let languageProbabilityScore = 0;
        const languageProbability = meta?.language_probability || 1.0;
        if (languageProbability < this.config.languageProbabilityThreshold) {
            details.languageProbability = languageProbability;
            details.languageProbabilityWeight = this.config.languageProbabilityWeight;
            languageProbabilityScore = 1 - (languageProbability / this.config.languageProbabilityThreshold);
            reasonCodes.push('LOW_LANGUAGE_PROBABILITY');
        }
        // 计算综合评分（加权平均）
        const totalScore = qualityScoreValue * this.config.qualityScoreWeight +
            shortSentenceScore * this.config.shortSentenceWeight +
            nonChineseRatioScore * this.config.nonChineseRatioWeight +
            syntaxScore * this.config.syntaxWeight +
            languageProbabilityScore * this.config.languageProbabilityWeight;
        return {
            score: Math.min(1.0, Math.max(0.0, totalScore)),
            reasonCodes,
            details,
        };
    }
    /**
     * 判断是否应该触发修复
     */
    shouldTrigger(score) {
        return score.score >= this.config.triggerThreshold;
    }
    /**
     * 统计非中文字符比例
     */
    countNonChineseChars(text) {
        const nonChinesePattern = /[^\u4e00-\u9fa5]/g;
        const matches = text.match(nonChinesePattern);
        return matches ? matches.length : 0;
    }
    /**
     * 检查基本句法
     * P1-4: 增强异常句法检测
     */
    hasBasicSyntax(text) {
        // 1. 检查是否包含常见动词
        const commonVerbs = [
            '是', '有', '在', '说', '做', '来', '去', '看', '听', '想', '要', '会', '能',
            '可以', '应该', '必须', '需要', '开始', '结束', '完成', '进行', '处理',
            '使用', '提供', '支持', '帮助', '解决', '实现', '创建', '删除', '修改',
        ];
        const hasVerb = commonVerbs.some(verb => text.includes(verb));
        // 2. 检查是否包含常见标点（表示完整句子）
        const hasPunctuation = /[。，！？、；：]/.test(text);
        // 3. 检查是否包含常见实体词（名词、代词等）
        const commonEntities = [
            '我', '你', '他', '她', '它', '我们', '你们', '他们',
            '这个', '那个', '这里', '那里', '今天', '明天', '昨天',
            '问题', '方法', '系统', '服务', '数据', '信息', '结果',
        ];
        const hasEntity = commonEntities.some(entity => text.includes(entity));
        // 4. 检查是否包含常见结构词（连词、介词等）
        const commonStructureWords = [
            '和', '或', '与', '及', '以及', '但是', '然而', '因为', '所以',
            '如果', '那么', '虽然', '但是', '尽管', '即使',
        ];
        const hasStructureWord = commonStructureWords.some(word => text.includes(word));
        // 5. 检查是否包含数字（数字通常表示实体）
        const hasNumber = /\d/.test(text);
        // 满足任一条件即认为有基本句法
        return hasVerb || hasPunctuation || hasEntity || hasStructureWord || hasNumber || text.length > 8;
    }
    /**
     * P1-4: 检测垃圾字符
     */
    hasGarbageChars(text) {
        // 检测连续重复字符（如"啊啊啊"、"哈哈哈"）
        const repeatedCharPattern = /(.)\1{4,}/;
        if (repeatedCharPattern.test(text)) {
            return true;
        }
        // 检测乱码字符（非中文字符、非英文、非数字、非标点的连续字符）
        const garbagePattern = /[^\u4e00-\u9fa5a-zA-Z0-9\s，。！？、；：""''（）【】《》\.,!?;:\-\(\)\[\]<>]{3,}/;
        if (garbagePattern.test(text)) {
            return true;
        }
        return false;
    }
    /**
     * P1-4: 检测异常词形（中文）
     */
    hasAbnormalWordForm(text) {
        // 检测连续重复字符（如"云云云"、"修修复"）
        const repeatedCharPattern = /(.)\1{2,}/;
        if (repeatedCharPattern.test(text)) {
            return true;
        }
        // 检测连续无标点的短片段（可能是语音噪声词）
        const words = text.split(/[，。！？、；：\s]/).filter(w => w.length > 0);
        if (words.length > 5) {
            const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
            if (avgWordLength < 2) {
                // 平均词长小于2，可能是异常词形
                return true;
            }
        }
        // 检测全名词堆叠（无动词）
        const hasVerb = /[是|有|在|说|做|来|去|看|听|想|要|会|能]/.test(text);
        if (!hasVerb && text.length > 10) {
            // 无动词且长度较长，可能是异常结构
            return true;
        }
        // 检测异常字符组合（连续2-3个相同字符，如"云云云"、"修修复"）
        // 注意：这里只检测模式，不硬编码具体词汇
        const abnormalCharSequence = /(.)\1{1,2}(.)\2{1,2}/;
        if (abnormalCharSequence.test(text)) {
            return true;
        }
        return false;
    }
}
exports.SemanticRepairScorer = SemanticRepairScorer;
