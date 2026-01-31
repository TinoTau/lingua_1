/**
 * ServiceProcessRunner - 统一的服务进程管理器
 * 
 * Day 3 重构: 删除魔法数字，简化逻辑
 * 进程启动/健康检查/端口与常量已抽到 ServiceProcessRunner-internal，本类只做委托。
 * 
 * 设计原则：
 * 1. 不区分Python/Rust，统一处理所有服务
 * 2. 配置完全来自service.json
 * 3. 错误直接抛出，不做防御性兜底
 * 4. 使用常量代替魔法数字
 */

import { spawn, ChildProcess } from 'child_process';
import { ServiceRegistry, ServiceEntry } from './ServiceTypes';
import logger from '../logger';
import {
  PROCESS_CONSTANTS,
  isPortFree,
  waitForPortRelease,
  runHealthCheck,
  applyServiceReady,
} from './ServiceProcessRunner-internal';

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
      const portFree = await isPortFree(port);
      if (!portFree) {
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
            this.handleServiceReady(serviceId, entry, entry.def.port);
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
            this.handleServiceReady(serviceId, entry, entry.def.port);
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
      await waitForPortRelease(port, PROCESS_CONSTANTS.PORT_RELEASE_TIMEOUT_MS);
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
  private handleServiceReady(serviceId: string, entry: ServiceEntry, port?: number): void {
    if (entry.runtime.status !== 'starting') {
      return;
    }
    const abortController = this.healthCheckAbortControllers.get(serviceId);
    if (abortController) {
      abortController.abort();
      this.healthCheckAbortControllers.delete(serviceId);
    }
    applyServiceReady(serviceId, entry, port);
  }

  /**
   * 健康检查 - 等待服务真正 ready，委托给 internal
   */
  private checkServiceHealth(serviceId: string, abortSignal?: AbortSignal): Promise<void> {
    const entry = this.registry.get(serviceId);
    if (!entry) {
      return Promise.resolve();
    }
    return runHealthCheck(serviceId, entry, abortSignal);
  }
}
