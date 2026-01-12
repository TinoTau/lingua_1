/* S2: NeedRescore 判定 - 判断是否需要复核
   对每个 commit_text 计算是否需要复核
*/

import { looksLikeCjk, countCjkChars, countWords } from '../aggregator/aggregator-decision';

export interface NeedRescoreContext {
  commitText: string;
  qualityScore?: number;
  mode: 'offline' | 'room';
  langProbs?: { top1: string; p1: number };
  dedupCharsRemoved?: number;  // dedup裁剪量
  userKeywords?: string[];  // 用户关键词（用于检测专名命中）
  // 高风险特征标志
  hasNumbers?: boolean;  // 含数字/单位/金额/时间
  hasUserKeywords?: boolean;  // 命中用户关键词
}

export interface NeedRescoreResult {
  needRescore: boolean;
  reasons: string[];  // 触发原因列表
}

export interface RescoreConfig {
  // 短句条件
  shortCjkChars: number;  // CJK短句阈值（默认18）
  shortEnWords: number;  // EN短句阈值（默认9）
  
  // 低置信条件
  qLowOffline: number;  // offline低质量阈值（默认0.45）
  qLowRoom: number;  // room低质量阈值（默认0.50）
  
  // 高风险特征
  riskWordPatterns: RegExp[];  // 风险词模式（数字、单位、金额、时间等）
}

const DEFAULT_CONFIG: RescoreConfig = {
  shortCjkChars: 16,  // 统一使用SemanticRepairScorer的标准：16字符
  shortEnWords: 9,
  qLowOffline: 0.45,
  qLowRoom: 0.50,
  riskWordPatterns: [
    /\d+/,  // 数字
    /[0-9]+%/,  // 百分比
    /\$\d+/,  // 金额
    /\d+点/,  // 时间点
    /\d+:\d+/,  // 时间格式
    /[0-9]+[年月日时分秒]/,  // 中文时间
  ],
};

export class NeedRescoreDetector {
  private config: RescoreConfig;

  constructor(config?: Partial<RescoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 判定是否需要复核
   */
  detect(ctx: NeedRescoreContext): NeedRescoreResult {
    const reasons: string[] = [];

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
  private checkShortUtterance(text: string): boolean {
    if (!text || !text.trim()) return false;

    const isCjk = looksLikeCjk(text);
    if (isCjk) {
      const chars = countCjkChars(text);
      return chars < this.config.shortCjkChars;
    } else {
      const words = countWords(text);
      return words < this.config.shortEnWords;
    }
  }

  /**
   * 检查低质量条件
   */
  private checkLowQuality(qualityScore: number | undefined, mode: 'offline' | 'room'): boolean {
    if (qualityScore === undefined) return false;

    const threshold = mode === 'room' ? this.config.qLowRoom : this.config.qLowOffline;
    return qualityScore < threshold;
  }

  /**
   * 检查高风险特征
   */
  private checkRiskFeatures(ctx: NeedRescoreContext): boolean {
    const text = ctx.commitText || '';

    // 1. 含数字/单位/金额/时间
    if (ctx.hasNumbers !== undefined) {
      if (ctx.hasNumbers) return true;
    } else {
      // 自动检测
      for (const pattern of this.config.riskWordPatterns) {
        if (pattern.test(text)) {
          return true;
        }
      }
    }

    // 2. 命中用户关键词
    if (ctx.hasUserKeywords !== undefined) {
      if (ctx.hasUserKeywords) return true;
    } else if (ctx.userKeywords && ctx.userKeywords.length > 0) {
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
  private shouldSkip(ctx: NeedRescoreContext, reasons: string[]): boolean {
    // 文本过长且质量高：不触发
    if (reasons.length === 0) return true;

    const text = ctx.commitText || '';
    const isCjk = looksLikeCjk(text);
    const isLong = isCjk ? countCjkChars(text) > 30 : countWords(text) > 15;
    const isHighQuality = ctx.qualityScore !== undefined && ctx.qualityScore >= 0.7;

    if (isLong && isHighQuality) {
      return true;  // 跳过复核
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
  updateConfig(config: Partial<RescoreConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

