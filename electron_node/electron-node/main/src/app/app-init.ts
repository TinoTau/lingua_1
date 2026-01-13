/**
 * 应用初始化模块
 * 负责初始化所有服务、加载配置、启动服务等
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import * as si from 'systeminformation';
import { NodeAgent } from '../agent/node-agent';
import { ModelManager } from '../model-manager/model-manager';
import { InferenceService } from '../inference/inference-service';
import { RustServiceManager } from '../rust-service-manager';
import { PythonServiceManager } from '../python-service-manager';
import { ServiceRegistryManager } from '../service-registry';
import { ServicePackageManager } from '../service-package-manager';
import { SemanticRepairServiceManager } from '../semantic-repair-service-manager';
import { loadNodeConfig, saveNodeConfig } from '../node-config';
import { getGpuUsage } from '../system-resources';
import { registerModelHandlers } from '../ipc-handlers/model-handlers';
import { registerServiceHandlers } from '../ipc-handlers/service-handlers';
import { preloadServiceData } from '../ipc-handlers/service-cache';
import { registerRuntimeHandlers } from '../ipc-handlers/runtime-handlers';
import logger from '../logger';

/**
 * 服务管理器引用
 */
export interface ServiceManagers {
  nodeAgent: NodeAgent | null;
  modelManager: ModelManager | null;
  inferenceService: InferenceService | null;
  rustServiceManager: RustServiceManager | null;
  pythonServiceManager: PythonServiceManager | null;
  serviceRegistryManager: ServiceRegistryManager | null;
  servicePackageManager: ServicePackageManager | null;
  semanticRepairServiceManager: SemanticRepairServiceManager | null;
}

/**
 * 初始化服务目录路径
 */
function initializeServicesDirectory(): string {
  if (process.env.SERVICES_DIR) {
    return process.env.SERVICES_DIR;
  }

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    // 尝试找到项目根目录下的 electron_node/services
    let currentDir = __dirname;
    for (let i = 0; i < 10; i++) {
      const testPath = path.join(currentDir, 'services', 'installed.json');
      if (fs.existsSync(testPath)) {
        const projectServicesDir = path.join(currentDir, 'services');
        logger.info({ servicesDir: projectServicesDir }, 'Using project services directory (development mode)');
        return projectServicesDir;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }
  }

  // 回退到 userData/services
  const userData = app.getPath('userData');
  return path.join(userData, 'services');
}

/**
 * 初始化所有服务
 */
export async function initializeServices(): Promise<ServiceManagers> {
  const managers: ServiceManagers = {
    nodeAgent: null,
    modelManager: null,
    inferenceService: null,
    rustServiceManager: null,
    pythonServiceManager: null,
    serviceRegistryManager: null,
    servicePackageManager: null,
    semanticRepairServiceManager: null,
  };

  // 初始化服务管理器
  managers.rustServiceManager = new RustServiceManager();
  managers.pythonServiceManager = new PythonServiceManager();

  // 初始化服务注册表管理器
  const servicesDir = initializeServicesDirectory();
  logger.info({ servicesDir }, 'Initializing service registry manager');
  managers.serviceRegistryManager = new ServiceRegistryManager(servicesDir);
  managers.servicePackageManager = new ServicePackageManager(servicesDir);

  // 加载注册表
  try {
    const registry = await managers.serviceRegistryManager.loadRegistry();
    logger.info({
      servicesDir,
      registryPath: (managers.serviceRegistryManager as any).registryPath,
      installedPath: (managers.serviceRegistryManager as any).installedPath,
      installedCount: Object.keys(registry.installed).length,
      currentCount: Object.keys(registry.current).length,
    }, 'Service registry loaded successfully');
  } catch (error: any) {
    logger.warn({
      error: error.message,
      servicesDir,
      registryPath: (managers.serviceRegistryManager as any).registryPath,
    }, 'Failed to load service registry, will use empty registry');
  }

  // 初始化语义修复服务管理器
  managers.semanticRepairServiceManager = new SemanticRepairServiceManager(
    managers.serviceRegistryManager,
    servicesDir
  );

  // 初始化其他服务
  managers.modelManager = new ModelManager();
  managers.inferenceService = new InferenceService(
    managers.modelManager,
    managers.pythonServiceManager,
    managers.rustServiceManager,
    managers.serviceRegistryManager,
    undefined,  // aggregatorManager
    undefined,  // aggregatorMiddleware
    managers.semanticRepairServiceManager
  );

  // 设置任务记录回调
  managers.inferenceService.setOnTaskProcessedCallback((serviceName: string) => {
    if (serviceName === 'pipeline') {
      // Pipeline 处理任务时，各个服务会分别处理，这里不需要单独计数
    }
  });

  // 设置任务开始/结束回调（用于GPU跟踪）
  managers.inferenceService.setOnTaskStartCallback(() => {
    if (managers.rustServiceManager) {
      managers.rustServiceManager.startGpuTracking();
    }
  });

  managers.inferenceService.setOnTaskEndCallback(() => {
    if (managers.rustServiceManager) {
      managers.rustServiceManager.stopGpuTracking();
    }
  });

  managers.nodeAgent = new NodeAgent(
    managers.inferenceService,
    managers.modelManager,
    managers.serviceRegistryManager,
    managers.rustServiceManager,
    managers.pythonServiceManager,
    managers.semanticRepairServiceManager
  );

  return managers;
}

/**
 * 加载并验证配置文件
 */
export function loadAndValidateConfig(): void {
  const configPath = path.join(app.getPath('userData'), 'electron-node-config.json');
  const configExists = fs.existsSync(configPath);

  logger.info(
    {
      configPath,
      configExists,
    },
    'Loading user service preferences from config file...'
  );

  const config = loadNodeConfig();
  const prefs = config.servicePreferences;

  logger.info(
    {
      configPath,
      servicePreferences: prefs,
      rustEnabled: prefs.rustEnabled,
      nmtEnabled: prefs.nmtEnabled,
      ttsEnabled: prefs.ttsEnabled,
      yourttsEnabled: prefs.yourttsEnabled,
      fasterWhisperVadEnabled: prefs.fasterWhisperVadEnabled,
      speakerEmbeddingEnabled: prefs.speakerEmbeddingEnabled,
      semanticRepairZhEnabled: prefs.semanticRepairZhEnabled,
      semanticRepairEnEnabled: prefs.semanticRepairEnEnabled,
      enNormalizeEnabled: prefs.enNormalizeEnabled,
    },
    'User service preferences loaded successfully'
  );

  // 确保配置文件包含所有必需字段
  try {
    if (configExists) {
      const rawConfig = fs.readFileSync(configPath, 'utf-8');
      const parsedConfig = JSON.parse(rawConfig);
      if (parsedConfig && typeof parsedConfig === 'object' && !parsedConfig.servicePreferences) {
        logger.info({ configPath }, 'Config file missing servicePreferences, saving default configuration...');
        saveNodeConfig(config);
        logger.info({ servicePreferences: config.servicePreferences }, 'Default configuration saved');
      } else {
        logger.debug({ configPath }, 'Config file is valid and contains servicePreferences');
      }
    } else {
      logger.info({ configPath }, 'Config file not found (first launch), saving default configuration...');
      saveNodeConfig(config);
      logger.info({ servicePreferences: config.servicePreferences }, 'Default configuration saved');
    }
  } catch (error) {
    logger.warn(
      {
        error,
        configPath,
        message: error instanceof Error ? error.message : String(error),
      },
      'Failed to check config file, using loaded config without saving (to avoid overwriting user preferences)'
    );
  }
}

/**
 * 启动服务（根据用户偏好）
 */
export async function startServicesByPreference(
  managers: ServiceManagers
): Promise<void> {
  const config = loadNodeConfig();
  const prefs = config.servicePreferences;

  logger.info(
    {
      servicePreferences: prefs,
      autoStartServices: {
        rust: prefs.rustEnabled,
        nmt: prefs.nmtEnabled,
        tts: prefs.ttsEnabled,
        yourtts: prefs.yourttsEnabled,
        fasterWhisperVad: prefs.fasterWhisperVadEnabled,
        speakerEmbedding: prefs.speakerEmbeddingEnabled,
        semanticRepairZh: prefs.semanticRepairZhEnabled,
        semanticRepairEn: prefs.semanticRepairEnEnabled,
        enNormalize: prefs.enNormalizeEnabled,
      },
    },
    'Service manager initialized, auto-starting services based on user preferences'
  );

  // 启动 Rust 推理服务
  if (prefs.rustEnabled && managers.rustServiceManager) {
    logger.info({}, 'Auto-starting Rust inference service...');
    managers.rustServiceManager.start().catch((error) => {
      logger.error({ error }, 'Failed to auto-start Rust inference service');
    });
  }

  // 启动 Python 服务（串行启动，避免GPU内存过载）
  if (managers.pythonServiceManager) {
    const toStart: Array<'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding'> = [];
    if (prefs.fasterWhisperVadEnabled) toStart.push('faster_whisper_vad');
    if (prefs.nmtEnabled) toStart.push('nmt');
    if (prefs.ttsEnabled) toStart.push('tts');
    if (prefs.yourttsEnabled) toStart.push('yourtts');
    if (prefs.speakerEmbeddingEnabled) toStart.push('speaker_embedding');

    (async () => {
      for (const name of toStart) {
        logger.info({ serviceName: name }, 'Auto-starting Python service...');
        try {
          await managers.pythonServiceManager!.startService(name);
          logger.info({ serviceName: name }, 'Python service started successfully');
        } catch (error) {
          logger.error({ error, serviceName: name }, 'Failed to auto-start Python service');
        }
      }
    })().catch((error) => {
      logger.error({ error }, 'Failed to start Python services');
    });
  }

  // 启动语义修复服务
  if (managers.semanticRepairServiceManager && managers.serviceRegistryManager) {
    (async () => {
      try {
        await managers.serviceRegistryManager!.loadRegistry();
        const installed = managers.serviceRegistryManager!.listInstalled();
        const config = loadNodeConfig();
        const prefs = config.servicePreferences || {};

        const semanticRepairServiceIds: Array<'semantic-repair-zh' | 'semantic-repair-en' | 'en-normalize'> = [
          'semantic-repair-zh',
          'semantic-repair-en',
          'en-normalize',
        ];

        const toStart: Array<'semantic-repair-zh' | 'semantic-repair-en' | 'en-normalize'> = [];
        for (const service of installed) {
          if (semanticRepairServiceIds.includes(service.service_id as any)) {
            const serviceId = service.service_id as 'semantic-repair-zh' | 'semantic-repair-en' | 'en-normalize';
            let shouldStart = false;
            if (serviceId === 'semantic-repair-zh') {
              shouldStart = prefs.semanticRepairZhEnabled !== false;
            } else if (serviceId === 'semantic-repair-en') {
              shouldStart = prefs.semanticRepairEnEnabled !== false;
            } else if (serviceId === 'en-normalize') {
              shouldStart = prefs.enNormalizeEnabled !== false;
            }

            if (shouldStart) {
              toStart.push(serviceId);
            } else {
              logger.debug(
                {
                  serviceId,
                  preference: serviceId === 'semantic-repair-zh'
                    ? prefs.semanticRepairZhEnabled
                    : serviceId === 'semantic-repair-en'
                      ? prefs.semanticRepairEnEnabled
                      : prefs.enNormalizeEnabled,
                },
                'Semantic repair service auto-start disabled by user preference'
              );
            }
          }
        }

        const sortedToStart = toStart.sort((a, b) => {
          if (a === 'en-normalize') return -1;
          if (b === 'en-normalize') return 1;
          return 0;
        });

        for (const serviceId of sortedToStart) {
          logger.info({ serviceId }, 'Auto-starting semantic repair service...');
          try {
            await managers.semanticRepairServiceManager!.startService(serviceId);
            logger.info({ serviceId }, 'Semantic repair service started successfully');
          } catch (error) {
            logger.error({ error, serviceId }, 'Failed to auto-start semantic repair service');
          }
        }
      } catch (error) {
        logger.error({ error }, 'Failed to auto-start semantic repair services');
      }
    })().catch((error) => {
      logger.error({ error }, 'Failed to start semantic repair services');
    });
  }
}

/**
 * 注册 IPC 处理器
 */
export function registerIpcHandlers(managers: ServiceManagers): void {
  registerModelHandlers(managers.modelManager);
  registerServiceHandlers(
    managers.serviceRegistryManager,
    managers.servicePackageManager,
    managers.rustServiceManager,
    managers.pythonServiceManager
  );
  registerRuntimeHandlers(
    managers.nodeAgent,
    managers.modelManager,
    managers.inferenceService,
    managers.rustServiceManager,
    managers.pythonServiceManager,
    managers.serviceRegistryManager,
    managers.semanticRepairServiceManager
  );

  // 注册系统资源 IPC 处理器
  ipcMain.handle('get-system-resources', async () => {
    try {
      logger.debug({}, 'Starting to fetch system resources');
      const [cpu, mem, gpuInfo] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        getGpuUsage(),
      ]);

      const result = {
        cpu: cpu.currentLoad || 0,
        gpu: gpuInfo?.usage ?? null,
        gpuMem: gpuInfo?.memory ?? null,
        memory: (mem.used / mem.total) * 100,
      };

      logger.debug({ gpuInfo, result }, 'System resources fetched successfully');
      return result;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch system resources');
      return {
        cpu: 0,
        gpu: null,
        gpuMem: null,
        memory: 0,
      };
    }
  });
}

/**
 * 启动 Node Agent
 */
export function startNodeAgent(managers: ServiceManagers): void {
  if (!managers.nodeAgent) {
    return;
  }

  logger.info({}, 'Starting Node Agent (connecting to scheduler server)...');
  managers.nodeAgent.start().catch((error) => {
    logger.error({ error }, 'Failed to start Node Agent');
  });

  // 预加载服务列表和排行（异步，不阻塞启动）
  setTimeout(() => {
    preloadServiceData().catch((error) => {
      logger.warn({ error }, 'Failed to preload service data, will retry on demand');
    });
  }, 2000);
}
