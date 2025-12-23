import { app, BrowserWindow, ipcMain } from 'electron';
import { NodeAgent } from './agent/node-agent';
import { ModelManager } from './model-manager/model-manager';
import { InferenceService } from './inference/inference-service';
import { RustServiceManager } from './rust-service-manager';
import { PythonServiceManager } from './python-service-manager';
import { ServiceRegistryManager } from './service-registry';
import { ServicePackageManager } from './service-package-manager';
import { loadNodeConfig } from './node-config';
import logger from './logger';
import { createWindow, getMainWindow } from './window-manager';
import { cleanupServices } from './service-cleanup';
import { getGpuUsage } from './system-resources';
import { registerModelHandlers } from './ipc-handlers/model-handlers';
import { registerServiceHandlers } from './ipc-handlers/service-handlers';
import { preloadServiceData } from './ipc-handlers/service-cache';
import { registerRuntimeHandlers } from './ipc-handlers/runtime-handlers';

let nodeAgent: NodeAgent | null = null;
let modelManager: ModelManager | null = null;
let inferenceService: InferenceService | null = null;
let rustServiceManager: RustServiceManager | null = null;
let pythonServiceManager: PythonServiceManager | null = null;
let serviceRegistryManager: ServiceRegistryManager | null = null;
let servicePackageManager: ServicePackageManager | null = null;

app.whenReady().then(async () => {
  createWindow();

  try {
    // 初始化服务管理器
    rustServiceManager = new RustServiceManager();
    pythonServiceManager = new PythonServiceManager();

    // 初始化服务注册表管理器
    // 服务目录路径：优先使用环境变量或项目目录，否则使用 userData/services
    let servicesDir: string;
    if (process.env.SERVICES_DIR) {
      // 从环境变量读取
      servicesDir = process.env.SERVICES_DIR;
    } else {
      // 开发环境：尝试使用项目目录下的 services 文件夹
      const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
      if (isDev) {
        // 尝试找到项目根目录下的 electron_node/services
        // 从当前文件向上查找，直到找到包含 services/installed.json 的目录
        const fs = require('fs');
        const path = require('path');
        let currentDir = __dirname;
        let projectServicesDir: string | null = null;
        // 最多向上查找 10 级
        for (let i = 0; i < 10; i++) {
          const testPath = path.join(currentDir, 'services', 'installed.json');
          if (fs.existsSync(testPath)) {
            projectServicesDir = path.join(currentDir, 'services');
            break;
          }
          const parentDir = path.dirname(currentDir);
          if (parentDir === currentDir) {
            // 已经到达根目录
            break;
          }
          currentDir = parentDir;
        }
        logger.info({
          __dirname,
          projectServicesDir,
          found: projectServicesDir !== null
        }, 'Checking project services directory');
        if (projectServicesDir && fs.existsSync(projectServicesDir)) {
          servicesDir = projectServicesDir;
          logger.info({ servicesDir }, 'Using project services directory (development mode)');
        } else {
          // 回退到 userData/services
          const userData = app.getPath('userData');
          servicesDir = path.join(userData, 'services');
        }
      } else {
        // 生产环境：使用 userData/services
        const userData = app.getPath('userData');
        const path = require('path');
        servicesDir = path.join(userData, 'services');
      }
    }
    logger.info({ servicesDir }, 'Initializing service registry manager');
    serviceRegistryManager = new ServiceRegistryManager(servicesDir);
    // 初始化服务包管理器
    servicePackageManager = new ServicePackageManager(servicesDir);
    // 加载注册表
    try {
      const registry = await serviceRegistryManager.loadRegistry();
      logger.info({
        servicesDir,
        registryPath: (serviceRegistryManager as any).registryPath,
        installedPath: (serviceRegistryManager as any).installedPath,
        installedCount: Object.keys(registry.installed).length,
        currentCount: Object.keys(registry.current).length
      }, 'Service registry loaded successfully');
    } catch (error: any) {
      logger.warn({
        error: error.message,
        servicesDir,
        registryPath: (serviceRegistryManager as any).registryPath
      }, 'Failed to load service registry, will use empty registry');
    }

    // 初始化其他服务
    modelManager = new ModelManager();
    inferenceService = new InferenceService(modelManager);

    // 设置任务记录回调
    inferenceService.setOnTaskProcessedCallback((serviceName: string) => {
      if (serviceName === 'rust' && rustServiceManager) {
        rustServiceManager.incrementTaskCount();
      } else if (pythonServiceManager && (serviceName === 'nmt' || serviceName === 'tts' || serviceName === 'yourtts')) {
        pythonServiceManager.incrementTaskCount(serviceName);
      }
    });

    // 设置任务开始/结束回调（用于GPU跟踪）
    // 任务开始时启动GPU跟踪，任务结束时停止GPU跟踪
    inferenceService.setOnTaskStartCallback(() => {
      if (rustServiceManager) {
        rustServiceManager.startGpuTracking();
      }
      // Python服务的GPU跟踪由各自的incrementTaskCount控制（因为不同服务可能不同时使用）
    });

    inferenceService.setOnTaskEndCallback(() => {
      if (rustServiceManager) {
        rustServiceManager.stopGpuTracking();
      }
      // Python服务的GPU跟踪会在任务计数为0时停止（在显示时检查）
    });

    nodeAgent = new NodeAgent(inferenceService, modelManager, serviceRegistryManager, rustServiceManager, pythonServiceManager);

    // 启动 Node Agent（连接到调度服务器）
    logger.info({}, 'Starting Node Agent (connecting to scheduler server)...');
    nodeAgent.start().catch((error) => {
      logger.error({ error }, 'Failed to start Node Agent');
    });

    // 预加载服务列表和排行（异步，不阻塞启动）
    // 延迟2秒后开始预加载，给调度服务器一些时间启动
    setTimeout(() => {
      preloadServiceData().catch((error) => {
        logger.warn({ error }, 'Failed to preload service data, will retry on demand');
      });
    }, 2000);

    // 根据用户上一次选择的功能自动启动对应服务
    const config = loadNodeConfig();
    const prefs = config.servicePreferences;

    logger.info({ prefs }, 'Service manager initialized, auto-starting services based on previous selection');

    // 按照偏好启动 Rust 推理服务（异步启动，不阻塞窗口显示）
    if (prefs.rustEnabled) {
      logger.info({}, 'Auto-starting Rust inference service...');
      rustServiceManager.start().catch((error) => {
        logger.error({ error }, 'Failed to auto-start Rust inference service');
      });
    }

    // 按照偏好启动 Python 服务（异步启动，不阻塞窗口显示）
    if (pythonServiceManager) {
      const toStart: Array<'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding'> = [];
      if (prefs.fasterWhisperVadEnabled) toStart.push('faster_whisper_vad');
      if (prefs.nmtEnabled) toStart.push('nmt');
      if (prefs.ttsEnabled) toStart.push('tts');
      if (prefs.yourttsEnabled) toStart.push('yourtts');
      if (prefs.speakerEmbeddingEnabled) toStart.push('speaker_embedding');

      for (const name of toStart) {
        logger.info({ serviceName: name }, 'Auto-starting Python service...');
        pythonServiceManager.startService(name).catch((error) => {
          logger.error({ error, serviceName: name }, 'Failed to auto-start Python service');
        });
      }
    }

    // 注册所有 IPC 处理器
    registerModelHandlers(modelManager);
    registerServiceHandlers(serviceRegistryManager, servicePackageManager, rustServiceManager, pythonServiceManager);
    registerRuntimeHandlers(nodeAgent, modelManager, rustServiceManager, pythonServiceManager, serviceRegistryManager);

    // 注册系统资源 IPC 处理器
    ipcMain.handle('get-system-resources', async () => {
      const si = require('systeminformation');

      try {
        logger.debug({}, 'Starting to fetch system resources');
        const [cpu, mem, gpuInfo] = await Promise.all([
          si.currentLoad(),
          si.mem(),
          getGpuUsage(), // 自定义函数获取 GPU 使用率
        ]);

        const result = {
          cpu: cpu.currentLoad || 0,
          gpu: gpuInfo?.usage ?? null,
          gpuMem: gpuInfo?.memory ?? null,
          memory: (mem.used / mem.total) * 100,
        };

        logger.info({ gpuInfo, result }, 'System resources fetched successfully');
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
  } catch (error) {
    logger.error({ error }, 'Failed to initialize services');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 正常关闭窗口时清理服务
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager);
    app.quit();
  }
});

// 在应用退出前确保清理（处理 macOS 等平台）
app.on('before-quit', async (event) => {
  // 如果服务还在运行，阻止默认退出行为，先清理服务
  const rustRunning = rustServiceManager?.getStatus().running;
  const pythonRunning = pythonServiceManager?.getAllServiceStatuses().some(s => s.running);

  if (rustRunning || pythonRunning) {
    event.preventDefault();
    await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager);
    app.quit();
  }
});

// 处理系统信号（SIGTERM, SIGINT）确保服务被清理
// 注意：使用 (process as any) 因为 Electron 的 process 类型定义只包含 'loaded' 事件，
// 但运行时实际支持 Node.js 的所有 process 事件（SIGTERM, SIGINT 等）
(process as any).on('SIGTERM', async () => {
  logger.info({}, 'Received SIGTERM signal, cleaning up services...');
  await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager);
  process.exit(0);
});

(process as any).on('SIGINT', async () => {
  logger.info({}, 'Received SIGINT signal, cleaning up services...');
  await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager);
  process.exit(0);
});

// 处理未捕获的异常，确保服务被清理
(process as any).on('uncaughtException', async (error: Error) => {
  logger.error({ error }, 'Uncaught exception, cleaning up services...');
  await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager);
  process.exit(1);
});

(process as any).on('unhandledRejection', async (reason: any, promise: Promise<any>) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection, cleaning up services...');
  await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager);
  process.exit(1);
});

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
