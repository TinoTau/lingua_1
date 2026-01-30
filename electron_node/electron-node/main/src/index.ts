/**
 * ========================================
 * 🔧 Day 6 Hotfix: 注册 TypeScript 路径别名
 * ========================================
 * 问题：Day 6 将主进程输出从 main/ 改为 dist/main/，导致运行时无法解析 @shared/* 路径别名
 * 原因：TypeScript 编译器保留路径别名在 JS 代码中，但 Node.js 不知道如何解析
 * 解决：使用 tsconfig-paths 在运行时注册路径映射
 * 
 * 目录结构：
 *   electron_node/
 *     ├── electron-node/          <- baseUrl
 *     │   ├── dist/main/index.js  <- 编译后的入口
 *     │   └── tsconfig.main.json
 *     └── shared/                 <- @shared 指向这里
 * 
 * 配置说明：
 *   - baseUrl: electron-node/ (项目根目录)
 *   - paths: @shared/* -> ../shared/* (相对于 baseUrl)
 */

// 使用 require 确保在编译后立即执行，不会被提升
const tsConfigPaths = require('tsconfig-paths');
const pathModule = require('path');

// 编译后位置: dist/main/index.js (__dirname)
// baseUrl 应该指向 electron-node/ 根目录
const baseUrl = pathModule.resolve(__dirname, '../..');

tsConfigPaths.register({
  baseUrl: baseUrl,
  paths: {
    '@shared/*': ['../shared/*']  // 相对于 electron-node/，shared/ 在 ../shared/
  }
});
console.log('✅ TypeScript path aliases registered (baseUrl:', baseUrl + ')');

// ========================================

// ========================================
// 🔍 诊断钩子：捕获所有未处理的异常和退出
// ========================================
process.on("uncaughtException", (err) => {
  console.error("========================================");
  console.error("[FATAL] uncaughtException:", err);
  console.error("========================================");
});

process.on("unhandledRejection", (reason) => {
  console.error("========================================");
  console.error("[FATAL] unhandledRejection:", reason);
  console.error("========================================");
});

process.on("exit", (code) => {
  console.error("========================================");
  console.error("[TRACE] process.exit called, code =", code);
  console.error("========================================");
});

// 捕获主动退出调用
const realExit = process.exit;
(process as any).exit = function (code?: number) {
  console.error("========================================");
  console.error("[TRACE] process.exit invoked with code =", code);
  console.trace();
  console.error("========================================");
  return realExit.apply(process, [code]);
};
console.log("✅ Diagnostic hooks installed");
// ========================================

// ========================================
// 🔧 预先配置CUDA/cuDNN环境路径
// ========================================
// 在任何子进程启动前配置好PATH，确保ONNX Runtime能找到所有CUDA/cuDNN DLLs
import * as path from 'path';

const cudaPath = process.env.CUDA_PATH || 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4';
const cudnnBasePath = 'C:\\Program Files\\NVIDIA\\CUDNN\\v9.6\\bin';
const cudnnPath = path.join(cudnnBasePath, '12.6'); // cuDNN 9.6 for CUDA 12.6

// 将CUDA和cuDNN路径添加到PATH的最前面
const cudaPaths = [
  path.join(cudaPath, 'bin'),           // CUDA Runtime DLLs
  path.join(cudaPath, 'libnvvp'),       // CUDA profiler
  cudnnPath,                             // cuDNN 9.6 DLLs
  cudnnBasePath,                         // cuDNN base path
];

const existingPath = process.env.PATH || '';
const newPath = [...cudaPaths, existingPath].join(path.delimiter);
process.env.PATH = newPath;

console.log('✅ CUDA/cuDNN paths configured in PATH:');
cudaPaths.forEach(p => console.log(`   - ${p}`));
console.log('');
// ========================================

import { app, BrowserWindow, ipcMain } from 'electron';
import { createWindow, getMainWindow } from './window-manager';
import { checkDependenciesAndShowDialog } from './app/app-dependencies';
// 使用新的简化架构
import {
  initializeServicesSimple as initializeServices,
  loadAndValidateConfig,
  startServicesByPreference,
  ServiceManagers
} from './app/app-init-simple';
import { loadNodeConfig } from './node-config';
import { registerWindowAllClosedHandler, registerBeforeQuitHandler, registerProcessSignalHandlers, registerExceptionHandlers } from './app/app-lifecycle-simple';
import { registerModelHandlers } from './ipc-handlers/model-handlers';
import { getServiceRunner, getServiceRegistry } from './service-layer';
import logger from './logger';
import * as os from 'os';

let managers: ServiceManagers = {
  nodeAgent: null,
  modelManager: null,
  inferenceService: null,
  serviceRunner: null,
  endpointResolver: null,
};

/**
 * 注册系统资源相关的 IPC handlers
 * 参考备份代码，这些handlers在所有managers初始化后直接注册
 */
function registerSystemResourceHandlers(managers: ServiceManagers): void {
  // 系统资源监控
  ipcMain.handle('get-system-resources', async () => {
    try {
      logger.debug({}, 'Fetching system resources');
      const cpus = os.cpus();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();

      // CPU 使用率（简化计算）
      let totalIdle = 0;
      let totalTick = 0;
      cpus.forEach((cpu: any) => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      const cpuUsage = 100 - (totalIdle / totalTick * 100);

      // 内存使用率
      const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;

      // GPU 使用率（简化：当前RustServiceManager不提供实时GPU使用率）
      // 如果需要GPU使用率，可以使用 systeminformation 库或 nvidia-smi
      let gpuUsage: number | null = null;

      const result = {
        cpu: Math.min(Math.max(cpuUsage, 0), 100),
        memory: Math.min(Math.max(memoryUsage, 0), 100),
        gpu: gpuUsage,
      };

      logger.debug({ result }, 'System resources fetched');
      return result;
    } catch (error) {
      logger.error({ error }, 'Failed to fetch system resources');
      return {
        cpu: 0,
        memory: 0,
        gpu: null,
      };
    }
  });

  // 服务元数据（用于动态服务发现显示）
  ipcMain.handle('get-all-service-metadata', async () => {
    try {
      const registry = getServiceRegistry();
      if (!registry) {
        logger.warn({}, 'Service registry not available');
        return {};
      }

      const metadata: Record<string, any> = {};
      for (const [serviceId, entry] of registry.entries()) {
        metadata[serviceId] = {
          name: entry.def.name,
          name_zh: entry.def.name, // 可以从 service.json 扩展字段获取中文名
          type: entry.def.type,
          device: entry.def.device,
          version: entry.def.version,
          port: entry.def.port,
          deprecated: false, // 可以从 service.json 扩展字段获取
        };
      }

      logger.debug({ count: registry.size }, 'Service metadata retrieved');
      return metadata;
    } catch (error) {
      logger.error({ error }, 'Failed to get service metadata');
      return {};
    }
  });

  logger.info({}, 'System resource IPC handlers registered');
}

app.whenReady().then(async () => {
  console.log('\n========================================');
  console.log('🚀 Electron App Ready!');
  console.log('========================================\n');

  console.log('📍 Debug: Checking if packaged:', app.isPackaged);
  console.log('📍 Debug: NODE_ENV:', process.env.NODE_ENV || 'not set');

  // ✅ 开发模式：检查Vite是否运行（简单直接）
  // 如果 renderer/dist 已构建，或者 NODE_ENV=production，则跳过 Vite 检查（生产构建模式）
  const path = require('path');
  const fs = require('fs');
  const rendererDistPath = path.join(__dirname, '../../../renderer/dist');
  const rendererBuilt = fs.existsSync(rendererDistPath);
  const isProduction = process.env.NODE_ENV === 'production';

  // 只在开发环境且未构建时检查Vite
  // 生产环境（NODE_ENV=production）或已构建的renderer都不需要Vite
  if (!app.isPackaged && !rendererBuilt && !isProduction) {
    console.log('📍 Debug: Development mode, checking Vite...');
    try {
      await fetch('http://localhost:5173', { signal: AbortSignal.timeout(2000) });
      console.log('✅ Vite dev server is running');
    } catch (error) {
      console.error('📍 Debug: Vite check failed:', error);
      const { dialog } = require('electron');
      dialog.showErrorBox(
        '❌ 开发环境未就绪',
        '请先在另一个终端运行:\n\nnpm run dev\n\n等待Vite启动后，再运行 npm start'
      );
      app.quit();
      return;
    }
  } else {
    if (isProduction) {
      console.log('✅ Production mode (NODE_ENV=production), skipping Vite check');
    } else if (rendererBuilt) {
      console.log('✅ Renderer already built, skipping Vite check');
    } else if (app.isPackaged) {
      console.log('✅ App is packaged, skipping Vite check');
    }
  }

  console.log('📍 Debug: Proceeding to IPC handler registration...');

  // 🔧 立即注册所有IPC handlers（不依赖managers初始化）
  logger.info({}, '🚀 Registering all IPC handlers immediately...');
  console.log('🔧 Registering IPC handlers...');

  // 系统资源监控（包含GPU）
  ipcMain.handle('get-system-resources', async () => {
    try {
      const cpus = os.cpus();
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();

      let totalIdle = 0;
      let totalTick = 0;
      cpus.forEach((cpu: any) => {
        for (const type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });
      const cpuUsage = 100 - (totalIdle / totalTick * 100);
      const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;

      // 获取GPU使用率
      let gpuUsage: number | null = null;
      try {
        const { getGpuUsage } = await import('./system-resources');
        const gpuInfo = await getGpuUsage();
        gpuUsage = gpuInfo?.usage ?? null;
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

  // 节点状态
  ipcMain.handle('get-node-status', async () => {
    if (managers.nodeAgent) {
      return managers.nodeAgent.getStatus();
    }
    return {
      isOnline: false,
      schedulerConnected: false,
      nodeId: null,
    };
  });

  // 服务元数据
  ipcMain.handle('get-all-service-metadata', async () => {
    const registry = getServiceRegistry();
    if (!registry) {
      return {};
    }

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

  // 服务偏好设置
  ipcMain.handle('get-service-preferences', async () => {
    try {
      const config = loadNodeConfig();
      return config.servicePreferences || {};
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

  // Rust服务状态（使用新架构）
  ipcMain.handle('get-rust-service-status', async () => {
    if (!managers.serviceRunner) {
      return { running: false, starting: false, pid: null, port: null };
    }
    try {
      // 查找Rust类型的服务
      const registry = getServiceRegistry();
      if (!registry) {
        return { running: false, starting: false, pid: null, port: null };
      }
      const rustService = Array.from(registry.values()).find(e => e.def.type === 'rust');
      if (!rustService) {
        return { running: false, starting: false, pid: null, port: null };
      }
      const status = managers.serviceRunner.getStatus(rustService.def.id);
      return {
        running: status.status === 'running',
        starting: status.status === 'starting',
        pid: status.pid,
        port: status.port,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get Rust service status');
      return { running: false, starting: false, pid: null, port: null };
    }
  });

  // Python服务状态（使用新架构，支持ID格式转换）
  ipcMain.handle('get-python-service-status', async (_event, serviceName: string) => {
    if (!managers.serviceRunner) {
      return { name: serviceName, running: false, starting: false, pid: null, port: null };
    }
    try {
      // Day 5: 统一使用kebab-case，不再做命名转换
      const serviceId = serviceName;
      const status = managers.serviceRunner.getStatus(serviceId);
      return {
        name: status.name,
        running: status.status === 'running',
        starting: status.status === 'starting',
        pid: status.pid,
        port: status.port,
      };
    } catch (error) {
      logger.debug({ serviceName, error }, 'Service not found or error');
      return { name: serviceName, running: false, starting: false, pid: null, port: null };
    }
  });

  ipcMain.handle('get-all-python-service-statuses', async () => {
    if (!managers.serviceRunner) {
      return [];
    }
    try {
      // 查找所有Python类型的服务（排除rust和semantic-repair类型）
      const registry = getServiceRegistry();
      if (!registry) {
        return [];
      }
      // Python服务的type包括：'asr', 'nmt', 'tts', 'speaker-embedding'等
      // 排除：'rust', 'semantic-repair'
      const pythonServices = Array.from(registry.values()).filter(e =>
        e.def.type !== 'rust' && e.def.type !== 'semantic-repair'
      );
      // 转换serviceId到前端期望的格式
      const serviceIdToName: Record<string, string> = {
        'faster-whisper-vad': 'faster_whisper_vad',
        'nmt-m2m100': 'nmt',
        'piper-tts': 'tts',
        'your-tts': 'yourtts',
        'speaker-embedding': 'speaker_embedding',
      };
      return pythonServices.map(entry => {
        const status = managers.serviceRunner!.getStatus(entry.def.id);
        // 使用映射后的name，方便前端匹配
        const mappedName = serviceIdToName[entry.def.id] || entry.def.id;
        return {
          name: mappedName,
          running: status.status === 'running',
          starting: status.status === 'starting',
          pid: status.pid,
          port: status.port,
        };
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get all Python service statuses');
      return [];
    }
  });

  // 服务启动/停止（使用新架构，错误直接抛出）
  ipcMain.handle('start-rust-service', async () => {
    if (!managers.serviceRunner) {
      throw new Error('Service runner not initialized');
    }
    // 查找Rust服务
    const registry = getServiceRegistry();
    if (!registry) {
      throw new Error('Service registry not initialized');
    }
    const rustService = Array.from(registry.values()).find(e => e.def.type === 'rust');
    if (!rustService) {
      throw new Error('Rust service not found in registry');
    }

    logger.info({ serviceId: rustService.def.id }, 'IPC: Starting Rust service');
    await managers.serviceRunner.start(rustService.def.id);
    return { success: true };
  });

  ipcMain.handle('stop-rust-service', async () => {
    if (!managers.serviceRunner) {
      throw new Error('Service runner not initialized');
    }
    const registry = getServiceRegistry();
    if (!registry) {
      throw new Error('Service registry not initialized');
    }
    const rustService = Array.from(registry.values()).find(e => e.def.type === 'rust');
    if (!rustService) {
      throw new Error('Rust service not found in registry');
    }

    logger.info({ serviceId: rustService.def.id }, 'IPC: Stopping Rust service');
    await managers.serviceRunner.stop(rustService.def.id);
    return { success: true };
  });

  ipcMain.handle('start-python-service', async (_event, serviceName: string) => {
    if (!managers.serviceRunner) {
      throw new Error('Service runner not initialized');
    }

    // serviceName可能需要转换成实际的service ID
    // 支持多种命名格式：旧前端传的名字 -> service.json中的ID
    const serviceIdMap: Record<string, string> = {
      // 旧命名 -> 新ID
      'nmt': 'nmt-m2m100',
      'tts': 'piper-tts',
      'yourtts': 'your-tts',
      'faster_whisper_vad': 'faster-whisper-vad',
      'speaker_embedding': 'speaker-embedding',
      // 也支持已经转换好的ID
      'nmt-m2m100': 'nmt-m2m100',
      'piper-tts': 'piper-tts',
      'your-tts': 'your-tts',
      'faster-whisper-vad': 'faster-whisper-vad',
      'speaker-embedding': 'speaker-embedding',
    };

    // Day 5: 简化，直接使用映射表或原始名称（统一kebab-case）
    const serviceId = serviceIdMap[serviceName] || serviceName;

    const registry = getServiceRegistry();
    if (registry && !registry.has(serviceId)) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    logger.info({ serviceId }, 'IPC: Starting Python service');
    await managers.serviceRunner.start(serviceId);
    return { success: true };
  });

  ipcMain.handle('stop-python-service', async (_event, serviceName: string) => {
    if (!managers.serviceRunner) {
      throw new Error('Service runner not initialized');
    }

    // serviceName可能需要转换成实际的service ID（使用相同的映射表）
    const serviceIdMap: Record<string, string> = {
      'nmt': 'nmt-m2m100',
      'tts': 'piper-tts',
      'yourtts': 'your-tts',
      'faster_whisper_vad': 'faster-whisper-vad',
      'speaker_embedding': 'speaker-embedding',
      'nmt-m2m100': 'nmt-m2m100',
      'piper-tts': 'piper-tts',
      'your-tts': 'your-tts',
      'faster-whisper-vad': 'faster-whisper-vad',
      'speaker-embedding': 'speaker-embedding',
    };

    // Day 5: 简化，直接使用映射表或原始名称（统一kebab-case）
    const serviceId = serviceIdMap[serviceName] || serviceName;

    const registry = getServiceRegistry();
    if (registry && !registry.has(serviceId)) {
      throw new Error(`Service not found: ${serviceName}`);
    }

    logger.info({ serviceId }, 'IPC: Stopping Python service');
    await managers.serviceRunner.stop(serviceId);
    return { success: true };
  });

  // 处理指标（性能监控）- 临时stub，初始化后会被正确的handler替换
  ipcMain.handle('get-processing-metrics', async () => {
    return {
      currentJobs: 0,
      totalProcessed: 0,
      averageTime: 0,
      queueLength: 0,
    };
  });

  // 语义修复服务状态（使用全局registry）
  ipcMain.handle('get-all-semantic-repair-service-statuses', async () => {
    try {
      const registry = getServiceRegistry();
      if (!registry) {
        return [];
      }

      // 获取所有semantic类型的服务
      const allServices = Array.from(registry.values());
      const semanticServices = allServices.filter(e => e.def.type === 'semantic');

      return semanticServices.map(entry => ({
        serviceId: entry.def.id,
        running: entry.runtime.status === 'running',
        starting: entry.runtime.status === 'starting',
        pid: entry.runtime.pid || null,
        port: entry.def.port || null,
        startedAt: entry.runtime.startedAt || null,
        lastError: entry.runtime.lastError || null,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get all semantic repair service statuses');
      return [];
    }
  });

  // 启动语义修复服务
  ipcMain.handle('start-semantic-repair-service', async (_event, serviceId: string) => {
    if (!managers.serviceRunner) {
      throw new Error('Service runner not initialized');
    }

    logger.info({ serviceId }, 'IPC: Starting semantic repair service');
    await managers.serviceRunner.start(serviceId);
    return { success: true };
  });

  // 停止语义修复服务
  ipcMain.handle('stop-semantic-repair-service', async (_event, serviceId: string) => {
    if (!managers.serviceRunner) {
      throw new Error('Service runner not initialized');
    }

    logger.info({ serviceId }, 'IPC: Stopping semantic repair service');
    await managers.serviceRunner.stop(serviceId);
    return { success: true };
  });

  logger.info({}, '✅ All IPC handlers registered!');
  console.log('✅ All 14 IPC handlers registered!\n');

  console.log('📱 Creating main window...');
  createWindow();
  console.log('✅ Main window created!\n');

  // 等待窗口加载完成后检查系统依赖
  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      checkDependenciesAndShowDialog(mainWindow);
    });
  } else {
    setTimeout(() => {
      const window = getMainWindow();
      if (window) {
        checkDependenciesAndShowDialog(window);
      } else {
        checkDependenciesAndShowDialog(null);
      }
    }, 1000);
  }

  try {
    console.log('\n========================================');
    console.log('⚙️  Initializing service managers...');
    console.log('========================================\n');
    logger.info({}, '========================================');
    logger.info({}, '   使用新的简化服务层架构');
    logger.info({}, '========================================');

    // 初始化所有服务（简化版）
    console.log('🔄 Calling initializeServices()...');
    managers = await initializeServices();
    console.log('✅ initializeServices() completed!');
    console.log('   - serviceRunner:', !!managers.serviceRunner);
    console.log('   - endpointResolver:', !!managers.endpointResolver);
    console.log('   - modelManager:', !!managers.modelManager);
    console.log('   - inferenceService:', !!managers.inferenceService);
    console.log('   - nodeAgent:', !!managers.nodeAgent);

    // 加载并验证配置
    loadAndValidateConfig();

    // 启动服务（根据用户偏好）
    await startServicesByPreference(managers);

    // 注册 Model IPC 处理器
    registerModelHandlers(managers.modelManager);

    // ✅ 所有IPC handlers已在app.whenReady()中使用新架构注册

    logger.info({}, '✅ All service managers initialized successfully!');
    logger.info({
      serviceRunner: !!managers.serviceRunner,
      endpointResolver: !!managers.endpointResolver,
      modelManager: !!managers.modelManager,
      inferenceService: !!managers.inferenceService,
      nodeAgent: !!managers.nodeAgent,
    }, 'Managers status');

    // 启动 Node Agent（简化版）
    if (managers.nodeAgent) {
      managers.nodeAgent.start().catch((error) => {
        logger.error({ error }, 'Failed to start NodeAgent');
      });
    }

    logger.info({}, '========================================');
    logger.info({}, '   应用初始化完成（新架构）');
    logger.info({}, '========================================');
    console.log('\n========================================');
    console.log('🎉 Application initialized successfully!');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n❌ FATAL ERROR during initialization:');
    console.error(error);
    console.error('\n');
    logger.error({ error }, 'Failed to initialize services');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Day 5: 简化lifecycle，删除空的registerWindowCloseHandler
});

// 注册应用级生命周期事件处理器（使用新架构）
registerWindowAllClosedHandler(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

registerBeforeQuitHandler(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

registerProcessSignalHandlers(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

registerExceptionHandlers(
  managers.nodeAgent,
  null, // rustServiceManager - 不再使用
  null  // pythonServiceManager - 不再使用
);

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
