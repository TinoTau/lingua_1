/**
 * 同音字检测器
 * 检测文本中可能存在的常见同音字错误，并生成修复候选
 * 
 * 注意：不使用完整的同音字库，而是基于常见错误模式进行检测
 * 支持手动添加和自动学习两种模式
 */

import { getLearnedPatterns } from './homophone-learner';

/**
 * 手动维护的常见同音字错误模式（基于实际使用中发现的错误）
 * 格式：{ 错误: 正确 }
 * 
 * 注意：这些是已知的常见错误，会自动加载
 * 新的错误模式会通过自动学习机制累积
 */
const MANUAL_HOMOPHONE_ERRORS: Record<string, string> = {
  // 用户报告的错误
  '童英字': '同音字',
  '童音字': '同音字',
  '硬品': '音频',  // 用户报告：ASR 识别错误
  '命中绿': '命中率',  // 用户报告：ASR 识别错误
  '统一字': '同音字',  // 用户报告：ASR 识别错误

  // 其他常见错误（可以根据实际使用情况扩展）
  // '可以': '可行',  // 在某些上下文中（注释掉，因为可能误判）
  // '方案': '方法',  // 在某些上下文中（注释掉，因为可能误判）
};

/**
 * 获取所有同音字错误模式（手动 + 自动学习）
 */
function getAllHomophoneErrors(): Record<string, string> {
  // 合并手动维护和自动学习的模式
  const learned = getLearnedPatterns();
  return {
    ...MANUAL_HOMOPHONE_ERRORS,
    ...learned,
  };
}

/**
 * 检测文本中可能存在的同音字错误
 * @param text 待检测文本
 * @returns 候选列表（包括原文和修复后的文本）
 */
export function detectHomophoneErrors(text: string): string[] {
  const candidates: string[] = [text];  // 包含原文

  // 获取所有同音字错误模式（手动 + 自动学习）
  const allErrors = getAllHomophoneErrors();

  // 检查是否包含已知的同音字错误
  for (const [error, correct] of Object.entries(allErrors)) {
    if (text.includes(error)) {
      // 生成修复候选（替换所有出现）
      const fixed = text.replace(new RegExp(error, 'g'), correct);
      if (fixed !== text) {
        candidates.push(fixed);
      }
    }
  }

  return candidates;
}

/**
 * 检查文本是否可能包含同音字错误
 * @param text 待检查文本
 * @returns 是否可能包含同音字错误
 */
export function hasPossibleHomophoneErrors(text: string): boolean {
  const allErrors = getAllHomophoneErrors();
  for (const error of Object.keys(allErrors)) {
    if (text.includes(error)) {
      return true;
    }
  }
  return false;
}

