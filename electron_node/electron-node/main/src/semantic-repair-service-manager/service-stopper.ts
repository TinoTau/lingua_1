/**
 * Semantic Repair Service Manager - Service Stopper
 * 服务停止逻辑
 */

import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import logger from '../logger';
import type { SemanticRepairServiceId } from './index';

/**
 * 停止服务进程
 */
export async function stopServiceProcess(
  serviceId: SemanticRepairServiceId,
  process: ChildProcess
): Promise<void> {
  logger.info({ serviceId, pid: process.pid }, 'Stopping service');

  try {
    // 尝试优雅关闭
    const platform = os.platform();
    
    if (process.pid) {
      // Windows: 使用 taskkill 清理进程树
      // Unix: 使用 kill
      if (platform === 'win32') {
        try {
          // 使用 taskkill /F /T /PID 强制终止进程树
          const killProcess = spawn('taskkill', ['/F', '/T', '/PID', process.pid.toString()], {
            stdio: 'ignore',
            windowsHide: true,
          });
          
          killProcess.on('error', (error) => {
            logger.warn({ error, serviceId, pid: process.pid }, 'taskkill failed, trying child.kill');
            process.kill('SIGTERM');
          });
        } catch (error) {
          logger.warn({ error, serviceId, pid: process.pid }, 'Failed to spawn taskkill, trying child.kill');
          process.kill('SIGTERM');
        }
      } else {
        process.kill('SIGTERM');
      }
    } else {
      process.kill('SIGTERM');
    }

    // 等待进程退出（最多等待10秒，增加超时时间）
    const maxWaitTime = 10000;
    const checkInterval = 100;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      if (process.killed || process.exitCode !== null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    // 如果进程仍未退出，强制终止
    if (!process.killed && process.exitCode === null) {
      logger.warn({ serviceId, pid: process.pid }, 'Service did not exit gracefully, forcing termination');
      
      // Windows: 再次尝试使用 taskkill 强制终止
      if (platform === 'win32' && process.pid) {
        try {
          const killProcess = spawn('taskkill', ['/F', '/T', '/PID', process.pid.toString()], {
            stdio: 'ignore',
            windowsHide: true,
          });
          
          killProcess.on('error', (error) => {
            logger.error({ error, serviceId, pid: process.pid }, 'Force kill taskkill failed');
            process.kill('SIGKILL');
          });
          
          // 等待 taskkill 完成
          await new Promise((resolve) => {
            killProcess.on('exit', resolve);
            setTimeout(resolve, 2000); // 2秒超时
          });
        } catch (error) {
          logger.error({ error, serviceId, pid: process.pid }, 'Exception during force kill');
          process.kill('SIGKILL');
        }
      } else {
        process.kill('SIGKILL');
      }
    }

    logger.info({ serviceId }, 'Service stopped');
  } catch (error) {
    logger.error({ error, serviceId }, 'Failed to stop service');
    throw error;
  }
}
