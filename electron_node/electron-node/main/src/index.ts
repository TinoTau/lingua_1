import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { NodeAgent } from './agent/node-agent';
import { ModelManager } from './model-manager/model-manager';
import { InferenceService } from './inference/inference-service';
import { RustServiceManager } from './rust-service-manager';
import { PythonServiceManager } from './python-service-manager';
import { loadNodeConfig, saveNodeConfig, ServicePreferences } from './node-config';
import logger from './logger';

let mainWindow: BrowserWindow | null = null;
let nodeAgent: NodeAgent | null = null;
let modelManager: ModelManager | null = null;
let inferenceService: InferenceService | null = null;
let rustServiceManager: RustServiceManager | null = null;
let pythonServiceManager: PythonServiceManager | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 开发环境加载 Vite 开发服务器，生产环境加载构建后的文件
  // 判断开发环境：NODE_ENV=development 或 app.isPackaged=false
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // 开发模式：尝试连接 Vite dev server（默认 5173，如果被占用可能在其他端口）
    const vitePort = process.env.VITE_PORT || '5173';
    const viteUrl = `http://localhost:${vitePort}`;
    logger.info({ viteUrl }, '开发模式：加载 Vite dev server');
    if (mainWindow) {
      mainWindow.loadURL(viteUrl).catch((error) => {
        logger.error({ error, viteUrl }, '加载 Vite dev server 失败，尝试备用端口');
        // 如果 5173 失败，尝试 5174（Vite 自动切换的端口）
        if (mainWindow) {
          mainWindow.loadURL('http://localhost:5174').catch((err) => {
            logger.error({ error: err }, '加载 Vite dev server 失败');
          });
        }
      });
      mainWindow.webContents.openDevTools();
    }
  } else {
    // 生产模式：加载打包后的文件
    const distPath = path.join(__dirname, '../../renderer/dist/index.html');
    logger.info({ distPath }, '生产模式：加载打包文件');
    if (mainWindow) {
      mainWindow.loadFile(distPath).catch((error) => {
        logger.error({ error, distPath }, '加载打包文件失败');
      });
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createWindow();

  try {
    // 初始化服务管理器
    rustServiceManager = new RustServiceManager();
    pythonServiceManager = new PythonServiceManager();

    // 初始化其他服务
    modelManager = new ModelManager();
    inferenceService = new InferenceService(modelManager);
    nodeAgent = new NodeAgent(inferenceService, modelManager);

    // 根据用户上一次选择的功能自动启动对应服务
    const config = loadNodeConfig();
    const prefs = config.servicePreferences;

    logger.info({ prefs }, '服务管理器已初始化，按上次选择自动启动服务');

    // 按照偏好启动 Rust 推理服务（异步启动，不阻塞窗口显示）
    if (prefs.rustEnabled) {
      logger.info({}, '开始自动启动 Rust 推理服务...');
      rustServiceManager.start().catch((error) => {
        logger.error({ error }, '自动启动 Rust 推理服务失败');
      });
    }

    // 按照偏好启动 Python 服务（异步启动，不阻塞窗口显示）
    if (pythonServiceManager) {
      const toStart: Array<'nmt' | 'tts' | 'yourtts'> = [];
      if (prefs.nmtEnabled) toStart.push('nmt');
      if (prefs.ttsEnabled) toStart.push('tts');
      if (prefs.yourttsEnabled) toStart.push('yourtts');

      for (const name of toStart) {
        logger.info({ serviceName: name }, '开始自动启动 Python 服务...');
        pythonServiceManager.startService(name).catch((error) => {
          logger.error({ error, serviceName: name }, '自动启动 Python 服务失败');
        });
      }
    }
  } catch (error) {
    logger.error({ error }, '初始化服务失败');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 统一的清理函数
async function cleanupServices(): Promise<void> {
  logger.info({}, '正在关闭所有服务...');

  // 停止 Node Agent
  if (nodeAgent) {
    try {
      nodeAgent.stop();
    } catch (error) {
      logger.error({ error }, '停止 Node Agent 失败');
    }
  }

  // 停止 Rust 服务
  if (rustServiceManager) {
    try {
      await rustServiceManager.stop();
    } catch (error) {
      logger.error({ error }, '停止 Rust 服务失败');
    }
  }

  // 停止所有 Python 服务
  if (pythonServiceManager) {
    try {
      await pythonServiceManager.stopAllServices();
    } catch (error) {
      logger.error({ error }, '停止 Python 服务失败');
    }
  }
}

// 正常关闭窗口时清理服务
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    await cleanupServices();
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
    await cleanupServices();
    app.quit();
  }
});

// 处理系统信号（SIGTERM, SIGINT）确保服务被清理
process.on('SIGTERM', async () => {
  logger.info({}, '收到 SIGTERM 信号，正在清理服务...');
  await cleanupServices();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info({}, '收到 SIGINT 信号，正在清理服务...');
  await cleanupServices();
  process.exit(0);
});

// 处理未捕获的异常，确保服务被清理
process.on('uncaughtException', async (error) => {
  logger.error({ error }, '未捕获的异常，正在清理服务...');
  await cleanupServices();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  logger.error({ reason, promise }, '未处理的 Promise 拒绝，正在清理服务...');
  await cleanupServices();
  process.exit(1);
});

// IPC 处理
ipcMain.handle('get-system-resources', async () => {
  const si = require('systeminformation');

  try {
    const [cpu, mem, gpuInfo] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      getGpuUsage(), // 自定义函数获取 GPU 使用率
    ]);

    return {
      cpu: cpu.currentLoad || 0,
      gpu: gpuInfo?.usage || null,
      gpuMem: gpuInfo?.memory || null,
      memory: (mem.used / mem.total) * 100,
    };
  } catch (error) {
    logger.error({ error }, '获取系统资源失败');
    return {
      cpu: 0,
      gpu: null,
      gpuMem: null,
      memory: 0,
    };
  }
});

// 获取 GPU 使用率（使用 nvidia-ml-py）
async function getGpuUsage(): Promise<{ usage: number; memory: number } | null> {
  try {
    // 尝试使用 nvidia-ml-py（需要 Python 环境）
    const { spawn } = require('child_process');
    const pythonScript = `
import pynvml
try:
    pynvml.nvmlInit()
    handle = pynvml.nvmlDeviceGetHandleByIndex(0)
    util = pynvml.nvmlDeviceGetUtilizationRates(handle)
    mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
    print(f"{util.gpu},{mem_info.used / mem_info.total * 100}")
    pynvml.nvmlShutdown()
except:
    print("ERROR")
`;

    return new Promise((resolve) => {
      const python = spawn('python', ['-c', pythonScript]);
      let output = '';

      python.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      python.on('close', (code: number) => {
        if (code === 0 && output.trim() !== 'ERROR') {
          const [usage, memory] = output.trim().split(',').map(Number);
          resolve({ usage, memory });
        } else {
          resolve(null);
        }
      });

      python.on('error', () => {
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}

// ===== 模型管理 IPC 接口 =====

ipcMain.handle('get-installed-models', async () => {
  return modelManager?.getInstalledModels() || [];
});

ipcMain.handle('get-available-models', async () => {
  return modelManager?.getAvailableModels() || [];
});

ipcMain.handle('download-model', async (_, modelId: string, version?: string) => {
  if (!modelManager) return false;
  try {
    await modelManager.downloadModel(modelId, version);
    return true;
  } catch (error) {
    logger.error({ error, modelId }, '下载模型失败');
    return false;
  }
});

ipcMain.handle('uninstall-model', async (_, modelId: string, version?: string) => {
  return modelManager?.uninstallModel(modelId, version) || false;
});

ipcMain.handle('get-model-path', async (_, modelId: string, version?: string) => {
  if (!modelManager) return null;
  try {
    return await modelManager.getModelPath(modelId, version);
  } catch (error) {
    logger.error({ error, modelId }, '获取模型路径失败');
    return null;
  }
});

ipcMain.handle('get-model-ranking', async () => {
  try {
    const axios = require('axios');
    const modelHubUrl = process.env.MODEL_HUB_URL || 'http://localhost:5000';
    const response = await axios.get(`${modelHubUrl}/api/model-usage/ranking`);
    return response.data || [];
  } catch (error) {
    logger.error({ error }, '获取模型排行失败');
    return [];
  }
});


ipcMain.handle('get-node-status', async () => {
  return nodeAgent?.getStatus() || { online: false, nodeId: null };
});

ipcMain.handle('get-rust-service-status', async () => {
  return rustServiceManager?.getStatus() || {
    running: false,
    starting: false,
    pid: null,
    port: null,
    startedAt: null,
    lastError: null,
  };
});

// Python 服务管理 IPC 接口
ipcMain.handle('get-python-service-status', async (_, serviceName: 'nmt' | 'tts' | 'yourtts') => {
  return pythonServiceManager?.getServiceStatus(serviceName) || {
    name: serviceName,
    running: false,
    starting: false,
    pid: null,
    port: null,
    startedAt: null,
    lastError: null,
  };
});

ipcMain.handle('get-all-python-service-statuses', async () => {
  return pythonServiceManager?.getAllServiceStatuses() || [];
});

ipcMain.handle('start-python-service', async (_, serviceName: 'nmt' | 'tts' | 'yourtts') => {
  if (!pythonServiceManager) {
    throw new Error('Python 服务管理器未初始化');
  }
  try {
    await pythonServiceManager.startService(serviceName);
    return { success: true };
  } catch (error) {
    logger.error({ error, serviceName }, '启动 Python 服务失败');
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('stop-python-service', async (_, serviceName: 'nmt' | 'tts' | 'yourtts') => {
  if (!pythonServiceManager) {
    throw new Error('Python 服务管理器未初始化');
  }
  try {
    await pythonServiceManager.stopService(serviceName);
    return { success: true };
  } catch (error) {
    logger.error({ error, serviceName }, '停止 Python 服务失败');
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Rust 服务管理 IPC 接口
ipcMain.handle('start-rust-service', async () => {
  if (!rustServiceManager) {
    throw new Error('Rust 服务管理器未初始化');
  }
  try {
    await rustServiceManager.start();
    return { success: true };
  } catch (error) {
    logger.error({ error }, '启动 Rust 服务失败');
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('stop-rust-service', async () => {
  if (!rustServiceManager) {
    throw new Error('Rust 服务管理器未初始化');
  }
  try {
    await rustServiceManager.stop();
    return { success: true };
  } catch (error) {
    logger.error({ error }, '停止 Rust 服务失败');
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 根据已安装的模型自动启动所需服务
ipcMain.handle('auto-start-services-by-models', async () => {
  if (!modelManager || !rustServiceManager || !pythonServiceManager) {
    return { success: false, error: '服务管理器未初始化' };
  }

  try {
    const installedModels = modelManager.getInstalledModels();
    const servicesToStart: Array<'nmt' | 'tts' | 'yourtts' | 'rust'> = [];

    // 检查是否需要启动各个服务
    const hasNmtModel = installedModels.some(m =>
      m.modelId.includes('nmt') || m.modelId.includes('m2m')
    );
    const hasTtsModel = installedModels.some(m =>
      m.modelId.includes('piper') || (m.modelId.includes('tts') && !m.modelId.includes('your'))
    );
    const hasYourttsModel = installedModels.some(m =>
      m.modelId.includes('yourtts') || m.modelId.includes('your_tts')
    );
    const hasAsrModel = installedModels.some(m =>
      m.modelId.includes('asr') || m.modelId.includes('whisper')
    );

    if (hasNmtModel) servicesToStart.push('nmt');
    if (hasTtsModel) servicesToStart.push('tts');
    if (hasYourttsModel) servicesToStart.push('yourtts');
    if (hasAsrModel) servicesToStart.push('rust');

    // 启动服务
    const results: Record<string, boolean> = {};
    for (const service of servicesToStart) {
      try {
        if (service === 'rust') {
          await rustServiceManager.start();
        } else {
          await pythonServiceManager.startService(service);
        }
        results[service] = true;
      } catch (error) {
        logger.error({ error, service }, '自动启动服务失败');
        results[service] = false;
      }
    }

    return { success: true, results };
  } catch (error) {
    logger.error({ error }, '根据模型自动启动服务失败');
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// 服务偏好设置（用于记住用户上一次选择的功能）
ipcMain.handle('get-service-preferences', async (): Promise<ServicePreferences> => {
  const config = loadNodeConfig();
  return config.servicePreferences;
});

ipcMain.handle(
  'set-service-preferences',
  async (
    _,
    prefs: ServicePreferences,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const config = loadNodeConfig();
      config.servicePreferences = {
        ...config.servicePreferences,
        ...prefs,
      };
      saveNodeConfig(config);
      return { success: true };
    } catch (error) {
      logger.error({ error }, '保存服务偏好失败');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
);

ipcMain.handle('generate-pairing-code', async () => {
  return nodeAgent?.generatePairingCode() || null;
});

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型

