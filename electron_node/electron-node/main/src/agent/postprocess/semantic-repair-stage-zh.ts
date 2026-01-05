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
import { getSequentialExecutor } from '../../sequential-executor/sequential-executor-factory';
import { tryAcquireGpuLease } from '../../gpu-arbiter';
import { loadNodeConfig } from '../../node-config';

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

      // 顺序执行：确保Semantic Repair按utterance_index顺序执行
      const sequentialExecutor = getSequentialExecutor();
      const sessionId = job.session_id || '';
      const utteranceIndex = job.utterance_index || 0;

      // 使用顺序执行管理器包装Semantic Repair调用
      const repairResult = await sequentialExecutor.execute(
        sessionId,
        utteranceIndex,
        'SEMANTIC_REPAIR',
        async () => {
          // GPU仲裁：获取GPU租约（支持忙时降级）
          let result: any;
          
          try {
            const lease = await tryAcquireGpuLease(
              'SEMANTIC_REPAIR',
              {
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
                stage: 'SemanticRepair',
              }
            );

            if (lease) {
              // 成功获取GPU租约，使用GPU执行
              try {
                result = await this.taskRouter!.routeSemanticRepairTask(repairTask);
              } finally {
                lease.release();
              }
            } else {
              // GPU租约获取失败（忙时降级），根据策略处理
              const config = loadNodeConfig();
              const policy = config.gpuArbiter?.policies?.SEMANTIC_REPAIR;
              const busyPolicy = policy?.busyPolicy || 'SKIP';

              if (busyPolicy === 'FALLBACK_CPU') {
                // TODO: 实现CPU fallback（需要语义修复服务支持CPU模式）
                logger.warn(
                  {
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                  },
                  'SemanticRepairStageZH: GPU busy, FALLBACK_CPU not implemented, skipping repair'
                );
                // 回退到PASS
                result = {
                  decision: 'PASS',
                  text_out: text,
                  confidence: 1.0,
                  reason_codes: ['GPU_BUSY_FALLBACK_CPU_NOT_IMPLEMENTED'],
                };
              } else {
                // SKIP策略：直接PASS
                logger.debug(
                  {
                    jobId: job.job_id,
                    sessionId: job.session_id,
                    utteranceIndex: job.utterance_index,
                  },
                  'SemanticRepairStageZH: GPU busy, skipping repair (SKIP policy)'
                );
                result = {
                  decision: 'PASS',
                  text_out: text,
                  confidence: 1.0,
                  reason_codes: ['GPU_BUSY_SKIPPED'],
                };
              }
            }
          } catch (error: any) {
            // GPU租约获取异常，回退到PASS
            logger.error(
              {
                error: error.message,
                jobId: job.job_id,
                sessionId: job.session_id,
                utteranceIndex: job.utterance_index,
              },
              'SemanticRepairStageZH: GPU lease error, skipping repair'
            );
            result = {
              decision: 'PASS',
              text_out: text,
              confidence: 1.0,
              reason_codes: ['GPU_LEASE_ERROR'],
            };
          }
          
          return result;
        },
        job.job_id
      );
      
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
