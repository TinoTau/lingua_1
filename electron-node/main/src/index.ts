import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
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
  // TODO: 获取系统资源使用情况
  return {
    cpu: 0,
    gpu: null,
    memory: 0,
  };
});

ipcMain.handle('get-installed-models', async () => {
  return modelManager?.getInstalledModels() || [];
});

ipcMain.handle('get-available-models', async () => {
  return modelManager?.getAvailableModels() || [];
});

ipcMain.handle('install-model', async (_, modelId: string) => {
  return modelManager?.installModel(modelId) || false;
});

ipcMain.handle('uninstall-model', async (_, modelId: string) => {
  return modelManager?.uninstallModel(modelId) || false;
});

ipcMain.handle('get-node-status', async () => {
  return nodeAgent?.getStatus() || { online: false, nodeId: null };
});

ipcMain.handle('generate-pairing-code', async () => {
  return nodeAgent?.generatePairingCode() || null;
});

