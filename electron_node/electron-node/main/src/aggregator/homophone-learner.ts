/**
 * 同音字自动学习器
 * 从 NMT Repair 的结果中自动学习同音字错误模式
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';

interface LearnedPattern {
  error: string;
  correct: string;
  confidence: number;  // 置信度（0-1）
  count: number;  // 出现次数
  lastUpdated: number;  // 最后更新时间戳
}

interface LearnedPatterns {
  patterns: Record<string, LearnedPattern>;
  version: number;
}

const LEARNED_PATTERNS_FILE = path.join(process.cwd(), 'data', 'learned-homophone-patterns.json');
const MIN_CONFIDENCE = 0.7;  // 最小置信度阈值
const MIN_COUNT = 2;  // 最小出现次数（需要至少2次才认为是可靠的）

/**
 * 加载已学习的模式
 */
function loadLearnedPatterns(): LearnedPatterns {
  try {
    if (fs.existsSync(LEARNED_PATTERNS_FILE)) {
      const content = fs.readFileSync(LEARNED_PATTERNS_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to load learned homophone patterns');
  }
  
  return {
    patterns: {},
    version: 1,
  };
}

/**
 * 保存已学习的模式
 */
function saveLearnedPatterns(data: LearnedPatterns): void {
  try {
    // 确保目录存在
    const dir = path.dirname(LEARNED_PATTERNS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(LEARNED_PATTERNS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logger.error({ error }, 'Failed to save learned homophone patterns');
  }
}

/**
 * 从修复结果中学习同音字错误模式
 * @param originalText 原始文本（包含错误）
 * @param fixedText 修复后的文本（正确）
 * @param scoreImprovement 分数提升（0-1）
 */
export function learnHomophonePattern(
  originalText: string,
  fixedText: string,
  scoreImprovement: number
): void {
  // 只学习有明显提升的情况
  if (scoreImprovement < 0.1) {
    return;
  }
  
  // 找出不同的部分（简化：假设只有一个词不同）
  const diff = findTextDifference(originalText, fixedText);
  if (!diff) {
    return;
  }
  
  const { error, correct } = diff;
  
  // 加载已学习的模式
  const data = loadLearnedPatterns();
  
  // 更新或创建模式
  const key = `${error}->${correct}`;
  const existing = data.patterns[key];
  
  if (existing) {
    // 更新现有模式
    existing.count += 1;
    existing.confidence = Math.min(1, existing.confidence + scoreImprovement * 0.1);
    existing.lastUpdated = Date.now();
  } else {
    // 创建新模式
    data.patterns[key] = {
      error,
      correct,
      confidence: scoreImprovement,
      count: 1,
      lastUpdated: Date.now(),
    };
  }
  
  // 保存
  saveLearnedPatterns(data);
  
  logger.debug(
    {
      error,
      correct,
      confidence: data.patterns[key].confidence,
      count: data.patterns[key].count,
    },
    'Learned homophone pattern'
  );
}

/**
 * 获取已学习的高置信度模式
 * @returns 高置信度模式列表
 */
export function getLearnedPatterns(): Record<string, string> {
  const data = loadLearnedPatterns();
  const result: Record<string, string> = {};
  
  for (const pattern of Object.values(data.patterns)) {
    // 只返回高置信度且出现次数足够的模式
    if (pattern.confidence >= MIN_CONFIDENCE && pattern.count >= MIN_COUNT) {
      result[pattern.error] = pattern.correct;
    }
  }
  
  return result;
}

/**
 * 找出两个文本的差异（简化实现：假设只有一个词不同）
 */
function findTextDifference(text1: string, text2: string): { error: string; correct: string } | null {
  // 简化实现：找出第一个不同的字符序列
  // 实际应该更智能，比如找出不同的词
  
  if (text1.length === text2.length) {
    // 长度相同，找出不同的部分
    let start = -1;
    let end = -1;
    
    for (let i = 0; i < text1.length; i++) {
      if (text1[i] !== text2[i]) {
        if (start === -1) {
          start = i;
        }
        end = i;
      } else if (start !== -1) {
        break;
      }
    }
    
    if (start !== -1 && end !== -1) {
      return {
        error: text1.substring(start, end + 1),
        correct: text2.substring(start, end + 1),
      };
    }
  } else {
    // 长度不同，尝试找出不同的词
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    if (words1.length === words2.length) {
      for (let i = 0; i < words1.length; i++) {
        if (words1[i] !== words2[i]) {
          return {
            error: words1[i],
            correct: words2[i],
          };
        }
      }
    }
  }
  
  return null;
}

