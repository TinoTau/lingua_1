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
    logger.warn({ port, error }, 'Failed to find process occupying port (Windows)');
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
    logger.warn({ port, error }, 'Failed to find process occupying port (Unix)');
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
    logger.warn({ pid, error }, 'Failed to kill process (Windows)');
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
    logger.warn({ pid, error }, 'Failed to kill process (Unix)');
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
    `Found process occupying port ${port}, attempting to kill...`
  );

  for (const pid of pids) {
    const success = await killProcess(pid);
    if (success) {
      logger.info({ serviceName, port, pid }, 'Killed process occupying port');
      // 等待端口释放
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      logger.warn({ serviceName, port, pid }, 'Failed to kill process');
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
          `Port ${port} release verification timeout (may still be occupied)`
        );
        resolve(false);
      }, timeout);

      testServer.listen(port, '127.0.0.1', () => {
        clearTimeout(timeoutHandle);
        testServer.close(() => {
          logger.info(
            { serviceName, port },
            `Port ${port} successfully released`
          );
          resolve(true);
        });
      });

      testServer.on('error', (err: any) => {
        clearTimeout(timeoutHandle);
        if (err.code === 'EADDRINUSE') {
          logger.error(
            { serviceName, port, error: err },
            `Port ${port} is still occupied, service may not have closed properly`
          );
          resolve(false);
        } else {
          logger.warn(
            { serviceName, port, error: err },
            `Port ${port} release verification failed`
          );
          resolve(false);
        }
      });
    });
  } catch (error) {
    logger.warn(
      { serviceName, port, error },
      `Port ${port} release verification exception`
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
      `Port ${port} is occupied by process PID(s) ${pids.join(', ')}`
    );
  } else {
    logger.warn(
      { serviceName, port },
      'Unable to find process occupying port'
    );
  }
}

