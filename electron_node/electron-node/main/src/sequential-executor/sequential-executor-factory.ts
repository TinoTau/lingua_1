/**
 * SequentialExecutorFactory - 顺序执行管理器工厂
 * 提供单例SequentialExecutor实例
 */

import { SequentialExecutor } from './sequential-executor';
import { SequentialExecutorConfig } from './types';
import { loadNodeConfig } from '../node-config';
import logger from '../logger';

let instance: SequentialExecutor | null = null;

/**
 * 获取SequentialExecutor实例（单例）
 */
export function getSequentialExecutor(): SequentialExecutor {
  if (!instance) {
    const config = loadSequentialExecutorConfig();
    instance = new SequentialExecutor(config);
    logger.info(
      {
        enabled: config.enabled,
        maxWaitMs: config.maxWaitMs,
      },
      'SequentialExecutorFactory: Created singleton instance'
    );
  }
  return instance;
}

/**
 * 从NodeConfig加载SequentialExecutor配置
 */
function loadSequentialExecutorConfig(): SequentialExecutorConfig {
  const nodeConfig = loadNodeConfig();
  const config = nodeConfig.sequentialExecutor || {};

  return {
    enabled: config.enabled ?? true,
    maxWaitMs: config.maxWaitMs ?? 30000,
    timeoutCheckIntervalMs: config.timeoutCheckIntervalMs ?? 5000,
  };
}

/**
 * 重置实例（用于测试）
 */
export function resetSequentialExecutor(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
