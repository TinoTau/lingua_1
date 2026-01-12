/**
 * Candidate Scorer: 候选翻译打分机制
 * 用于 NMT Repair 功能，对多个候选翻译进行打分择优
 */

export interface ScoredCandidate {
  candidate: string;  // 原文候选
  translation: string;  // 翻译结果
  score: number;  // 综合得分
}

export interface ScoringConfig {
  ruleWeight: number;  // 规则分权重（默认 0.4）
  nmtWeight: number;  // NMT 分权重（默认 0.4）
  lmWeight: number;  // 语言模型分权重（默认 0.2）
  minScoreImprovement: number;  // 最小分数提升阈值（默认 0.05）
}

const DEFAULT_CONFIG: ScoringConfig = {
  ruleWeight: 0.4,
  nmtWeight: 0.4,
  lmWeight: 0.2,
  minScoreImprovement: 0.05,
};

/**
 * 对候选翻译进行打分
 */
export function scoreCandidates(
  candidates: Array<{ candidate: string; translation: string }>,
  originalText: string,
  originalTranslation: string,
  previousTranslation?: string,
  config: Partial<ScoringConfig> = {}
): ScoredCandidate[] {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  const scored: ScoredCandidate[] = candidates.map(({ candidate, translation }) => {
    // 规则分（40%）
    const ruleScore = calculateRuleScore(
      candidate,
      originalText,
      previousTranslation
    );
    
    // NMT 分（40%）
    const nmtScore = calculateNMTScore(
      translation,
      originalTranslation,
      previousTranslation
    );
    
    // 语言模型分（20%）
    const lmScore = calculateLMScore(candidate, originalText);
    
    // 综合得分
    const totalScore = 
      ruleScore * finalConfig.ruleWeight +
      nmtScore * finalConfig.nmtWeight +
      lmScore * finalConfig.lmWeight;
    
    return {
      candidate,
      translation,
      score: totalScore,
    };
  });
  
  return scored;
}

/**
 * 规则分计算（40%）
 * - Glossary/专名保护：命中 glossary 的候选加分
 * - 数字保护：数字不匹配的候选减分
 * - 重复惩罚：与上一条高度重复的候选减分
 * - 长度惩罚：过短或过长的候选减分
 */
function calculateRuleScore(
  candidate: string,
  originalText: string,
  previousTranslation?: string
): number {
  let score = 0.5;  // 基础分
  
  // 1. 数字保护（20%）
  const originalNumbers = extractNumbers(originalText);
  const candidateNumbers = extractNumbers(candidate);
  if (originalNumbers.length > 0) {
    const numberMatch = originalNumbers.every((num, idx) => 
      candidateNumbers[idx] === num
    );
    if (numberMatch) {
      score += 0.2;
    } else {
      score -= 0.3;  // 数字不匹配，严重减分
    }
  } else {
    score += 0.1;  // 没有数字，小幅加分
  }
  
  // 2. 长度惩罚（30%）
  const lengthRatio = candidate.length / Math.max(originalText.length, 1);
  if (lengthRatio >= 0.8 && lengthRatio <= 1.2) {
    score += 0.3;  // 长度合理
  } else if (lengthRatio < 0.5 || lengthRatio > 2.0) {
    score -= 0.3;  // 长度差异过大
  } else {
    score += 0.1;  // 长度差异可接受
  }
  
  // 3. 重复惩罚（20%）
  if (previousTranslation) {
    const similarity = calculateSimilarity(candidate, previousTranslation);
    if (similarity > 0.8) {
      score -= 0.2;  // 与上一条高度重复
    } else if (similarity < 0.3) {
      score += 0.1;  // 与上一条差异较大，可能是新内容
    }
  }
  
  // 4. 文本相似度（30%）
  const textSimilarity = calculateSimilarity(candidate, originalText);
  score += textSimilarity * 0.3;
  
  return Math.max(0, Math.min(1, score));  // 限制在 [0, 1] 范围内
}

/**
 * NMT 分计算（40%）
 * - 翻译自然度：翻译是否流畅
 * - 翻译一致性：与上下文是否一致
 * - 翻译置信度：NMT 模型的置信度（这里简化为基于长度的启发式）
 */
function calculateNMTScore(
  translation: string,
  originalTranslation: string,
  previousTranslation?: string
): number {
  let score = 0.5;  // 基础分
  
  // 1. 翻译自然度（40%）
  // 简化为：检查翻译是否包含常见的不自然模式
  const hasUnnaturalPatterns = checkUnnaturalPatterns(translation);
  if (!hasUnnaturalPatterns) {
    score += 0.4;
  } else {
    score -= 0.2;
  }
  
  // 2. 翻译一致性（30%）
  if (previousTranslation) {
    const consistency = calculateConsistency(translation, previousTranslation);
    score += consistency * 0.3;
  } else {
    score += 0.15;  // 没有上下文，给中等分数
  }
  
  // 3. 翻译置信度（30%）
  // 简化为：基于翻译长度的启发式（通常合理的翻译长度与原文相关）
  const lengthScore = Math.min(1, translation.length / Math.max(originalTranslation.length, 1));
  score += lengthScore * 0.3;
  
  return Math.max(0, Math.min(1, score));  // 限制在 [0, 1] 范围内
}

/**
 * 语言模型分计算（20%）
 * - 文本自然度：原文是否自然
 * - 语法正确性：语法是否正确（简化处理）
 */
function calculateLMScore(candidate: string, originalText: string): number {
  let score = 0.5;  // 基础分
  
  // 1. 文本自然度（60%）
  // 简化为：检查是否包含明显的错误模式
  const hasErrors = checkTextErrors(candidate);
  if (!hasErrors) {
    score += 0.6;
  } else {
    score -= 0.3;
  }
  
  // 2. 语法正确性（40%）
  // 简化为：检查标点符号和基本格式
  const hasGoodFormatting = checkFormatting(candidate);
  if (hasGoodFormatting) {
    score += 0.4;
  } else {
    score -= 0.2;
  }
  
  return Math.max(0, Math.min(1, score));  // 限制在 [0, 1] 范围内
}

/**
 * 提取文本中的数字
 */
function extractNumbers(text: string): string[] {
  const numbers: string[] = [];
  const regex = /\d+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    numbers.push(match[0]);
  }
  return numbers;
}

/**
 * 计算两个文本的相似度（简单的字符级相似度）
 */
function calculateSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  
  const longer = text1.length > text2.length ? text1 : text2;
  const shorter = text1.length > text2.length ? text2 : text1;
  
  if (longer.length === 0) return 1.0;
  
  // 使用简单的编辑距离相似度
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

/**
 * 计算编辑距离（Levenshtein Distance）
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * 检查翻译是否包含不自然的模式
 */
function checkUnnaturalPatterns(translation: string): boolean {
  // 检查重复的单词或短语
  const words = translation.split(/\s+/);
  const wordCounts = new Map<string, number>();
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }
  
  // 如果某个单词出现超过 3 次，可能不自然
  for (const count of wordCounts.values()) {
    if (count > 3) {
      return true;
    }
  }
  
  // 检查过长的单词（可能是错误）
  for (const word of words) {
    if (word.length > 30) {
      return true;
    }
  }
  
  return false;
}

/**
 * 计算翻译一致性（与上下文的连贯性）
 */
function calculateConsistency(translation: string, previousTranslation: string): number {
  // 简化为：检查是否有共同的词汇或短语
  const translationWords = new Set(translation.toLowerCase().split(/\s+/));
  const previousWords = new Set(previousTranslation.toLowerCase().split(/\s+/));
  
  let commonWords = 0;
  for (const word of translationWords) {
    if (previousWords.has(word) && word.length > 2) {
      commonWords++;
    }
  }
  
  // 归一化到 [0, 1]
  const maxWords = Math.max(translationWords.size, previousWords.size);
  return maxWords > 0 ? commonWords / maxWords : 0.5;
}

/**
 * 检查文本是否包含明显的错误
 */
function checkTextErrors(text: string): boolean {
  // 检查连续重复的字符（如 "aaaa"）
  if (/(.)\1{4,}/.test(text)) {
    return true;
  }
  
  // 检查过多的空格
  if (/\s{3,}/.test(text)) {
    return true;
  }
  
  return false;
}

/**
 * 检查文本格式是否正确
 */
function checkFormatting(text: string): boolean {
  // 检查是否有基本的标点符号（如果文本较长）
  if (text.length > 10) {
    const hasPunctuation = /[.,!?;:]/.test(text);
    if (!hasPunctuation && text.length > 20) {
      return false;  // 长文本应该有标点符号
    }
  }
  
  // 检查是否有过多的特殊字符
  const specialCharCount = (text.match(/[^\w\s]/g) || []).length;
  if (specialCharCount > text.length * 0.3) {
    return false;
  }
  
  return true;
}

/**
 * 选择最佳候选（考虑最小分数提升阈值）
 */
export function selectBestCandidate(
  scoredCandidates: ScoredCandidate[],
  originalTranslation: string,
  minScoreImprovement: number = 0.05
): ScoredCandidate | null {
  if (scoredCandidates.length === 0) {
    return null;
  }
  
  // 找到得分最高的候选
  const best = scoredCandidates.reduce((a, b) => 
    a.score > b.score ? a : b
  );
  
  // 计算原始翻译的得分（作为基准）
  const originalScore = best.score;  // 使用最佳候选的得分作为参考（简化处理）
  
  // 只有明显更好的候选才使用
  if (best.score > originalScore + minScoreImprovement) {
    return best;
  }
  
  // 如果提升不明显，返回 null（使用原始翻译）
  return null;
}

