//! 端口管理工具
//! 
//! 提供跨平台的端口检查、清理和验证功能

import logger from '../logger';

/**
 * 检查端口是否可用
 */
export async function checkPortAvailable(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const testServer = net.createServer();
    
    testServer.listen(port, host, () => {
      testServer.close(() => resolve(true));
    });
    
    testServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * 查找占用端口的进程 PID（Windows）
 */
export async function findPortProcessWindows(port: number): Promise<number[]> {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
    const lines = stdout.trim().split('\n');
    const pids: number[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(parseInt(pid))) {
          pids.push(parseInt(pid));
        }
      }
    }

    return pids;
  } catch (error) {
    logger.warn({ port, error }, '查找占用端口的进程失败 (Windows)');
    return [];
  }
}

/**
 * 查找占用端口的进程 PID（Linux/Mac）
 */
export async function findPortProcessUnix(port: number): Promise<number[]> {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const { stdout } = await execAsync(`lsof -ti:${port}`);
    const pids = stdout.trim().split('\n').filter((pid: string) => pid);
    return pids.map((pid: string) => parseInt(pid));
  } catch (error) {
    logger.warn({ port, error }, '查找占用端口的进程失败 (Unix)');
    return [];
  }
}

/**
 * 查找占用端口的进程 PID（跨平台）
 */
export async function findPortProcess(port: number): Promise<number[]> {
  const nodeProcess = require('process');
  if (nodeProcess.platform === 'win32') {
    return findPortProcessWindows(port);
  } else {
    return findPortProcessUnix(port);
  }
}

/**
 * 终止进程（Windows）
 */
export async function killProcessWindows(pid: number): Promise<boolean> {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    await execAsync(`taskkill /PID ${pid} /F`);
    return true;
  } catch (error) {
    logger.warn({ pid, error }, '终止进程失败 (Windows)');
    return false;
  }
}

/**
 * 终止进程（Linux/Mac）
 */
export async function killProcessUnix(pid: number): Promise<boolean> {
  try {
    const nodeProcess = require('process');
    nodeProcess.kill(pid, 'SIGTERM');
    return true;
  } catch (error) {
    logger.warn({ pid, error }, '终止进程失败 (Unix)');
    return false;
  }
}

/**
 * 终止进程（跨平台）
 */
export async function killProcess(pid: number): Promise<boolean> {
  const nodeProcess = require('process');
  if (nodeProcess.platform === 'win32') {
    return killProcessWindows(pid);
  } else {
    return killProcessUnix(pid);
  }
}

/**
 * 清理占用端口的进程
 */
export async function cleanupPortProcesses(
  port: number,
  serviceName?: string
): Promise<void> {
  const pids = await findPortProcess(port);
  
  if (pids.length === 0) {
    return;
  }

  logger.info(
    { serviceName, port, pids },
    `发现占用端口 ${port} 的进程，尝试终止...`
  );

  for (const pid of pids) {
    const success = await killProcess(pid);
    if (success) {
      logger.info({ serviceName, port, pid }, '已终止占用端口的进程');
      // 等待端口释放
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      logger.warn({ serviceName, port, pid }, '终止进程失败');
    }
  }
}

/**
 * 验证端口是否已释放
 */
export async function verifyPortReleased(
  port: number,
  serviceName?: string,
  timeout: number = 2000
): Promise<boolean> {
  try {
    const net = require('net');
    const testServer = net.createServer();

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        testServer.close();
        logger.warn(
          { serviceName, port },
          `端口 ${port} 释放验证超时（可能仍被占用）`
        );
        resolve(false);
      }, timeout);

      testServer.listen(port, '127.0.0.1', () => {
        clearTimeout(timeoutHandle);
        testServer.close(() => {
          logger.info(
            { serviceName, port },
            `✅ 端口 ${port} 已成功释放`
          );
          resolve(true);
        });
      });

      testServer.on('error', (err: any) => {
        clearTimeout(timeoutHandle);
        if (err.code === 'EADDRINUSE') {
          logger.error(
            { serviceName, port, error: err },
            `❌ 端口 ${port} 仍被占用，服务可能未正确关闭`
          );
          resolve(false);
        } else {
          logger.warn(
            { serviceName, port, error: err },
            `端口 ${port} 释放验证失败`
          );
          resolve(false);
        }
      });
    });
  } catch (error) {
    logger.warn(
      { serviceName, port, error },
      `端口 ${port} 释放验证异常`
    );
    return false;
  }
}

/**
 * 记录占用端口的进程信息
 */
export async function logPortOccupier(
  port: number,
  serviceName?: string
): Promise<void> {
  const pids = await findPortProcess(port);
  
  if (pids.length > 0) {
    logger.warn(
      { serviceName, port, pids },
      `端口 ${port} 被进程 PID ${pids.join(', ')} 占用`
    );
  } else {
    logger.warn(
      { serviceName, port },
      '无法查找占用端口的进程'
    );
  }
}

