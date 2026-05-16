/**
 * SemanticRepairStage - 语义修复 Stage（语言路由）
 * 5015 不可用或失败时返回 skipped，由 pipeline step 回退原文并继续 NMT/TTS。
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { TaskRouter } from '../../task-router/task-router';
import { SemanticRepairTask, SemanticRepairResult } from '../../task-router/types';
import { EnNormalizeStage, EnNormalizeStageResult } from './en-normalize-stage';
import { SemanticRepairStageZH } from './semantic-repair-stage-zh';
import { SemanticRepairStageEN } from './semantic-repair-stage-en';
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
  /** @deprecated 使用 semanticRepairHttpApplied */
  semanticRepairApplied?: boolean;
  semanticRepairHttpCalled?: boolean;
  semanticRepairHttpApplied?: boolean;
  enNormalizeApplied?: boolean;
  skipped?: boolean;
  skipReason?: string;
  degraded?: boolean;
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
    private config: SemanticRepairStageConfig
  ) {
    if (config.zh?.enabled && taskRouter) {
      this.zhStage = new SemanticRepairStageZH(taskRouter, config.zh || {});
    }
    if (config.en?.repairEnabled && taskRouter) {
      this.enStage = new SemanticRepairStageEN(taskRouter, config.en || {});
    }
    if (config.en?.normalizeEnabled && taskRouter) {
      this.enNormalizeStage = new EnNormalizeStage(taskRouter);
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
    }
    return {
      textOut: text,
      decision: 'PASS',
      confidence: 1.0,
      reasonCodes: ['UNSUPPORTED_LANGUAGE'],
      skipped: true,
      skipReason: 'UNSUPPORTED_LANGUAGE',
    };
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
      return {
        textOut: text,
        decision: 'PASS',
        confidence: 1.0,
        reasonCodes: ['ZH_STAGE_NOT_AVAILABLE'],
        skipped: true,
        skipReason: 'ZH_STAGE_NOT_AVAILABLE',
      };
    }

    const result = await this.zhStage.process(job, text, qualityScore, meta);
    if (result.skipped) {
      return {
        textOut: result.textOut,
        decision: 'PASS',
        confidence: result.confidence,
        reasonCodes: result.reasonCodes,
        repairTimeMs: result.repairTimeMs,
        skipped: true,
        skipReason: result.skipReason,
        degraded: result.degraded,
      };
    }
    const httpApplied = result.semanticRepairHttpApplied === true;
    return {
      textOut: result.textOut,
      decision: result.decision,
      confidence: result.confidence,
      diff: result.diff,
      reasonCodes: result.reasonCodes,
      repairTimeMs: result.repairTimeMs,
      semanticRepairHttpCalled: true,
      semanticRepairHttpApplied: httpApplied,
      semanticRepairApplied: httpApplied,
    };
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
      const repairResult = await this.enStage.process(job, currentText, qualityScore, meta);
      if (repairResult.skipped) {
        return {
          textOut: repairResult.textOut,
          decision: 'PASS',
          confidence: repairResult.confidence,
          reasonCodes: [...reasonCodes, ...repairResult.reasonCodes],
          repairTimeMs: repairResult.repairTimeMs,
          skipped: true,
          skipReason: repairResult.skipReason,
          degraded: repairResult.degraded,
          enNormalizeApplied: normalized,
        };
      }
      const httpApplied = repairResult.semanticRepairHttpApplied === true;
      return {
        textOut: repairResult.textOut,
        decision: repairResult.decision,
        confidence: repairResult.confidence,
        diff: repairResult.diff,
        reasonCodes: [...reasonCodes, ...repairResult.reasonCodes],
        repairTimeMs: repairResult.repairTimeMs,
        semanticRepairHttpCalled: true,
        semanticRepairHttpApplied: httpApplied,
        semanticRepairApplied: httpApplied,
        enNormalizeApplied: normalized,
      };
    }

    return {
      textOut: currentText,
      decision: 'PASS',
      confidence: normalized ? 0.9 : 1.0,
      reasonCodes,
      enNormalizeApplied: normalized,
      semanticRepairHttpApplied: false,
      semanticRepairApplied: false,
    };
  }
}
