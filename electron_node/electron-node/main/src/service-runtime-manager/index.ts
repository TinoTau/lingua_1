/**
 * ServiceRuntimeManager - 服务运行时管理器
 * 
 * 统一启动/停止服务进程（通过平台适配器）
 */

import { ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import logger from '../logger';
import { getPlatformAdapter, Platform } from '../platform-adapter';
import { ServiceRegistryManager } from '../service-registry';
import { ServiceJson, PlatformConfig, HealthCheck } from '../service-package-manager/types';
import { verifyPortReleased, checkPortAvailable } from '../utils/port-manager';

export interface ServiceRuntimeStatus {
  service_id: string;
  version: string;
  platform: string;
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
}

export class ServiceRuntimeManager {
  private runningServices: Map<string, ChildProcess> = new Map();
  private serviceStatuses: Map<string, ServiceRuntimeStatus> = new Map();
  private platformAdapter = getPlatformAdapter();
  private registryManager: ServiceRegistryManager;

  constructor(servicesDir: string) {
    this.registryManager = new ServiceRegistryManager(servicesDir);
  }

  /**
   * 启动服务
   */
  async startService(serviceId: string): Promise<void> {
    const platform = this.platformAdapter.getPlatformId();

    // 检查是否已在运行
    if (this.runningServices.has(serviceId)) {
      logger.warn({ serviceId }, 'Service is already running');
      return;
    }

    // 1. 从 current.json 读取当前版本与平台路径
    const current = this.registryManager.getCurrent(serviceId);
    if (!current) {
      throw new Error(`Service not installed or activated: ${serviceId}`);
    }

    // 2. 读取 service.json → 选择 platforms[platformId]
    const serviceJsonPath = current.service_json_path;
    const serviceJson: ServiceJson = await this.loadServiceJson(serviceJsonPath);

    const platformConfig = serviceJson.platforms[platform];
    if (!platformConfig) {
      throw new Error(`Platform config not found: ${platform} for service ${serviceId}`);
    }

    // 3. Node 分配可用端口（使用默认端口，如果被占用则查找下一个可用端口）
    let port = platformConfig.default_port;
    
    // 检查端口是否可用
    const portAvailable = await checkPortAvailable(port);
    if (!portAvailable) {
      // 如果端口被占用，尝试查找下一个可用端口
      logger.warn({ port, serviceId }, 'Default port is in use, finding alternative port');
      for (let p = port + 1; p < port + 100; p++) {
        if (await checkPortAvailable(p)) {
          port = p;
          logger.info({ port, serviceId }, 'Found alternative port');
          break;
        }
      }
    }

    // 4. 注入 env
    const env = {
      ...process.env,
      SERVICE_PORT: String(port),
      MODEL_PATH: path.join(current.install_path, 'models'),
      SERVICE_ID: serviceId,
      SERVICE_VERSION: current.version,
    };

    // 5. PlatformAdapter.spawn(program, args, env, cwd)
    const execConfig = platformConfig.exec;
    const program = path.join(current.install_path, execConfig.program);
    const args = execConfig.args.map(arg => {
      // 替换路径变量
      return arg.replace('${cwd}', current.install_path);
    });
    const cwd = path.join(current.install_path, execConfig.cwd);

    this.updateStatus(serviceId, {
      service_id: serviceId,
      version: current.version,
      platform,
      running: false,
      starting: true,
      pid: null,
      port,
      startedAt: null,
      lastError: null,
    });

    try {
      const process = this.platformAdapter.spawn(program, args, {
        cwd,
        env,
        stdio: 'pipe',
      });

      // 处理进程事件
      process.on('error', (error) => {
        logger.error({ error, serviceId }, 'Service process error');
        this.updateStatus(serviceId, {
          service_id: serviceId,
          version: current.version,
          platform,
          running: false,
          starting: false,
          pid: null,
          port,
          startedAt: null,
          lastError: error.message,
        });
        this.runningServices.delete(serviceId);
      });

      process.on('exit', (code, signal) => {
        logger.info({ serviceId, code, signal }, 'Service process exited');
        this.updateStatus(serviceId, {
          service_id: serviceId,
          version: current.version,
          platform,
          running: false,
          starting: false,
          pid: null,
          port,
          startedAt: null,
          lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
        });
        this.runningServices.delete(serviceId);
      });

      this.runningServices.set(serviceId, process);

      // 6. 等待 health_check
      await this.waitForHealthCheck(serviceJson.health_check, port, serviceId);

      this.updateStatus(serviceId, {
        service_id: serviceId,
        version: current.version,
        platform,
        running: true,
        starting: false,
        pid: process.pid || null,
        port,
        startedAt: new Date(),
        lastError: null,
      });

      logger.info({ serviceId, pid: process.pid, port }, 'Service started successfully');
    } catch (error) {
      logger.error({ error, serviceId }, 'Failed to start service');
      this.updateStatus(serviceId, {
        service_id: serviceId,
        version: current.version,
        platform,
        running: false,
        starting: false,
        pid: null,
        port,
        startedAt: null,
        lastError: error instanceof Error ? error.message : String(error),
      });
      this.runningServices.delete(serviceId);
      throw error;
    }
  }

  /**
   * 停止服务
   */
  async stopService(serviceId: string): Promise<void> {
    const process = this.runningServices.get(serviceId);
    if (!process) {
      logger.info({ serviceId }, 'Service is not running');
      return;
    }

    const status = this.serviceStatuses.get(serviceId);
    const port = status?.port || null;

    try {
      // 先发送优雅停止（如果服务支持）
      // TODO: 发送 SIGTERM 或其他停止信号

      // 等待进程退出（最多等待 5 秒）
      const exitPromise = new Promise<void>((resolve) => {
        process.once('exit', () => resolve());
      });

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 5000);
      });

      await Promise.race([exitPromise, timeoutPromise]);

      // 如果进程还在运行，强制 kill
      if (!process.killed && process.pid) {
        try {
          process.kill('SIGKILL');
        } catch (error) {
          logger.error({ error, serviceId }, 'Failed to kill service process');
        }
      }

      // 回收端口
      if (port) {
        await verifyPortReleased(port);
      }

      this.runningServices.delete(serviceId);
      this.updateStatus(serviceId, {
        ...status!,
        running: false,
        starting: false,
        pid: null,
        startedAt: null,
      });

      logger.info({ serviceId, port }, 'Service stopped');
    } catch (error) {
      logger.error({ error, serviceId }, 'Failed to stop service');
      throw error;
    }
  }

  /**
   * 获取服务状态
   */
  getServiceStatus(serviceId: string): ServiceRuntimeStatus | null {
    return this.serviceStatuses.get(serviceId) || null;
  }

  /**
   * 等待健康检查
   */
  private async waitForHealthCheck(
    healthCheck: HealthCheck,
    port: number,
    serviceId: string
  ): Promise<void> {
    const startTime = Date.now();
    const gracePeriod = healthCheck.startup_grace_ms;
    const checkInterval = 500;
    const timeout = healthCheck.timeout_ms;

    return new Promise((resolve, reject) => {
      const checkHealth = async () => {
        const elapsed = Date.now() - startTime;

        if (elapsed > gracePeriod) {
          reject(new Error(`Service health check timeout: ${serviceId} (grace period: ${gracePeriod}ms)`));
          return;
        }

        try {
          const endpoint = healthCheck.endpoint.startsWith('/')
            ? healthCheck.endpoint
            : `/${healthCheck.endpoint}`;
          
          const response = await axios.get(`http://localhost:${port}${endpoint}`, {
            timeout,
            validateStatus: (status) => status < 500,
          });

          if (response.status < 400) {
            logger.info({ serviceId, port, elapsed }, 'Service health check passed');
            resolve();
            return;
          }
        } catch (error: any) {
          // 连接错误是正常的（服务可能还在启动），继续等待
          if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            // 继续等待
          } else {
            logger.warn({ error, serviceId, port, elapsed }, 'Service health check error');
          }
        }

        // 继续等待
        setTimeout(checkHealth, checkInterval);
      };

      checkHealth();
    });
  }

  /**
   * 加载 service.json
   */
  private async loadServiceJson(serviceJsonPath: string): Promise<ServiceJson> {
    try {
      const content = await fs.readFile(serviceJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.error({ error, serviceJsonPath }, 'Failed to load service.json');
      throw error;
    }
  }

  /**
   * 更新服务状态
   */
  private updateStatus(serviceId: string, status: ServiceRuntimeStatus): void {
    this.serviceStatuses.set(serviceId, status);
  }
}

