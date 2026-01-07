import { loadNodeConfig, saveNodeConfig } from './node-config';
import logger from './logger';
import type { NodeAgent } from './agent/node-agent';
import type { RustServiceManager } from './rust-service-manager';
import type { PythonServiceManager } from './python-service-manager';
import type { SemanticRepairServiceManager } from './semantic-repair-service-manager';

export async function cleanupServices(
  nodeAgent: NodeAgent | null,
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null = null
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
    const fasterWhisperVadEnabled = !!pythonStatuses.find(s => s.name === 'faster_whisper_vad')?.running;
    const speakerEmbeddingEnabled = !!pythonStatuses.find(s => s.name === 'speaker_embedding')?.running;

    // 获取语义修复服务状态
    const semanticRepairStatuses = semanticRepairServiceManager 
      ? await semanticRepairServiceManager.getAllServiceStatuses()
      : [];
    const semanticRepairZhEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-zh')?.running;
    const semanticRepairEnEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en')?.running;
    const enNormalizeEnabled = !!semanticRepairStatuses.find(s => s.serviceId === 'en-normalize')?.running;

    const config = loadNodeConfig();
    config.servicePreferences = {
      rustEnabled,
      nmtEnabled,
      ttsEnabled,
      yourttsEnabled,
      fasterWhisperVadEnabled,
      speakerEmbeddingEnabled,
      semanticRepairZhEnabled,
      semanticRepairEnEnabled,
      enNormalizeEnabled,
    };
    saveNodeConfig(config);
    logger.info(
      { servicePreferences: config.servicePreferences },
      'Saved current service status to config file'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to save service status to config file');
  }

  // 停止 Node Agent（通知调度服务器节点离线）
  if (nodeAgent) {
    try {
      logger.info({}, 'Stopping Node Agent and notifying scheduler server...');
      // 停止心跳，避免在关闭连接时继续发送心跳
      nodeAgent.stop();
      // 给 WebSocket 一点时间发送关闭帧（如果可能）
      // 注意：WebSocket 关闭是异步的，但 close() 调用会立即触发 close 事件
      await new Promise(resolve => setTimeout(resolve, 100));
      logger.info({}, 'Node Agent stopped, scheduler server notified');
    } catch (error) {
      logger.error({ error }, 'Failed to stop Node Agent');
      // 即使失败也继续，确保其他服务能被清理
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
      
      // 添加超时保护，确保清理不会无限期等待
      const cleanupTimeout = 30000; // 30秒超时
      const cleanupPromise = pythonServiceManager.stopAllServices();
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Python services cleanup timeout after ${cleanupTimeout}ms`));
        }, cleanupTimeout);
      });
      
      await Promise.race([cleanupPromise, timeoutPromise]);
      logger.info({}, 'All Python services stopped');
    } catch (error) {
      logger.error({ error }, 'Failed to stop Python services');
      // 即使清理失败，也继续执行，避免阻塞应用退出
    }
  }

  // 停止所有语义修复服务（修复：之前遗漏了语义修复服务的清理）
  if (semanticRepairServiceManager) {
    try {
      const allStatuses = await semanticRepairServiceManager.getAllServiceStatuses();
      const runningSemanticRepairServices = allStatuses.filter(s => s.running);
      
      if (runningSemanticRepairServices.length > 0) {
        logger.info(
          { count: runningSemanticRepairServices.length, services: runningSemanticRepairServices.map(s => ({ id: s.serviceId, pid: s.pid, port: s.port })) },
          `Stopping all semantic repair services (${runningSemanticRepairServices.length} service(s))...`
        );
        
        // 添加超时保护
        const cleanupTimeout = 30000; // 30秒超时
        const cleanupPromise = semanticRepairServiceManager.stopAllServices();
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Semantic repair services cleanup timeout after ${cleanupTimeout}ms`));
          }, cleanupTimeout);
        });
        
        await Promise.race([cleanupPromise, timeoutPromise]);
        logger.info({}, 'All semantic repair services stopped');
      } else {
        logger.info({}, 'No semantic repair services running, no need to stop');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to stop semantic repair services');
      // 即使清理失败，也继续执行，避免阻塞应用退出
    }
  }

  logger.info({}, '========================================');
  logger.info({}, 'All services cleanup completed');
  logger.info({}, '========================================');
}

