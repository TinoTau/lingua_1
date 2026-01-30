/**
 * 服务发现模块
 * 扫描 services 目录，读取所有 service.json，构建 ServiceRegistry
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../logger';
import {
  ServiceDefinition,
  ServiceEntry,
  ServiceRegistry,
} from './ServiceTypes';

/**
 * 扫描服务目录，构建服务注册表
 * @param servicesRoot services 目录的绝对路径
 * @returns ServiceRegistry (内存结构)
 */
export async function scanServices(servicesRoot: string): Promise<ServiceRegistry> {
  const registry: ServiceRegistry = new Map();

  logger.info({ servicesRoot }, '[ServiceDiscovery] Scanning services directory...');

  // 检查目录是否存在
  if (!fs.existsSync(servicesRoot)) {
    logger.warn({ servicesRoot }, 'Services directory does not exist');
    return registry;
  }

  // 读取所有子目录
  const entries = fs.readdirSync(servicesRoot, { withFileTypes: true });
  
  for (const dir of entries) {
    if (!dir.isDirectory()) continue;

    const serviceDir = path.join(servicesRoot, dir.name);
    const serviceJsonPath = path.join(serviceDir, 'service.json');

    // 检查 service.json 是否存在
    if (!fs.existsSync(serviceJsonPath)) {
      logger.debug({ serviceDir }, 'No service.json found, skipping');
      continue;
    }

    try {
      // 读取并解析 service.json
      const raw = fs.readFileSync(serviceJsonPath, 'utf8');
      const def: ServiceDefinition = JSON.parse(raw);

      // 验证必需字段
      if (!def.id || !def.name || !def.type) {
        logger.warn(
          { serviceJsonPath, def },
          'Invalid service.json: missing required fields (id, name, type)'
        );
        continue;
      }

      // 验证 exec 字段
      if (!def.exec || !def.exec.command || !Array.isArray(def.exec.args)) {
        logger.warn(
          { serviceJsonPath, def },
          'Invalid service.json: missing or invalid exec field'
        );
        continue;
      }

      // 将相对路径转换为绝对路径
      if (def.exec.cwd && !path.isAbsolute(def.exec.cwd)) {
        def.exec.cwd = path.join(serviceDir, def.exec.cwd);
      } else if (!def.exec.cwd) {
        def.exec.cwd = serviceDir;
      }

      // 检查是否有重复的 service_id
      if (registry.has(def.id)) {
        logger.warn(
          { serviceId: def.id, existingPath: registry.get(def.id)?.installPath, newPath: serviceDir },
          'Duplicate service_id found, skipping new one'
        );
        continue;
      }

      // 添加到注册表
      registry.set(def.id, {
        def,
        runtime: {
          status: 'stopped',
        },
        installPath: serviceDir,
      });

      logger.info(
        { 
          serviceId: def.id, 
          name: def.name, 
          type: def.type, 
          version: def.version,
          installPath: serviceDir,
          execCommand: def.exec.command,
          execArgs: def.exec.args
        },
        '[ServiceDiscovery] ✅ Service discovered and registered'
      );
    } catch (error) {
      logger.error(
        { error, serviceJsonPath },
        'Failed to parse service.json'
      );
      continue;
    }
  }

  logger.info(
    { 
      totalServices: registry.size,
      serviceIds: Array.from(registry.keys()),
      servicesByType: {
        asr: Array.from(registry.values()).filter(e => e.def.type === 'asr').length,
        nmt: Array.from(registry.values()).filter(e => e.def.type === 'nmt').length,
        tts: Array.from(registry.values()).filter(e => e.def.type === 'tts').length,
        tone: Array.from(registry.values()).filter(e => e.def.type === 'tone').length,
        semantic: Array.from(registry.values()).filter(e => e.def.type === 'semantic').length,
      }
    },
    '[ServiceDiscovery] ✅ Service discovery completed successfully'
  );

  return registry;
}

/**
 * 获取指定类型的服务
 * @param registry 服务注册表
 * @param type 服务类型
 * @returns 该类型的所有服务
 */
export function getServicesByType(
  registry: ServiceRegistry,
  type: string
): ServiceEntry[] {
  return Array.from(registry.values()).filter(
    (entry) => entry.def.type === type
  );
}

/**
 * 获取正在运行的服务
 * @param registry 服务注册表
 * @returns 所有运行中的服务
 */
export function getRunningServices(registry: ServiceRegistry): ServiceEntry[] {
  return Array.from(registry.values()).filter(
    (entry) => entry.runtime.status === 'running'
  );
}

/**
 * 构建 NodeAgent 使用的服务列表
 * @param registry 服务注册表
 * @returns InstalledService[] 格式
 */
/**
 * 构建 InstalledService 列表（用于NodeAgent上报）
 * ✅ Day 2: 直接从ServiceRegistry构建，返回符合协议的格式
 */
export function buildInstalledServices(registry: ServiceRegistry): any[] {
  const result: any[] = [];

  for (const { def, runtime } of registry.values()) {
    // type字段直接使用service.json中的值
    // 协议期望的是字符串类型，不是枚举
    result.push({
      service_id: def.id,
      type: def.type,  // 'asr', 'nmt', 'tts', 'tone', 'semantic'
      device: def.device || 'gpu', // 默认 GPU
      status:
        runtime.status === 'running' || runtime.status === 'starting'
          ? 'running'  // ✅ 将 starting 视为 running（进程已启动）
          : runtime.status === 'error'
          ? 'error'
          : 'stopped',
      version: def.version || '2.0.0',
    });
  }

  logger.debug(
    {
      totalServices: result.length,
      services: result.map(s => `${s.service_id}:${s.type}:${s.status}`),
    },
    'Built installed services from registry'
  );

  return result;
}

/**
 * 构建能力聚合结果（按类型）
 * @param registry 服务注册表
 * @returns CapabilityByType[] 格式
 */
export function buildCapabilityByType(registry: ServiceRegistry): any[] {
  const types = ['asr', 'nmt', 'tts', 'tone', 'semantic'];
  const capability: any[] = [];

  for (const type of types) {
    // 找到该类型中运行中的 GPU 服务
    const runningGpuServices = Array.from(registry.values()).filter(
      (entry) =>
        entry.def.type === type &&
        (entry.def.device === 'gpu' || entry.def.device === 'auto' || !entry.def.device) &&
        entry.runtime.status === 'running'
    );

    if (runningGpuServices.length > 0) {
      capability.push({
        type,
        ready: true,
        ready_impl_ids: runningGpuServices.map((s) => s.def.id),
      });
      continue;
    }

    // 未找到运行中的 GPU 服务，检查原因
    const anyInstalled = Array.from(registry.values()).some((s) => s.def.type === type);
    const anyRunning = Array.from(registry.values()).some(
      (s) => s.def.type === type && s.runtime.status === 'running'
    );
    const anyGpu = Array.from(registry.values()).some(
      (s) =>
        s.def.type === type &&
        (s.def.device === 'gpu' || s.def.device === 'auto' || !s.def.device)
    );

    let reason = 'no_impl';
    if (anyInstalled && anyGpu && !anyRunning) {
      reason = 'gpu_impl_not_running';
    } else if (anyInstalled && anyRunning && !anyGpu) {
      reason = 'only_cpu_running';
    } else if (anyInstalled && !anyRunning) {
      reason = 'no_running_impl';
    }

    capability.push({
      type,
      ready: false,
      reason,
    });
  }

  return capability;
}
