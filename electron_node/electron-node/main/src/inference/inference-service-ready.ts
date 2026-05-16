/**
 * InferenceService 服务就绪检查（仅等待 ASR/NMT/TTS 等基础能力）
 */

import { JobAssignMessage, ServiceType } from '@shared/protocols/messages';
import logger from '../logger';
import type { TaskRouter } from '../task-router/task-router';

export async function checkServiceTypeReady(
  taskRouter: TaskRouter,
  serviceType: ServiceType
): Promise<boolean> {
  try {
    const router = taskRouter as any;
    const endpoints = router.serviceEndpoints?.get(serviceType) || [];
    return endpoints.length > 0;
  } catch (error) {
    logger.warn({ error, serviceType }, 'Error checking service type readiness');
    return false;
  }
}

/** 按 job.pipeline 决定等待哪些基础服务（增强服务不在此等待） */
export async function waitForServicesReady(
  taskRouter: TaskRouter,
  maxWaitMs: number = 5000,
  job?: JobAssignMessage
): Promise<void> {
  const pipeline = job?.pipeline;
  const needAsr = pipeline?.use_asr !== false;
  const needNmt = pipeline?.use_nmt !== false;
  const needTts = pipeline?.use_tts === true;

  const startTime = Date.now();
  const checkInterval = 200;

  logger.info({ maxWaitMs, needAsr, needNmt, needTts }, 'Waiting for base services to be ready');

  await taskRouter.forceRefreshServiceEndpoints();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      await taskRouter.forceRefreshServiceEndpoints();

      const hasASR = !needAsr || (await checkServiceTypeReady(taskRouter, ServiceType.ASR));
      const hasNMT = !needNmt || (await checkServiceTypeReady(taskRouter, ServiceType.NMT));
      const hasTTS = !needTts || (await checkServiceTypeReady(taskRouter, ServiceType.TTS));

      if (hasASR && hasNMT && hasTTS) {
        logger.info({ elapsedMs: Date.now() - startTime }, 'Required base services are ready');
        return;
      }

      logger.debug(
        { elapsedMs: Date.now() - startTime, hasASR, hasNMT, hasTTS },
        'Base services not all ready yet, waiting...'
      );
    } catch (error) {
      logger.warn({ error, elapsedMs: Date.now() - startTime }, 'Error checking service readiness');
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  logger.warn(
    { elapsedMs: Date.now() - startTime, maxWaitMs, needAsr, needNmt, needTts },
    'Base services not ready after timeout, proceeding anyway (may fail)'
  );
}
