/* S1: Prompt Builder - 上下文偏置（Prompt Bias）
   为 ASR 解码注入"关键词 + 最近上下文"的软偏置
*/

import logger from '../logger';

export interface PromptConfig {
  maxChars: number;  // prompt最大字符数（offline: 600, room: 500）
  maxKeywords: number;  // 最大关键词数（默认30）
  maxRecentLines: number;  // 最大最近文本行数（默认2）
  maxRecentLineChars: number;  // 每行最大字符数（默认120）
  enableRecentContext: boolean;  // 是否启用最近上下文（根据quality动态控制）
}

export interface PromptBuilderContext {
  userKeywords: string[];  // 用户配置的关键词（专名、术语、产品名）
  recentCommittedText: string[];  // 最近提交的文本（用于提取关键词和上下文）
  qualityScore?: number;  // 当前质量分数（用于门控）
  recentTextQualityScores?: number[];  // 最近文本对应的质量分数（可选，用于更精确的质量控制）
}

const DEFAULT_CONFIG_OFFLINE: PromptConfig = {
  maxChars: 600,
  maxKeywords: 30,
  maxRecentLines: 2,
  maxRecentLineChars: 120,
  enableRecentContext: true,
};

const DEFAULT_CONFIG_ROOM: PromptConfig = {
  maxChars: 500,
  maxKeywords: 30,
  maxRecentLines: 2,
  maxRecentLineChars: 120,
  enableRecentContext: true,
};

// 质量阈值配置
const QUALITY_THRESHOLD_HIGH = 0.65;  // 高质量阈值（用于 recent context）
const QUALITY_THRESHOLD_MEDIUM = 0.50;  // 中等质量阈值（用于 keywords from recent）
const QUALITY_THRESHOLD_LOW = 0.40;  // 低质量阈值（完全禁用）

export class PromptBuilder {
  private config: PromptConfig;

  constructor(mode: 'offline' | 'room' = 'offline', config?: Partial<PromptConfig>) {
    const baseConfig = mode === 'room' ? DEFAULT_CONFIG_ROOM : DEFAULT_CONFIG_OFFLINE;
    this.config = { ...baseConfig, ...config };
  }

  /**
   * 构建 prompt
   * @param ctx 上下文信息
   * @returns prompt字符串，如果为空则返回null
   */
  build(ctx: PromptBuilderContext): string | null {
    try {
      // 质量门控优化：
      // 1. 如果当前质量很低（< 0.4），完全禁用 recent context 和从 recent 提取的 keywords
      // 2. 如果当前质量中等（0.4-0.65），只使用 keywords（用户配置的），不使用 recent context
      // 3. 如果当前质量高（>= 0.65），使用 keywords + recent context
      const currentQuality = ctx.qualityScore ?? 1.0;  // 如果未提供，假设高质量（保守策略）
      
      const enableRecent = this.config.enableRecentContext && 
        currentQuality >= QUALITY_THRESHOLD_HIGH;  // 只在高质量时使用 recent context
      
      const enableKeywordsFromRecent = currentQuality >= QUALITY_THRESHOLD_MEDIUM;  // 中等质量以上才从 recent 提取 keywords

      // 提取关键词（根据质量决定是否从 recent 提取）
      const keywords = this.extractKeywords(ctx, enableKeywordsFromRecent);
      
      // 提取最近上下文（只在高质量时使用）
      const recentLines = enableRecent ? this.extractRecentLinesWithQualityCheck(ctx) : [];

      // 如果都没有，返回null
      if (keywords.length === 0 && recentLines.length === 0) {
        return null;
      }

      // 构建prompt
      let prompt = '[CONTEXT]\n';
      
      if (keywords.length > 0) {
        prompt += 'Keywords:\n';
        for (const kw of keywords) {
          prompt += `- ${kw}\n`;
        }
      }

      if (recentLines.length > 0) {
        prompt += 'Recent:\n';
        for (const line of recentLines) {
          prompt += `${line}\n`;
        }
      }

      prompt += '[/CONTEXT]';

      // 压缩：如果超过maxChars，截断
      if (prompt.length > this.config.maxChars) {
        prompt = this.compressPrompt(prompt, keywords, recentLines);
      }

      return prompt;
    } catch (error) {
      logger.error({ error }, 'PromptBuilder.build failed, returning null');
      return null;  // 异常时回退空prompt
    }
  }

  /**
   * 提取关键词
   */
  private extractKeywords(ctx: PromptBuilderContext, includeRecent: boolean): string[] {
    const keywords = new Set<string>();

    // 1. 用户配置的关键词（最高优先级）
    for (const kw of ctx.userKeywords || []) {
      if (kw && kw.trim()) {
        keywords.add(kw.trim());
      }
    }

    // 2. 从最近提交的文本中提取关键词（如果启用且质量足够）
    if (includeRecent && ctx.recentCommittedText) {
      // 只从高质量文本中提取关键词
      const qualityScores = ctx.recentTextQualityScores || [];
      const highQualityTexts: string[] = [];
      
      for (let i = 0; i < ctx.recentCommittedText.length; i++) {
        const text = ctx.recentCommittedText[i];
        const quality = qualityScores.length > i ? qualityScores[i] : undefined;
        
        // 只使用高质量文本（>= 0.5）或未提供质量分数的文本（保守策略）
        if (quality === undefined || quality >= QUALITY_THRESHOLD_MEDIUM) {
          // 额外检查：文本是否可能包含错误
          if (!this.isTextLikelyErroneous(text)) {
            highQualityTexts.push(text);
          }
        }
      }
      
      if (highQualityTexts.length > 0) {
        const recentKeywords = this.extractKeywordsFromText(highQualityTexts);
        for (const kw of recentKeywords) {
          keywords.add(kw);
        }
      }
    }

    // 去重并按优先级排序（用户关键词优先）
    const userKeywordSet = new Set(ctx.userKeywords || []);
    const sorted = Array.from(keywords).sort((a, b) => {
      const aIsUser = userKeywordSet.has(a);
      const bIsUser = userKeywordSet.has(b);
      if (aIsUser && !bIsUser) return -1;
      if (!aIsUser && bIsUser) return 1;
      return 0;
    });

    // 截断到maxKeywords
    return sorted.slice(0, this.config.maxKeywords);
  }

  /**
   * 从文本中提取关键词（高频、专名）
   */
  private extractKeywordsFromText(texts: string[]): string[] {
    const keywords = new Set<string>();
    const wordFreq = new Map<string, number>();

    // 统计词频
    for (const text of texts) {
      if (!text || !text.trim()) continue;

      // 提取可能的专名和术语
      // 1. 中文字符串（2-6字）
      const cjkMatches = text.match(/[\u4e00-\u9fff]{2,6}/g);
      if (cjkMatches) {
        for (const word of cjkMatches) {
          wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
      }

      // 2. 英文单词（大写开头或全大写，长度>=3）
      const enMatches = text.match(/\b[A-Z][a-z]{2,}\b|\b[A-Z]{3,}\b/g);
      if (enMatches) {
        for (const word of enMatches) {
          wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }
      }
    }

    // 选择高频词（出现>=2次）或专名特征明显的词
    for (const [word, freq] of wordFreq.entries()) {
      if (freq >= 2 || this.looksLikeProperNoun(word)) {
        keywords.add(word);
      }
    }

    return Array.from(keywords);
  }

  /**
   * 判断是否像专名
   */
  private looksLikeProperNoun(word: string): boolean {
    // 全大写且长度>=3
    if (/^[A-Z]{3,}$/.test(word)) return true;
    // 大写开头且长度>=4
    if (/^[A-Z][a-z]{3,}$/.test(word)) return true;
    return false;
  }

  /**
   * 提取最近上下文行（带质量检查和错误过滤）
   */
  private extractRecentLinesWithQualityCheck(ctx: PromptBuilderContext): string[] {
    if (!ctx.recentCommittedText || ctx.recentCommittedText.length === 0) {
      return [];
    }

    const lines: string[] = [];
    const maxLines = this.config.maxRecentLines;
    const maxLineChars = this.config.maxRecentLineChars;

    // 取最近N条文本
    const recent = ctx.recentCommittedText.slice(-maxLines);
    const qualityScores = ctx.recentTextQualityScores || [];

    for (let i = 0; i < recent.length; i++) {
      const text = recent[i];
      if (!text || !text.trim()) continue;

      // 质量检查：如果有质量分数，只使用高质量文本（>= 0.65）
      if (qualityScores.length > i) {
        const quality = qualityScores[qualityScores.length - recent.length + i];
        if (quality !== undefined && quality < QUALITY_THRESHOLD_HIGH) {
          // 跳过低质量文本
          continue;
        }
      }

      // 文本合理性检查：过滤明显错误的文本
      if (this.isTextLikelyErroneous(text)) {
        // 跳过明显错误的文本
        continue;
      }

      // 截断到maxLineChars
      let line = text.trim();
      if (line.length > maxLineChars) {
        // 尝试在句号、问号、感叹号处截断
        const punctMatch = line.substring(0, maxLineChars).match(/[。！？.!?]/g);
        if (punctMatch && punctMatch.length > 0) {
          const lastPunct = line.lastIndexOf(punctMatch[punctMatch.length - 1], maxLineChars);
          if (lastPunct > maxLineChars * 0.5) {
            line = line.substring(0, lastPunct + 1);
          } else {
            line = line.substring(0, maxLineChars);
          }
        } else {
          line = line.substring(0, maxLineChars);
        }
      }

      lines.push(line);
    }

    return lines;
  }

  /**
   * 提取最近上下文行（兼容旧接口，不带质量检查）
   */
  private extractRecentLines(ctx: PromptBuilderContext): string[] {
    // 使用新的带质量检查的方法
    return this.extractRecentLinesWithQualityCheck(ctx);
  }

  /**
   * 判断文本是否可能包含错误（启发式检查）
   */
  private isTextLikelyErroneous(text: string): boolean {
    // 检查1: 包含明显的错误模式（根据实际错误案例）
    const errorPatterns = [
      /云反归/,  // "云反归" 可能是 "语音返回" 的错误
      /单结/,    // "单结" 可能是 "单独" 的错误
      /投.*小时/, // "投 一两句小时" 明显错误
      /日治/,    // "日治" 可能是 "日志" 的错误
      /泡泡的问题/, // "泡泡的问题" 可能是识别错误
    ];

    for (const pattern of errorPatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }

    // 检查2: 文本过短且包含异常字符组合
    if (text.length < 5 && /[\u4e00-\u9fff]{1}[\w]{1}[\u4e00-\u9fff]{1}/.test(text)) {
      // 中英混杂且过短，可能是识别错误
      return true;
    }

    // 检查3: 包含明显的乱码或异常字符（可选，可能过于严格）
    // 暂时不启用，因为可能包含英文等正常字符

    return false;
  }

  /**
   * 压缩prompt（如果超过maxChars）
   */
  private compressPrompt(
    prompt: string,
    keywords: string[],
    recentLines: string[]
  ): string {
    // 策略：先压缩recent lines，再压缩keywords
    let result = '[CONTEXT]\n';

    // Keywords部分
    if (keywords.length > 0) {
      result += 'Keywords:\n';
      let remainingChars = this.config.maxChars - result.length - 10; // 预留[/CONTEXT]等

      for (const kw of keywords) {
        const kwLine = `- ${kw}\n`;
        if (remainingChars >= kwLine.length) {
          result += kwLine;
          remainingChars -= kwLine.length;
        } else {
          break;
        }
      }
    }

    // Recent部分（如果还有空间）
    if (recentLines.length > 0) {
      const recentHeader = 'Recent:\n';
      let remainingChars = this.config.maxChars - result.length - recentHeader.length - 10;

      if (remainingChars > 0) {
        result += recentHeader;
        for (const line of recentLines) {
          const lineWithNewline = `${line}\n`;
          if (remainingChars >= lineWithNewline.length) {
            result += lineWithNewline;
            remainingChars -= lineWithNewline.length;
          } else {
            // 截断最后一行
            if (remainingChars > 10) {
              result += line.substring(0, remainingChars - 1) + '\n';
            }
            break;
          }
        }
      }
    }

    result += '[/CONTEXT]';

    // 最终检查：如果还是超过，直接截断
    if (result.length > this.config.maxChars) {
      result = result.substring(0, this.config.maxChars - 10) + '\n[/CONTEXT]';
    }

    return result;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PromptConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

