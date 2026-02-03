/**
 * 启动前端口与进程清理
 * 扫描服务注册表中的预期端口，终止占用这些端口的遗留进程（如断电/崩溃后残留）
 * 不硬编码端口，完全从 registry 获取
 */

import { execSync } from 'child_process';
import type { ServiceRegistry } from './ServiceTypes';
import logger from '../logger';

/**
 * 获取占用指定端口的进程 PID
 * @returns PID 或 null（端口空闲）
 */
function getPidListeningOnPort(port: number): number | null {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf8',
        windowsHide: true,
      });
      // 解析 LISTENING 行的最后一列（PID）
      const lines = out.split('\n').filter((s) => s.includes('LISTENING'));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid) && pid > 0) return pid;
      }
      return null;
    }
    const out = execSync(`lsof -i :${port} -t`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const firstLine = out.trim().split('\n')[0];
    const pid = parseInt(firstLine || '0', 10);
    return isNaN(pid) || pid <= 0 ? null : pid;
  } catch {
    return null;
  }
}

/**
 * 终止指定 PID 的进程（含子进程树）
 */
function killProcess(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
    logger.info({ pid, port: 'see caller' }, 'Killed orphaned process on port');
  } catch (err) {
    logger.warn({ pid, error: err instanceof Error ? err.message : String(err) }, 'Failed to kill process (may already be dead)');
  }
}

/**
 * 从 ServiceRegistry 收集所有有端口的服务的端口号
 */
function getExpectedPorts(registry: ServiceRegistry): number[] {
  const ports = new Set<number>();
  for (const entry of registry.values()) {
    if (entry.def.port != null) {
      ports.add(entry.def.port);
    }
  }
  return Array.from(ports);
}

/**
 * 启动前清理：扫描 registry 中的预期端口，终止占用端口的遗留进程
 */
export async function cleanupOrphanedProcessesOnStartup(registry: ServiceRegistry): Promise<void> {
  const ports = getExpectedPorts(registry);
  if (ports.length === 0) return;

  logger.info({ ports }, 'Startup cleanup: checking for orphaned processes on expected ports');

  for (const port of ports) {
    const pid = getPidListeningOnPort(port);
    if (pid != null) {
      logger.info({ port, pid }, 'Found orphaned process on expected port, killing');
      killProcess(pid);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  logger.info({ ports }, 'Startup cleanup: done');
}
