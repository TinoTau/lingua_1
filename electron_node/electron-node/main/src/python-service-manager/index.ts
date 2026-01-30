import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import logger from '../logger';
import { GpuUsageTracker } from '../utils/gpu-tracker';
import { verifyPortReleased } from '../utils/port-manager';
import { setupCudaEnvironment } from '../utils/cuda-env';
import { PythonServiceStatus, PythonServiceName, PythonServiceConfig } from './types';
import { findProjectRoot } from './project-root';
import {
  startServiceProcess,
  stopServiceProcess,
  waitForServiceReadyWithProcessCheck,
} from './service-process';
import { getServiceRegistry } from '../service-layer';

export type { PythonServiceConfig, PythonServiceStatus, PythonServiceName };
export { PythonServiceManager };

class PythonServiceManager {
  private services: Map<string, ChildProcess> = new Map();
  private statuses: Map<string, PythonServiceStatus> = new Map();
  private taskCounts: Map<string, number> = new Map(); // 任务计数
  private gpuTrackers: Map<string, GpuUsageTracker> = new Map(); // GPU 跟踪器
  private projectRoot: string = '';
  private onStatusChangeCallback: ((serviceName: PythonServiceName, status: PythonServiceStatus) => void) | null = null; // 状态变化回调

  constructor() {
    this.projectRoot = findProjectRoot();
  }

  /**
   * 注册服务状态变化回调
   * 当服务的 running 状态发生变化时，会调用此回调
   */
  setOnStatusChangeCallback(callback: (serviceName: PythonServiceName, status: PythonServiceStatus) => void): void {
    this.onStatusChangeCallback = callback;
  }

  /**
   * 映射服务名称到 service_id（用于服务发现）
   */
  private getServiceId(serviceName: PythonServiceName): string {
    const serviceIdMap: Record<PythonServiceName, string> = {
      nmt: 'nmt-m2m100',
      tts: 'piper-tts',
      yourtts: 'your-tts',
      speaker_embedding: 'speaker-embedding',
      faster_whisper_vad: 'faster-whisper-vad',
    };
    return serviceIdMap[serviceName];
  }

  /**
   * 从服务发现机制获取服务配置
   */
  private async getServiceConfig(serviceName: PythonServiceName): Promise<PythonServiceConfig | null> {
    const serviceId = this.getServiceId(serviceName);
    const registry = getServiceRegistry();
    
    if (!registry || !registry.has(serviceId)) {
      logger.error({ serviceName, serviceId }, 'Service not found in registry');
      return null;
    }

    const serviceEntry = registry.get(serviceId)!;
    const serviceConfig = serviceEntry.def;
    
    logger.info({ serviceName, serviceId }, 'Loading service configuration from service discovery');

    if (!serviceConfig.exec) {
      logger.error({ serviceName, serviceId }, 'Service config missing exec definition');
      return null;
    }

    // 构建完整的配置
    const servicePath = serviceEntry.installPath;
    const venvPath = path.join(servicePath, 'venv');
    const venvScripts = path.join(venvPath, 'Scripts');
    const logDir = path.join(servicePath, 'logs');
    const logFile = path.join(logDir, `${serviceId}.log`);

    // 确保日志目录存在
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // 解析脚本路径
    const scriptPath = path.isAbsolute(serviceConfig.exec.args[0])
      ? serviceConfig.exec.args[0]
      : path.join(servicePath, serviceConfig.exec.args[0]);

    // 构建环境变量
    const baseEnv: Record<string, string> = {
      ...process.env,
      ...setupCudaEnvironment(),
      PYTHONIOENCODING: 'utf-8',
      PATH: `${venvScripts};${process.env.PATH || ''}`,
    };

    return {
      name: serviceConfig.name,
      port: serviceConfig.port || 8000,
      servicePath,
      venvPath,
      scriptPath,
      workingDir: serviceConfig.exec.cwd || servicePath,
      logDir,
      logFile,
      env: baseEnv,
    };
  }

  async startService(serviceName: PythonServiceName): Promise<void> {
    if (this.services.has(serviceName)) {
      logger.warn({ serviceName }, 'Service is already running');
      return;
    }

    let config: PythonServiceConfig | null = null;
    try {
      config = await this.getServiceConfig(serviceName);
      if (!config) {
        throw new Error(`Unknown service: ${serviceName}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          error: {
            message: errorMessage,
            name: error instanceof Error ? error.name : typeof error,
          },
          serviceName,
        },
        'Failed to get service config'
      );
      throw error;
    }

    // 设置启动中状态
    this.updateStatus(serviceName, {
      running: false,
      starting: true,
      pid: null,
      port: config.port,
      startedAt: null,
      lastError: null,
    });

    try {
      // 启动服务进程
      const process = await startServiceProcess(
        serviceName,
        config,
        {
          onProcessError: (error) => {
            this.updateStatus(serviceName, {
              running: false,
              starting: false,
              pid: null,
              port: config.port,
              startedAt: null,
              lastError: error.message,
            });
            this.services.delete(serviceName);
          },
          onProcessExit: (code, signal) => {
            this.updateStatus(serviceName, {
              running: false,
              starting: false,
              pid: null,
              port: config.port,
              startedAt: null,
              lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
            });
            this.services.delete(serviceName);
          },
        }
      );

      this.services.set(serviceName, process);

      // 等待服务就绪
      await waitForServiceReadyWithProcessCheck(config.port, process, serviceName);

      // 初始化统计信息
      if (!this.taskCounts.has(serviceName)) {
        this.taskCounts.set(serviceName, 0);
      }

      // 初始化 GPU 跟踪器
      if (!this.gpuTrackers.has(serviceName)) {
        this.gpuTrackers.set(serviceName, new GpuUsageTracker());
      }

      this.updateStatus(serviceName, {
        running: true,
        starting: false,
        pid: process.pid || null,
        port: config.port,
        startedAt: new Date(),
        lastError: null,
      });

      // 注意：GPU跟踪不会在服务启动时开始，而是在第一个任务处理时才开始（在incrementTaskCount中）
      // 这样可以确保只有在有实际任务时才统计GPU使用时间

      logger.info(
        { serviceName, pid: process.pid, port: config.port },
        'Python service started'
      );
    } catch (error) {
      // 记录详细的错误信息
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error(
        {
          error: {
            message: errorMessage,
            stack: errorStack,
            name: error instanceof Error ? error.name : typeof error,
          },
          serviceName,
          config: {
            venvPath: config?.venvPath,
            scriptPath: config?.scriptPath,
            port: config?.port,
          },
        },
        'Failed to start Python service'
      );
      this.updateStatus(serviceName, {
        running: false,
        starting: false,
        pid: null,
        port: config?.port || null,
        startedAt: null,
        lastError: errorMessage,
      });
      throw error;
    }
  }

  async stopService(serviceName: PythonServiceName): Promise<void> {
    const child = this.services.get(serviceName);
    if (!child) {
      const status = this.statuses.get(serviceName);
      logger.info(
        { serviceName, port: status?.port, running: status?.running },
        'Service is not running, no need to stop'
      );
      return;
    }

    const status = this.statuses.get(serviceName);
    const port = status?.port || null;

    // 停止GPU使用时间跟踪并重置
    this.stopGpuTracking(serviceName);
    const tracker = this.gpuTrackers.get(serviceName);
    if (tracker) {
      tracker.reset();
    }

    await stopServiceProcess(serviceName, child, port);

    // 重置任务计数和GPU跟踪器（下次启动时从0开始）
    this.taskCounts.delete(serviceName);
    this.gpuTrackers.delete(serviceName);

    this.updateStatus(serviceName, {
      running: false,
      starting: false,
      pid: null,
      port: port,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
    });
    this.services.delete(serviceName);
  }

  async stopAllServices(): Promise<void> {
    const serviceNames: Array<PythonServiceName> = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];

    // 记录当前运行的服务状态
    const runningServices = serviceNames
      .map((name) => {
        const status = this.statuses.get(name);
        return status?.running ? { name, port: status.port, pid: status.pid } : null;
      })
      .filter((s) => s !== null);

    logger.info(
      { runningServices, total: runningServices.length },
      `Stopping all Python services (${runningServices.length} service(s) running)...`
    );

    await Promise.all(
      serviceNames.map((name) =>
        this.stopService(name).catch((err) => {
          logger.error({ error: err, serviceName: name }, 'Failed to stop service');
        })
      )
    );

    // 验证所有端口是否已释放
    const allPorts = runningServices.map((s) => s?.port).filter((p) => p !== null) as number[];
    if (allPorts.length > 0) {
      logger.info(
        { ports: allPorts },
        `Verifying all service ports are released: ${allPorts.join(', ')}`
      );

      for (const port of allPorts) {
        // 等待一小段时间让端口完全释放
        await new Promise((resolve) => setTimeout(resolve, 500));
        await verifyPortReleased(port, 'all');
      }
    }

    logger.info({}, 'All Python services stopped');
  }

  getServiceStatus(serviceName: PythonServiceName): PythonServiceStatus | null {
    const status = this.statuses.get(serviceName);
    if (status) {
      // 更新统计信息
      const taskCount = this.taskCounts.get(serviceName) || 0;
      status.taskCount = taskCount;

      // 只有在有任务时才返回GPU使用时间，否则返回0
      if (taskCount > 0) {
        const tracker = this.gpuTrackers.get(serviceName);
        status.gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
      } else {
        status.gpuUsageMs = 0;
      }
    }
    return status || null;
  }

  getAllServiceStatuses(): PythonServiceStatus[] {
    return Array.from(this.statuses.values()).map((status) => {
      // 更新统计信息
      const taskCount = this.taskCounts.get(status.name) || 0;
      status.taskCount = taskCount;

      // 只有在有任务时才返回GPU使用时间，否则返回0
      if (taskCount > 0) {
        const tracker = this.gpuTrackers.get(status.name);
        status.gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
      } else {
        status.gpuUsageMs = 0;
      }
      return status;
    });
  }

  /**
   * 增加任务计数
   * 注意：GPU跟踪现在在任务路由时（routeASRTask/routeNMTTask/routeTTSTask）启动，
   * 而不是在这里启动，以确保能够捕获整个任务期间的 GPU 使用
   */
  incrementTaskCount(serviceName: PythonServiceName): void {
    const current = this.taskCounts.get(serviceName) || 0;
    const newCount = current + 1;
    this.taskCounts.set(serviceName, newCount);

    // GPU 跟踪现在在任务路由时启动，这里不再启动
    // 但确保跟踪器已创建（如果还没有创建）
    if (current === 0 && !this.gpuTrackers.has(serviceName)) {
      // 创建跟踪器但不启动（将在任务路由时启动）
      this.gpuTrackers.set(serviceName, new GpuUsageTracker());
      logger.debug({ serviceName }, 'Created GPU tracker for service (will be started when task routes)');
    }

    const status = this.statuses.get(serviceName);
    if (status) {
      status.taskCount = newCount;
    }
  }

  /**
   * 开始跟踪GPU使用时间
   */
  startGpuTracking(serviceName: PythonServiceName): void {
    let tracker = this.gpuTrackers.get(serviceName);
    if (!tracker) {
      tracker = new GpuUsageTracker();
      this.gpuTrackers.set(serviceName, tracker);
    }
    tracker.startTracking();
  }

  /**
   * 停止跟踪GPU使用时间
   */
  stopGpuTracking(serviceName: PythonServiceName): void {
    const tracker = this.gpuTrackers.get(serviceName);
    if (tracker) {
      tracker.stopTracking();
    }
  }

  private updateStatus(serviceName: string, status: Partial<Omit<PythonServiceStatus, 'name'>>): void {
    const current = this.statuses.get(serviceName);
    const taskCount = this.taskCounts.get(serviceName) || 0;

    // 获取GPU使用时间（无论是否有任务，都返回累计值）
    // 注意：如果跟踪器未启动，getGpuUsageMs() 会返回 0
    const tracker = this.gpuTrackers.get(serviceName);
    const gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;

    // 检查 running 状态是否发生变化
    const previousRunning = current?.running ?? false;
    const newRunning = status.running !== undefined ? status.running : (current?.running ?? false);

    // 合并状态，确保统计信息不被覆盖
    const mergedStatus: PythonServiceStatus = {
      name: serviceName,
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
      ...current,
      ...status,
    };

    // 如果status中没有指定taskCount和gpuUsageMs，使用当前值
    if (status.taskCount === undefined) {
      mergedStatus.taskCount = current?.taskCount ?? taskCount;
    }
    if (status.gpuUsageMs === undefined) {
      // 只有在有任务时才使用GPU使用时间，否则保持为0
      mergedStatus.gpuUsageMs = (taskCount > 0) ? (current?.gpuUsageMs ?? gpuUsageMs) : 0;
    }

    this.statuses.set(serviceName, mergedStatus);

    // 如果 running 状态发生变化，触发回调
    if (previousRunning !== newRunning && this.onStatusChangeCallback) {
      try {
        this.onStatusChangeCallback(serviceName as PythonServiceName, mergedStatus);
      } catch (error) {
        logger.error({ error, serviceName }, 'Error in onStatusChangeCallback');
      }
    }
  }
}

