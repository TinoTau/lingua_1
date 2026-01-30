/**
 * ServiceProcessRunner - 统一的服务进程管理器
 * 
 * Day 3 重构: 删除魔法数字，简化逻辑
 * 
 * 设计原则：
 * 1. 不区分Python/Rust，统一处理所有服务
 * 2. 配置完全来自service.json
 * 3. 错误直接抛出，不做防御性兜底
 * 4. 使用常量代替魔法数字
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { ServiceRegistry } from './ServiceTypes';
import logger from '../logger';

/**
 * 服务进程管理常量
 */
const PROCESS_CONSTANTS = {
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
  // 需要模型预加载的服务，增加健康检查超时时间
  MODEL_PRELOAD_SERVICES: ['faster-whisper-vad', 'nmt-m2m100', 'piper-tts'],
  MODEL_PRELOAD_HEALTH_CHECK_MAX_ATTEMPTS: 180, // 180秒：ASR 模型加载+预热常需 1～2 分钟，留足余量

  // 错误日志
  MAX_ERROR_LOG_LENGTH: 5000,
} as const;

export class ServiceProcessRunner {
  private processes = new Map<string, ChildProcess>();
  // 用于跟踪健康检查是否应该继续（当收到 SERVICE_READY 信号时停止）
  private healthCheckAbortControllers = new Map<string, AbortController>();

  constructor(private registry: ServiceRegistry) { }

  /**
   * 启动服务
   * @throws Error 如果服务不存在、已在运行、或启动失败
   */
  async start(serviceId: string): Promise<void> {
    // 1. 从注册表获取服务定义
    const entry = this.registry.get(serviceId);
    if (!entry) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    // 2. 检查是否已经在运行
    if (entry.runtime.status === 'running') {
      throw new Error(`Service already running: ${serviceId} (pid: ${entry.runtime.pid})`);
    }

    // ✅ 3. 检查端口是否可用
    const port = entry.def.port;
    if (port) {
      const isPortFree = await this.isPortFree(port);
      if (!isPortFree) {
        const errorMsg = `Port ${port} is already in use. Please wait a moment and try again.`;
        logger.error({ serviceId, port }, errorMsg);
        entry.runtime.status = 'error';
        entry.runtime.lastError = errorMsg;
        throw new Error(errorMsg);
      }
    }

    // 4. 从service.json读取启动配置
    const { exec } = entry.def;
    if (!exec) {
      throw new Error(
        `Service ${serviceId} has no exec defined in service.json at ${entry.installPath}`
      );
    }

    const { command: executable, args } = exec;
    const workingDir = exec.cwd || entry.installPath;

    logger.info(
      {
        serviceId,
        executable,
        args,
        cwd: workingDir,
      },
      '🚀 Starting service process'
    );

    // 4. 准备环境变量
    const serviceEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      PYTHONIOENCODING: 'utf-8',  // 解决Windows GBK编码问题
      PIPER_USE_GPU: 'true',       // 启用Piper TTS的GPU模式
    };

    // Windows PATH环境变量兼容处理
    const pathValue = serviceEnv.PATH || serviceEnv.Path || process.env.PATH || process.env.Path;
    if (pathValue) {
      serviceEnv.PATH = pathValue;
      serviceEnv.Path = pathValue;
    }

    // 5. 启动进程
    try {
      const proc = spawn(executable, args || [], {
        cwd: workingDir,
        env: serviceEnv,
        stdio: ['ignore', 'pipe', 'pipe'], // 🔍 改为pipe以捕获stderr
      });

      // 注意：spawn是异步的，可能立即返回但没有PID
      // 不应该在这里检查PID，而是在下面的事件监听中处理

      this.processes.set(serviceId, proc);

      // ✅ 立即设置为starting状态
      entry.runtime.status = 'starting';
      entry.runtime.pid = proc.pid;
      entry.runtime.startedAt = new Date();

      // 5. 监听进程输出（stdout）
      proc.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logger.debug({ serviceId, pid: proc.pid }, `[stdout] ${output}`);

          // 检测服务就绪信号 [SERVICE_READY]
          if (output.includes('[SERVICE_READY]')) {
            this.handleServiceReady(serviceId, entry.def.port);
          }
        }
      });

      // 6. 监听进程错误输出（stderr）
      proc.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logger.error({ serviceId, pid: proc.pid }, `[stderr] ${output}`);

          // 检测服务就绪信号 [SERVICE_READY]（某些服务可能输出到 stderr）
          if (output.includes('[SERVICE_READY]')) {
            this.handleServiceReady(serviceId, entry.def.port);
          }

          // 保存stderr到runtime.lastError（追加）
          if (!entry.runtime.lastError) {
            entry.runtime.lastError = output;
          } else {
            entry.runtime.lastError += '\n' + output;
          }

          // 限制总长度，避免内存溢出
          const errorLength = entry.runtime.lastError?.length || 0;
          if (errorLength > PROCESS_CONSTANTS.MAX_ERROR_LOG_LENGTH && entry.runtime.lastError) {
            entry.runtime.lastError = entry.runtime.lastError.slice(-PROCESS_CONSTANTS.MAX_ERROR_LOG_LENGTH);
          }
        }
      });

      // 7. 监听进程退出
      proc.on('exit', (code, signal) => {
        const exitInfo = {
          serviceId,
          pid: proc.pid,
          code,
          signal,
          wasRunning: entry.runtime.status === 'running',
        };

        if (code === 0) {
          logger.info(exitInfo, '✅ Service process exited cleanly');
        } else {
          logger.error(
            exitInfo,
            `❌ Service process exited with code ${code} (signal: ${signal})`
          );
        }

        this.processes.delete(serviceId);

        // 更新runtime状态
        entry.runtime.status = 'stopped';
        entry.runtime.pid = undefined;
        entry.runtime.lastError =
          code !== 0 ? `Process exited with code ${code} (signal: ${signal})` : undefined;
      });

      // 8. 监听进程错误（spawn失败）
      proc.on('error', (error) => {
        logger.error(
          {
            serviceId,
            error: error.message,
            executable,
            args,
            cwd: workingDir,
          },
          '❌ Service process spawn error'
        );

        // 更新runtime状态
        entry.runtime.status = 'stopped';
        entry.runtime.lastError = `Spawn failed: ${error.message}`;

        throw error;
      });

      // 9. 等待确认进程没有立即退出
      await new Promise<void>((resolve, reject) => {
        const checkTimeout = setTimeout(() => {
          if (!proc.pid) {
            reject(new Error(
              `Service process failed to start (no PID after ${PROCESS_CONSTANTS.STARTUP_CHECK_TIMEOUT_MS}ms). ` +
              `Command: ${executable} ${(args || []).join(' ')} ` +
              `CWD: ${workingDir}`
            ));
            return;
          }
          resolve();
        }, PROCESS_CONSTANTS.STARTUP_CHECK_TIMEOUT_MS);

        proc.on('exit', (code) => {
          clearTimeout(checkTimeout);
          reject(
            new Error(
              `Service process exited immediately with code ${code}. ` +
              `Check logs for details. ` +
              `Command: ${executable} ${(args || []).join(' ')} ` +
              `CWD: ${workingDir}`
            )
          );
        });

        proc.on('error', (error) => {
          clearTimeout(checkTimeout);
          reject(new Error(
            `Failed to spawn process: ${error.message}. ` +
            `Command: ${executable} ${(args || []).join(' ')} ` +
            `CWD: ${workingDir}`
          ));
        });
      });

      // 10. 保持starting状态（不立即设置为running）
      entry.runtime.status = 'starting';
      entry.runtime.pid = proc.pid;
      entry.runtime.lastError = undefined;

      logger.info({ serviceId, pid: proc.pid }, '⏳ Service process spawned, starting health check...');

      // 11. 创建健康检查的 AbortController（用于在收到 SERVICE_READY 信号时停止轮询）
      const healthCheckAbortController = new AbortController();
      this.healthCheckAbortControllers.set(serviceId, healthCheckAbortController);

      // 12. 启动健康检查（后台异步，不阻塞）
      this.checkServiceHealth(serviceId, healthCheckAbortController.signal).catch((error) => {
        if (error.name !== 'AbortError') {
          logger.warn({ serviceId, error: error.message }, '⚠️ Health check failed, but service may still work');
        }
      });
    } catch (error) {
      logger.error(
        {
          serviceId,
          error: error instanceof Error ? error.message : 'Unknown error',
          executable,
          args,
          cwd: workingDir,
        },
        '❌ Failed to start service'
      );

      // 确保清理
      this.processes.delete(serviceId);

      // 更新runtime状态
      entry.runtime.status = 'stopped';
      entry.runtime.lastError = error instanceof Error ? error.message : 'Unknown error';

      throw error;
    }
  }

  /**
   * 停止服务
   * @throws Error 如果服务不存在
   */
  async stop(serviceId: string): Promise<void> {
    const entry = this.registry.get(serviceId);
    if (!entry) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    const proc = this.processes.get(serviceId);
    if (!proc) {
      logger.warn({ serviceId }, 'Service process not found (already stopped?)');
      entry.runtime.status = 'stopped';
      entry.runtime.pid = undefined;
      entry.runtime.port = undefined;
      entry.runtime.startedAt = undefined;
      return;
    }

    logger.info({ serviceId, pid: proc.pid }, '🛑 Stopping service');

    entry.runtime.status = 'stopping';

    // 尝试优雅关闭
    proc.kill('SIGTERM');

    // 等待优雅关闭
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn({ serviceId, pid: proc.pid }, 'Service did not stop gracefully, force killing');
        proc.kill('SIGKILL');
        resolve();
      }, PROCESS_CONSTANTS.GRACEFUL_STOP_TIMEOUT_MS);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // 如果有端口，等待端口释放
    const port = entry.def.port;
    if (port) {
      logger.info({ serviceId, port }, 'Waiting for port to be released...');
      await this.waitForPortRelease(port, PROCESS_CONSTANTS.PORT_RELEASE_TIMEOUT_MS);
    }

    this.processes.delete(serviceId);

    // 清理健康检查的 AbortController
    const abortController = this.healthCheckAbortControllers.get(serviceId);
    if (abortController) {
      abortController.abort();
      this.healthCheckAbortControllers.delete(serviceId);
    }

    entry.runtime.status = 'stopped';
    entry.runtime.pid = undefined;
    entry.runtime.port = undefined;
    entry.runtime.startedAt = undefined;

    logger.info({ serviceId }, '✅ Service stopped and cleaned up');
  }

  /**
   * 等待端口释放
   */
  private async waitForPortRelease(port: number, maxWaitMs: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(PROCESS_CONSTANTS.PORT_RELEASE_CHECK_TIMEOUT_MS)
        });
        // 端口仍被占用，继续等待
        await new Promise(resolve => setTimeout(resolve, PROCESS_CONSTANTS.PORT_RELEASE_CHECK_INTERVAL_MS));
      } catch {
        // 端口已释放
        logger.info({ port }, '✅ Port released');
        return;
      }
    }

    logger.warn({ port, maxWaitMs }, '⚠️ Port may still be in use after timeout');
  }

  /**
   * 检查端口是否空闲
   */
  private async isPortFree(port: number): Promise<boolean> {
    try {
      await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(PROCESS_CONSTANTS.PORT_CHECK_TIMEOUT_MS)
      });
      return false; // 端口被占用
    } catch {
      return true; // 端口空闲
    }
  }

  /**
   * 获取服务状态
   * @throws Error 如果服务不存在
   */
  getStatus(serviceId: string) {
    const entry = this.registry.get(serviceId);
    if (!entry) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    return {
      serviceId,
      name: entry.def.name,
      type: entry.def.type,
      status: entry.runtime.status,
      pid: entry.runtime.pid,
      port: entry.def.port,
      startedAt: entry.runtime.startedAt,
      lastError: entry.runtime.lastError,
    };
  }

  /**
   * 获取所有服务状态
   */
  getAllStatuses() {
    const statuses: ReturnType<typeof this.getStatus>[] = [];
    for (const [serviceId] of this.registry) {
      try {
        statuses.push(this.getStatus(serviceId));
      } catch (error) {
        logger.error({ serviceId, error }, 'Failed to get service status');
      }
    }
    return statuses;
  }

  /**
   * 停止所有服务
   */
  async stopAll(): Promise<void> {
    logger.info({ count: this.processes.size }, 'Stopping all services');

    const promises = Array.from(this.processes.keys()).map((id) =>
      this.stop(id).catch((err) => logger.error({ serviceId: id, error: err }, 'Failed to stop service'))
    );

    await Promise.all(promises);

    logger.info({}, '✅ All services stopped');
  }

  /**
   * 检查服务是否正在运行
   */
  isRunning(serviceId: string): boolean {
    const entry = this.registry.get(serviceId);
    return entry ? entry.runtime.status === 'running' : false;
  }

  /**
   * 处理服务就绪信号 [SERVICE_READY]
   * 当服务在 stdout/stderr 中输出 [SERVICE_READY] 时，立即标记为 running 并停止健康检查轮询
   */
  private handleServiceReady(serviceId: string, port?: number): void {
    const entry = this.registry.get(serviceId);
    if (!entry || entry.runtime.status !== 'starting') {
      return; // 服务不存在或已经处于其他状态
    }

    // 停止健康检查轮询
    const abortController = this.healthCheckAbortControllers.get(serviceId);
    if (abortController) {
      abortController.abort();
      this.healthCheckAbortControllers.delete(serviceId);
    }

    // 立即标记为 running
    entry.runtime.status = 'running';
    if (port) {
      entry.runtime.port = port;
    }

    logger.info(
      { serviceId, port },
      '✅ Service is now running (received [SERVICE_READY] signal from service)'
    );
  }

  /**
   * 健康检查 - 等待服务真正ready
   * 后台异步运行，不阻塞start()
   * 如果收到 abortSignal，立即停止轮询（服务已通过 [SERVICE_READY] 信号通知就绪）
   */
  private async checkServiceHealth(serviceId: string, abortSignal?: AbortSignal): Promise<void> {
    const entry = this.registry.get(serviceId);
    if (!entry) {
      return;
    }

    const port = entry.def.port;

    // 没有port的服务，等待后直接设置为running
    if (!port) {
      await new Promise(resolve => setTimeout(resolve, PROCESS_CONSTANTS.NO_PORT_SERVICE_WAIT_MS));
      if (entry.runtime.status === 'starting') {
        entry.runtime.status = 'running';
        logger.info({ serviceId }, '✅ Service is now running (no port to check)');
      }
      return;
    }

    // 有port的服务，尝试健康检查
    // 对于需要模型预加载的服务，使用更长的超时时间
    const isPreloadService = (PROCESS_CONSTANTS.MODEL_PRELOAD_SERVICES as readonly string[]).includes(serviceId);
    const maxAttempts = isPreloadService
      ? PROCESS_CONSTANTS.MODEL_PRELOAD_HEALTH_CHECK_MAX_ATTEMPTS
      : PROCESS_CONSTANTS.HEALTH_CHECK_MAX_ATTEMPTS;

    for (let i = 0; i < maxAttempts; i++) {
      // 检查是否收到中止信号（服务已通过 [SERVICE_READY] 信号通知就绪）
      if (abortSignal?.aborted) {
        logger.debug({ serviceId }, 'Health check aborted (service ready signal received)');
        return;
      }

      // 检查进程是否还活着
      if (entry.runtime.status === 'stopped') {
        logger.warn({ serviceId }, 'Service stopped during health check');
        return;
      }

      // 如果服务已经通过 [SERVICE_READY] 信号标记为 running，停止轮询
      if (entry.runtime.status === 'running') {
        logger.debug({ serviceId }, 'Service already marked as running (ready signal received), stopping health check');
        return;
      }

      try {
        // 尝试访问/health端点
        // 使用 127.0.0.1 而不是 localhost，避免 IPv6/IPv4 解析问题（与 service-health.ts 保持一致）
        // 如果收到中止信号，使用它来取消请求
        const fetchSignal = abortSignal?.aborted
          ? AbortSignal.abort()
          : AbortSignal.timeout(PROCESS_CONSTANTS.HEALTH_CHECK_TIMEOUT_MS);

        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: fetchSignal
        });

        if (response.ok) {
          // 检查响应体中的 status 字段，只有 status === "ok" 才认为真正就绪
          try {
            const healthData = await response.json() as { status?: string };
            const serviceStatus = healthData?.status;

            // 对于预加载服务，记录每次健康检查的结果（便于排查）
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
            // 使用 info 级别，便于排查预加载服务的等待过程
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
          } catch (parseError) {
            entry.runtime.status = 'running';
            entry.runtime.port = port;
            logger.info({ serviceId, port, attempts: i + 1 }, '✅ Service is now running (health check passed, parse skip)');
            return;
          }
        }
      } catch (error) {
        // 如果是中止信号，直接返回（服务已通过 [SERVICE_READY] 信号通知就绪）
        if (error instanceof Error && error.name === 'AbortError' && abortSignal?.aborted) {
          logger.debug({ serviceId }, 'Health check fetch aborted (service ready signal received)');
          return;
        }

        // 继续等待，HTTP连接失败很正常（服务还在启动）
        // 对于预加载服务，记录连接失败（便于排查）
        if (isPreloadService && i % 10 === 0) {
          logger.info(
            { serviceId, port, attempts: i + 1, maxAttempts, error: error instanceof Error ? error.message : String(error) },
            'Health check connection failed (service may still be starting)...'
          );
        }
      }

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, PROCESS_CONSTANTS.HEALTH_CHECK_INTERVAL_MS));
    }

    // 超时后仍然没有健康检查通过
    // 对于需要模型预加载的服务，超时后仍然标记为 running（但记录警告）
    // 因为模型可能仍在加载，但服务进程已启动
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
}
