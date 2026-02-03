/**
 * OriginalJobResultDispatcher 超时注册清理逻辑
 * 从 original-job-result-dispatcher.ts 迁出，仅迁移实现，不新增逻辑。
 */

import type { OriginalJobRegistration } from './original-job-result-dispatcher-types';
import logger from '../logger';

export const CLEANUP_MAX_IDLE_MS = 60_000; // 60秒（比 TTL 更长，只清理异常悬挂）

/**
 * 清理超时的注册信息（兜底清理，防止内存泄漏）
 * 注意：TTL 超时应该通过 forceFinalizePartial 处理，这里只清理异常悬挂的 registration
 */
export function cleanupExpiredRegistrations(
  registrations: Map<string, Map<string, OriginalJobRegistration>>,
  options: { maxIdleMs?: number } = {}
): void {
  const maxIdleMs = options.maxIdleMs ?? CLEANUP_MAX_IDLE_MS;
  const now = Date.now();
  const expiredJobs: Array<{ sessionId: string; originalJobId: string; idleMs: number }> = [];

  for (const [sessionId, sessionRegistrations] of registrations.entries()) {
    for (const [originalJobId, registration] of sessionRegistrations.entries()) {
      if (registration.isFinalized) {
        continue;
      }

      const idleMs = now - registration.lastActivityAt;
      if (idleMs > maxIdleMs) {
        expiredJobs.push({ sessionId, originalJobId, idleMs });

        if (registration.ttlTimerHandle) {
          clearTimeout(registration.ttlTimerHandle);
        }

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

    if (sessionRegistrations.size === 0) {
      registrations.delete(sessionId);
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
