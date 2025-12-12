import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { NodeAgent } from './agent/node-agent';
import { ModelManager } from './model-manager/model-manager';
import { InferenceService } from './inference/inference-service';

let mainWindow: BrowserWindow | null = null;
let nodeAgent: NodeAgent | null = null;
let modelManager: ModelManager | null = null;
let inferenceService: InferenceService | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 开发环境加载 Vite 开发服务器，生产环境加载构建后的文件
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // 初始化服务
  modelManager = new ModelManager();
  inferenceService = new InferenceService(modelManager);
  nodeAgent = new NodeAgent(inferenceService);

  // 启动 Node Agent
  nodeAgent.start().catch(console.error);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 清理资源
    nodeAgent?.stop();
    app.quit();
  }
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
    console.error('获取系统资源失败:', error);
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
    console.error('下载模型失败:', error);
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
    console.error('获取模型路径失败:', error);
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
    console.error('获取模型排行失败:', error);
    return [];
  }
});


ipcMain.handle('get-node-status', async () => {
  return nodeAgent?.getStatus() || { online: false, nodeId: null };
});

ipcMain.handle('generate-pairing-code', async () => {
  return nodeAgent?.generatePairingCode() || null;
});

// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型

