/**
 * SemanticRepairStageZH - 中文语义修复Stage
 * 职责：对中文ASR文本进行语义修复（使用LLM）
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairTask, SemanticRepairResult } from '../../task-router/types';
import { SemanticRepairScorer, SemanticRepairScorerConfig } from './semantic-repair-scorer';
import { SemanticRepairValidator, SemanticRepairValidatorConfig } from './semantic-repair-validator';
import logger from '../../logger';

export interface SemanticRepairStageZHConfig {
  enabled: boolean;
  qualityThreshold?: number;  // 质量分数阈值（默认0.70，已废弃，使用scorer配置）
  forceForShortSentence?: boolean;  // 是否强制处理短句（已废弃，使用scorer配置）
  scorerConfig?: SemanticRepairScorerConfig;  // P1-1: 打分器配置
  validatorConfig?: SemanticRepairValidatorConfig;  // P1-2: 输出校验配置
}

export interface SemanticRepairStageZHResult {
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

export class SemanticRepairStageZH {
  private readonly DEFAULT_QUALITY_THRESHOLD = 0.70;
  private readonly SHORT_SENTENCE_LENGTH = 16;
  private scorer: SemanticRepairScorer;
  private validator: SemanticRepairValidator;

  constructor(
    private taskRouter: TaskRouter | null,
    private config: SemanticRepairStageZHConfig
  ) {
    // P1-1: 初始化打分器
    this.scorer = new SemanticRepairScorer({
      qualityThreshold: config.qualityThreshold || this.DEFAULT_QUALITY_THRESHOLD,
      shortSentenceLength: this.SHORT_SENTENCE_LENGTH,
      ...config.scorerConfig,
    });

    // P1-2: 初始化输出校验器
    this.validator = new SemanticRepairValidator(config.validatorConfig);
  }

  /**
   * 执行中文语义修复
   */
  async process(
    job: JobAssignMessage,
    text: string,
    qualityScore?: number,
    meta?: any
  ): Promise<SemanticRepairStageZHResult> {
    if (!text || text.trim().length === 0) {
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['EMPTY_TEXT'],
      };
    }

    // 调用语义修复服务
    if (!this.taskRouter) {
      logger.warn(
        { jobId: job.job_id },
        'SemanticRepairStageZH: TaskRouter not available, returning PASS'
      );
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['TASK_ROUTER_NOT_AVAILABLE'],
      };
    }

    // 对每句话都进行修复，不根据阈值触发
    // 仍然计算评分用于日志记录，但不作为触发条件
    const scoreResult = this.scorer.score(text, qualityScore, meta);

    const startTime = Date.now();

    try {
      // 获取微上下文（上一句尾部）
      const microContext = this.getMicroContext(job, meta);

      // 构建修复任务
      const repairTask: SemanticRepairTask = {
        job_id: job.job_id,
        session_id: job.session_id || '',
        utterance_index: job.utterance_index || 0,
        lang: 'zh',
        text_in: text,
        quality_score: qualityScore,
        micro_context: microContext,
        meta: {
          segments: meta?.segments,
          language_probability: meta?.language_probability,
          reason_codes: scoreResult.reasonCodes,
          score: scoreResult.score,  // P1-1: 传递综合评分
          score_details: scoreResult.details,  // P1-1: 传递评分详情
        },
      };

      // 调用修复服务
      const repairResult = await this.taskRouter.routeSemanticRepairTask(repairTask);
      const repairTimeMs = Date.now() - startTime;

      // P1-2: 输出校验
      let finalTextOut = repairResult.text_out;
      let finalDecision = repairResult.decision;
      let finalConfidence = repairResult.confidence;
      let finalReasonCodes = [...repairResult.reason_codes];

      if (repairResult.decision === 'REPAIR') {
        const validationResult = this.validator.validate(text, repairResult.text_out);
        
        if (!validationResult.isValid) {
          // 校验失败，回退到PASS
          logger.warn(
            {
              jobId: job.job_id,
              validationReasonCodes: validationResult.reasonCodes,
              originalText: text.substring(0, 50),
              repairedText: repairResult.text_out.substring(0, 50),
            },
            'SemanticRepairStageZH: Validation failed, reverting to PASS'
          );
          finalTextOut = text;
          finalDecision = 'PASS';
          finalConfidence = 1.0;
          finalReasonCodes = [...repairResult.reason_codes, ...validationResult.reasonCodes];
        }
      }

      logger.debug(
        {
          jobId: job.job_id,
          decision: finalDecision,
          confidence: finalConfidence,
          reasonCodes: finalReasonCodes,
          repairTimeMs,
        },
        'SemanticRepairStageZH: Repair completed'
      );

      return {
        textOut: finalTextOut,
        decision: finalDecision,
        confidence: finalConfidence,
        diff: repairResult.diff,
        reasonCodes: finalReasonCodes,
        repairTimeMs,
      };
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          stack: error.stack,
          jobId: job.job_id,
        },
        'SemanticRepairStageZH: Repair service error, returning PASS'
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

  // P1-1: 已移除shouldTriggerRepair、countNonChineseChars、hasBasicSyntax方法
  // 这些功能已迁移到SemanticRepairScorer中

  /**
   * 获取微上下文（上一句尾部）
   */
  private getMicroContext(job: JobAssignMessage, meta?: any): string | undefined {
    // TODO: 从AggregatorManager获取上一句文本
    // 暂时返回undefined，后续可以从meta中获取
    return meta?.micro_context;
  }
}
