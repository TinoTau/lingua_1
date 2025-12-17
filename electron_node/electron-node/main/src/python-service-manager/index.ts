import { ChildProcess } from 'child_process';
import logger from '../logger';
import { GpuUsageTracker } from '../utils/gpu-tracker';
import { verifyPortReleased } from '../utils/port-manager';
import { getPythonServiceConfig } from '../utils/python-service-config';
import { PythonServiceStatus, PythonServiceName, PythonServiceConfig } from './types';
import { findProjectRoot } from './project-root';
import {
  startServiceProcess,
  stopServiceProcess,
  waitForServiceReadyWithProcessCheck,
} from './service-process';

export type { PythonServiceConfig, PythonServiceStatus, PythonServiceName };
export { PythonServiceManager };

class PythonServiceManager {
  private services: Map<string, ChildProcess> = new Map();
  private statuses: Map<string, PythonServiceStatus> = new Map();
  private taskCounts: Map<string, number> = new Map(); // 任务计数
  private gpuTrackers: Map<string, GpuUsageTracker> = new Map(); // GPU 跟踪器
  private projectRoot: string = '';

  constructor() {
    this.projectRoot = findProjectRoot();
  }

  private getServiceConfig(serviceName: PythonServiceName): PythonServiceConfig | null {
    return getPythonServiceConfig(serviceName, this.projectRoot);
  }

  async startService(serviceName: PythonServiceName): Promise<void> {
    if (this.services.has(serviceName)) {
      logger.warn({ serviceName }, 'Service is already running');
      return;
    }

    const config = this.getServiceConfig(serviceName);
    if (!config) {
      throw new Error(`Unknown service: ${serviceName}`);
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
      logger.error({ error, serviceName }, 'Failed to start Python service');
      this.updateStatus(serviceName, {
        running: false,
        starting: false,
        pid: null,
        port: config.port,
        startedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
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
    const serviceNames: Array<PythonServiceName> = ['nmt', 'tts', 'yourtts'];

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
   * 当第一个任务开始时，启动GPU跟踪
   * 注意：GPU跟踪应该在任务实际执行期间进行，而不是在任务完成后
   */
  incrementTaskCount(serviceName: PythonServiceName): void {
    const current = this.taskCounts.get(serviceName) || 0;
    const newCount = current + 1;
    this.taskCounts.set(serviceName, newCount);
    
    // 如果是第一个任务，开始GPU跟踪
    // 注意：这个方法在任务完成后被调用，但GPU跟踪应该在任务开始时开始
    // 因此这里启动GPU跟踪意味着"这个服务已经处理过任务了，应该开始跟踪"
    // 实际的GPU时间统计只在GPU实际使用时累计
    if (current === 0) {
      this.startGpuTracking(serviceName);
      logger.info({ serviceName }, 'First task completed, starting GPU usage time tracking (will be counted during subsequent task execution)');
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
    
    // 只有在有任务时才计算GPU使用时间，否则为0
    let gpuUsageMs = 0;
    if (taskCount > 0) {
      const tracker = this.gpuTrackers.get(serviceName);
      gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
    }

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
  }
}

