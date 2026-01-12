/**
 * Semantic Repair Service Manager - Service Starter
 * 服务启动逻辑
 */

import { spawn, ChildProcess, execSync } from 'child_process';
import * as path from 'path';
import * as http from 'http';
import logger from '../logger';
import { cleanupPortProcesses, checkPortAvailable } from '../utils/port-manager';
import type { ServiceRegistryManager } from '../service-registry';
import type { SemanticRepairServiceStatus, SemanticRepairServiceId } from './index';

export interface ServiceJson {
  service_id: string;
  name: string;
  version: string;
  port: number;
  startup_command: string;
  startup_args: string[];
  health_check?: {
    endpoint: string;
    timeout_ms: number;
  };
}

/**
 * 获取服务配置（从service.json）
 */
export async function getServiceConfig(
  serviceId: SemanticRepairServiceId,
  serviceRegistryManager: ServiceRegistryManager
): Promise<ServiceJson> {
  try {
    await serviceRegistryManager.loadRegistry();
    const current = serviceRegistryManager.getCurrent(serviceId);
    
    if (!current || !current.install_path) {
      throw new Error(`Service ${serviceId} not found or not installed`);
    }

    // 从install_path构建service.json路径
    const serviceJsonPath = path.join(current.install_path, 'service.json');
    if (!require('fs').existsSync(serviceJsonPath)) {
      throw new Error(`service.json not found for ${serviceId} at ${serviceJsonPath}`);
    }

    const serviceJsonContent = require('fs').readFileSync(serviceJsonPath, 'utf-8');
    const serviceJson: ServiceJson = JSON.parse(serviceJsonContent);
    
    logger.debug({ serviceId, serviceJsonPath, port: serviceJson.port }, 'Loaded service config');
    return serviceJson;
  } catch (error) {
    logger.error({ error, serviceId }, 'Failed to load service config');
    throw error;
  }
}

/**
 * 检测Python命令
 */
export function detectPythonCommand(): string {
  let command = 'python';
  try {
    try {
      execSync('python3 --version', { stdio: 'ignore' });
      command = 'python3';
    } catch {
      try {
        execSync('python --version', { stdio: 'ignore' });
        command = 'python';
      } catch {
        // 如果都找不到，尝试python.exe（Windows）
        if (process.platform === 'win32') {
          command = 'python.exe';
        }
      }
    }
  } catch (error) {
    logger.warn({ error }, 'Failed to detect Python, using default: python');
  }
  return command;
}

/**
 * 等待服务就绪（通过健康检查）
 */
export async function waitForServiceReady(
  serviceId: SemanticRepairServiceId,
  config: ServiceJson,
  isLightweightService: boolean,
  updateStatus: (updates: Partial<SemanticRepairServiceStatus>) => void
): Promise<void> {
  const maxWaitTime = isLightweightService ? 10000 : 120000; // 轻量级服务10秒，模型服务2分钟
  const checkInterval = isLightweightService ? 200 : 1000; // 轻量级服务200ms检查一次，模型服务1秒
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const healthCheckPath = config.health_check?.endpoint || '/health';
      
      const response = await new Promise<{ ok: boolean; status?: string }>((resolve, reject) => {
        let responseData = '';
        const req = http.get(
          {
            hostname: 'localhost',
            port: config.port,
            path: healthCheckPath,
            timeout: config.health_check?.timeout_ms || 5000,
          },
          (res: any) => {
            res.on('data', (chunk: Buffer) => {
              responseData += chunk.toString();
            });
            res.on('end', () => {
              try {
                const healthData = JSON.parse(responseData);
                resolve({ 
                  ok: res.statusCode === 200,
                  status: healthData.status 
                });
              } catch {
                resolve({ ok: res.statusCode === 200 });
              }
            });
          }
        );
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });
      });

      // 如果status是"healthy"，认为服务已完全就绪
      if (response.ok && response.status === 'healthy') {
        logger.info({ serviceId, port: config.port }, 'Service is ready');
        updateStatus({
          starting: false,
          running: true,
          startedAt: new Date(),
        });
        return;
      } else if (response.ok && response.status === 'loading') {
        // 服务正在加载模型，继续等待
        logger.debug({ serviceId, port: config.port }, 'Service is loading model, waiting...');
      }
    } catch (error) {
      // 服务可能还在启动中，继续等待
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }

  throw new Error('Service health check timeout');
}

/**
 * 启动服务进程
 */
export async function startServiceProcess(
  serviceId: SemanticRepairServiceId,
  config: ServiceJson,
  workingDir: string,
  updateStatus: (updates: Partial<SemanticRepairServiceStatus>) => void
): Promise<ChildProcess> {
  // 检查端口是否可用
  const portAvailable = await checkPortAvailable(config.port);
  if (!portAvailable) {
    logger.warn(
      { serviceId, port: config.port },
      `Port ${config.port} is already in use, attempting to cleanup...`
    );
    await cleanupPortProcesses(config.port, serviceId);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // 构建启动命令
  let command = config.startup_command || 'python';
  if (command === 'python') {
    command = detectPythonCommand();
  }
  
  const args = config.startup_args || [];
  
  // 确保工作目录正确
  logger.info(
    { serviceId, command, args, workingDir, port: config.port },
    'Starting semantic repair service with command'
  );

  // 设置环境变量
  const envVars: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: config.port.toString(),
    HOST: '127.0.0.1',
  };

  // 启动进程
  logger.info(
    { serviceId, command, args, workingDir, port: config.port },
    'Starting semantic repair service'
  );

  const serviceProcess = spawn(command, args, {
    env: envVars,
    cwd: workingDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // 处理输出（使用更详细的日志级别以便调试）
  serviceProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString('utf8');
    // 输出到控制台以便调试
    console.log(`[${serviceId}] stdout:`, text);
    logger.info({ serviceId, stdout: text }, 'Service stdout');
  });

  serviceProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString('utf8');
    // 输出到控制台以便调试
    console.error(`[${serviceId}] stderr:`, text);
    logger.error({ serviceId, stderr: text }, 'Service stderr');
  });

  // 处理进程事件
  serviceProcess.on('error', (error: Error) => {
    const errorMessage = `Failed to start service process: ${error.message}`;
    console.error(`[${serviceId}] Process error:`, error);
    logger.error({ error, serviceId, command, args, workingDir }, 'Failed to start service process');
    updateStatus({
      starting: false,
      running: false,
      lastError: errorMessage,
    });
  });

  serviceProcess.on('exit', (code: number | null, signal: string | null) => {
    const exitMessage = code !== 0 ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : null;
    console.log(`[${serviceId}] Process exited: code=${code}, signal=${signal}`);
    logger.info({ serviceId, code, signal, command, args, workingDir }, 'Service process exited');
    updateStatus({
      starting: false,
      running: false,
      pid: null,
      lastError: exitMessage,
    });
  });

  // 设置初始状态
  updateStatus({
    starting: true,
    running: false,
    pid: serviceProcess.pid || null,
    port: config.port,
  });

  return serviceProcess;
}
