/**
 * ServiceProcessRunner 内部实现：常量、端口检查、健康检查、就绪标记
 * Runner 类只做委托，不新增对外接口。
 * 健康检查 / 端口检查的 host 来自配置 getServicesBaseUrl，无硬编码 URL。
 */

import { ServiceEntry } from './ServiceTypes';
import logger from '../logger';
import { getServicesBaseUrl } from '../node-config';

/**
 * 服务进程管理常量
 */
export const PROCESS_CONSTANTS = {
  // 进程启动检查
  STARTUP_CHECK_TIMEOUT_MS: 500,

  // 停止超时
  GRACEFUL_STOP_TIMEOUT_MS: 5000,

  // 端口管理
  PORT_CHECK_TIMEOUT_MS: 1000,
  PORT_RELEASE_TIMEOUT_MS: 3000,
  PORT_RELEASE_CHECK_INTERVAL_MS: 200,
  PORT_RELEASE_CHECK_TIMEOUT_MS: 500,

  // 健康检查
  HEALTH_CHECK_MAX_ATTEMPTS: 20,
  HEALTH_CHECK_INTERVAL_MS: 1000,
  HEALTH_CHECK_TIMEOUT_MS: 1000,
  NO_PORT_SERVICE_WAIT_MS: 2000,
  MODEL_PRELOAD_SERVICES: ['faster-whisper-vad', 'nmt-m2m100', 'piper-tts'],
  MODEL_PRELOAD_HEALTH_CHECK_MAX_ATTEMPTS: 180,

  // 错误日志
  MAX_ERROR_LOG_LENGTH: 5000,
} as const;

function healthCheckUrl(port: number): string {
  return `${getServicesBaseUrl()}:${port}/health`;
}

/**
 * 检查端口是否空闲
 */
export async function isPortFree(port: number): Promise<boolean> {
  try {
    await fetch(healthCheckUrl(port), {
      signal: AbortSignal.timeout(PROCESS_CONSTANTS.PORT_CHECK_TIMEOUT_MS)
    });
    return false; // 端口被占用
  } catch {
    return true; // 端口空闲
  }
}

/**
 * 等待端口释放
 */
export async function waitForPortRelease(port: number, maxWaitMs: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      await fetch(healthCheckUrl(port), {
        signal: AbortSignal.timeout(PROCESS_CONSTANTS.PORT_RELEASE_CHECK_TIMEOUT_MS)
      });
      await new Promise(resolve => setTimeout(resolve, PROCESS_CONSTANTS.PORT_RELEASE_CHECK_INTERVAL_MS));
    } catch {
      logger.info({ port }, '✅ Port released');
      return;
    }
  }

  logger.warn({ port, maxWaitMs }, '⚠️ Port may still be in use after timeout');
}

/**
 * 标记服务就绪（收到 [SERVICE_READY] 或健康检查通过时调用）
 */
export function applyServiceReady(serviceId: string, entry: ServiceEntry, port?: number): void {
  if (entry.runtime.status !== 'starting') {
    return;
  }
  entry.runtime.status = 'running';
  if (port !== undefined) {
    entry.runtime.port = port;
  }
  logger.info(
    { serviceId, port },
    '✅ Service is now running (received [SERVICE_READY] signal from service)'
  );
}

/**
 * 健康检查循环：等待服务 /health 返回 ok 或收到 abort
 * 会修改 entry.runtime.status / port
 */
export async function runHealthCheck(
  serviceId: string,
  entry: ServiceEntry,
  abortSignal?: AbortSignal
): Promise<void> {
  const port = entry.def.port;

  if (!port) {
    await new Promise(resolve => setTimeout(resolve, PROCESS_CONSTANTS.NO_PORT_SERVICE_WAIT_MS));
    if (entry.runtime.status === 'starting') {
      entry.runtime.status = 'running';
      logger.info({ serviceId }, '✅ Service is now running (no port to check)');
    }
    return;
  }

  const isPreloadService = (PROCESS_CONSTANTS.MODEL_PRELOAD_SERVICES as readonly string[]).includes(serviceId);
  const maxAttempts = isPreloadService
    ? PROCESS_CONSTANTS.MODEL_PRELOAD_HEALTH_CHECK_MAX_ATTEMPTS
    : PROCESS_CONSTANTS.HEALTH_CHECK_MAX_ATTEMPTS;

  for (let i = 0; i < maxAttempts; i++) {
    if (abortSignal?.aborted) {
      logger.debug({ serviceId }, 'Health check aborted (service ready signal received)');
      return;
    }
    if (entry.runtime.status === 'stopped') {
      logger.warn({ serviceId }, 'Service stopped during health check');
      return;
    }
    if (entry.runtime.status === 'running') {
      logger.debug({ serviceId }, 'Service already marked as running (ready signal received), stopping health check');
      return;
    }

    try {
      const fetchSignal = abortSignal?.aborted
        ? AbortSignal.abort()
        : AbortSignal.timeout(PROCESS_CONSTANTS.HEALTH_CHECK_TIMEOUT_MS);

      const response = await fetch(healthCheckUrl(port), {
        signal: fetchSignal
      });

      if (response.ok) {
        try {
          const healthData = await response.json() as { status?: string };
          const serviceStatus = healthData?.status;

          if (isPreloadService && i % 10 === 0) {
            logger.info(
              { serviceId, port, attempts: i + 1, serviceStatus, maxAttempts },
              'Health check connected, checking status...'
            );
          }

          if (serviceStatus === undefined || serviceStatus === null) {
            entry.runtime.status = 'running';
            entry.runtime.port = port;
            logger.info({ serviceId, port, attempts: i + 1 }, '✅ Service is now running (health check passed, no status field)');
            return;
          }
          if (serviceStatus === 'ok') {
            entry.runtime.status = 'running';
            entry.runtime.port = port;
            logger.info({ serviceId, port, attempts: i + 1 }, '✅ Service is now running (model loaded, health check passed)');
            return;
          }
          const logLevel = isPreloadService ? 'info' : 'debug';
          if (logLevel === 'info') {
            logger.info(
              { serviceId, port, serviceStatus, attempts: i + 1, maxAttempts },
              'Service health check returned but model not ready yet, continuing to wait...'
            );
          } else {
            logger.debug(
              { serviceId, port, serviceStatus, attempts: i + 1 },
              'Service health check returned but model not ready yet, continuing to wait...'
            );
          }
        } catch {
          entry.runtime.status = 'running';
          entry.runtime.port = port;
          logger.info({ serviceId, port, attempts: i + 1 }, '✅ Service is now running (health check passed, parse skip)');
          return;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError' && abortSignal?.aborted) {
        logger.debug({ serviceId }, 'Health check fetch aborted (service ready signal received)');
        return;
      }
      if (isPreloadService && i % 10 === 0) {
        logger.info(
          { serviceId, port, attempts: i + 1, maxAttempts, error: error instanceof Error ? error.message : String(error) },
          'Health check connection failed (service may still be starting)...'
        );
      }
    }

    await new Promise(resolve => setTimeout(resolve, PROCESS_CONSTANTS.HEALTH_CHECK_INTERVAL_MS));
  }

  if (entry.runtime.status === 'starting') {
    const maxWaitSeconds = maxAttempts * PROCESS_CONSTANTS.HEALTH_CHECK_INTERVAL_MS / 1000;
    if (isPreloadService) {
      logger.warn(
        { serviceId, port, maxWaitSeconds },
        `⚠️ Health check timeout after ${maxWaitSeconds}s for model preload service, assuming service is running (model may still be loading)`
      );
    } else {
      logger.warn({ serviceId, port }, `⚠️ Health check timeout after ${maxWaitSeconds}s, assuming service is running`);
    }
    entry.runtime.status = 'running';
    entry.runtime.port = port;
  }
}
