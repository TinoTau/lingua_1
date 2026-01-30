/**
 * ServiceRegistry 全局单例
 * 
 * 确保整个应用只有一个ServiceRegistry实例，避免状态不同步
 * 
 * 设计原则：
 * - Single Source of Truth：所有模块共享同一个registry
 * - 所有组件（ServiceProcessRunner, NodeServiceSupervisor, IPC handlers）都使用这个单例
 * - 任何模块更新runtime状态，其他模块立即可见
 */

import { ServiceRegistry } from './ServiceTypes';
import logger from '../logger';

let globalRegistry: ServiceRegistry | null = null;

/**
 * 设置全局ServiceRegistry（仅在初始化时调用）
 */
export function setServiceRegistry(registry: ServiceRegistry): void {
  if (globalRegistry !== null) {
    logger.warn({}, '⚠️  ServiceRegistry already initialized, replacing with new instance');
  }
  globalRegistry = registry;
  logger.info({ serviceCount: registry.size }, '✅ Global ServiceRegistry set');
}

/**
 * 获取全局ServiceRegistry
 * @throws Error 如果registry未初始化
 */
export function getServiceRegistry(): ServiceRegistry {
  if (!globalRegistry) {
    throw new Error(
      'ServiceRegistry not initialized! ' +
      'Call setServiceRegistry() in initServiceLayer() first.'
    );
  }
  return globalRegistry;
}

/**
 * 检查registry是否已初始化
 */
export function isServiceRegistryInitialized(): boolean {
  return globalRegistry !== null;
}
