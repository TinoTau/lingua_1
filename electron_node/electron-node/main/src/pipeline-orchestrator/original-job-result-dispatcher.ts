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
import logger from '../logger';
import {
  cleanupExpiredRegistrations,
  CLEANUP_MAX_IDLE_MS,
} from './original-job-result-dispatcher-cleanup';
import { executeFinalizeAndCallback } from './original-job-result-dispatcher-finalize';
import type {
  OriginalJobASRData,
  OriginalJobCallback,
  OriginalJobRegistration,
} from './original-job-result-dispatcher-types';

export type { OriginalJobASRData, OriginalJobCallback };

/**
 * OriginalJobResultDispatcher
 * 按原始job_id分发ASR结果
 */
export class OriginalJobResultDispatcher {
  private registrations: Map<string, Map<string, OriginalJobRegistration>> = new Map();

  private readonly REGISTRATION_TTL_MS = 10_000; // 10秒
  private readonly UTT_TIMEOUT_MS = 20_000; // 20秒
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  private startCleanupTimer(): void {
    if (this.cleanupIntervalId) {
      return;
    }

    this.cleanupIntervalId = setInterval(() => {
      cleanupExpiredRegistrations(this.registrations, { maxIdleMs: CLEANUP_MAX_IDLE_MS });
    }, 5_000);

    logger.info(
      {
        registrationTtlMs: this.REGISTRATION_TTL_MS,
        checkIntervalMs: 5_000,
      },
      'OriginalJobResultDispatcher: Started cleanup timer for expired registrations'
    );
  }

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

  cleanupAllTimers(): void {
    this.stopCleanupTimer();

    for (const [sessionId, sessionRegistrations] of this.registrations.entries()) {
      for (const [originalJobId, registration] of sessionRegistrations.entries()) {
        if (registration.ttlTimerHandle) {
          clearTimeout(registration.ttlTimerHandle);
          registration.ttlTimerHandle = undefined;
        }
      }
    }
  }

  registerOriginalJob(
    sessionId: string,
    originalJobId: string,
    expectedSegmentCount: number,
    originalJob: JobAssignMessage,
    callback: OriginalJobCallback
  ): void {
    let sessionRegistrations = this.registrations.get(sessionId);
    if (!sessionRegistrations) {
      sessionRegistrations = new Map();
      this.registrations.set(sessionId, sessionRegistrations);
    }

    const existingRegistration = sessionRegistrations.get(originalJobId);

    if (existingRegistration && !existingRegistration.isFinalized) {
      existingRegistration.expectedSegmentCount += expectedSegmentCount;
      existingRegistration.lastActivityAt = Date.now();

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
    };

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

    // 已由 TTL/forceFinalizePartial 标记为 finalized 时，不再接受新片段，避免重复回调
    if (registration.isFinalized) {
      return false;
    }

    registration.lastActivityAt = Date.now();

    if (asrData.batchIndex === undefined || asrData.batchIndex === null) {
      asrData.batchIndex = registration.receivedCount;
    } else {
      asrData.batchIndex = registration.receivedCount;
    }

    registration.accumulatedSegments.push(asrData);
    if (!asrData.missing) {
      registration.accumulatedSegmentsList.push(...asrData.asrSegments);
    }

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

    const shouldProcess = registration.receivedCount >= registration.expectedSegmentCount;

    if (shouldProcess) {
      if (registration.ttlTimerHandle) {
        clearTimeout(registration.ttlTimerHandle);
        registration.ttlTimerHandle = undefined;
      }

      registration.isFinalized = true;

      await executeFinalizeAndCallback(registration, originalJobId, { sessionId });

      sessionRegistrations.delete(originalJobId);
      if (sessionRegistrations.size === 0) {
        this.registrations.delete(sessionId);
      }
    }

    return shouldProcess;
  }

  private async forceFinalizePartial(
    sessionId: string,
    originalJobId: string,
    reason: string
  ): Promise<void> {
    const sessionRegistrations = this.registrations.get(sessionId);
    if (!sessionRegistrations) {
      return;
    }

    const registration = sessionRegistrations.get(originalJobId);
    if (!registration) {
      return;
    }

    if (registration.isFinalized) {
      return;
    }

    if (registration.ttlTimerHandle) {
      clearTimeout(registration.ttlTimerHandle);
      registration.ttlTimerHandle = undefined;
    }

    registration.isFinalized = true;

    if (registration.accumulatedSegments.length > 0) {
      await executeFinalizeAndCallback(registration, originalJobId, {
        sessionId,
        reason,
        triggerPath: 'forceFinalizePartial',
      });
    }

    sessionRegistrations.delete(originalJobId);
    if (sessionRegistrations.size === 0) {
      this.registrations.delete(sessionId);
    }
  }

  async forceComplete(sessionId: string, originalJobId: string): Promise<void> {
    await this.forceFinalizePartial(sessionId, originalJobId, 'force_complete');
  }
}
