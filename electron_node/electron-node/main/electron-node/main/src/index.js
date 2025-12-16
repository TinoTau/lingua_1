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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const node_agent_1 = require("./agent/node-agent");
const model_manager_1 = require("./model-manager/model-manager");
const inference_service_1 = require("./inference/inference-service");
const rust_service_manager_1 = require("./rust-service-manager");
const python_service_manager_1 = require("./python-service-manager");
const node_config_1 = require("./node-config");
const logger_1 = __importDefault(require("./logger"));
let mainWindow = null;
let nodeAgent = null;
let modelManager = null;
let inferenceService = null;
let rustServiceManager = null;
let pythonServiceManager = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    if (isDev) {
        // 开发模式：尝试连接 Vite dev server（默认 5173，如果被占用可能在其他端口）
        const vitePort = process.env.VITE_PORT || '5173';
        const viteUrl = `http://localhost:${vitePort}`;
        logger_1.default.info({ viteUrl }, '开发模式：加载 Vite dev server');
        if (mainWindow) {
            mainWindow.loadURL(viteUrl).catch((error) => {
                logger_1.default.error({ error, viteUrl }, '加载 Vite dev server 失败，尝试备用端口');
                // 如果 5173 失败，尝试 5174（Vite 自动切换的端口）
                if (mainWindow) {
                    mainWindow.loadURL('http://localhost:5174').catch((err) => {
                        logger_1.default.error({ error: err }, '加载 Vite dev server 失败');
                    });
                }
            });
            mainWindow.webContents.openDevTools();
        }
    }
    else {
        // 生产模式：加载打包后的文件
        const distPath = path.join(__dirname, '../../renderer/dist/index.html');
        logger_1.default.info({ distPath }, '生产模式：加载打包文件');
        if (mainWindow) {
            mainWindow.loadFile(distPath).catch((error) => {
                logger_1.default.error({ error, distPath }, '加载打包文件失败');
            });
        }
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(async () => {
    createWindow();
    try {
        // 初始化服务管理器
        rustServiceManager = new rust_service_manager_1.RustServiceManager();
        pythonServiceManager = new python_service_manager_1.PythonServiceManager();
        // 初始化其他服务
        modelManager = new model_manager_1.ModelManager();
        inferenceService = new inference_service_1.InferenceService(modelManager);
        nodeAgent = new node_agent_1.NodeAgent(inferenceService, modelManager);
        // 根据用户上一次选择的功能自动启动对应服务
        const config = (0, node_config_1.loadNodeConfig)();
        const prefs = config.servicePreferences;
        logger_1.default.info({ prefs }, '服务管理器已初始化，按上次选择自动启动服务');
        // 按照偏好启动 Rust 推理服务（异步启动，不阻塞窗口显示）
        if (prefs.rustEnabled) {
            logger_1.default.info({}, '开始自动启动 Rust 推理服务...');
            rustServiceManager.start().catch((error) => {
                logger_1.default.error({ error }, '自动启动 Rust 推理服务失败');
            });
        }
        // 按照偏好启动 Python 服务（异步启动，不阻塞窗口显示）
        if (pythonServiceManager) {
            const toStart = [];
            if (prefs.nmtEnabled)
                toStart.push('nmt');
            if (prefs.ttsEnabled)
                toStart.push('tts');
            if (prefs.yourttsEnabled)
                toStart.push('yourtts');
            for (const name of toStart) {
                logger_1.default.info({ serviceName: name }, '开始自动启动 Python 服务...');
                pythonServiceManager.startService(name).catch((error) => {
                    logger_1.default.error({ error, serviceName: name }, '自动启动 Python 服务失败');
                });
            }
        }
    }
    catch (error) {
        logger_1.default.error({ error }, '初始化服务失败');
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// 统一的清理函数
async function cleanupServices() {
    logger_1.default.info({}, '正在关闭所有服务...');
    // 停止 Node Agent
    if (nodeAgent) {
        try {
            nodeAgent.stop();
        }
        catch (error) {
            logger_1.default.error({ error }, '停止 Node Agent 失败');
        }
    }
    // 停止 Rust 服务
    if (rustServiceManager) {
        try {
            await rustServiceManager.stop();
        }
        catch (error) {
            logger_1.default.error({ error }, '停止 Rust 服务失败');
        }
    }
    // 停止所有 Python 服务
    if (pythonServiceManager) {
        try {
            await pythonServiceManager.stopAllServices();
        }
        catch (error) {
            logger_1.default.error({ error }, '停止 Python 服务失败');
        }
    }
}
// 正常关闭窗口时清理服务
electron_1.app.on('window-all-closed', async () => {
    if (process.platform !== 'darwin') {
        await cleanupServices();
        electron_1.app.quit();
    }
});
// 在应用退出前确保清理（处理 macOS 等平台）
electron_1.app.on('before-quit', async (event) => {
    // 如果服务还在运行，阻止默认退出行为，先清理服务
    const rustRunning = rustServiceManager?.getStatus().running;
    const pythonRunning = pythonServiceManager?.getAllServiceStatuses().some(s => s.running);
    if (rustRunning || pythonRunning) {
        event.preventDefault();
        await cleanupServices();
        electron_1.app.quit();
    }
});
// 处理系统信号（SIGTERM, SIGINT）确保服务被清理
process.on('SIGTERM', async () => {
    logger_1.default.info({}, '收到 SIGTERM 信号，正在清理服务...');
    await cleanupServices();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.default.info({}, '收到 SIGINT 信号，正在清理服务...');
    await cleanupServices();
    process.exit(0);
});
// 处理未捕获的异常，确保服务被清理
process.on('uncaughtException', async (error) => {
    logger_1.default.error({ error }, '未捕获的异常，正在清理服务...');
    await cleanupServices();
    process.exit(1);
});
process.on('unhandledRejection', async (reason, promise) => {
    logger_1.default.error({ reason, promise }, '未处理的 Promise 拒绝，正在清理服务...');
    await cleanupServices();
    process.exit(1);
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
        logger_1.default.error({ error }, '获取系统资源失败');
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
// ===== 模型管理 IPC 接口 =====
electron_1.ipcMain.handle('get-installed-models', async () => {
    return modelManager?.getInstalledModels() || [];
});
electron_1.ipcMain.handle('get-available-models', async () => {
    return modelManager?.getAvailableModels() || [];
});
electron_1.ipcMain.handle('download-model', async (_, modelId, version) => {
    if (!modelManager)
        return false;
    try {
        await modelManager.downloadModel(modelId, version);
        return true;
    }
    catch (error) {
        logger_1.default.error({ error, modelId }, '下载模型失败');
        return false;
    }
});
electron_1.ipcMain.handle('uninstall-model', async (_, modelId, version) => {
    return modelManager?.uninstallModel(modelId, version) || false;
});
electron_1.ipcMain.handle('get-model-path', async (_, modelId, version) => {
    if (!modelManager)
        return null;
    try {
        return await modelManager.getModelPath(modelId, version);
    }
    catch (error) {
        logger_1.default.error({ error, modelId }, '获取模型路径失败');
        return null;
    }
});
electron_1.ipcMain.handle('get-model-ranking', async () => {
    try {
        const axios = require('axios');
        const modelHubUrl = process.env.MODEL_HUB_URL || 'http://localhost:5000';
        const response = await axios.get(`${modelHubUrl}/api/model-usage/ranking`);
        return response.data || [];
    }
    catch (error) {
        logger_1.default.error({ error }, '获取模型排行失败');
        return [];
    }
});
electron_1.ipcMain.handle('get-node-status', async () => {
    return nodeAgent?.getStatus() || { online: false, nodeId: null };
});
electron_1.ipcMain.handle('get-rust-service-status', async () => {
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
electron_1.ipcMain.handle('get-python-service-status', async (_, serviceName) => {
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
electron_1.ipcMain.handle('get-all-python-service-statuses', async () => {
    return pythonServiceManager?.getAllServiceStatuses() || [];
});
electron_1.ipcMain.handle('start-python-service', async (_, serviceName) => {
    if (!pythonServiceManager) {
        throw new Error('Python 服务管理器未初始化');
    }
    try {
        await pythonServiceManager.startService(serviceName);
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error, serviceName }, '启动 Python 服务失败');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('stop-python-service', async (_, serviceName) => {
    if (!pythonServiceManager) {
        throw new Error('Python 服务管理器未初始化');
    }
    try {
        await pythonServiceManager.stopService(serviceName);
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error, serviceName }, '停止 Python 服务失败');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// Rust 服务管理 IPC 接口
electron_1.ipcMain.handle('start-rust-service', async () => {
    if (!rustServiceManager) {
        throw new Error('Rust 服务管理器未初始化');
    }
    try {
        await rustServiceManager.start();
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error }, '启动 Rust 服务失败');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('stop-rust-service', async () => {
    if (!rustServiceManager) {
        throw new Error('Rust 服务管理器未初始化');
    }
    try {
        await rustServiceManager.stop();
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error }, '停止 Rust 服务失败');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// 根据已安装的模型自动启动所需服务
electron_1.ipcMain.handle('auto-start-services-by-models', async () => {
    if (!modelManager || !rustServiceManager || !pythonServiceManager) {
        return { success: false, error: '服务管理器未初始化' };
    }
    try {
        const installedModels = modelManager.getInstalledModels();
        const servicesToStart = [];
        // 检查是否需要启动各个服务
        const hasNmtModel = installedModels.some(m => m.modelId.includes('nmt') || m.modelId.includes('m2m'));
        const hasTtsModel = installedModels.some(m => m.modelId.includes('piper') || (m.modelId.includes('tts') && !m.modelId.includes('your')));
        const hasYourttsModel = installedModels.some(m => m.modelId.includes('yourtts') || m.modelId.includes('your_tts'));
        const hasAsrModel = installedModels.some(m => m.modelId.includes('asr') || m.modelId.includes('whisper'));
        if (hasNmtModel)
            servicesToStart.push('nmt');
        if (hasTtsModel)
            servicesToStart.push('tts');
        if (hasYourttsModel)
            servicesToStart.push('yourtts');
        if (hasAsrModel)
            servicesToStart.push('rust');
        // 启动服务
        const results = {};
        for (const service of servicesToStart) {
            try {
                if (service === 'rust') {
                    await rustServiceManager.start();
                }
                else {
                    await pythonServiceManager.startService(service);
                }
                results[service] = true;
            }
            catch (error) {
                logger_1.default.error({ error, service }, '自动启动服务失败');
                results[service] = false;
            }
        }
        return { success: true, results };
    }
    catch (error) {
        logger_1.default.error({ error }, '根据模型自动启动服务失败');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// 服务偏好设置（用于记住用户上一次选择的功能）
electron_1.ipcMain.handle('get-service-preferences', async () => {
    const config = (0, node_config_1.loadNodeConfig)();
    return config.servicePreferences;
});
electron_1.ipcMain.handle('set-service-preferences', async (_, prefs) => {
    try {
        const config = (0, node_config_1.loadNodeConfig)();
        config.servicePreferences = {
            ...config.servicePreferences,
            ...prefs,
        };
        (0, node_config_1.saveNodeConfig)(config);
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error }, '保存服务偏好失败');
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
});
electron_1.ipcMain.handle('generate-pairing-code', async () => {
    return nodeAgent?.generatePairingCode() || null;
});
// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
