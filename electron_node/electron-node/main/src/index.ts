import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as si from 'systeminformation';

import { NodeAgent } from './agent/node-agent';
import { ModelManager } from './model-manager/model-manager';
import { InferenceService } from './inference/inference-service';
import { RustServiceManager } from './rust-service-manager';
import { PythonServiceManager } from './python-service-manager';
import { ServiceRegistryManager } from './service-registry';
import { ServicePackageManager } from './service-package-manager';
import { loadNodeConfig, saveNodeConfig } from './node-config';
import logger from './logger';
import { createWindow, getMainWindow } from './window-manager';
import { cleanupServices } from './service-cleanup';
import { getGpuUsage } from './system-resources';
import { cleanupEsbuild } from './utils/esbuild-cleanup';
import { registerModelHandlers } from './ipc-handlers/model-handlers';
import { registerServiceHandlers } from './ipc-handlers/service-handlers';
import { preloadServiceData } from './ipc-handlers/service-cache';
import { registerRuntimeHandlers } from './ipc-handlers/runtime-handlers';
import { checkAllDependencies, validateRequiredDependencies } from './utils/dependency-checker';
import { SemanticRepairServiceManager } from './semantic-repair-service-manager';

let nodeAgent: NodeAgent | null = null;
let modelManager: ModelManager | null = null;
let inferenceService: InferenceService | null = null;
let rustServiceManager: RustServiceManager | null = null;
let pythonServiceManager: PythonServiceManager | null = null;
let serviceRegistryManager: ServiceRegistryManager | null = null;
let servicePackageManager: ServicePackageManager | null = null;
let semanticRepairServiceManager: SemanticRepairServiceManager | null = null;

/**
 * 检查依赖并显示对话框
 */
function checkDependenciesAndShowDialog(mainWindow: BrowserWindow | null): void {
  try {
    const dependencies = checkAllDependencies();
    const { valid, missing } = validateRequiredDependencies();
    
    if (!valid) {
      logger.error({ missing }, 'Required dependencies are missing');
      
      // 构建错误消息
      const missingList = missing.join(', ');
      const message = `缺少必需的依赖：${missingList}\n\n` +
        '请安装以下依赖后重新启动应用：\n\n' +
        dependencies
          .filter(dep => dep.required && !dep.installed)
          .map(dep => {
            let installGuide = '';
            if (dep.name === 'Python') {
              installGuide = '• Python 3.10+\n  下载：https://www.python.org/downloads/\n  安装时请勾选 "Add Python to PATH"';
            } else if (dep.name === 'ffmpeg') {
              installGuide = '• ffmpeg\n  Windows: 下载 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip\n  解压到 C:\\ffmpeg，并将 C:\\ffmpeg\\bin 添加到系统 PATH';
            }
            return `${dep.name}:\n  ${dep.message}\n  ${installGuide}`;
          })
          .join('\n\n') +
        '\n\n详细安装指南请查看：electron_node/electron-node/docs/DEPENDENCY_INSTALLATION.md';
      
      // 显示错误对话框
      if (mainWindow) {
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: '依赖检查失败',
          message: '缺少必需的系统依赖',
          detail: message,
          buttons: ['确定', '查看文档'],
          defaultId: 0,
          cancelId: 0,
        }).then((result) => {
          if (result.response === 1) {
            // 打开文档（如果存在）
            const docPath = path.join(__dirname, '../../docs/DEPENDENCY_INSTALLATION.md');
            shell.openPath(docPath).catch(() => {
              // 如果文件不存在，打开包含文档的目录
              shell.openPath(path.dirname(docPath));
            });
          }
        }).catch((error) => {
          logger.error({ error }, 'Failed to show dependency error dialog');
        });
      } else {
        // 如果窗口不存在，输出到控制台
        console.error('缺少必需的依赖：', missing);
        console.error(message);
      }
      
      // 注意：不阻止应用启动，但依赖缺失可能导致服务无法正常工作
      logger.warn('应用将继续启动，但某些功能可能无法正常工作');
    } else {
      logger.info('所有必需依赖已安装');
    }
  } catch (error) {
    logger.error({ error }, '依赖检查失败，继续启动应用');
  }
}

app.whenReady().then(async () => {
  createWindow();

  // 等待窗口加载完成后检查系统依赖
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      // 检查系统依赖
      checkDependenciesAndShowDialog(mainWindow);
    });
  } else {
    // 如果窗口创建失败，延迟检查
    setTimeout(() => {
      const window = getMainWindow();
      if (window) {
        checkDependenciesAndShowDialog(window);
      } else {
        // 如果窗口仍然不存在，只记录日志
        checkDependenciesAndShowDialog(null);
      }
    }, 1000);
  }

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
      }, 'Service registry loaded successfully'); // 已在service-registry中降低为debug级别，这里保留info用于初始化日志
    } catch (error: any) {
      logger.warn({
        error: error.message,
        servicesDir,
        registryPath: (serviceRegistryManager as any).registryPath
      }, 'Failed to load service registry, will use empty registry');
    }

    // 初始化其他服务
    modelManager = new ModelManager();
    inferenceService = new InferenceService(
      modelManager,
      pythonServiceManager,
      rustServiceManager,
      serviceRegistryManager
    );

    // 设置任务记录回调
    inferenceService.setOnTaskProcessedCallback((serviceName: string) => {
      // 新架构使用 'pipeline' 作为服务名称
      if (serviceName === 'pipeline') {
        // Pipeline 处理任务时，各个服务会分别处理，这里不需要单独计数
        // 如果需要，可以在 TaskRouter 中分别计数各个服务的调用
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

    nodeAgent = new NodeAgent(inferenceService, modelManager, serviceRegistryManager, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);

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

    // 确保配置文件包含所有必需字段（首次启动时补齐缺失字段）
    // 检查配置文件中是否缺少 servicePreferences 字段（通过读取原始文件检查）
    try {
      const configPath = require('path').join(require('electron').app.getPath('userData'), 'electron-node-config.json');
      if (require('fs').existsSync(configPath)) {
        const rawConfig = require('fs').readFileSync(configPath, 'utf-8');
        const parsedConfig = JSON.parse(rawConfig);
        if (!parsedConfig.servicePreferences) {
          logger.info({}, 'Config file missing servicePreferences, saving default configuration...');
          saveNodeConfig(config);
        }
      }
    } catch (error) {
      // 忽略检查错误，继续启动
      logger.debug({ error }, 'Failed to check config file for missing fields');
    }

    logger.info({ prefs }, 'Service manager initialized, auto-starting services based on previous selection');

    // 按照偏好启动 Rust 推理服务（异步启动，不阻塞窗口显示）
    if (prefs.rustEnabled) {
      logger.info({}, 'Auto-starting Rust inference service...');
      rustServiceManager.start().catch((error) => {
        logger.error({ error }, 'Failed to auto-start Rust inference service');
      });
    }

    // 按照偏好启动 Python 服务（串行启动，避免GPU内存过载）
    if (pythonServiceManager) {
      const toStart: Array<'nmt' | 'tts' | 'yourtts' | 'faster_whisper_vad' | 'speaker_embedding'> = [];
      if (prefs.fasterWhisperVadEnabled) toStart.push('faster_whisper_vad');
      if (prefs.nmtEnabled) toStart.push('nmt');
      if (prefs.ttsEnabled) toStart.push('tts');
      if (prefs.yourttsEnabled) toStart.push('yourtts');
      if (prefs.speakerEmbeddingEnabled) toStart.push('speaker_embedding');

      // 串行启动服务，等待每个服务完全启动后再启动下一个（避免GPU内存过载）
      // 使用异步函数避免阻塞窗口显示
      (async () => {
        for (const name of toStart) {
          logger.info({ serviceName: name }, 'Auto-starting Python service...');
          try {
            await pythonServiceManager.startService(name);
            logger.info({ serviceName: name }, 'Python service started successfully');
          } catch (error) {
            logger.error({ error, serviceName: name }, 'Failed to auto-start Python service');
          }
        }
      })().catch((error) => {
        logger.error({ error }, 'Failed to start Python services');
      });
    }

    // 注册所有 IPC 处理器
    registerModelHandlers(modelManager);
    registerServiceHandlers(serviceRegistryManager, servicePackageManager, rustServiceManager, pythonServiceManager);
    // 初始化语义修复服务管理器
    semanticRepairServiceManager = new SemanticRepairServiceManager(
      serviceRegistryManager,
      servicesDir
    );

    // 自动启动语义修复服务（如果已安装）
    // 注意：与Python服务不同，语义修复服务需要加载模型，启动时间较长
    // 因此使用异步启动，不阻塞应用启动
    if (semanticRepairServiceManager && serviceRegistryManager) {
      (async () => {
        try {
          // 加载服务注册表
          await serviceRegistryManager.loadRegistry();
          const installed = serviceRegistryManager.listInstalled();
          
          // 加载用户偏好配置
          const config = loadNodeConfig();
          const prefs = config.servicePreferences || {};
          
          // 检查已安装的语义修复服务，并根据用户偏好决定是否启动
          const semanticRepairServiceIds: Array<'semantic-repair-zh' | 'semantic-repair-en' | 'en-normalize'> = [
            'semantic-repair-zh',
            'semantic-repair-en',
            'en-normalize',
          ];
          
          const toStart: Array<'semantic-repair-zh' | 'semantic-repair-en' | 'en-normalize'> = [];
          for (const service of installed) {
            if (semanticRepairServiceIds.includes(service.service_id as any)) {
              const serviceId = service.service_id as 'semantic-repair-zh' | 'semantic-repair-en' | 'en-normalize';
              
              // 根据用户偏好决定是否启动
              let shouldStart = false;
              if (serviceId === 'semantic-repair-zh') {
                // 如果用户偏好未设置，默认启用（向后兼容）
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
                        : prefs.enNormalizeEnabled
                  },
                  'Semantic repair service auto-start disabled by user preference'
                );
              }
            }
          }
          
          // 串行启动语义修复服务（避免GPU内存过载）
          // 注意：en-normalize是轻量级服务，可以优先启动
          // semantic-repair-zh和semantic-repair-en需要加载模型，启动较慢
          const sortedToStart = toStart.sort((a, b) => {
            // en-normalize优先
            if (a === 'en-normalize') return -1;
            if (b === 'en-normalize') return 1;
            return 0;
          });
          
          for (const serviceId of sortedToStart) {
            logger.info({ serviceId }, 'Auto-starting semantic repair service...');
            try {
              await semanticRepairServiceManager.startService(serviceId);
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

    registerRuntimeHandlers(nodeAgent, modelManager, inferenceService, rustServiceManager, pythonServiceManager, serviceRegistryManager, semanticRepairServiceManager);

    // 注册系统资源 IPC 处理器
    ipcMain.handle('get-system-resources', async () => {
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

        // 降低系统资源获取日志级别为debug，减少终端输出
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
    await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    // 清理 ESBuild 进程
    cleanupEsbuild();
    app.quit();
  }
});

// 在应用退出前确保清理（处理 macOS 等平台）
app.on('before-quit', async (event) => {
  // 如果服务还在运行，阻止默认退出行为，先清理服务
  const rustRunning = rustServiceManager?.getStatus().running;
  const pythonRunning = pythonServiceManager?.getAllServiceStatuses().some(s => s.running);
  const semanticRepairRunning = semanticRepairServiceManager ? (await semanticRepairServiceManager.getAllServiceStatuses()).some((s) => s.running) : false;

  if (rustRunning || pythonRunning || semanticRepairRunning) {
    event.preventDefault();
    await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    // 清理 ESBuild 进程
    cleanupEsbuild();
    app.quit();
  } else {
    // 即使服务没有运行，也要保存当前服务状态（以便下次启动时恢复）
    // 这样用户关闭应用时，即使所有服务都已停止，也能记住用户的选择
    try {
      const pythonStatuses = pythonServiceManager?.getAllServiceStatuses() || [];
      const semanticRepairStatuses = semanticRepairServiceManager 
        ? await semanticRepairServiceManager.getAllServiceStatuses()
        : [];
      
      const config = loadNodeConfig();
      config.servicePreferences = {
        rustEnabled: false,
        nmtEnabled: !!pythonStatuses.find(s => s.name === 'nmt')?.running,
        ttsEnabled: !!pythonStatuses.find(s => s.name === 'tts')?.running,
        yourttsEnabled: !!pythonStatuses.find(s => s.name === 'yourtts')?.running,
        fasterWhisperVadEnabled: !!pythonStatuses.find(s => s.name === 'faster_whisper_vad')?.running,
        speakerEmbeddingEnabled: !!pythonStatuses.find(s => s.name === 'speaker_embedding')?.running,
        semanticRepairZhEnabled: !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-zh')?.running,
        semanticRepairEnEnabled: !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en')?.running,
        enNormalizeEnabled: !!semanticRepairStatuses.find(s => s.serviceId === 'en-normalize')?.running,
      };
      saveNodeConfig(config);
      logger.info(
        { servicePreferences: config.servicePreferences },
        'Saved current service status to config file (no services running)'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to save service status to config file');
    }
    // 清理 ESBuild 进程
    cleanupEsbuild();
  }
});

// 处理系统信号（SIGTERM, SIGINT）确保服务被清理
// 注意：使用 (process as any) 因为 Electron 的 process 类型定义只包含 'loaded' 事件，
// 但运行时实际支持 Node.js 的所有 process 事件（SIGTERM, SIGINT 等）
(process as any).on('SIGTERM', async () => {
  logger.info({}, 'Received SIGTERM signal, cleaning up services and notifying scheduler...');
  try {
    await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
  } catch (error) {
    logger.error({ error }, 'Cleanup failed, but attempting to notify scheduler');
    if (nodeAgent) {
      try {
        nodeAgent.stop();
      } catch (e) {
        // 忽略错误
      }
    }
  }
  // 清理 ESBuild 进程
  cleanupEsbuild();
  process.exit(0);
});

(process as any).on('SIGINT', async () => {
  logger.info({}, 'Received SIGINT signal, cleaning up services and notifying scheduler...');
  try {
    await cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
  } catch (error) {
    logger.error({ error }, 'Cleanup failed, but attempting to notify scheduler');
    if (nodeAgent) {
      try {
        nodeAgent.stop();
      } catch (e) {
        // 忽略错误
      }
    }
  }
  // 清理 ESBuild 进程
  cleanupEsbuild();
  process.exit(0);
});

// 处理未捕获的异常，确保服务被清理
(process as any).on('uncaughtException', async (error: Error) => {
  logger.error({ error }, 'Uncaught exception, cleaning up services and notifying scheduler...');
  try {
    // 设置超时，确保即使清理失败也能退出
    const cleanupPromise = cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
    });
    await Promise.race([cleanupPromise, timeoutPromise]);
  } catch (cleanupError) {
    logger.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
    // 即使清理失败，也尝试通知调度服务器
    if (nodeAgent) {
      try {
        nodeAgent.stop();
      } catch (e) {
        // 忽略错误
      }
    }
  }
  // 清理 ESBuild 进程
  cleanupEsbuild();
  process.exit(1);
});

(process as any).on('unhandledRejection', async (reason: any, promise: Promise<any>) => {
  logger.error({ reason, promise }, 'Unhandled promise rejection, cleaning up services and notifying scheduler...');
  try {
    // 设置超时，确保即使清理失败也能退出
    const cleanupPromise = cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
    });
    await Promise.race([cleanupPromise, timeoutPromise]);
  } catch (cleanupError) {
    logger.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
    // 即使清理失败，也尝试通知调度服务器
    if (nodeAgent) {
      try {
        nodeAgent.stop();
      } catch (e) {
        // 忽略错误
      }
    }
  }
  // 清理 ESBuild 进程
  cleanupEsbuild();
  process.exit(1);
});

// 进程退出时的最后清理（确保 ESBuild 被清理）
process.on('exit', () => {
  cleanupEsbuild();
});

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
