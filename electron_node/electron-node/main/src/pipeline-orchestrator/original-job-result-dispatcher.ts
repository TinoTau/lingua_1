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
  /** 期望的片段数量：undefined=累积等待，>0=等待指定数量 */
  expectedSegmentCount?: number;
  /** 累积的ASR批次数据（用于排序和合并文本） */
  accumulatedSegments: OriginalJobASRData[];
  /** 累积的ASR片段列表（用于传递给后续处理） */
  accumulatedSegmentsList: SegmentInfo[];
  // ✅ utterance 生命周期 / 状态
  /** 注册时间（用于计算utterance生命周期） */
  startedAt: number;
  /** 最后活动时间（用于超时清理） */
  lastActivityAt: number;
  /** 是否已finalize（防止重复处理） */
  isFinalized: boolean;
}

/**
 * OriginalJobResultDispatcher
 * 按原始job_id分发ASR结果
 */
export class OriginalJobResultDispatcher {
  // 按sessionId和originalJobId分组存储注册信息
  private registrations: Map<string, Map<string, OriginalJobRegistration>> = new Map();

  // ✅ 20秒超时清理机制
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
        timeoutMs: this.UTT_TIMEOUT_MS,
        checkIntervalMs: 5_000,
      },
      'OriginalJobResultDispatcher: Started cleanup timer for expired utterances'
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
   * 清理超时的注册信息
   */
  private cleanupExpiredRegistrations(): void {
    const now = Date.now();
    const expiredJobs: Array<{ sessionId: string; originalJobId: string; idleMs: number }> = [];

    for (const [sessionId, sessionRegistrations] of this.registrations.entries()) {
      for (const [originalJobId, registration] of sessionRegistrations.entries()) {
        // 已完成的无需处理
        if (registration.isFinalized) {
          continue;
        }

        const idleMs = now - registration.lastActivityAt;
        if (idleMs > this.UTT_TIMEOUT_MS) {
          expiredJobs.push({ sessionId, originalJobId, idleMs });

          // 只清理，不触发SR
          sessionRegistrations.delete(originalJobId);

          logger.warn(
            {
              sessionId,
              originalJobId,
              idleMs,
              startedAt: registration.startedAt,
              lastActivityAt: registration.lastActivityAt,
              accumulatedSegmentsCount: registration.accumulatedSegments.length,
              reason: 'Utterance timed out, cleaning registration (no SR triggered)',
            },
            'OriginalJobResultDispatcher: Utterance timed out, cleaning registration'
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
        'OriginalJobResultDispatcher: Cleaned up expired utterances'
      );
    }
  }

  /**
   * 注册原始job
   * 
   * @param sessionId 会话ID
   * @param originalJobId 原始job ID
   * @param expectedSegmentCount 期望的片段数量（undefined=累积等待，0=立即处理，>0=等待指定数量）
   * @param originalJob 原始job消息
   * @param callback 处理回调
   */
  registerOriginalJob(
    sessionId: string,
    originalJobId: string,
    expectedSegmentCount: number | undefined,
    originalJob: JobAssignMessage,
    callback: OriginalJobCallback
  ): void {
    let sessionRegistrations = this.registrations.get(sessionId);
    if (!sessionRegistrations) {
      sessionRegistrations = new Map();
      this.registrations.set(sessionId, sessionRegistrations);
    }

    const now = Date.now();
    sessionRegistrations.set(originalJobId, {
      originalJob,
      callback,
      expectedSegmentCount,
      accumulatedSegments: [],
      accumulatedSegmentsList: [],
      // ✅ 初始化生命周期字段
      startedAt: now,
      lastActivityAt: now,
      isFinalized: false,
    });

    // ✅ TASK-4: 精简日志，只在关键路径记录
    // 注册日志已删除，减少噪声
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

    // 累积ASR结果
    registration.accumulatedSegments.push(asrData);
    registration.accumulatedSegmentsList.push(...asrData.asrSegments);

    logger.debug(
      {
        sessionId,
        originalJobId,
        operation: 'accumulateASRSegment',
        batchIndex: asrData.batchIndex,
        currentAccumulatedCount: registration.accumulatedSegments.length,
        expectedSegmentCount: registration.expectedSegmentCount,
        asrTextLength: asrData.asrText.length,
        asrSegmentsCount: asrData.asrSegments.length,
      },
      'OriginalJobResultDispatcher: [Accumulate] Added ASR segment to accumulation'
    );

    // ✅ TASK-1: 简化并内联shouldProcessNow逻辑
    // 检查是否应该立即处理：仅在收齐expectedSegmentCount时触发
    const shouldProcess =
      registration.expectedSegmentCount != null &&
      registration.accumulatedSegments.length >= registration.expectedSegmentCount;

    if (shouldProcess) {
      // ✅ 标记为已finalize
      registration.isFinalized = true;

      // ✅ 按batchIndex排序，保证顺序（如果batchIndex存在）
      const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
        const aIndex = a.batchIndex ?? 0;
        const bIndex = b.batchIndex ?? 0;
        return aIndex - bIndex;
      });

      // ✅ 按排序后的顺序合并文本
      const fullText = sortedSegments.map(s => s.asrText).join(' ');

      logger.info(
        {
          sessionId,
          originalJobId,
          operation: 'mergeASRText',
          batchCount: sortedSegments.length,
          batchTexts: sortedSegments.map((s, idx) => ({
            batchIndex: s.batchIndex ?? idx,
            textLength: s.asrText.length,
            textPreview: s.asrText.substring(0, 30),
          })),
          mergedTextLength: fullText.length,
          mergedTextPreview: fullText.substring(0, 100),
        },
        'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text'
      );

      // 触发处理回调
      const finalAsrData: OriginalJobASRData = {
        originalJobId,
        asrText: fullText,
        asrSegments: registration.accumulatedSegmentsList,
        languageProbabilities: this.mergeLanguageProbabilities(registration.accumulatedSegments),
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
    const sessionRegistrations = this.registrations.get(sessionId);
    if (!sessionRegistrations) {
      return; // 已被正常流程清理
    }

    const registration = sessionRegistrations.get(originalJobId);
    if (!registration) {
      return; // 已被正常流程清理
    }

    // ✅ TASK-2: 早期返回防御，避免双回调
    if (registration.isFinalized) {
      return; // 已由addASRSegment正常完成，避免重复触发
    }

    // ✅ 标记为已finalize
    registration.isFinalized = true;

    // 如果有累积的ASR结果，立即处理
    if (registration.accumulatedSegments.length > 0) {
      // ✅ 按batchIndex排序，保证顺序（如果batchIndex存在）
      const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
        const aIndex = a.batchIndex ?? 0;
        const bIndex = b.batchIndex ?? 0;
        return aIndex - bIndex;
      });

      // ✅ 按排序后的顺序合并文本
      const fullText = sortedSegments.map(s => s.asrText).join(' ');

      logger.info(
        {
          sessionId,
          originalJobId,
          operation: 'mergeASRText',
          triggerPath: 'forceComplete',
          batchCount: sortedSegments.length,
          batchTexts: sortedSegments.map((s, idx) => ({
            batchIndex: s.batchIndex ?? idx,
            textLength: s.asrText.length,
            textPreview: s.asrText.substring(0, 30),
          })),
          mergedTextLength: fullText.length,
          mergedTextPreview: fullText.substring(0, 100),
        },
        'OriginalJobResultDispatcher: [TextMerge] Merged ASR batches text (forceComplete path)'
      );

      const finalAsrData: OriginalJobASRData = {
        originalJobId,
        asrText: fullText,
        asrSegments: registration.accumulatedSegmentsList,
        languageProbabilities: this.mergeLanguageProbabilities(registration.accumulatedSegments),
      };

      // ✅ TASK-4: 精简日志，只记录关键信息（forceComplete是fallback路径）
      logger.info(
        {
          sessionId,
          originalJobId,
          batchCount: registration.accumulatedSegments.length,
          expectedSegmentCount: registration.expectedSegmentCount,
          reason: 'Force complete triggered (fallback path)',
        },
        'OriginalJobResultDispatcher: [SRTrigger] Force complete triggered, triggering semantic repair'
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
