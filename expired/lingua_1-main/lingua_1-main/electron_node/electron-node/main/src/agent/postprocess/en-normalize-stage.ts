/**
 * EnNormalizeStage - 英文文本标准化阶段
 * 职责：对英文ASR文本进行轻量级标准化处理（纯规则，无LLM）
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairTask, SemanticRepairResult } from '../../task-router/types';
import logger from '../../logger';

export interface EnNormalizeStageResult {
  normalizedText: string;
  normalized: boolean;  // 是否进行了标准化
  flags?: {
    hasNumbers?: boolean;
    hasAbbreviations?: boolean;
    hasUrls?: boolean;
    hasEmails?: boolean;
  };
  reasonCodes: string[];
}

export class EnNormalizeStage {
  constructor(private taskRouter: TaskRouter | null) {}

  /**
   * 执行英文文本标准化
   */
  async process(
    job: JobAssignMessage,
    text: string,
    qualityScore?: number
  ): Promise<EnNormalizeStageResult> {
    if (!text || text.trim().length === 0) {
      return {
        normalizedText: text,
        normalized: false,
        reasonCodes: [],
      };
    }

    // 只处理英文
    if (job.src_lang !== 'en') {
      return {
        normalizedText: text,
        normalized: false,
        reasonCodes: ['NOT_ENGLISH'],
      };
    }

    const startTime = Date.now();
    let normalizedText = text;
    const reasonCodes: string[] = [];
    const flags: EnNormalizeStageResult['flags'] = {};

    try {
      // 1. 检测特殊内容（用于后续保护）
      flags.hasNumbers = this.hasNumbers(text);
      flags.hasAbbreviations = this.hasAbbreviations(text);
      flags.hasUrls = this.hasUrls(text);
      flags.hasEmails = this.hasEmails(text);

      // 2. 文本规范化
      normalizedText = this.normalizeText(text, flags);

      // 3. 数字/单位规范化（可选，仅在必要时）
      if (flags.hasNumbers) {
        normalizedText = this.normalizeNumbers(normalizedText);
        reasonCodes.push('NUMBER_NORMALIZED');
      }

      // 4. 缩写保护
      if (flags.hasAbbreviations) {
        normalizedText = this.protectAbbreviations(normalizedText);
        reasonCodes.push('ABBREVIATION_PROTECTED');
      }

      // 5. URL/邮箱保护
      if (flags.hasUrls || flags.hasEmails) {
        normalizedText = this.protectUrlsAndEmails(normalizedText);
        reasonCodes.push('URL_EMAIL_PROTECTED');
      }

      const normalized = normalizedText !== text;
      const duration = Date.now() - startTime;

      logger.debug(
        {
          jobId: job.job_id,
          originalLength: text.length,
          normalizedLength: normalizedText.length,
          normalized,
          duration,
          reasonCodes,
        },
        'EnNormalizeStage: Normalization completed'
      );

      return {
        normalizedText,
        normalized,
        flags,
        reasonCodes,
      };
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          jobId: job.job_id,
        },
        'EnNormalizeStage: Normalization error, returning original text'
      );
      return {
        normalizedText: text,
        normalized: false,
        flags,
        reasonCodes: ['ERROR'],
      };
    }
  }

  /**
   * 基础文本规范化
   */
  private normalizeText(text: string, flags: EnNormalizeStageResult['flags']): string {
    let normalized = text;

    // 1. 统一大小写（句首大写）
    normalized = this.capitalizeSentenceStart(normalized);

    // 2. 去除重复空格
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // 3. 规范化标点（可选，保守处理）
    normalized = this.normalizePunctuation(normalized);

    // 4. 处理口头语填充词（仅在低质量句，保守处理）
    // 暂时跳过，避免过度处理

    return normalized;
  }

  /**
   * 句首大写
   */
  private capitalizeSentenceStart(text: string): string {
    if (text.length === 0) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /**
   * 规范化标点
   */
  private normalizePunctuation(text: string): string {
    // 保守处理：只处理明显的错误
    return text
      .replace(/\s+([,.!?;:])/g, '$1')  // 移除标点前的空格
      .replace(/([,.!?;:])([^\s])/g, '$1 $2');  // 标点后添加空格（如果缺失）
  }

  /**
   * 规范化数字
   */
  private normalizeNumbers(text: string): string {
    // 保守处理：只处理明显的口语数字
    // 例如：one hundred and five -> 105
    // 暂时跳过复杂转换，避免误处理
    return text;
  }

  /**
   * 保护缩写
   */
  private protectAbbreviations(text: string): string {
    // 常见技术缩写列表
    const abbreviations = [
      'API', 'URL', 'HTTP', 'HTTPS', 'GPU', 'CPU', 'SQL', 'JSON', 'XML',
      'HTML', 'CSS', 'JS', 'TS', 'IDE', 'OS', 'UI', 'UX', 'AI', 'ML',
      'NLP', 'ASR', 'NMT', 'TTS', 'VAD', 'WAV', 'MP3', 'OPUS',
    ];

    let protectedText = text;
    for (const abbr of abbreviations) {
      // 匹配小写或混合大小写的缩写，转换为全大写
      const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
      protectedText = protectedText.replace(regex, abbr);
    }

    return protectedText;
  }

  /**
   * 保护URL和邮箱
   */
  private protectUrlsAndEmails(text: string): string {
    // URL和邮箱已经在检测时识别，这里只需要确保它们不被修改
    // 实际保护在后续的LLM修复阶段通过Prompt实现
    return text;
  }

  /**
   * 检测是否包含数字
   */
  private hasNumbers(text: string): boolean {
    return /\d/.test(text);
  }

  /**
   * 检测是否包含缩写
   */
  private hasAbbreviations(text: string): boolean {
    const commonAbbrs = ['api', 'url', 'http', 'gpu', 'cpu', 'sql', 'json', 'xml', 'html', 'css'];
    const lowerText = text.toLowerCase();
    return commonAbbrs.some(abbr => lowerText.includes(abbr));
  }

  /**
   * 检测是否包含URL
   */
  private hasUrls(text: string): boolean {
    const urlPattern = /https?:\/\/[^\s]+|www\.[^\s]+/i;
    return urlPattern.test(text);
  }

  /**
   * 检测是否包含邮箱
   */
  private hasEmails(text: string): boolean {
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    return emailPattern.test(text);
  }
}
