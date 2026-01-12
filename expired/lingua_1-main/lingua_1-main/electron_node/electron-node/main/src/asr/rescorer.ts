/* S2: Rescorer - 复核打分
   对候选文本进行规则打分和上下文打分
*/

import { looksLikeCjk, countCjkChars, countWords } from '../aggregator/aggregator-decision';
import logger from '../logger';

export interface Candidate {
  text: string;
  source: 'primary' | 'nbest' | 'secondary_decode';
  score?: number;  // 原始分数（如果有）
}

export interface RescoreContext {
  primaryText: string;  // 原始识别文本
  candidates: Candidate[];  // 候选列表
  recentCommittedText: string[];  // 最近提交的文本（用于上下文打分）
  userKeywords: string[];  // 用户关键词
  qualityScore?: number;  // 原始质量分数
}

export interface RescoreResult {
  bestText: string;  // 最佳文本
  bestScore: number;  // 最佳分数
  primaryScore: number;  // 原始文本分数
  replaced: boolean;  // 是否替换了原始文本
  candidateScores: Array<{ text: string; score: number }>;  // 候选分数列表
}

export interface RescoreConfig {
  // 权重
  wRule: number;  // 规则打分权重（默认1.0）
  wCtx: number;  // 上下文打分权重（默认0.5）
  
  // delta_margin：如果best_score - primary_score < delta_margin，保持primary
  deltaMargin: number;  // 默认1.5
}

const DEFAULT_CONFIG: RescoreConfig = {
  wRule: 1.0,
  wCtx: 0.5,
  deltaMargin: 1.5,
};

export class Rescorer {
  private config: RescoreConfig;

  constructor(config?: Partial<RescoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 对候选进行打分并选择最佳
   */
  rescore(ctx: RescoreContext): RescoreResult {
    if (!ctx.candidates || ctx.candidates.length === 0) {
      // 没有候选，返回原始文本
      return {
        bestText: ctx.primaryText,
        bestScore: 0,
        primaryScore: 0,
        replaced: false,
        candidateScores: [],
      };
    }

    // 计算每个候选的分数
    const candidateScores: Array<{ text: string; score: number; candidate: Candidate }> = [];

    for (const candidate of ctx.candidates) {
      const ruleScore = this.computeRuleScore(candidate.text, ctx);
      const ctxScore = this.computeContextScore(candidate.text, ctx);
      const totalScore = this.config.wRule * ruleScore + this.config.wCtx * ctxScore;

      candidateScores.push({
        text: candidate.text,
        score: totalScore,
        candidate,
      });
    }

    // 计算原始文本的分数
    const primaryRuleScore = this.computeRuleScore(ctx.primaryText, ctx);
    const primaryCtxScore = this.computeContextScore(ctx.primaryText, ctx);
    const primaryScore = this.config.wRule * primaryRuleScore + this.config.wCtx * primaryCtxScore;

    // 找到最佳候选
    let bestCandidate = candidateScores[0];
    for (const cs of candidateScores) {
      if (cs.score > bestCandidate.score) {
        bestCandidate = cs;
      }
    }

    // 判断是否替换：如果best_score - primary_score < delta_margin，保持primary
    const scoreDiff = bestCandidate.score - primaryScore;
    const shouldReplace = scoreDiff >= this.config.deltaMargin;

    return {
      bestText: shouldReplace ? bestCandidate.text : ctx.primaryText,
      bestScore: shouldReplace ? bestCandidate.score : primaryScore,
      primaryScore,
      replaced: shouldReplace,
      candidateScores: candidateScores.map(cs => ({ text: cs.text, score: cs.score })),
    };
  }

  /**
   * 计算规则打分（RuleScore）
   */
  private computeRuleScore(text: string, ctx: RescoreContext): number {
    let score = 0.0;

    if (!text || !text.trim()) {
      return -10.0;  // 空文本严重扣分
    }

    const trimmed = text.trim();

    // 1. 数字保护：数字/单位格式更合理者得分更高
    const hasNumbers = /\d/.test(trimmed);
    if (hasNumbers) {
      // 检查数字格式是否合理
      const numberPatterns = [
        /\d+%/,  // 百分比
        /\$\d+/,  // 金额
        /\d+:\d+/,  // 时间
        /\d+[年月日时分秒]/,  // 中文时间
      ];
      let validNumberFormat = false;
      for (const pattern of numberPatterns) {
        if (pattern.test(trimmed)) {
          validNumberFormat = true;
          break;
        }
      }
      if (validNumberFormat) {
        score += 2.0;
      } else if (/\d+/.test(trimmed)) {
        score += 1.0;  // 有数字但格式一般
      }
    }

    // 2. 专名保护（分层权重）
    const lowerText = trimmed.toLowerCase();
    if (ctx.userKeywords && ctx.userKeywords.length > 0) {
      for (const kw of ctx.userKeywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          score += 3.0;  // 命中用户显式关键词（最高）
          break;  // 只计算一次
        }
      }
    }

    // 3. 重复惩罚：明显重复（我们我们、and and）扣分
    if (this.hasRepetition(trimmed)) {
      score -= 3.0;
    }

    // 4. 极短/语气词惩罚：只有"嗯/啊/and"扣分
    if (this.isOnlyFiller(trimmed)) {
      score -= 5.0;
    }

    // 5. 长度合理性：过短或不完整扣分
    const isCjk = looksLikeCjk(trimmed);
    if (isCjk) {
      const chars = countCjkChars(trimmed);
      if (chars < 2) {
        score -= 3.0;  // 过短
      } else if (chars >= 3 && chars <= 20) {
        score += 1.0;  // 合理长度
      }
    } else {
      const words = countWords(trimmed);
      if (words < 2) {
        score -= 3.0;  // 过短
      } else if (words >= 3 && words <= 15) {
        score += 1.0;  // 合理长度
      }
    }

    return score;
  }

  /**
   * 计算上下文打分（ContextScore）
   */
  private computeContextScore(text: string, ctx: RescoreContext): number {
    let score = 0.0;

    if (!ctx.recentCommittedText || ctx.recentCommittedText.length === 0) {
      return 0.0;
    }

    // 与recent_committed_text的关键词重合度
    const textKeywords = this.extractKeywords(text);
    let matchCount = 0;

    for (const recentText of ctx.recentCommittedText) {
      const recentKeywords = this.extractKeywords(recentText);
      for (const kw of textKeywords) {
        if (recentKeywords.includes(kw)) {
          matchCount++;
        }
      }
    }

    // 匹配的关键词越多，分数越高（但不超过上限）
    score = Math.min(matchCount * 0.5, 2.0);

    return score;
  }

  /**
   * 提取关键词（简单实现）
   */
  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];

    // 中文字符串（2-6字）
    const cjkMatches = text.match(/[\u4e00-\u9fff]{2,6}/g);
    if (cjkMatches) {
      keywords.push(...cjkMatches);
    }

    // 英文单词（长度>=3）
    const enMatches = text.match(/\b[a-zA-Z]{3,}\b/g);
    if (enMatches) {
      keywords.push(...enMatches.map(w => w.toLowerCase()));
    }

    return keywords;
  }

  /**
   * 检查是否有重复
   */
  private hasRepetition(text: string): boolean {
    // 检查明显的重复模式：我们我们、and and等
    const repetitionPatterns = [
      /(\S+)\s+\1/,  // 单词重复（and and）
      /([\u4e00-\u9fff]{2,})\1/,  // 中文重复（我们我们）
    ];

    for (const pattern of repetitionPatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 检查是否只有语气词
   */
  private isOnlyFiller(text: string): boolean {
    const fillers = ['嗯', '啊', '呃', 'and', 'um', 'uh', '哦', '噢'];
    const trimmed = text.trim().toLowerCase();
    
    for (const filler of fillers) {
      if (trimmed === filler || trimmed === filler.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<RescoreConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

