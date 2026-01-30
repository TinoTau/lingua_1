/**
 * Service Snapshots (Day 2 Refactor)
 * 为NodeAgent提供服务和资源快照，替代旧的Manager依赖
 */

import { ServiceRegistry } from './ServiceTypes';
import { buildInstalledServices } from './ServiceDiscovery';
import logger from '../logger';
import * as os from 'os';

/**
 * 资源使用快照
 */
export interface ResourceUsage {
  cpuUsage: number;  // CPU使用率 (0-100)
  memoryUsage: number;  // 内存使用 MB
  totalMemory: number;  // 总内存 MB
  gpuUsage?: number;  // GPU使用率 (0-100, 可选)
  gpuMemory?: number;  // GPU显存使用 MB (可选)
}

/**
 * 创建服务快照函数
 * @param registry ServiceRegistry实例
 * @returns 返回服务快照函数
 */
export function createServiceSnapshotGetter(registry: ServiceRegistry) {
  return function getServiceSnapshot() {
    const snapshot = buildInstalledServices(registry);
    
    logger.debug(
      {
        totalServices: snapshot.length,
        running: snapshot.filter(s => s.status === 'running').length,
        stopped: snapshot.filter(s => s.status === 'stopped').length,
      },
      'Created service snapshot'
    );
    
    return snapshot;
  };
}

/**
 * 创建资源快照函数
 * @returns 返回资源快照函数
 */
export function createResourceSnapshotGetter() {
  return function getResourceSnapshot(): ResourceUsage {
    const totalMemMB = os.totalmem() / (1024 * 1024);
    const freeMemMB = os.freemem() / (1024 * 1024);
    const usedMemMB = totalMemMB - freeMemMB;
    
    // CPU使用率（简化版，基于load average）
    const loadAvg = os.loadavg()[0]; // 1分钟平均负载
    const cpuCount = os.cpus().length;
    const cpuUsage = Math.min(100, (loadAvg / cpuCount) * 100);
    
    const snapshot: ResourceUsage = {
      cpuUsage: Math.round(cpuUsage * 10) / 10,
      memoryUsage: Math.round(usedMemMB),
      totalMemory: Math.round(totalMemMB),
    };
    
    logger.debug(snapshot, 'Created resource snapshot');
    
    return snapshot;
  };
}

/**
 * 获取GPU信息（可选，依赖nvidia-smi或其他GPU监控工具）
 * 当前返回undefined，表示不可用
 */
export function getGPUInfo(): { usage: number; memory: number } | undefined {
  // TODO: 实现GPU监控（可选）
  // 可以使用 nvidia-smi, CUDA API 或其他工具
  return undefined;
}
