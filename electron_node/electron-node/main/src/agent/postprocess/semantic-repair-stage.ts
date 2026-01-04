/**
 * SemanticRepairStage - 语义修复Stage（统一入口，语言路由）
 * 职责：根据源语言路由到对应的修复Stage
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairTask, SemanticRepairResult } from '../../task-router/types';
import { EnNormalizeStage, EnNormalizeStageResult } from './en-normalize-stage';
import { SemanticRepairStageZH } from './semantic-repair-stage-zh';
import { SemanticRepairStageEN } from './semantic-repair-stage-en';
import { SemanticRepairServiceInfo } from '../node-agent-services-semantic-repair';
import logger from '../../logger';

export interface SemanticRepairStageResult {
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
  semanticRepairApplied?: boolean;  // 是否应用了语义修复
}

export interface SemanticRepairStageConfig {
  zh?: {
    enabled: boolean;
    qualityThreshold?: number;
    forceForShortSentence?: boolean;
  };
  en?: {
    normalizeEnabled: boolean;
    repairEnabled: boolean;
    qualityThreshold?: number;
  };
}

export class SemanticRepairStage {
  private zhStage: SemanticRepairStageZH | null = null;
  private enStage: SemanticRepairStageEN | null = null;
  private enNormalizeStage: EnNormalizeStage | null = null;

  constructor(
    private taskRouter: TaskRouter | null,
    private installedServices: SemanticRepairServiceInfo,
    private config: SemanticRepairStageConfig
  ) {
    // 初始化中文修复Stage
    if (installedServices.zh && config.zh?.enabled && taskRouter) {
      this.zhStage = new SemanticRepairStageZH(taskRouter, config.zh || {});
      logger.info({}, 'SemanticRepairStage: ZH stage initialized');
    }

    // 初始化英文修复Stage
    if (installedServices.en && config.en?.repairEnabled && taskRouter) {
      this.enStage = new SemanticRepairStageEN(taskRouter, config.en || {});
      logger.info({}, 'SemanticRepairStage: EN repair stage initialized');
    }

    // 初始化英文标准化Stage
    if (installedServices.enNormalize && config.en?.normalizeEnabled && taskRouter) {
      this.enNormalizeStage = new EnNormalizeStage(taskRouter);
      logger.info({}, 'SemanticRepairStage: EN normalize stage initialized');
    }
  }

  /**
   * 执行语义修复
   */
  async process(
    job: JobAssignMessage,
    text: string,
    qualityScore?: number,
    meta?: any
  ): Promise<SemanticRepairStageResult> {
    if (!text || text.trim().length === 0) {
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['EMPTY_TEXT'],
        semanticRepairApplied: false,
      };
    }

    const srcLang = job.src_lang || 'zh';

    // 根据语言路由到对应的Stage
    if (srcLang === 'zh') {
      return await this.processChinese(job, text, qualityScore, meta);
    } else if (srcLang === 'en') {
      return await this.processEnglish(job, text, qualityScore, meta);
    } else {
      // 其他语言暂不支持，直接PASS
      logger.debug(
        { jobId: job.job_id, srcLang },
        'SemanticRepairStage: Unsupported language, returning PASS'
      );
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['UNSUPPORTED_LANGUAGE'],
        semanticRepairApplied: false,
      };
    }
  }

  /**
   * 处理中文文本
   */
  private async processChinese(
    job: JobAssignMessage,
    text: string,
    qualityScore?: number,
    meta?: any
  ): Promise<SemanticRepairStageResult> {
    if (!this.zhStage) {
      logger.debug(
        { jobId: job.job_id },
        'SemanticRepairStage: ZH stage not available, returning PASS'
      );
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['ZH_STAGE_NOT_AVAILABLE'],
        semanticRepairApplied: false,
      };
    }

    try {
      const result = await this.zhStage.process(job, text, qualityScore, meta);
      return {
        textOut: result.textOut,
        decision: result.decision,
        confidence: result.confidence,
        diff: result.diff,
        reasonCodes: result.reasonCodes,
        repairTimeMs: result.repairTimeMs,
        semanticRepairApplied: result.decision === 'REPAIR',
      };
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          jobId: job.job_id,
        },
        'SemanticRepairStage: ZH stage error, returning PASS'
      );
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['ZH_STAGE_ERROR'],
        semanticRepairApplied: false,
      };
    }
  }

  /**
   * 处理英文文本
   */
  private async processEnglish(
    job: JobAssignMessage,
    text: string,
    qualityScore?: number,
    meta?: any
  ): Promise<SemanticRepairStageResult> {
    let currentText = text;
    const reasonCodes: string[] = [];
    let normalized = false;

    // Step 1: 英文标准化（如果启用）
    if (this.enNormalizeStage) {
      try {
        const normalizeResult = await this.enNormalizeStage.process(job, currentText, qualityScore);
        if (normalizeResult.normalized) {
          currentText = normalizeResult.normalizedText;
          normalized = true;
          reasonCodes.push(...normalizeResult.reasonCodes);
        }
      } catch (error: any) {
        logger.warn(
          {
            error: error.message,
            jobId: job.job_id,
          },
          'SemanticRepairStage: EN normalize stage error, continuing with original text'
        );
      }
    }

    // Step 2: 英文语义修复（如果启用且需要）
    if (this.enStage) {
      try {
        const repairResult = await this.enStage.process(job, currentText, qualityScore, meta);
        return {
          textOut: repairResult.textOut,
          decision: repairResult.decision,
          confidence: repairResult.confidence,
          diff: repairResult.diff,
          reasonCodes: [...reasonCodes, ...repairResult.reasonCodes],
          repairTimeMs: repairResult.repairTimeMs,
          semanticRepairApplied: repairResult.decision === 'REPAIR',
        };
      } catch (error: any) {
        logger.error(
          {
            error: error.message,
            jobId: job.job_id,
          },
          'SemanticRepairStage: EN repair stage error, returning normalized or original text'
        );
        return {
          textOut: currentText,
          decision: normalized ? 'PASS' : 'PASS',
          confidence: normalized ? 0.8 : 1.0,
          reasonCodes: [...reasonCodes, 'EN_REPAIR_STAGE_ERROR'],
          semanticRepairApplied: false,
        };
      }
    }

    // 如果只有标准化，返回标准化结果
    return {
      textOut: currentText,
      decision: normalized ? 'REPAIR' : 'PASS',
      confidence: normalized ? 0.9 : 1.0,
      reasonCodes,
      semanticRepairApplied: normalized,
    };
  }
}
