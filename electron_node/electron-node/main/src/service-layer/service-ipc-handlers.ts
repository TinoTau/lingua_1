/**
 * 服务层 IPC Handlers
 * 处理渲染进程的服务相关请求
 * 
 * Day 4 重构: 使用 ServiceProcessRunner 替代 NodeServiceSupervisor
 */

import { ipcMain } from 'electron';
import * as path from 'path';
import logger from '../logger';
import { scanServices } from './ServiceDiscovery';
import { ServiceProcessRunner } from './ServiceProcessRunner';
import { ServiceRegistry } from './ServiceTypes';
import { getServiceRegistry, setServiceRegistry } from './ServiceRegistrySingleton';
import { buildIntentRuntimeDiagnosticsReport } from '../lexicon-v2/intent-runtime-metrics';

let serviceRunner: ServiceProcessRunner;
let servicesRoot: string;

/**
 * 初始化服务层
 * 在主进程启动时调用
 * 
 * Day 4: 简化返回值，只返回 ServiceProcessRunner
 */
export async function initServiceLayer(servicesRootPath: string): Promise<{
  registry: ServiceRegistry;
  runner: ServiceProcessRunner;
}> {
  servicesRoot = servicesRootPath;

  logger.info({ servicesRoot }, '[ServiceLayer] 🔧 Initializing service layer...');

  // 扫描服务目录（只从 service.json 读取）
  const registry = await scanServices(servicesRoot);

  // 设置为全局单例（确保所有模块使用同一个registry）
  setServiceRegistry(registry);

  // 使用全局registry创建 ServiceProcessRunner
  serviceRunner = new ServiceProcessRunner(getServiceRegistry());

  logger.info(
    {
      serviceCount: registry.size,
      services: Array.from(registry.keys())
    },
    '[ServiceLayer] ✅ Service layer initialized successfully'
  );

  return {
    registry,
    runner: serviceRunner,
  };
}

/**
 * 注册 IPC handlers
 */
export function registerServiceIpcHandlers(): void {
  /**
   * 列出所有服务（原始条目，供 list/refresh 等用）
   */
  ipcMain.handle('services:list', () => {
    try {
      const registry = getServiceRegistry();
      const services = Array.from(registry.values());
      logger.debug({ count: services.length }, 'IPC: services:list');
      return services;
    } catch (error) {
      logger.error({ error }, 'IPC: services:list failed');
      throw error;
    }
  });

  /**
   * 所有服务统一状态（按 type 在 UI 侧过滤，语义修复/同音纠错等共用）
   */
  ipcMain.handle('services:statuses', () => {
    try {
      const registry = getServiceRegistry();
      if (!registry) return [];
      return Array.from(registry.values()).map((entry) => ({
        serviceId: entry.def.id,
        type: entry.def.type,
        running: entry.runtime.status === 'running',
        starting: entry.runtime.status === 'starting',
        pid: entry.runtime.pid ?? null,
        port: entry.def.port ?? null,
        startedAt: entry.runtime.startedAt ?? null,
        lastError: entry.runtime.lastError ?? null,
      }));
    } catch (error) {
      logger.error({ error }, 'IPC: services:statuses failed');
      return [];
    }
  });

  /**
   * 刷新服务列表（重新扫描）
   * 
   * 设计原则：非破坏性刷新
   * - 只更新service.json定义
   * - 保留运行中服务的runtime状态
   * - 不停止任何正在运行的服务
   */
  ipcMain.handle('services:refresh', async () => {
    try {
      logger.info({}, 'IPC: services:refresh - rescanning services directory');

      // ✅ 1. 重新扫描，获取最新的service.json定义
      const freshRegistry = await scanServices(servicesRoot);

      // ✅ 2. 获取全局registry（当前运行中的状态）
      const currentRegistry = getServiceRegistry();

      let addedCount = 0;
      let updatedCount = 0;
      let removedCount = 0;

      // ✅ 3. 合并新扫描的服务到当前registry
      for (const [serviceId, freshEntry] of freshRegistry.entries()) {
        const currentEntry = currentRegistry.get(serviceId);

        if (currentEntry) {
          // 服务已存在：更新定义，保留runtime状态
          currentEntry.def = freshEntry.def;
          currentEntry.installPath = freshEntry.installPath;
          // ✅ 保持 currentEntry.runtime 不变！
          updatedCount++;
          logger.debug(
            {
              serviceId,
              status: currentEntry.runtime.status,
              pid: currentEntry.runtime.pid
            },
            '✅ Updated service definition, preserved runtime state'
          );
        } else {
          // 新发现的服务：直接添加
          currentRegistry.set(serviceId, freshEntry);
          addedCount++;
          logger.info({ serviceId, name: freshEntry.def.name }, '✅ Added new service');
        }
      }

      // ✅ 4. 检查已删除的服务
      for (const [serviceId, currentEntry] of currentRegistry.entries()) {
        if (!freshRegistry.has(serviceId)) {
          // 服务的service.json被删除了
          if (currentEntry.runtime.status === 'running') {
            // ✅ 保留运行中的服务，不删除
            logger.warn(
              { serviceId, pid: currentEntry.runtime.pid },
              '⚠️  Service removed from disk but still running, keeping it'
            );
          } else {
            // 已停止的服务可以移除
            currentRegistry.delete(serviceId);
            removedCount++;
            logger.info({ serviceId }, '✅ Removed stopped service');
          }
        }
      }

      // ✅ 5. 不需要重建runner，因为它已经引用同一个registry对象
      //      registry的变化会自动反映到runner

      const services = Array.from(currentRegistry.values());
      logger.info(
        {
          total: services.length,
          added: addedCount,
          updated: updatedCount,
          removed: removedCount,
        },
        '✅ IPC: services:refresh completed (non-destructive)'
      );

      return services;
    } catch (error) {
      logger.error({ error }, 'IPC: services:refresh failed');
      throw error;
    }
  });

  /**
   * 启动服务
   */
  ipcMain.handle('services:start', async (_, id: string) => {
    try {
      logger.info({ serviceId: id }, 'IPC: services:start');
      await serviceRunner.start(id);
      return { success: true };
    } catch (error) {
      logger.error({ error, serviceId: id }, 'IPC: services:start failed');
      throw error;
    }
  });

  /**
   * 停止服务
   */
  ipcMain.handle('services:stop', async (_, id: string) => {
    try {
      logger.info({ serviceId: id }, 'IPC: services:stop');
      await serviceRunner.stop(id);
      return { success: true };
    } catch (error) {
      logger.error({ error, serviceId: id }, 'IPC: services:stop failed');
      throw error;
    }
  });

  /**
   * 获取单个服务信息
   */
  ipcMain.handle('services:get', (_, id: string) => {
    try {
      const registry = getServiceRegistry();
      const service = registry.get(id);
      if (!service) {
        throw new Error(`Service not found: ${id}`);
      }
      return service;
    } catch (error) {
      logger.error({ error, serviceId: id }, 'IPC: services:get failed');
      throw error;
    }
  });

  ipcMain.handle('services:intent-runtime-diagnostics', () => {
    try {
      return buildIntentRuntimeDiagnosticsReport();
    } catch (error) {
      logger.error({ error }, 'IPC: services:intent-runtime-diagnostics failed');
      throw error;
    }
  });

  logger.info({}, 'Service IPC handlers registered');
}

/**
 * 获取当前的服务注册表（供其他模块使用）
 */
export { getServiceRegistry } from './ServiceRegistrySingleton';

/**
 * 获取当前的 ServiceProcessRunner（供其他模块使用）
 */
export function getServiceRunner(): ServiceProcessRunner {
  return serviceRunner;
}
