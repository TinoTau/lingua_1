import { loadNodeConfig, saveNodeConfig } from './node-config';
import logger from './logger';
import type { NodeAgent } from './agent/node-agent';
import type { RustServiceManager } from './rust-service-manager';
import type { PythonServiceManager } from './python-service-manager';

export async function cleanupServices(
  nodeAgent: NodeAgent | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null
): Promise<void> {
  logger.info({}, '========================================');
  logger.info({}, 'Starting cleanup of all services...');
  logger.info({}, '========================================');

  // 记录当前运行的服务状态
  const rustStatus = rustServiceManager?.getStatus();
  const pythonStatuses = pythonServiceManager?.getAllServiceStatuses() || [];
  const runningPythonServices = pythonStatuses.filter(s => s.running);

  logger.info(
    {
      rustRunning: rustStatus?.running,
      rustPort: rustStatus?.port,
      rustPid: rustStatus?.pid,
      pythonServices: runningPythonServices.map(s => ({
        name: s.name,
        port: s.port,
        pid: s.pid,
      })),
    },
    `Current service status - Rust: ${rustStatus?.running ? `port ${rustStatus.port}, PID ${rustStatus.pid}` : 'not running'}, Python: ${runningPythonServices.length} service(s) running`
  );

  // 在清理服务前，保存当前服务状态到配置文件
  // 这样即使窗口意外关闭，下次启动时也能恢复服务状态
  try {
    const rustEnabled = !!rustStatus?.running;
    const nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
    const ttsEnabled = !!pythonStatuses.find(s => s.name === 'tts')?.running;
    const yourttsEnabled = !!pythonStatuses.find(s => s.name === 'yourtts')?.running;

    const config = loadNodeConfig();
    config.servicePreferences = {
      rustEnabled,
      nmtEnabled,
      ttsEnabled,
      yourttsEnabled,
    };
    saveNodeConfig(config);
    logger.info(
      { servicePreferences: config.servicePreferences },
      'Saved current service status to config file'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to save service status to config file');
  }

  // 停止 Node Agent
  if (nodeAgent) {
    try {
      logger.info({}, 'Stopping Node Agent...');
      nodeAgent.stop();
      logger.info({}, 'Node Agent stopped');
    } catch (error) {
      logger.error({ error }, 'Failed to stop Node Agent');
    }
  }

  // 停止 Rust 服务
  if (rustServiceManager) {
    try {
      const status = rustServiceManager.getStatus();
      if (status.running) {
        logger.info(
          { port: status.port, pid: status.pid },
          `Stopping Rust service (port: ${status.port}, PID: ${status.pid})...`
        );
        await rustServiceManager.stop();
        logger.info(
          { port: status.port },
          `Rust service stopped (port: ${status.port})`
        );
      } else {
        logger.info({}, 'Rust service is not running, no need to stop');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to stop Rust service');
    }
  }

  // 停止所有 Python 服务
  if (pythonServiceManager) {
    try {
      logger.info(
        { count: runningPythonServices.length },
        `Stopping all Python services (${runningPythonServices.length} service(s))...`
      );
      await pythonServiceManager.stopAllServices();
      logger.info({}, 'All Python services stopped');
    } catch (error) {
      logger.error({ error }, 'Failed to stop Python services');
    }
  }

  logger.info({}, '========================================');
  logger.info({}, 'All services cleanup completed');
  logger.info({}, '========================================');
}

