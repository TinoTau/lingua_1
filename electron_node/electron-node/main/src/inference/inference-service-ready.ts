/**
 * InferenceService 服务就绪检查逻辑
 * 从 inference-service.ts 迁出，仅迁移实现，不新增逻辑。
 */

import { ServiceType } from '@shared/protocols/messages';
import logger from '../logger';
import type { TaskRouter } from '../task-router/task-router';

/**
 * 检查指定服务类型是否有可用的端点
 */
export async function checkServiceTypeReady(
  taskRouter: TaskRouter,
  serviceType: ServiceType
): Promise<boolean> {
  try {
    const router = taskRouter as any;
    const endpoints = router.serviceEndpoints?.get(serviceType) || [];
    const hasEndpoints = endpoints.length > 0;

    if (!hasEndpoints) {
      logger.debug({ serviceType, endpointCount: endpoints.length }, 'No endpoints available for service type');
    }

    return hasEndpoints;
  } catch (error) {
    logger.warn({ error, serviceType }, 'Error checking service type readiness');
    return false;
  }
}

/**
 * 等待服务就绪（用于第一次任务）
 * 检查ASR、NMT、TTS服务是否都有可用的端点
 */
export async function waitForServicesReady(
  taskRouter: TaskRouter,
  maxWaitMs: number = 5000
): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 200;

  logger.info({ maxWaitMs }, 'Waiting for services to be ready');

  await taskRouter.forceRefreshServiceEndpoints();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      await taskRouter.forceRefreshServiceEndpoints();

      const hasASR = await checkServiceTypeReady(taskRouter, ServiceType.ASR);
      const hasNMT = await checkServiceTypeReady(taskRouter, ServiceType.NMT);
      const hasTTS = await checkServiceTypeReady(taskRouter, ServiceType.TTS);

      if (hasASR && hasNMT && hasTTS) {
        logger.info({ elapsedMs: Date.now() - startTime }, 'All services are ready');
        return;
      }

      logger.debug(
        {
          elapsedMs: Date.now() - startTime,
          hasASR,
          hasNMT,
          hasTTS,
        },
        'Services not all ready yet, waiting...'
      );
    } catch (error) {
      logger.warn({ error, elapsedMs: Date.now() - startTime }, 'Error checking service readiness');
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  logger.warn(
    {
      elapsedMs: Date.now() - startTime,
      maxWaitMs,
    },
    'Services not ready after timeout, proceeding anyway (may fail)'
  );
}
