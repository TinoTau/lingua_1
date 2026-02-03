/**
 * 主进程 IPC 注册：系统资源、节点状态、服务元数据、服务启动/停止等
 * 从 index.ts 迁出，行为不变；通过 getManagers() 获取当前 managers。
 */
import { ipcMain } from 'electron';
import * as os from 'os';
import { getServiceRegistry } from './service-layer';
import { loadNodeConfig, getSchedulerUrl } from './node-config';
import logger from './logger';
import type { ServiceManagers } from './app/app-init-simple';

export function registerIpcHandlers(getManagers: () => ServiceManagers): void {
  ipcMain.handle('get-system-resources', async () => {
    try {
      const cpus = os.cpus();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      let totalIdle = 0;
      let totalTick = 0;
      cpus.forEach((cpu: any) => {
        for (const type in cpu.times) totalTick += cpu.times[type];
        totalIdle += cpu.times.idle;
      });
      const cpuUsage = 100 - (totalIdle / totalTick * 100);
      const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;
      let gpuUsage: number | null = null;
      try {
        const { getGpuUsage } = await import('./system-resources');
        gpuUsage = (await getGpuUsage())?.usage ?? null;
      } catch (error) {
        logger.debug({ error }, 'Failed to get GPU usage');
      }
      return {
        cpu: Math.min(Math.max(cpuUsage, 0), 100),
        memory: Math.min(Math.max(memoryUsage, 0), 100),
        gpu: gpuUsage,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to fetch system resources');
      return { cpu: 0, memory: 0, gpu: null };
    }
  });

  ipcMain.handle('get-node-status', async () => {
    const managers = getManagers();
    if (managers.nodeAgent) return managers.nodeAgent.getStatus();
    return { online: false, nodeId: null, connected: false, lastHeartbeat: new Date() };
  });

  /** 供渲染进程显示用：返回当前配置的调度器 URL（来自 electron-node-config.json） */
  ipcMain.handle('get-scheduler-url', async () => getSchedulerUrl());

  ipcMain.handle('reconnect-node', async () => {
    logger.info({}, 'reconnect-node IPC 被调用');
    const managers = getManagers();
    if (!managers.nodeAgent) {
      logger.warn({}, 'reconnect-node: NodeAgent 未初始化');
      return { success: false, error: 'NodeAgent 未初始化' };
    }
    managers.nodeAgent.stop();
    await managers.nodeAgent.start();
    logger.info({}, 'reconnect-node: 已执行 stop + start');
    return { success: true };
  });

  ipcMain.handle('get-all-service-metadata', async () => {
    const registry = getServiceRegistry();
    if (!registry) return {};
    const metadata: Record<string, any> = {};
    for (const [serviceId, entry] of registry.entries()) {
      metadata[serviceId] = {
        name: entry.def.name,
        name_zh: entry.def.name,
        type: entry.def.type,
        device: entry.def.device,
        version: entry.def.version,
        port: entry.def.port,
        deprecated: false,
      };
    }
    return metadata;
  });

  ipcMain.handle('get-service-preferences', async () => {
    try {
      return loadNodeConfig().servicePreferences || {};
    } catch (error) {
      logger.error({ error }, 'Failed to load service preferences');
      return {};
    }
  });

  ipcMain.handle('set-service-preferences', async (_event, preferences) => {
    try {
      const { saveNodeConfig } = await import('./node-config');
      const config = loadNodeConfig();
      config.servicePreferences = { ...config.servicePreferences, ...preferences };
      saveNodeConfig(config);
      return { success: true };
    } catch (error) {
      logger.error({ error }, 'Failed to set service preferences');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('get-rust-service-status', async () => {
    const managers = getManagers();
    if (!managers.serviceRunner) return { running: false, starting: false, pid: null, port: null };
    try {
      const registry = getServiceRegistry();
      if (!registry) return { running: false, starting: false, pid: null, port: null };
      const rustService = Array.from(registry.values()).find(e => e.def.type === 'rust');
      if (!rustService) return { running: false, starting: false, pid: null, port: null };
      const status = managers.serviceRunner.getStatus(rustService.def.id);
      return { running: status.status === 'running', starting: status.status === 'starting', pid: status.pid, port: status.port };
    } catch (error) {
      logger.error({ error }, 'Failed to get Rust service status');
      return { running: false, starting: false, pid: null, port: null };
    }
  });

  ipcMain.handle('get-python-service-status', async (_event, serviceName: string) => {
    const managers = getManagers();
    if (!managers.serviceRunner) return { name: serviceName, running: false, starting: false, pid: null, port: null };
    try {
      const serviceId = serviceName;
      const status = managers.serviceRunner.getStatus(serviceId);
      return { name: status.name, running: status.status === 'running', starting: status.status === 'starting', pid: status.pid, port: status.port };
    } catch (error) {
      logger.debug({ serviceName, error }, 'Service not found or error');
      return { name: serviceName, running: false, starting: false, pid: null, port: null };
    }
  });

  ipcMain.handle('get-all-python-service-statuses', async () => {
    const managers = getManagers();
    if (!managers.serviceRunner) return [];
    try {
      const registry = getServiceRegistry();
      if (!registry) return [];
      const pythonServices = Array.from(registry.values()).filter(e => e.def.type !== 'rust' && e.def.type !== 'semantic-repair');
      const serviceIdToName: Record<string, string> = {
        'faster-whisper-vad': 'faster_whisper_vad',
        'nmt-m2m100': 'nmt',
        'piper-tts': 'tts',
        'your-tts': 'yourtts',
        'speaker-embedding': 'speaker_embedding',
      };
      return pythonServices.map(entry => {
        const status = managers.serviceRunner!.getStatus(entry.def.id);
        return { name: serviceIdToName[entry.def.id] || entry.def.id, running: status.status === 'running', starting: status.status === 'starting', pid: status.pid, port: status.port };
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get all Python service statuses');
      return [];
    }
  });

  ipcMain.handle('start-rust-service', async () => {
    const managers = getManagers();
    if (!managers.serviceRunner) throw new Error('Service runner not initialized');
    const registry = getServiceRegistry();
    if (!registry) throw new Error('Service registry not initialized');
    const rustService = Array.from(registry.values()).find(e => e.def.type === 'rust');
    if (!rustService) throw new Error('Rust service not found in registry');
    logger.info({ serviceId: rustService.def.id }, 'IPC: Starting Rust service');
    await managers.serviceRunner.start(rustService.def.id);
    return { success: true };
  });

  ipcMain.handle('stop-rust-service', async () => {
    const managers = getManagers();
    if (!managers.serviceRunner) throw new Error('Service runner not initialized');
    const registry = getServiceRegistry();
    if (!registry) throw new Error('Service registry not initialized');
    const rustService = Array.from(registry.values()).find(e => e.def.type === 'rust');
    if (!rustService) throw new Error('Rust service not found in registry');
    logger.info({ serviceId: rustService.def.id }, 'IPC: Stopping Rust service');
    await managers.serviceRunner.stop(rustService.def.id);
    return { success: true };
  });

  const pythonServiceIdMap: Record<string, string> = {
    'nmt': 'nmt-m2m100', 'tts': 'piper-tts', 'yourtts': 'your-tts', 'faster_whisper_vad': 'faster-whisper-vad', 'speaker_embedding': 'speaker-embedding',
    'nmt-m2m100': 'nmt-m2m100', 'piper-tts': 'piper-tts', 'your-tts': 'your-tts', 'faster-whisper-vad': 'faster-whisper-vad', 'speaker-embedding': 'speaker-embedding',
  };

  ipcMain.handle('start-python-service', async (_event, serviceName: string) => {
    const managers = getManagers();
    if (!managers.serviceRunner) throw new Error('Service runner not initialized');
    const serviceId = pythonServiceIdMap[serviceName] || serviceName;
    const registry = getServiceRegistry();
    if (registry && !registry.has(serviceId)) throw new Error(`Service not found: ${serviceName}`);
    logger.info({ serviceId }, 'IPC: Starting Python service');
    await managers.serviceRunner.start(serviceId);
    return { success: true };
  });

  ipcMain.handle('stop-python-service', async (_event, serviceName: string) => {
    const managers = getManagers();
    if (!managers.serviceRunner) throw new Error('Service runner not initialized');
    const serviceId = pythonServiceIdMap[serviceName] || serviceName;
    const registry = getServiceRegistry();
    if (registry && !registry.has(serviceId)) throw new Error(`Service not found: ${serviceName}`);
    logger.info({ serviceId }, 'IPC: Stopping Python service');
    await managers.serviceRunner.stop(serviceId);
    return { success: true };
  });

  ipcMain.handle('get-processing-metrics', async () => ({ currentJobs: 0, totalProcessed: 0, averageTime: 0, queueLength: 0 }));

  /** 联调/测试：用模拟 ASR 文本跑完整 pipeline（聚合 → 语义修复 → 去重 → NMT） */
  ipcMain.handle('run-pipeline-with-mock-asr', async (
    _event,
    asrText: string,
    srcLang?: string,
    tgtLang?: string
  ) => {
    const managers = getManagers();
    if (!managers.inferenceService) throw new Error('InferenceService not available');
    return managers.inferenceService.runPipelineWithMockAsr(
      asrText,
      srcLang ?? 'zh',
      tgtLang ?? 'en'
    );
  });

  logger.info({}, '✅ All IPC handlers registered!');
  console.log('✅ All 14 IPC handlers registered!\n');
}
