/**
 * SemanticRepairStageEN - 英文语义修复Stage
 * 职责：对英文ASR文本进行语义修复（使用LLM）
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairTask, SemanticRepairResult } from '../../task-router/types';
import logger from '../../logger';
import { loadNodeConfig } from '../../node-config';

export interface SemanticRepairStageENConfig {
  repairEnabled: boolean;
  qualityThreshold?: number;  // 质量分数阈值（默认0.70）
}

export interface SemanticRepairStageENResult {
  textOut: string;
  decision: 'PASS' | 'REPAIR' | 'REJECT';
  confidence: number;
  diff?: Array<{
    from: string;
    to: string;
    position: number;
  }>;
  reasonCodes: string[];
  repairTimeMs?: number;
}

export class SemanticRepairStageEN {
  private readonly DEFAULT_QUALITY_THRESHOLD = 0.70;

  constructor(
    private taskRouter: TaskRouter | null,
    private config: SemanticRepairStageENConfig
  ) {}

  /**
   * 执行英文语义修复
   */
  async process(
    job: JobAssignMessage,
    text: string,
    qualityScore?: number,
    meta?: any
  ): Promise<SemanticRepairStageENResult> {
    if (!text || text.trim().length === 0) {
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['EMPTY_TEXT'],
      };
    }

    // 对每句话都进行修复，跳过质量评分
    // 仍然计算触发原因用于日志记录
    const shouldRepair = this.shouldTriggerRepair(text, qualityScore, meta);

    // 调用语义修复服务
    if (!this.taskRouter) {
      logger.warn(
        { jobId: job.job_id },
        'SemanticRepairStageEN: TaskRouter not available, returning PASS'
      );
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['TASK_ROUTER_NOT_AVAILABLE'],
      };
    }

    const startTime = Date.now();

    try {
      // 获取微上下文（上一句尾部）
      const microContext = this.getMicroContext(job, meta);

      // 构建修复任务
      const repairTask: SemanticRepairTask = {
        job_id: job.job_id,
        session_id: job.session_id || '',
        utterance_index: job.utterance_index || 0,
        lang: 'en',
        text_in: text,
        quality_score: qualityScore,
        micro_context: microContext,
        meta: {
          segments: meta?.segments,
          language_probability: meta?.language_probability,
          reason_codes: shouldRepair.reasonCodes,
        },
      };

      // 调用修复服务
      const repairResult = await this.taskRouter.routeSemanticRepairTask(repairTask);
      const repairTimeMs = Date.now() - startTime;

      logger.debug(
        {
          jobId: job.job_id,
          decision: repairResult.decision,
          confidence: repairResult.confidence,
          reasonCodes: repairResult.reason_codes,
          repairTimeMs,
        },
        'SemanticRepairStageEN: Repair completed'
      );

      return {
        textOut: repairResult.text_out,
        decision: repairResult.decision,
        confidence: repairResult.confidence,
        diff: repairResult.diff,
        reasonCodes: repairResult.reason_codes,
        repairTimeMs,
      };
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          jobId: job.job_id,
        },
        'SemanticRepairStageEN: Repair service error, returning PASS'
      );
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['SERVICE_ERROR'],
        repairTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * 判断是否应该触发修复
   * 修改：跳过质量评分，对 >= 配置的最小发送长度 字符的文本都进行修复
   */
  private shouldTriggerRepair(
    text: string,
    qualityScore?: number,
    meta?: any
  ): { shouldRepair: boolean; reasonCodes: string[] } {
    const reasonCodes: string[] = [];
    // 从配置文件加载文本长度配置
    const nodeConfig = loadNodeConfig();
    const MIN_LENGTH_FOR_REPAIR = nodeConfig.textLength?.minLengthToSend ?? 20;  // 最小修复长度：默认20个字符

    // 跳过质量评分，只检查文本长度
    // 对 >= 配置的最小发送长度 字符的文本都进行修复
    if (text.length >= MIN_LENGTH_FOR_REPAIR) {
      reasonCodes.push('LENGTH_MEETS_THRESHOLD');
      // 仍然记录其他检测结果用于日志，但不作为触发条件
      if (qualityScore !== undefined) {
        const threshold = this.config.qualityThreshold || this.DEFAULT_QUALITY_THRESHOLD;
        if (qualityScore < threshold) {
          reasonCodes.push('LOW_QUALITY_SCORE');
        }
      }
      if (this.isFragmented(text)) {
        reasonCodes.push('FRAGMENTED_TEXT');
      }
      if (this.hasStructuralIssues(text)) {
        reasonCodes.push('STRUCTURAL_ISSUES');
      }
      const languageProbability = meta?.language_probability || 1.0;
      if (languageProbability < 0.7) {
        reasonCodes.push('LOW_LANGUAGE_PROBABILITY');
      }
    }

    return {
      shouldRepair: reasonCodes.length > 0,
      reasonCodes,
    };
  }

  /**
   * 检测文本是否片段化
   */
  private isFragmented(text: string): boolean {
    // 检查是否包含大量短片段（无标点分隔）
    const words = text.split(/\s+/);
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
    return avgWordLength < 3 && words.length > 5;
  }

  /**
   * 检测结构异常
   */
  private hasStructuralIssues(text: string): boolean {
    // 检查是否缺少基本句法结构
    // 简化检查：至少应该包含一个常见动词
    const commonVerbs = ['is', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'can', 'should'];
    const lowerText = text.toLowerCase();
    const hasVerb = commonVerbs.some(verb => lowerText.includes(verb));
    
    // 检查是否包含标点
    const hasPunctuation = /[.!?,;:]/.test(text);
    
    return !hasVerb && !hasPunctuation && text.length > 10;
  }

  /**
   * 获取微上下文（上一句尾部）
   */
  private getMicroContext(job: JobAssignMessage, meta?: any): string | undefined {
    // TODO: 从AggregatorManager获取上一句文本
    // 暂时返回undefined，后续可以从meta中获取
    return meta?.micro_context;
  }
}
