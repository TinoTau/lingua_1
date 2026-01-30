/**
 * OriginalJobResultDispatcher
 * 按原始job_id分发ASR结果，累积多个ASR批次到同一个JobResult
 * 
 * 功能：
 * 1. 按originalJobId分组ASR结果
 * 2. 累积多个ASR批次到同一个JobResult的segments数组
 * 3. 当达到期望的片段数量或finalize时，触发后续处理（语义修复、NMT、TTS）
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { ASRResult, SegmentInfo } from '../task-router/types';
import logger from '../logger';

/**
 * 原始Job的ASR数据
 */
export interface OriginalJobASRData {
  originalJobId: string;
  asrText: string;
  asrSegments: SegmentInfo[];
  languageProbabilities?: Record<string, number>;
  // ✅ 新增：批次索引（用于排序）
  batchIndex?: number;
  jobIndex?: number; // 批次归属的job（可选）
  /** 是否缺失（ASR 失败/超时，标记为已结算但无文本） */
  missing?: boolean;
}

/**
 * 原始Job的处理回调
 */
type OriginalJobCallback = (
  asrData: OriginalJobASRData,
  originalJobMsg: JobAssignMessage
) => Promise<void>;

/**
 * 原始Job的注册信息
 */
interface OriginalJobRegistration {
  originalJob: JobAssignMessage;
  callback: OriginalJobCallback;
  /** 期望的片段数量：必须等于 audioSegments.length（强制一致） */
  expectedSegmentCount: number;
  /** 已接收的片段数量（包括 missing 片段） */
  receivedCount: number;
  /** 缺失的片段数量（ASR 失败/超时） */
  missingCount: number;
  /** 累积的ASR批次数据（用于排序和合并文本） */
  accumulatedSegments: OriginalJobASRData[];
  /** 累积的ASR片段列表（用于传递给后续处理） */
  accumulatedSegmentsList: SegmentInfo[];
  // ✅ utterance 生命周期 / 状态
  /** 注册时间（用于计算utterance生命周期和TTL） */
  startedAt: number;
  /** 最后活动时间（用于超时清理） */
  lastActivityAt: number;
  /** 是否已finalize（防止重复处理） */
  isFinalized: boolean;
  /** TTL 定时器句柄（用于超时强制 finalize） */
  ttlTimerHandle?: NodeJS.Timeout;
  /** 是否有 pendingMaxDurationAudio（等待后续 batch 到达） */
  hasPendingMaxDurationAudio: boolean;
}

/**
 * OriginalJobResultDispatcher
 * 按原始job_id分发ASR结果
 */
export class OriginalJobResultDispatcher {
  // 按sessionId和originalJobId分组存储注册信息
  private registrations: Map<string, Map<string, OriginalJobRegistration>> = new Map();

  // ✅ Registration TTL：5-10秒（决策部门建议）
  private readonly REGISTRATION_TTL_MS = 10_000; // 10秒
  // ✅ 20秒超时清理机制（兜底清理，防止内存泄漏）
  private readonly UTT_TIMEOUT_MS = 20_000; // 20秒
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    // 启动定时清理任务（每5秒检查一次）
    this.startCleanupTimer();
  }

  /**
   * 启动定时清理任务
   */
  private startCleanupTimer(): void {
    if (this.cleanupIntervalId) {
      return; // 已经启动
    }

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpiredRegistrations();
    }, 5_000); // 每5秒检查一次

    logger.info(
      {
        registrationTtlMs: this.REGISTRATION_TTL_MS,
        checkIntervalMs: 5_000,
      },
      'OriginalJobResultDispatcher: Started cleanup timer for expired registrations'
    );
  }

  /**
   * 停止定时清理任务
   */
  stopCleanupTimer(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      logger.info(
        {},
        'OriginalJobResultDispatcher: Stopped cleanup timer'
      );
    }
  }

  /**
   * 清理所有定时器（用于测试）
   */
  cleanupAllTimers(): void {
    // 停止清理定时器
    this.stopCleanupTimer();
    
    // 清理所有 registration 的 TTL 定时器
    for (const [sessionId, sessionRegistrations] of this.registrations.entries()) {
      for (const [originalJobId, registration] of sessionRegistrations.entries()) {
        if (registration.ttlTimerHandle) {
          clearTimeout(registration.ttlTimerHandle);
          registration.ttlTimerHandle = undefined;
        }
      }
    }
  }

  /**
   * 清理超时的注册信息（兜底清理，防止内存泄漏）
   * 注意：TTL 超时应该通过 forceFinalizePartial 处理，这里只清理异常悬挂的 registration
   */
  private cleanupExpiredRegistrations(): void {
    const now = Date.now();
    const MAX_IDLE_TIME_MS = 60_000; // 60秒（比 TTL 更长，只清理异常悬挂）
    const expiredJobs: Array<{ sessionId: string; originalJobId: string; idleMs: number }> = [];

    for (const [sessionId, sessionRegistrations] of this.registrations.entries()) {
      for (const [originalJobId, registration] of sessionRegistrations.entries()) {
        // 已完成的无需处理
        if (registration.isFinalized) {
          continue;
        }

        const idleMs = now - registration.lastActivityAt;
        // 只清理异常悬挂的 registration（超过60秒无活动）
        if (idleMs > MAX_IDLE_TIME_MS) {
          expiredJobs.push({ sessionId, originalJobId, idleMs });

          // 清除 TTL 定时器
          if (registration.ttlTimerHandle) {
            clearTimeout(registration.ttlTimerHandle);
          }

          // 只清理，不触发SR（异常情况）
          sessionRegistrations.delete(originalJobId);

          logger.warn(
            {
              sessionId,
              originalJobId,
              idleMs,
              startedAt: registration.startedAt,
              lastActivityAt: registration.lastActivityAt,
              receivedCount: registration.receivedCount,
              expectedSegmentCount: registration.expectedSegmentCount,
              accumulatedSegmentsCount: registration.accumulatedSegments.length,
              reason: 'Registration abnormally hung, cleaning (no SR triggered)',
            },
            'OriginalJobResultDispatcher: Registration abnormally hung, cleaning'
          );
        }
      }

      // 如果session下没有注册信息了，删除session
      if (sessionRegistrations.size === 0) {
        this.registrations.delete(sessionId);
      }
    }

    if (expiredJobs.length > 0) {
      logger.warn(
        {
          expiredCount: expiredJobs.length,
          expiredJobs: expiredJobs.map(j => ({
            sessionId: j.sessionId,
            originalJobId: j.originalJobId,
            idleMs: j.idleMs,
          })),
        },
        'OriginalJobResultDispatcher: Cleaned up abnormally hung registrations'
      );
    }
  }

  /**
   * 注册原始job
   * 
   * @param sessionId 会话ID
   * @param originalJobId 原始job ID
   * @param expectedSegmentCount 期望的片段数量（必须等于 audioSegments.length，强制一致）
   * @param originalJob 原始job消息
   * @param callback 处理回调
   * @param hasPendingMaxDurationAudio 是否有 pendingMaxDurationAudio（等待后续 batch 到达）
   */
  registerOriginalJob(
    sessionId: string,
    originalJobId: string,
    expectedSegmentCount: number,
    originalJob: JobAssignMessage,
    callback: OriginalJobCallback,
    hasPendingMaxDurationAudio: boolean
  ): void {
    let sessionRegistrations = this.registrations.get(sessionId);
    if (!sessionRegistrations) {
      sessionRegistrations = new Map();
      this.registrations.set(sessionId, sessionRegistrations);
    }

    const existingRegistration = sessionRegistrations.get(originalJobId);
    
    // ✅ 架构修复：如果已存在且未 finalized，追加 batch 而不是覆盖
    if (existingRegistration && !existingRegistration.isFinalized) {
      // 追加 batch：增加 expectedSegmentCount，保留 accumulatedSegments
      existingRegistration.expectedSegmentCount += expectedSegmentCount;
      existingRegistration.lastActivityAt = Date.now();
      
      // 如果后续 batch 到达，清除 pendingMaxDurationAudio 标记（说明 pending 已被处理）
      if (existingRegistration.hasPendingMaxDurationAudio) {
        existingRegistration.hasPendingMaxDurationAudio = false;
        logger.info(
          {
            sessionId,
            originalJobId,
            note: 'Subsequent batch arrived, pendingMaxDurationAudio flag cleared',
          },
          'OriginalJobResultDispatcher: Subsequent batch arrived, pendingMaxDurationAudio processed'
        );
      }
      
      // 重置 TTL 定时器（延长等待时间）
      if (existingRegistration.ttlTimerHandle) {
        clearTimeout(existingRegistration.ttlTimerHandle);
      }
      existingRegistration.ttlTimerHandle = setTimeout(() => {
        this.forceFinalizePartial(sessionId, originalJobId, 'registration_ttl');
      }, this.REGISTRATION_TTL_MS);
      
      logger.info(
        {
          sessionId,
          originalJobId,
          previousExpectedSegmentCount: existingRegistration.expectedSegmentCount - expectedSegmentCount,
          newExpectedSegmentCount: existingRegistration.expectedSegmentCount,
          addedBatchCount: expectedSegmentCount,
          accumulatedSegmentsCount: existingRegistration.accumulatedSegments.length,
          note: 'Appended batch to existing registration (not overwritten)',
        },
        'OriginalJobResultDispatcher: Appended batch to existing original job registration'
      );
      return;
    }

    // 新注册：创建新的 registration
    const now = Date.now();
    const registration: OriginalJobRegistration = {
      originalJob,
      callback,
      expectedSegmentCount,
      receivedCount: 0,
      missingCount: 0,
      accumulatedSegments: [],
      accumulatedSegmentsList: [],
      startedAt: now,
      lastActivityAt: now,
      isFinalized: false,
      hasPendingMaxDurationAudio,
    };
    
    // ✅ 启动 TTL 定时器（超时强制 finalize partial）
    registration.ttlTimerHandle = setTimeout(() => {
      this.forceFinalizePartial(sessionId, originalJobId, 'registration_ttl');
    }, this.REGISTRATION_TTL_MS);
    
    sessionRegistrations.set(originalJobId, registration);

    logger.info(
      {
        sessionId,
        originalJobId,
        expectedSegmentCount,
        registrationTtlMs: this.REGISTRATION_TTL_MS,
        note: 'Registration TTL timer started',
      },
      'OriginalJobResultDispatcher: Registered original job with TTL timer'
    );
  }

  /**
   * 添加ASR片段
   * 
   * @param sessionId 会话ID
   * @param originalJobId 原始job ID
   * @param asrData ASR数据
   * @returns 是否应该立即处理（达到期望片段数量或finalize）
   */
  async addASRSegment(
    sessionId: string,
    originalJobId: string,
    asrData: OriginalJobASRData
  ): Promise<boolean> {
    const sessionRegistrations = this.registrations.get(sessionId);
    if (!sessionRegistrations) {
      logger.warn(
        { sessionId, originalJobId },
        'OriginalJobResultDispatcher: Session not found'
      );
      return false;
    }

    const registration = sessionRegistrations.get(originalJobId);
    if (!registration) {
      logger.warn(
        { sessionId, originalJobId },
        'OriginalJobResultDispatcher: Original job not registered'
      );
      return false;
    }

    // ✅ 更新生命周期：更新lastActivityAt
    registration.lastActivityAt = Date.now();

    // ✅ 架构设计：batchIndex由dispatcher管理（相对于originalJobId）
    // 原因：batchIndex用于排序，应该相对于originalJobId，而不是相对于当前job
    // 设计：dispatcher根据已接收的batch数量自动分配batchIndex，确保唯一且递增
    // 这样asr-step.ts不需要关心batchIndex，逻辑更简单
    if (asrData.batchIndex === undefined || asrData.batchIndex === null) {
      asrData.batchIndex = registration.receivedCount;
    } else {
      // 如果asr-step.ts设置了batchIndex，忽略它，使用dispatcher分配的
      // 这样可以避免多个job的batch被分配给同一个originalJobId时batchIndex重复的问题
      asrData.batchIndex = registration.receivedCount;
    }

    // ✅ 累积ASR结果（包括 missing segment）
    registration.accumulatedSegments.push(asrData);
    if (!asrData.missing) {
      // 只有非 missing 的 segment 才添加到 segmentsList
      registration.accumulatedSegmentsList.push(...asrData.asrSegments);
    }
    
    // ✅ 更新计数（missing segment 也计入 receivedCount）
    registration.receivedCount++;
    if (asrData.missing) {
      registration.missingCount++;
    }

    logger.info(
      {
        sessionId,
        originalJobId,
        operation: 'accumulateASRSegment',
        batchIndex: asrData.batchIndex,
        isMissing: asrData.missing || false,
        receivedCount: registration.receivedCount,
        missingCount: registration.missingCount,
        expectedSegmentCount: registration.expectedSegmentCount,
        asrTextLength: asrData.asrText.length,
        asrTextPreview: asrData.asrText.substring(0, 50),
        asrSegmentsCount: asrData.asrSegments.length,
        note: asrData.missing 
          ? 'Missing segment (ASR failed/timeout)' 
          : 'Normal segment - batchIndex assigned by dispatcher (relative to originalJobId)',
      },
      'OriginalJobResultDispatcher: [Accumulate] Added ASR segment to accumulation'
    );

    // ✅ 检查是否应该立即处理：当 receivedCount >= expectedSegmentCount 时触发
    const shouldProcess = registration.receivedCount >= registration.expectedSegmentCount;

    if (shouldProcess) {
      // ✅ 架构设计：如果所有batch都已经收到，立即处理
      // pendingMaxDurationAudio只影响后续的batch，不应该影响当前已经收到的batch的处理
      // 如果所有batch都已收到，应该立即处理，不需要等待pending音频
      
      // ✅ 清除 TTL 定时器
      if (registration.ttlTimerHandle) {
        clearTimeout(registration.ttlTimerHandle);
        registration.ttlTimerHandle = undefined;
      }
      
      // ✅ 标记为已finalize
      registration.isFinalized = true;

      // ✅ 按batchIndex排序，保证顺序（如果batchIndex存在）
      const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
        const aIndex = a.batchIndex ?? 0;
        const bIndex = b.batchIndex ?? 0;
        return aIndex - bIndex;
      });

      // ✅ 按排序后的顺序合并文本（跳过 missing segment）
      const nonMissingSegments = sortedSegments.filter(s => !s.missing);
      const fullText = nonMissingSegments.map(s => s.asrText).join(' ');
      const isPartial = registration.missingCount > 0;

      logger.info(
        {
          sessionId,
          originalJobId,
          operation: 'mergeASRText',
          batchCount: sortedSegments.length,
          missingCount: registration.missingCount,
          receivedCount: registration.receivedCount,
          expectedSegmentCount: registration.expectedSegmentCount,
          isPartial,
          batchTexts: sortedSegments.map((s, idx) => ({
            batchIndex: s.batchIndex ?? idx,
            isMissing: s.missing || false,
            textLength: s.asrText.length,
            textPreview: s.asrText.substring(0, 50),
            note: s.missing 
              ? 'Missing segment (ASR failed/timeout) - excluded from final text'
              : (s.asrText.length === 0 
                ? 'Empty result (audio quality rejection or ASR returned empty) - included in final text but will be empty'
                : 'Normal segment with text'),
          })),
          mergedTextLength: fullText.length,
          mergedTextPreview: fullText.substring(0, 100),
          note: registration.missingCount > 0 
            ? `Has ${registration.missingCount} missing segment(s) - these were excluded from final text merge`
            : 'No missing segments - all batches processed successfully',
        },
        'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text'
      );

      // 触发处理回调
      const finalAsrData: OriginalJobASRData = {
        originalJobId,
        asrText: fullText,
        asrSegments: registration.accumulatedSegmentsList,
        languageProbabilities: this.mergeLanguageProbabilities(nonMissingSegments),
      };

      await registration.callback(finalAsrData, registration.originalJob);

      // 清除注册信息
      sessionRegistrations.delete(originalJobId);
      if (sessionRegistrations.size === 0) {
        this.registrations.delete(sessionId);
      }
    }

    return shouldProcess;
  }

  /**
   * 强制 finalize partial（TTL 超时或异常情况）
   * 
   * @param sessionId 会话ID
   * @param originalJobId 原始job ID
   * @param reason 触发原因（registration_ttl / asr_segment_timeout 等）
   */
  private async forceFinalizePartial(
    sessionId: string,
    originalJobId: string,
    reason: string
  ): Promise<void> {
    const sessionRegistrations = this.registrations.get(sessionId);
    if (!sessionRegistrations) {
      return; // 已被正常流程清理
    }

    const registration = sessionRegistrations.get(originalJobId);
    if (!registration) {
      return; // 已被正常流程清理
    }

    // ✅ 早期返回防御，避免双回调
    if (registration.isFinalized) {
      return; // 已由 addASRSegment 正常完成，避免重复触发
    }

    // ✅ 清除 TTL 定时器
    if (registration.ttlTimerHandle) {
      clearTimeout(registration.ttlTimerHandle);
      registration.ttlTimerHandle = undefined;
    }

    // ✅ 标记为已finalize
    registration.isFinalized = true;

    // 如果有累积的ASR结果，立即处理（partial）
    if (registration.accumulatedSegments.length > 0) {
      // ✅ 按batchIndex排序，保证顺序（如果batchIndex存在）
      const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
        const aIndex = a.batchIndex ?? 0;
        const bIndex = b.batchIndex ?? 0;
        return aIndex - bIndex;
      });

      // ✅ 按排序后的顺序合并文本（跳过 missing segment）
      const nonMissingSegments = sortedSegments.filter(s => !s.missing);
      const fullText = nonMissingSegments.map(s => s.asrText).join(' ');

      logger.info(
        {
          sessionId,
          originalJobId,
          operation: 'mergeASRText',
          triggerPath: 'forceFinalizePartial',
          reason,
          batchCount: sortedSegments.length,
          missingCount: registration.missingCount,
          receivedCount: registration.receivedCount,
          expectedSegmentCount: registration.expectedSegmentCount,
          isPartial: true,
          batchTexts: sortedSegments.map((s, idx) => ({
            batchIndex: s.batchIndex ?? idx,
            isMissing: s.missing || false,
            textLength: s.asrText.length,
            textPreview: s.asrText.substring(0, 30),
          })),
          mergedTextLength: fullText.length,
          mergedTextPreview: fullText.substring(0, 100),
        },
        'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text (forceFinalizePartial path)'
      );

      const finalAsrData: OriginalJobASRData = {
        originalJobId,
        asrText: fullText,
        asrSegments: registration.accumulatedSegmentsList,
        languageProbabilities: this.mergeLanguageProbabilities(nonMissingSegments),
      };

      logger.info(
        {
          sessionId,
          originalJobId,
          batchCount: registration.accumulatedSegments.length,
          receivedCount: registration.receivedCount,
          expectedSegmentCount: registration.expectedSegmentCount,
          missingCount: registration.missingCount,
          reason,
          note: 'Force finalize partial triggered (TTL or timeout)',
        },
        'OriginalJobResultDispatcher: [SRTrigger] Force finalize partial triggered, triggering semantic repair'
      );

      await registration.callback(finalAsrData, registration.originalJob);
    }

    // 清除注册信息
    sessionRegistrations.delete(originalJobId);
    if (sessionRegistrations.size === 0) {
      this.registrations.delete(sessionId);
    }
  }

  /**
   * 强制完成原始job（异常兜底路径）
   * 
   * **设计说明**：
   * - 仅作为异常兜底使用（例如少数batch丢失的极端情况）
   * - 正常业务不依赖此函数触发SR，主流程通过addASRSegment触发
   * - 调用方（例如runAsrStep）只在finalize后的"最后安全点"调用一次
   * 
   * @param sessionId 会话ID
   * @param originalJobId 原始job ID
   */
  async forceComplete(sessionId: string, originalJobId: string): Promise<void> {
    // 使用 forceFinalizePartial 实现（reason='force_complete'）
    await this.forceFinalizePartial(sessionId, originalJobId, 'force_complete');
  }


  /**
   * 合并语言概率
   */
  private mergeLanguageProbabilities(
    segments: OriginalJobASRData[]
  ): Record<string, number> | undefined {
    if (segments.length === 0) {
      return undefined;
    }

    // 使用最后一个片段的语言概率（或合并所有片段的概率）
    const lastSegment = segments[segments.length - 1];
    return lastSegment.languageProbabilities;
  }
}
