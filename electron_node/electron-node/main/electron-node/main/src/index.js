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
        minWidth: 800,
        minHeight: 600,
        resizable: true, // 允许窗口自由缩放
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
        logger_1.default.info({ viteUrl }, 'Development mode: Loading Vite dev server');
        if (mainWindow) {
            mainWindow.loadURL(viteUrl).catch((error) => {
                logger_1.default.error({ error, viteUrl }, 'Failed to load Vite dev server, trying fallback port');
                // 如果 5173 失败，尝试 5174（Vite 自动切换的端口）
                if (mainWindow) {
                    mainWindow.loadURL('http://localhost:5174').catch((err) => {
                        logger_1.default.error({ error: err }, 'Failed to load Vite dev server');
                    });
                }
            });
            mainWindow.webContents.openDevTools();
        }
    }
    else {
        // 生产模式：加载打包后的文件
        const distPath = path.join(__dirname, '../../renderer/dist/index.html');
        logger_1.default.info({ distPath }, 'Production mode: Loading built files');
        if (mainWindow) {
            mainWindow.loadFile(distPath).catch((error) => {
                logger_1.default.error({ error, distPath }, 'Failed to load built files');
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
        // 设置任务记录回调
        inferenceService.setOnTaskProcessedCallback((serviceName) => {
            if (serviceName === 'rust' && rustServiceManager) {
                rustServiceManager.incrementTaskCount();
            }
            else if (pythonServiceManager && (serviceName === 'nmt' || serviceName === 'tts' || serviceName === 'yourtts')) {
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
        nodeAgent = new node_agent_1.NodeAgent(inferenceService, modelManager);
        // 启动 Node Agent（连接到调度服务器）
        logger_1.default.info({}, 'Starting Node Agent (connecting to scheduler server)...');
        nodeAgent.start().catch((error) => {
            logger_1.default.error({ error }, 'Failed to start Node Agent');
        });
        // 根据用户上一次选择的功能自动启动对应服务
        const config = (0, node_config_1.loadNodeConfig)();
        const prefs = config.servicePreferences;
        logger_1.default.info({ prefs }, 'Service manager initialized, auto-starting services based on previous selection');
        // 按照偏好启动 Rust 推理服务（异步启动，不阻塞窗口显示）
        if (prefs.rustEnabled) {
            logger_1.default.info({}, 'Auto-starting Rust inference service...');
            rustServiceManager.start().catch((error) => {
                logger_1.default.error({ error }, 'Failed to auto-start Rust inference service');
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
                logger_1.default.info({ serviceName: name }, 'Auto-starting Python service...');
                pythonServiceManager.startService(name).catch((error) => {
                    logger_1.default.error({ error, serviceName: name }, 'Failed to auto-start Python service');
                });
            }
        }
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to initialize services');
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// 统一的清理函数
async function cleanupServices() {
    logger_1.default.info({}, '========================================');
    logger_1.default.info({}, 'Starting cleanup of all services...');
    logger_1.default.info({}, '========================================');
    // 记录当前运行的服务状态
    const rustStatus = rustServiceManager?.getStatus();
    const pythonStatuses = pythonServiceManager?.getAllServiceStatuses() || [];
    const runningPythonServices = pythonStatuses.filter(s => s.running);
    logger_1.default.info({
        rustRunning: rustStatus?.running,
        rustPort: rustStatus?.port,
        rustPid: rustStatus?.pid,
        pythonServices: runningPythonServices.map(s => ({
            name: s.name,
            port: s.port,
            pid: s.pid,
        })),
    }, `Current service status - Rust: ${rustStatus?.running ? `port ${rustStatus.port}, PID ${rustStatus.pid}` : 'not running'}, Python: ${runningPythonServices.length} service(s) running`);
    // 在清理服务前，保存当前服务状态到配置文件
    // 这样即使窗口意外关闭，下次启动时也能恢复服务状态
    try {
        const rustEnabled = !!rustStatus?.running;
        const nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
        const ttsEnabled = !!pythonStatuses.find(s => s.name === 'tts')?.running;
        const yourttsEnabled = !!pythonStatuses.find(s => s.name === 'yourtts')?.running;
        const config = (0, node_config_1.loadNodeConfig)();
        config.servicePreferences = {
            rustEnabled,
            nmtEnabled,
            ttsEnabled,
            yourttsEnabled,
        };
        (0, node_config_1.saveNodeConfig)(config);
        logger_1.default.info({ servicePreferences: config.servicePreferences }, 'Saved current service status to config file');
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to save service status to config file');
    }
    // 停止 Node Agent
    if (nodeAgent) {
        try {
            logger_1.default.info({}, 'Stopping Node Agent...');
            nodeAgent.stop();
            logger_1.default.info({}, 'Node Agent stopped');
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to stop Node Agent');
        }
    }
    // 停止 Rust 服务
    if (rustServiceManager) {
        try {
            const status = rustServiceManager.getStatus();
            if (status.running) {
                logger_1.default.info({ port: status.port, pid: status.pid }, `Stopping Rust service (port: ${status.port}, PID: ${status.pid})...`);
                await rustServiceManager.stop();
                logger_1.default.info({ port: status.port }, `Rust service stopped (port: ${status.port})`);
            }
            else {
                logger_1.default.info({}, 'Rust service is not running, no need to stop');
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to stop Rust service');
        }
    }
    // 停止所有 Python 服务
    if (pythonServiceManager) {
        try {
            logger_1.default.info({ count: runningPythonServices.length }, `Stopping all Python services (${runningPythonServices.length} service(s))...`);
            await pythonServiceManager.stopAllServices();
            logger_1.default.info({}, 'All Python services stopped');
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to stop Python services');
        }
    }
    logger_1.default.info({}, '========================================');
    logger_1.default.info({}, 'All services cleanup completed');
    logger_1.default.info({}, '========================================');
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
    logger_1.default.info({}, 'Received SIGTERM signal, cleaning up services...');
    await cleanupServices();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.default.info({}, 'Received SIGINT signal, cleaning up services...');
    await cleanupServices();
    process.exit(0);
});
// 处理未捕获的异常，确保服务被清理
process.on('uncaughtException', async (error) => {
    logger_1.default.error({ error }, 'Uncaught exception, cleaning up services...');
    await cleanupServices();
    process.exit(1);
});
process.on('unhandledRejection', async (reason, promise) => {
    logger_1.default.error({ reason, promise }, 'Unhandled promise rejection, cleaning up services...');
    await cleanupServices();
    process.exit(1);
});
// IPC 处理
electron_1.ipcMain.handle('get-system-resources', async () => {
    const si = require('systeminformation');
    try {
        logger_1.default.debug({}, 'Starting to fetch system resources');
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
        logger_1.default.info({ gpuInfo, result }, 'System resources fetched successfully');
        return result;
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to fetch system resources');
        return {
            cpu: 0,
            gpu: null,
            gpuMem: null,
            memory: 0,
        };
    }
});
// 获取 GPU 使用率（多种方法尝试）
async function getGpuUsage() {
    logger_1.default.info({}, 'Starting to fetch GPU usage');
    // 方法1: 尝试使用 nvidia-smi (Windows/Linux, 如果可用)
    try {
        logger_1.default.info({}, 'Attempting to fetch GPU info via nvidia-smi');
        const result = await getGpuUsageViaNvidiaSmi();
        if (result) {
            logger_1.default.info({ result }, 'Successfully fetched GPU info via nvidia-smi');
            return result;
        }
        logger_1.default.warn({}, 'nvidia-smi method returned no result');
    }
    catch (error) {
        logger_1.default.warn({ error }, 'nvidia-smi method failed, trying alternative');
    }
    // 方法2: 尝试使用 Python + pynvml
    try {
        logger_1.default.debug({}, 'Attempting to fetch GPU info via Python pynvml');
        const result = await getGpuUsageViaPython();
        if (result) {
            logger_1.default.info({ result }, 'Successfully fetched GPU info via Python pynvml');
            return result;
        }
        logger_1.default.debug({}, 'Python pynvml method returned no result');
    }
    catch (error) {
        logger_1.default.warn({ error }, 'Python pynvml method failed');
    }
    logger_1.default.warn({}, 'All GPU info fetch methods failed, GPU info will not be displayed');
    return null;
}
// 方法1: 使用 nvidia-smi 命令获取 GPU 信息
async function getGpuUsageViaNvidiaSmi() {
    return new Promise((resolve) => {
        const { spawn } = require('child_process');
        // nvidia-smi 命令：获取GPU利用率和内存使用率
        const nvidiaSmi = spawn('nvidia-smi', [
            '--query-gpu=utilization.gpu,memory.used,memory.total',
            '--format=csv,noheader,nounits'
        ]);
        let output = '';
        let errorOutput = '';
        nvidiaSmi.stdout.on('data', (data) => {
            output += data.toString();
        });
        nvidiaSmi.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });
        nvidiaSmi.on('close', (code) => {
            if (code === 0 && output.trim()) {
                try {
                    // 输出格式: "utilization.gpu, memory.used, memory.total"
                    const parts = output.trim().split(',');
                    logger_1.default.info({ code, output: output.trim(), parts }, 'nvidia-smi command executed successfully, starting to parse output');
                    if (parts.length >= 3) {
                        const usage = parseFloat(parts[0].trim());
                        const memUsed = parseFloat(parts[1].trim());
                        const memTotal = parseFloat(parts[2].trim());
                        const memPercent = (memUsed / memTotal) * 100;
                        logger_1.default.info({ usage, memUsed, memTotal, memPercent }, 'Parsed GPU info');
                        if (!isNaN(usage) && !isNaN(memPercent)) {
                            logger_1.default.info({ usage, memory: memPercent }, 'nvidia-smi successfully returned GPU usage');
                            resolve({ usage, memory: memPercent });
                            return;
                        }
                        else {
                            logger_1.default.warn({ usage, memPercent }, 'Parsed values are invalid (NaN)');
                        }
                    }
                    else {
                        logger_1.default.warn({ partsLength: parts.length, parts }, 'nvidia-smi output format incorrect, insufficient parts');
                    }
                }
                catch (parseError) {
                    logger_1.default.warn({ parseError, output }, 'Failed to parse nvidia-smi output');
                }
            }
            else {
                logger_1.default.warn({ code, output: output.trim(), errorOutput: errorOutput.trim() }, 'nvidia-smi command execution failed or output is empty');
            }
            resolve(null);
        });
        nvidiaSmi.on('error', (error) => {
            // nvidia-smi 命令不存在或无法执行
            logger_1.default.warn({ error: error.message }, 'nvidia-smi command execution error (command may not exist)');
            resolve(null);
        });
    });
}
// 方法2: 使用 Python + pynvml 获取 GPU 信息
async function getGpuUsageViaPython() {
    return new Promise((resolve) => {
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
except Exception as e:
    print("ERROR")
`;
        // 尝试 python3 或 python
        const pythonCommands = ['python3', 'python'];
        let currentIndex = 0;
        const tryNextPython = () => {
            if (currentIndex >= pythonCommands.length) {
                resolve(null);
                return;
            }
            const python = spawn(pythonCommands[currentIndex], ['-c', pythonScript]);
            let output = '';
            let errorOutput = '';
            python.stdout.on('data', (data) => {
                output += data.toString();
            });
            python.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            python.on('close', (code) => {
                if (code === 0 && output.trim() !== 'ERROR') {
                    try {
                        const [usage, memory] = output.trim().split(',').map(Number);
                        if (!isNaN(usage) && !isNaN(memory)) {
                            resolve({ usage, memory });
                            return;
                        }
                    }
                    catch (parseError) {
                        logger_1.default.warn({ parseError, output }, 'Failed to parse Python output');
                    }
                }
                // 当前命令失败，尝试下一个
                currentIndex++;
                tryNextPython();
            });
            python.on('error', () => {
                // 当前命令不存在，尝试下一个
                currentIndex++;
                tryNextPython();
            });
        };
        tryNextPython();
    });
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
        logger_1.default.error({ error, modelId }, 'Failed to download model');
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
        logger_1.default.error({ error, modelId }, 'Failed to get model path');
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
        logger_1.default.error({ error }, 'Failed to get model ranking');
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
        taskCount: 0,
        gpuUsageMs: 0,
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
        taskCount: 0,
        gpuUsageMs: 0,
    };
});
electron_1.ipcMain.handle('get-all-python-service-statuses', async () => {
    return pythonServiceManager?.getAllServiceStatuses() || [];
});
electron_1.ipcMain.handle('start-python-service', async (_, serviceName) => {
    if (!pythonServiceManager) {
        throw new Error('Python service manager not initialized');
    }
    try {
        await pythonServiceManager.startService(serviceName);
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error, serviceName }, 'Failed to start Python service');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('stop-python-service', async (_, serviceName) => {
    if (!pythonServiceManager) {
        throw new Error('Python service manager not initialized');
    }
    try {
        await pythonServiceManager.stopService(serviceName);
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error, serviceName }, 'Failed to stop Python service');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// Rust 服务管理 IPC 接口
electron_1.ipcMain.handle('start-rust-service', async () => {
    if (!rustServiceManager) {
        throw new Error('Rust service manager not initialized');
    }
    try {
        await rustServiceManager.start();
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to start Rust service');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('stop-rust-service', async () => {
    if (!rustServiceManager) {
        throw new Error('Rust service manager not initialized');
    }
    try {
        await rustServiceManager.stop();
        return { success: true };
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to stop Rust service');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// 根据已安装的模型自动启动所需服务
electron_1.ipcMain.handle('auto-start-services-by-models', async () => {
    if (!modelManager || !rustServiceManager || !pythonServiceManager) {
        return { success: false, error: 'Service manager not initialized' };
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
                logger_1.default.error({ error, service }, 'Failed to auto-start service');
                results[service] = false;
            }
        }
        return { success: true, results };
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to auto-start services based on models');
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
        logger_1.default.error({ error }, 'Failed to save service preferences');
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
