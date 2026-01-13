/**
 * 应用生命周期管理模块
 * 负责处理应用退出、窗口关闭等生命周期事件
 */

import { app } from 'electron';
import { NodeAgent } from '../agent/node-agent';
import { RustServiceManager } from '../rust-service-manager';
import { PythonServiceManager } from '../python-service-manager';
import { SemanticRepairServiceManager } from '../semantic-repair-service-manager';
import { cleanupServices } from '../service-cleanup';
import { cleanupEsbuild } from '../utils/esbuild-cleanup';
import { getCurrentServiceStatus, saveServiceStatusToConfig } from './app-service-status';
import logger from '../logger';

/**
 * 清理应用资源
 */
async function cleanupAppResources(
  nodeAgent: NodeAgent | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): Promise<void> {
  try {
    await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
  } catch (error) {
    logger.error({ error }, 'Cleanup failed, but attempting to notify scheduler');
    if (nodeAgent) {
      try {
        nodeAgent.stop();
      } catch (e) {
        // 忽略错误
      }
    }
  }
  cleanupEsbuild();
}

/**
 * 注册窗口关闭事件处理
 */
export function registerWindowCloseHandler(
  mainWindow: Electron.BrowserWindow | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): void {
  if (!mainWindow) {
    return;
  }

  mainWindow.on('close', async () => {
    logger.info({}, 'Window close event triggered, saving user service preferences...');
    try {
      const serviceStatus = await getCurrentServiceStatus(
        rustServiceManager,
        pythonServiceManager,
        semanticRepairServiceManager
      );
      saveServiceStatusToConfig(serviceStatus, 'window-close-event');
    } catch (error) {
      logger.error(
        {
          error,
          message: error instanceof Error ? error.message : String(error),
          savedFrom: 'window-close-event',
        },
        'Failed to save service preferences on window close'
      );
    }
  });
}

/**
 * 注册 window-all-closed 事件处理
 */
export function registerWindowAllClosedHandler(
  nodeAgent: NodeAgent | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): void {
  app.on('window-all-closed', async () => {
    logger.info({ platform: process.platform }, 'window-all-closed event triggered');
    if (process.platform !== 'darwin') {
      logger.info({}, 'Cleaning up services and saving user preferences (window-all-closed)...');
      await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
      app.quit();
    }
  });
}

/**
 * 注册 before-quit 事件处理
 */
export function registerBeforeQuitHandler(
  nodeAgent: NodeAgent | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): void {
  app.on('before-quit', async (event) => {
    logger.info({ platform: process.platform }, 'before-quit event triggered');
    
    const rustRunning = rustServiceManager?.getStatus().running;
    const pythonRunning = pythonServiceManager?.getAllServiceStatuses().some(s => s.running);
    const semanticRepairRunning = semanticRepairServiceManager
      ? (await semanticRepairServiceManager.getAllServiceStatuses()).some((s) => s.running)
      : false;

    logger.info(
      {
        rustRunning,
        pythonRunning,
        semanticRepairRunning,
        hasRunningServices: rustRunning || pythonRunning || semanticRepairRunning,
      },
      'Checking service status before quit'
    );

    if (rustRunning || pythonRunning || semanticRepairRunning) {
      event.preventDefault();
      logger.info({}, 'Services are running, cleaning up and saving user preferences (before-quit)...');
      await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
      app.quit();
    } else {
      logger.info({}, 'No services running, saving user preferences (before-quit)...');
      try {
        const serviceStatus = await getCurrentServiceStatus(
          rustServiceManager,
          pythonServiceManager,
          semanticRepairServiceManager
        );
        saveServiceStatusToConfig(serviceStatus, 'before-quit-event');
      } catch (error) {
        logger.error({ error }, 'Failed to save service status to config file');
      }
      cleanupEsbuild();
    }
  });
}

/**
 * 注册进程信号处理
 */
export function registerProcessSignalHandlers(
  nodeAgent: NodeAgent | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): void {
  // 处理 SIGTERM 信号
  (process as any).on('SIGTERM', async () => {
    logger.info({}, 'Received SIGTERM signal, cleaning up services and notifying scheduler...');
    await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    process.exit(0);
  });

  // 处理 SIGINT 信号
  (process as any).on('SIGINT', async () => {
    logger.info({}, 'Received SIGINT signal, cleaning up services and notifying scheduler...');
    await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    process.exit(0);
  });
}

/**
 * 注册异常处理
 */
export function registerExceptionHandlers(
  nodeAgent: NodeAgent | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): void {
  // 处理未捕获的异常
  (process as any).on('uncaughtException', async (error: Error) => {
    logger.error({ error }, 'Uncaught exception, cleaning up services and notifying scheduler...');
    try {
      const cleanupPromise = cleanupAppResources(
        nodeAgent,
        rustServiceManager,
        pythonServiceManager,
        semanticRepairServiceManager
      );
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
      });
      await Promise.race([cleanupPromise, timeoutPromise]);
    } catch (cleanupError) {
      logger.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
      if (nodeAgent) {
        try {
          nodeAgent.stop();
        } catch (e) {
          // 忽略错误
        }
      }
    }
    process.exit(1);
  });

  // 处理未处理的 Promise 拒绝
  (process as any).on('unhandledRejection', async (reason: any, promise: Promise<any>) => {
    logger.error({ reason, promise }, 'Unhandled promise rejection, cleaning up services and notifying scheduler...');
    try {
      const cleanupPromise = cleanupAppResources(
        nodeAgent,
        rustServiceManager,
        pythonServiceManager,
        semanticRepairServiceManager
      );
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
      });
      await Promise.race([cleanupPromise, timeoutPromise]);
    } catch (cleanupError) {
      logger.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
      if (nodeAgent) {
        try {
          nodeAgent.stop();
        } catch (e) {
          // 忽略错误
        }
      }
    }
    process.exit(1);
  });

  // 进程退出时的最后清理
  (process as any).on('exit', () => {
    cleanupEsbuild();
  });
}
