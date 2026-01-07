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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const si = __importStar(require("systeminformation"));
const node_agent_1 = require("./agent/node-agent");
const model_manager_1 = require("./model-manager/model-manager");
const inference_service_1 = require("./inference/inference-service");
const rust_service_manager_1 = require("./rust-service-manager");
const python_service_manager_1 = require("./python-service-manager");
const service_registry_1 = require("./service-registry");
const service_package_manager_1 = require("./service-package-manager");
const node_config_1 = require("./node-config");
const logger_1 = __importDefault(require("./logger"));
const window_manager_1 = require("./window-manager");
const service_cleanup_1 = require("./service-cleanup");
const system_resources_1 = require("./system-resources");
const esbuild_cleanup_1 = require("./utils/esbuild-cleanup");
const model_handlers_1 = require("./ipc-handlers/model-handlers");
const service_handlers_1 = require("./ipc-handlers/service-handlers");
const service_cache_1 = require("./ipc-handlers/service-cache");
const runtime_handlers_1 = require("./ipc-handlers/runtime-handlers");
const dependency_checker_1 = require("./utils/dependency-checker");
const semantic_repair_service_manager_1 = require("./semantic-repair-service-manager");
let nodeAgent = null;
let modelManager = null;
let inferenceService = null;
let rustServiceManager = null;
let pythonServiceManager = null;
let serviceRegistryManager = null;
let servicePackageManager = null;
let semanticRepairServiceManager = null;
/**
 * 检查依赖并显示对话框
 */
function checkDependenciesAndShowDialog(mainWindow) {
    try {
        const dependencies = (0, dependency_checker_1.checkAllDependencies)();
        const { valid, missing } = (0, dependency_checker_1.validateRequiredDependencies)();
        if (!valid) {
            logger_1.default.error({ missing }, 'Required dependencies are missing');
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
                    }
                    else if (dep.name === 'ffmpeg') {
                        installGuide = '• ffmpeg\n  Windows: 下载 https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip\n  解压到 C:\\ffmpeg，并将 C:\\ffmpeg\\bin 添加到系统 PATH';
                    }
                    return `${dep.name}:\n  ${dep.message}\n  ${installGuide}`;
                })
                    .join('\n\n') +
                '\n\n详细安装指南请查看：electron_node/electron-node/docs/DEPENDENCY_INSTALLATION.md';
            // 显示错误对话框
            if (mainWindow) {
                electron_1.dialog.showMessageBox(mainWindow, {
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
                        electron_1.shell.openPath(docPath).catch(() => {
                            // 如果文件不存在，打开包含文档的目录
                            electron_1.shell.openPath(path.dirname(docPath));
                        });
                    }
                }).catch((error) => {
                    logger_1.default.error({ error }, 'Failed to show dependency error dialog');
                });
            }
            else {
                // 如果窗口不存在，输出到控制台
                console.error('缺少必需的依赖：', missing);
                console.error(message);
            }
            // 注意：不阻止应用启动，但依赖缺失可能导致服务无法正常工作
            logger_1.default.warn('应用将继续启动，但某些功能可能无法正常工作');
        }
        else {
            logger_1.default.info('所有必需依赖已安装');
        }
    }
    catch (error) {
        logger_1.default.error({ error }, '依赖检查失败，继续启动应用');
    }
}
electron_1.app.whenReady().then(async () => {
    (0, window_manager_1.createWindow)();
    // 等待窗口加载完成后检查系统依赖
    const mainWindow = (0, window_manager_1.getMainWindow)();
    if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => {
            // 检查系统依赖
            checkDependenciesAndShowDialog(mainWindow);
        });
    }
    else {
        // 如果窗口创建失败，延迟检查
        setTimeout(() => {
            const window = (0, window_manager_1.getMainWindow)();
            if (window) {
                checkDependenciesAndShowDialog(window);
            }
            else {
                // 如果窗口仍然不存在，只记录日志
                checkDependenciesAndShowDialog(null);
            }
        }, 1000);
    }
    try {
        // 初始化服务管理器
        rustServiceManager = new rust_service_manager_1.RustServiceManager();
        pythonServiceManager = new python_service_manager_1.PythonServiceManager();
        // 初始化服务注册表管理器
        // 服务目录路径：优先使用环境变量或项目目录，否则使用 userData/services
        let servicesDir;
        if (process.env.SERVICES_DIR) {
            // 从环境变量读取
            servicesDir = process.env.SERVICES_DIR;
        }
        else {
            // 开发环境：尝试使用项目目录下的 services 文件夹
            const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
            if (isDev) {
                // 尝试找到项目根目录下的 electron_node/services
                // 从当前文件向上查找，直到找到包含 services/installed.json 的目录
                let currentDir = __dirname;
                let projectServicesDir = null;
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
                logger_1.default.info({
                    __dirname,
                    projectServicesDir,
                    found: projectServicesDir !== null
                }, 'Checking project services directory');
                if (projectServicesDir && fs.existsSync(projectServicesDir)) {
                    servicesDir = projectServicesDir;
                    logger_1.default.info({ servicesDir }, 'Using project services directory (development mode)');
                }
                else {
                    // 回退到 userData/services
                    const userData = electron_1.app.getPath('userData');
                    servicesDir = path.join(userData, 'services');
                }
            }
            else {
                // 生产环境：使用 userData/services
                const userData = electron_1.app.getPath('userData');
                servicesDir = path.join(userData, 'services');
            }
        }
        logger_1.default.info({ servicesDir }, 'Initializing service registry manager');
        serviceRegistryManager = new service_registry_1.ServiceRegistryManager(servicesDir);
        // 初始化服务包管理器
        servicePackageManager = new service_package_manager_1.ServicePackageManager(servicesDir);
        // 加载注册表
        try {
            const registry = await serviceRegistryManager.loadRegistry();
            logger_1.default.info({
                servicesDir,
                registryPath: serviceRegistryManager.registryPath,
                installedPath: serviceRegistryManager.installedPath,
                installedCount: Object.keys(registry.installed).length,
                currentCount: Object.keys(registry.current).length
            }, 'Service registry loaded successfully'); // 已在service-registry中降低为debug级别，这里保留info用于初始化日志
        }
        catch (error) {
            logger_1.default.warn({
                error: error.message,
                servicesDir,
                registryPath: serviceRegistryManager.registryPath
            }, 'Failed to load service registry, will use empty registry');
        }
        // 初始化其他服务
        modelManager = new model_manager_1.ModelManager();
        inferenceService = new inference_service_1.InferenceService(modelManager, pythonServiceManager, rustServiceManager, serviceRegistryManager);
        // 设置任务记录回调
        inferenceService.setOnTaskProcessedCallback((serviceName) => {
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
        nodeAgent = new node_agent_1.NodeAgent(inferenceService, modelManager, serviceRegistryManager, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
        // 启动 Node Agent（连接到调度服务器）
        logger_1.default.info({}, 'Starting Node Agent (connecting to scheduler server)...');
        nodeAgent.start().catch((error) => {
            logger_1.default.error({ error }, 'Failed to start Node Agent');
        });
        // 预加载服务列表和排行（异步，不阻塞启动）
        // 延迟2秒后开始预加载，给调度服务器一些时间启动
        setTimeout(() => {
            (0, service_cache_1.preloadServiceData)().catch((error) => {
                logger_1.default.warn({ error }, 'Failed to preload service data, will retry on demand');
            });
        }, 2000);
        // 根据用户上一次选择的功能自动启动对应服务
        const config = (0, node_config_1.loadNodeConfig)();
        const prefs = config.servicePreferences;
        // 确保配置文件包含所有必需字段（首次启动时补齐缺失字段）
        // 检查配置文件中是否缺少 servicePreferences 字段（通过读取原始文件检查）
        try {
            const configPath = require('path').join(require('electron').app.getPath('userData'), 'electron-node-config.json');
            if (require('fs').existsSync(configPath)) {
                const rawConfig = require('fs').readFileSync(configPath, 'utf-8');
                const parsedConfig = JSON.parse(rawConfig);
                if (!parsedConfig.servicePreferences) {
                    logger_1.default.info({}, 'Config file missing servicePreferences, saving default configuration...');
                    (0, node_config_1.saveNodeConfig)(config);
                }
            }
        }
        catch (error) {
            // 忽略检查错误，继续启动
            logger_1.default.debug({ error }, 'Failed to check config file for missing fields');
        }
        logger_1.default.info({ prefs }, 'Service manager initialized, auto-starting services based on previous selection');
        // 按照偏好启动 Rust 推理服务（异步启动，不阻塞窗口显示）
        if (prefs.rustEnabled) {
            logger_1.default.info({}, 'Auto-starting Rust inference service...');
            rustServiceManager.start().catch((error) => {
                logger_1.default.error({ error }, 'Failed to auto-start Rust inference service');
            });
        }
        // 按照偏好启动 Python 服务（串行启动，避免GPU内存过载）
        if (pythonServiceManager) {
            const toStart = [];
            if (prefs.fasterWhisperVadEnabled)
                toStart.push('faster_whisper_vad');
            if (prefs.nmtEnabled)
                toStart.push('nmt');
            if (prefs.ttsEnabled)
                toStart.push('tts');
            if (prefs.yourttsEnabled)
                toStart.push('yourtts');
            if (prefs.speakerEmbeddingEnabled)
                toStart.push('speaker_embedding');
            // 串行启动服务，等待每个服务完全启动后再启动下一个（避免GPU内存过载）
            // 使用异步函数避免阻塞窗口显示
            (async () => {
                for (const name of toStart) {
                    logger_1.default.info({ serviceName: name }, 'Auto-starting Python service...');
                    try {
                        await pythonServiceManager.startService(name);
                        logger_1.default.info({ serviceName: name }, 'Python service started successfully');
                    }
                    catch (error) {
                        logger_1.default.error({ error, serviceName: name }, 'Failed to auto-start Python service');
                    }
                }
            })().catch((error) => {
                logger_1.default.error({ error }, 'Failed to start Python services');
            });
        }
        // 注册所有 IPC 处理器
        (0, model_handlers_1.registerModelHandlers)(modelManager);
        (0, service_handlers_1.registerServiceHandlers)(serviceRegistryManager, servicePackageManager, rustServiceManager, pythonServiceManager);
        // 初始化语义修复服务管理器
        semanticRepairServiceManager = new semantic_repair_service_manager_1.SemanticRepairServiceManager(serviceRegistryManager, servicesDir);
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
                    const config = (0, node_config_1.loadNodeConfig)();
                    const prefs = config.servicePreferences || {};
                    // 检查已安装的语义修复服务，并根据用户偏好决定是否启动
                    const semanticRepairServiceIds = [
                        'semantic-repair-zh',
                        'semantic-repair-en',
                        'en-normalize',
                    ];
                    const toStart = [];
                    for (const service of installed) {
                        if (semanticRepairServiceIds.includes(service.service_id)) {
                            const serviceId = service.service_id;
                            // 根据用户偏好决定是否启动
                            let shouldStart = false;
                            if (serviceId === 'semantic-repair-zh') {
                                // 如果用户偏好未设置，默认启用（向后兼容）
                                shouldStart = prefs.semanticRepairZhEnabled !== false;
                            }
                            else if (serviceId === 'semantic-repair-en') {
                                shouldStart = prefs.semanticRepairEnEnabled !== false;
                            }
                            else if (serviceId === 'en-normalize') {
                                shouldStart = prefs.enNormalizeEnabled !== false;
                            }
                            if (shouldStart) {
                                toStart.push(serviceId);
                            }
                            else {
                                logger_1.default.debug({
                                    serviceId,
                                    preference: serviceId === 'semantic-repair-zh'
                                        ? prefs.semanticRepairZhEnabled
                                        : serviceId === 'semantic-repair-en'
                                            ? prefs.semanticRepairEnEnabled
                                            : prefs.enNormalizeEnabled
                                }, 'Semantic repair service auto-start disabled by user preference');
                            }
                        }
                    }
                    // 串行启动语义修复服务（避免GPU内存过载）
                    // 注意：en-normalize是轻量级服务，可以优先启动
                    // semantic-repair-zh和semantic-repair-en需要加载模型，启动较慢
                    const sortedToStart = toStart.sort((a, b) => {
                        // en-normalize优先
                        if (a === 'en-normalize')
                            return -1;
                        if (b === 'en-normalize')
                            return 1;
                        return 0;
                    });
                    for (const serviceId of sortedToStart) {
                        logger_1.default.info({ serviceId }, 'Auto-starting semantic repair service...');
                        try {
                            await semanticRepairServiceManager.startService(serviceId);
                            logger_1.default.info({ serviceId }, 'Semantic repair service started successfully');
                        }
                        catch (error) {
                            logger_1.default.error({ error, serviceId }, 'Failed to auto-start semantic repair service');
                        }
                    }
                }
                catch (error) {
                    logger_1.default.error({ error }, 'Failed to auto-start semantic repair services');
                }
            })().catch((error) => {
                logger_1.default.error({ error }, 'Failed to start semantic repair services');
            });
        }
        (0, runtime_handlers_1.registerRuntimeHandlers)(nodeAgent, modelManager, inferenceService, rustServiceManager, pythonServiceManager, serviceRegistryManager, semanticRepairServiceManager);
        // 注册系统资源 IPC 处理器
        electron_1.ipcMain.handle('get-system-resources', async () => {
            try {
                logger_1.default.debug({}, 'Starting to fetch system resources');
                const [cpu, mem, gpuInfo] = await Promise.all([
                    si.currentLoad(),
                    si.mem(),
                    (0, system_resources_1.getGpuUsage)(), // 自定义函数获取 GPU 使用率
                ]);
                const result = {
                    cpu: cpu.currentLoad || 0,
                    gpu: gpuInfo?.usage ?? null,
                    gpuMem: gpuInfo?.memory ?? null,
                    memory: (mem.used / mem.total) * 100,
                };
                // 降低系统资源获取日志级别为debug，减少终端输出
                logger_1.default.debug({ gpuInfo, result }, 'System resources fetched successfully');
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
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to initialize services');
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            (0, window_manager_1.createWindow)();
        }
    });
});
// 正常关闭窗口时清理服务
electron_1.app.on('window-all-closed', async () => {
    if (process.platform !== 'darwin') {
        await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
        // 清理 ESBuild 进程
        (0, esbuild_cleanup_1.cleanupEsbuild)();
        electron_1.app.quit();
    }
});
// 在应用退出前确保清理（处理 macOS 等平台）
electron_1.app.on('before-quit', async (event) => {
    // 如果服务还在运行，阻止默认退出行为，先清理服务
    const rustRunning = rustServiceManager?.getStatus().running;
    const pythonRunning = pythonServiceManager?.getAllServiceStatuses().some(s => s.running);
    const semanticRepairRunning = semanticRepairServiceManager ? (await semanticRepairServiceManager.getAllServiceStatuses()).some((s) => s.running) : false;
    if (rustRunning || pythonRunning || semanticRepairRunning) {
        event.preventDefault();
        await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
        // 清理 ESBuild 进程
        (0, esbuild_cleanup_1.cleanupEsbuild)();
        electron_1.app.quit();
    }
    else {
        // 即使服务没有运行，也要保存当前服务状态（以便下次启动时恢复）
        // 这样用户关闭应用时，即使所有服务都已停止，也能记住用户的选择
        try {
            const pythonStatuses = pythonServiceManager?.getAllServiceStatuses() || [];
            const semanticRepairStatuses = semanticRepairServiceManager
                ? await semanticRepairServiceManager.getAllServiceStatuses()
                : [];
            const config = (0, node_config_1.loadNodeConfig)();
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
            (0, node_config_1.saveNodeConfig)(config);
            logger_1.default.info({ servicePreferences: config.servicePreferences }, 'Saved current service status to config file (no services running)');
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to save service status to config file');
        }
        // 清理 ESBuild 进程
        (0, esbuild_cleanup_1.cleanupEsbuild)();
    }
});
// 处理系统信号（SIGTERM, SIGINT）确保服务被清理
// 注意：使用 (process as any) 因为 Electron 的 process 类型定义只包含 'loaded' 事件，
// 但运行时实际支持 Node.js 的所有 process 事件（SIGTERM, SIGINT 等）
process.on('SIGTERM', async () => {
    logger_1.default.info({}, 'Received SIGTERM signal, cleaning up services and notifying scheduler...');
    try {
        await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    }
    catch (error) {
        logger_1.default.error({ error }, 'Cleanup failed, but attempting to notify scheduler');
        if (nodeAgent) {
            try {
                nodeAgent.stop();
            }
            catch (e) {
                // 忽略错误
            }
        }
    }
    // 清理 ESBuild 进程
    (0, esbuild_cleanup_1.cleanupEsbuild)();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.default.info({}, 'Received SIGINT signal, cleaning up services and notifying scheduler...');
    try {
        await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    }
    catch (error) {
        logger_1.default.error({ error }, 'Cleanup failed, but attempting to notify scheduler');
        if (nodeAgent) {
            try {
                nodeAgent.stop();
            }
            catch (e) {
                // 忽略错误
            }
        }
    }
    // 清理 ESBuild 进程
    (0, esbuild_cleanup_1.cleanupEsbuild)();
    process.exit(0);
});
// 处理未捕获的异常，确保服务被清理
process.on('uncaughtException', async (error) => {
    logger_1.default.error({ error }, 'Uncaught exception, cleaning up services and notifying scheduler...');
    try {
        // 设置超时，确保即使清理失败也能退出
        const cleanupPromise = (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
        });
        await Promise.race([cleanupPromise, timeoutPromise]);
    }
    catch (cleanupError) {
        logger_1.default.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
        // 即使清理失败，也尝试通知调度服务器
        if (nodeAgent) {
            try {
                nodeAgent.stop();
            }
            catch (e) {
                // 忽略错误
            }
        }
    }
    // 清理 ESBuild 进程
    (0, esbuild_cleanup_1.cleanupEsbuild)();
    process.exit(1);
});
process.on('unhandledRejection', async (reason, promise) => {
    logger_1.default.error({ reason, promise }, 'Unhandled promise rejection, cleaning up services and notifying scheduler...');
    try {
        // 设置超时，确保即使清理失败也能退出
        const cleanupPromise = (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
        });
        await Promise.race([cleanupPromise, timeoutPromise]);
    }
    catch (cleanupError) {
        logger_1.default.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
        // 即使清理失败，也尝试通知调度服务器
        if (nodeAgent) {
            try {
                nodeAgent.stop();
            }
            catch (e) {
                // 忽略错误
            }
        }
    }
    // 清理 ESBuild 进程
    (0, esbuild_cleanup_1.cleanupEsbuild)();
    process.exit(1);
});
// 进程退出时的最后清理（确保 ESBuild 被清理）
process.on('exit', () => {
    (0, esbuild_cleanup_1.cleanupEsbuild)();
});
// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
