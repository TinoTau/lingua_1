"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const node_agent_1 = require("./agent/node-agent");
const model_manager_1 = require("./model-manager/model-manager");
const inference_service_1 = require("./inference/inference-service");
let mainWindow = null;
let nodeAgent = null;
let modelManager = null;
let inferenceService = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(() => {
    createWindow();
    // 初始化服务
    modelManager = new model_manager_1.ModelManager();
    inferenceService = new inference_service_1.InferenceService(modelManager);
    nodeAgent = new node_agent_1.NodeAgent(inferenceService);
    // 启动 Node Agent
    nodeAgent.start().catch(console.error);
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // 清理资源
        nodeAgent?.stop();
        electron_1.app.quit();
    }
});
// IPC 处理
electron_1.ipcMain.handle('get-system-resources', async () => {
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
    }
    catch (error) {
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
async function getGpuUsage() {
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
            python.stdout.on('data', (data) => {
                output += data.toString();
            });
            python.on('close', (code) => {
                if (code === 0 && output.trim() !== 'ERROR') {
                    const [usage, memory] = output.trim().split(',').map(Number);
                    resolve({ usage, memory });
                }
                else {
                    resolve(null);
                }
            });
            python.on('error', () => {
                resolve(null);
            });
        });
    }
    catch {
        return null;
    }
}
electron_1.ipcMain.handle('get-installed-models', async () => {
    return modelManager?.getInstalledModels() || [];
});
electron_1.ipcMain.handle('get-available-models', async () => {
    return modelManager?.getAvailableModels() || [];
});
electron_1.ipcMain.handle('install-model', async (_, modelId) => {
    return modelManager?.installModel(modelId) || false;
});
electron_1.ipcMain.handle('uninstall-model', async (_, modelId) => {
    return modelManager?.uninstallModel(modelId) || false;
});
electron_1.ipcMain.handle('get-node-status', async () => {
    return nodeAgent?.getStatus() || { online: false, nodeId: null };
});
electron_1.ipcMain.handle('generate-pairing-code', async () => {
    return nodeAgent?.generatePairingCode() || null;
});
electron_1.ipcMain.handle('get-module-status', async () => {
    return inferenceService?.getModuleStatus() || {};
});
electron_1.ipcMain.handle('toggle-module', async (_, moduleName, enabled) => {
    if (!inferenceService)
        return false;
    try {
        if (enabled) {
            await inferenceService.enableModule(moduleName);
        }
        else {
            await inferenceService.disableModule(moduleName);
        }
        return true;
    }
    catch (error) {
        console.error('切换模块状态失败:', error);
        return false;
    }
});
