"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
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
const model_handlers_1 = require("./ipc-handlers/model-handlers");
const service_handlers_1 = require("./ipc-handlers/service-handlers");
const service_cache_1 = require("./ipc-handlers/service-cache");
const runtime_handlers_1 = require("./ipc-handlers/runtime-handlers");
let nodeAgent = null;
let modelManager = null;
let inferenceService = null;
let rustServiceManager = null;
let pythonServiceManager = null;
let serviceRegistryManager = null;
let servicePackageManager = null;
electron_1.app.whenReady().then(async () => {
    (0, window_manager_1.createWindow)();
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
                const fs = require('fs');
                const path = require('path');
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
                const path = require('path');
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
            }, 'Service registry loaded successfully');
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
        nodeAgent = new node_agent_1.NodeAgent(inferenceService, modelManager, serviceRegistryManager);
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
        // 注册所有 IPC 处理器
        (0, model_handlers_1.registerModelHandlers)(modelManager);
        (0, service_handlers_1.registerServiceHandlers)(serviceRegistryManager, servicePackageManager, rustServiceManager, pythonServiceManager);
        (0, runtime_handlers_1.registerRuntimeHandlers)(nodeAgent, modelManager, rustServiceManager, pythonServiceManager);
        // 注册系统资源 IPC 处理器
        electron_1.ipcMain.handle('get-system-resources', async () => {
            const si = require('systeminformation');
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
        await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager);
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
        await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager);
        electron_1.app.quit();
    }
});
// 处理系统信号（SIGTERM, SIGINT）确保服务被清理
// 注意：使用 (process as any) 因为 Electron 的 process 类型定义只包含 'loaded' 事件，
// 但运行时实际支持 Node.js 的所有 process 事件（SIGTERM, SIGINT 等）
process.on('SIGTERM', async () => {
    logger_1.default.info({}, 'Received SIGTERM signal, cleaning up services...');
    await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager);
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.default.info({}, 'Received SIGINT signal, cleaning up services...');
    await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager);
    process.exit(0);
});
// 处理未捕获的异常，确保服务被清理
process.on('uncaughtException', async (error) => {
    logger_1.default.error({ error }, 'Uncaught exception, cleaning up services...');
    await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager);
    process.exit(1);
});
process.on('unhandledRejection', async (reason, promise) => {
    logger_1.default.error({ reason, promise }, 'Unhandled promise rejection, cleaning up services...');
    await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager);
    process.exit(1);
});
// 注意：模块管理 IPC 已移除
// 模块现在根据任务请求中的 features 自动启用/禁用，不需要手动管理
// 如果需要查看模块状态，可以通过模型管理界面查看已安装的模型
