"use strict";
/**
 * 应用初始化模块
 * 负责初始化所有服务、加载配置、启动服务等
 */
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
exports.initializeServices = initializeServices;
exports.loadAndValidateConfig = loadAndValidateConfig;
exports.startServicesByPreference = startServicesByPreference;
exports.registerIpcHandlers = registerIpcHandlers;
exports.startNodeAgent = startNodeAgent;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const si = __importStar(require("systeminformation"));
const node_agent_1 = require("../agent/node-agent");
const model_manager_1 = require("../model-manager/model-manager");
const inference_service_1 = require("../inference/inference-service");
const rust_service_manager_1 = require("../rust-service-manager");
const python_service_manager_1 = require("../python-service-manager");
const service_registry_1 = require("../service-registry");
const service_package_manager_1 = require("../service-package-manager");
const semantic_repair_service_manager_1 = require("../semantic-repair-service-manager");
const node_config_1 = require("../node-config");
const system_resources_1 = require("../system-resources");
const model_handlers_1 = require("../ipc-handlers/model-handlers");
const service_handlers_1 = require("../ipc-handlers/service-handlers");
const service_cache_1 = require("../ipc-handlers/service-cache");
const runtime_handlers_1 = require("../ipc-handlers/runtime-handlers");
const logger_1 = __importDefault(require("../logger"));
/**
 * 初始化服务目录路径
 */
function initializeServicesDirectory() {
    if (process.env.SERVICES_DIR) {
        return process.env.SERVICES_DIR;
    }
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    if (isDev) {
        // 尝试找到项目根目录下的 electron_node/services
        let currentDir = __dirname;
        for (let i = 0; i < 10; i++) {
            const testPath = path.join(currentDir, 'services', 'installed.json');
            if (fs.existsSync(testPath)) {
                const projectServicesDir = path.join(currentDir, 'services');
                logger_1.default.info({ servicesDir: projectServicesDir }, 'Using project services directory (development mode)');
                return projectServicesDir;
            }
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    }
    // 回退到 userData/services
    const userData = electron_1.app.getPath('userData');
    return path.join(userData, 'services');
}
/**
 * 初始化所有服务
 */
async function initializeServices() {
    const managers = {
        nodeAgent: null,
        modelManager: null,
        inferenceService: null,
        rustServiceManager: null,
        pythonServiceManager: null,
        serviceRegistryManager: null,
        servicePackageManager: null,
        semanticRepairServiceManager: null,
    };
    // 初始化服务管理器
    managers.rustServiceManager = new rust_service_manager_1.RustServiceManager();
    managers.pythonServiceManager = new python_service_manager_1.PythonServiceManager();
    // 初始化服务注册表管理器
    const servicesDir = initializeServicesDirectory();
    logger_1.default.info({ servicesDir }, 'Initializing service registry manager');
    managers.serviceRegistryManager = new service_registry_1.ServiceRegistryManager(servicesDir);
    managers.servicePackageManager = new service_package_manager_1.ServicePackageManager(servicesDir);
    // 加载注册表
    try {
        const registry = await managers.serviceRegistryManager.loadRegistry();
        logger_1.default.info({
            servicesDir,
            registryPath: managers.serviceRegistryManager.registryPath,
            installedPath: managers.serviceRegistryManager.installedPath,
            installedCount: Object.keys(registry.installed).length,
            currentCount: Object.keys(registry.current).length,
        }, 'Service registry loaded successfully');
    }
    catch (error) {
        logger_1.default.warn({
            error: error.message,
            servicesDir,
            registryPath: managers.serviceRegistryManager.registryPath,
        }, 'Failed to load service registry, will use empty registry');
    }
    // 初始化语义修复服务管理器
    managers.semanticRepairServiceManager = new semantic_repair_service_manager_1.SemanticRepairServiceManager(managers.serviceRegistryManager, servicesDir);
    // 初始化其他服务
    managers.modelManager = new model_manager_1.ModelManager();
    managers.inferenceService = new inference_service_1.InferenceService(managers.modelManager, managers.pythonServiceManager, managers.rustServiceManager, managers.serviceRegistryManager, undefined, // aggregatorManager
    undefined, // aggregatorMiddleware
    managers.semanticRepairServiceManager);
    // 设置任务记录回调
    managers.inferenceService.setOnTaskProcessedCallback((serviceName) => {
        if (serviceName === 'pipeline') {
            // Pipeline 处理任务时，各个服务会分别处理，这里不需要单独计数
        }
    });
    // 设置任务开始/结束回调（用于GPU跟踪）
    managers.inferenceService.setOnTaskStartCallback(() => {
        if (managers.rustServiceManager) {
            managers.rustServiceManager.startGpuTracking();
        }
    });
    managers.inferenceService.setOnTaskEndCallback(() => {
        if (managers.rustServiceManager) {
            managers.rustServiceManager.stopGpuTracking();
        }
    });
    managers.nodeAgent = new node_agent_1.NodeAgent(managers.inferenceService, managers.modelManager, managers.serviceRegistryManager, managers.rustServiceManager, managers.pythonServiceManager, managers.semanticRepairServiceManager);
    return managers;
}
/**
 * 加载并验证配置文件
 */
function loadAndValidateConfig() {
    const configPath = path.join(electron_1.app.getPath('userData'), 'electron-node-config.json');
    const configExists = fs.existsSync(configPath);
    logger_1.default.info({
        configPath,
        configExists,
    }, 'Loading user service preferences from config file...');
    const config = (0, node_config_1.loadNodeConfig)();
    const prefs = config.servicePreferences;
    logger_1.default.info({
        configPath,
        servicePreferences: prefs,
        rustEnabled: prefs.rustEnabled,
        nmtEnabled: prefs.nmtEnabled,
        ttsEnabled: prefs.ttsEnabled,
        yourttsEnabled: prefs.yourttsEnabled,
        fasterWhisperVadEnabled: prefs.fasterWhisperVadEnabled,
        speakerEmbeddingEnabled: prefs.speakerEmbeddingEnabled,
        semanticRepairZhEnabled: prefs.semanticRepairZhEnabled,
        semanticRepairEnEnabled: prefs.semanticRepairEnEnabled,
        enNormalizeEnabled: prefs.enNormalizeEnabled,
        semanticRepairEnZhEnabled: prefs.semanticRepairEnZhEnabled,
    }, 'User service preferences loaded successfully');
    // 确保配置文件包含所有必需字段
    try {
        if (configExists) {
            const rawConfig = fs.readFileSync(configPath, 'utf-8');
            const parsedConfig = JSON.parse(rawConfig);
            if (parsedConfig && typeof parsedConfig === 'object' && !parsedConfig.servicePreferences) {
                logger_1.default.info({ configPath }, 'Config file missing servicePreferences, saving default configuration...');
                (0, node_config_1.saveNodeConfig)(config);
                logger_1.default.info({ servicePreferences: config.servicePreferences }, 'Default configuration saved');
            }
            else {
                logger_1.default.debug({ configPath }, 'Config file is valid and contains servicePreferences');
            }
        }
        else {
            logger_1.default.info({ configPath }, 'Config file not found (first launch), saving default configuration...');
            (0, node_config_1.saveNodeConfig)(config);
            logger_1.default.info({ servicePreferences: config.servicePreferences }, 'Default configuration saved');
        }
    }
    catch (error) {
        logger_1.default.warn({
            error,
            configPath,
            message: error instanceof Error ? error.message : String(error),
        }, 'Failed to check config file, using loaded config without saving (to avoid overwriting user preferences)');
    }
}
/**
 * 启动服务（根据用户偏好）
 */
async function startServicesByPreference(managers) {
    const config = (0, node_config_1.loadNodeConfig)();
    const prefs = config.servicePreferences;
    logger_1.default.info({
        servicePreferences: prefs,
        autoStartServices: {
            rust: prefs.rustEnabled,
            nmt: prefs.nmtEnabled,
            tts: prefs.ttsEnabled,
            yourtts: prefs.yourttsEnabled,
            fasterWhisperVad: prefs.fasterWhisperVadEnabled,
            speakerEmbedding: prefs.speakerEmbeddingEnabled,
            semanticRepairZh: prefs.semanticRepairZhEnabled,
            semanticRepairEn: prefs.semanticRepairEnEnabled,
            enNormalize: prefs.enNormalizeEnabled,
            semanticRepairEnZh: prefs.semanticRepairEnZhEnabled,
        },
    }, 'Service manager initialized, auto-starting services based on user preferences');
    // 启动 Rust 推理服务
    if (prefs.rustEnabled && managers.rustServiceManager) {
        logger_1.default.info({}, 'Auto-starting Rust inference service...');
        managers.rustServiceManager.start().catch((error) => {
            logger_1.default.error({ error }, 'Failed to auto-start Rust inference service');
        });
    }
    // 启动 Python 服务（串行启动，避免GPU内存过载）
    if (managers.pythonServiceManager) {
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
        (async () => {
            for (const name of toStart) {
                logger_1.default.info({ serviceName: name }, 'Auto-starting Python service...');
                try {
                    await managers.pythonServiceManager.startService(name);
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
    // 启动语义修复服务
    if (managers.semanticRepairServiceManager && managers.serviceRegistryManager) {
        (async () => {
            try {
                await managers.serviceRegistryManager.loadRegistry();
                const installed = managers.serviceRegistryManager.listInstalled();
                const config = (0, node_config_1.loadNodeConfig)();
                const prefs = config.servicePreferences || {};
                const semanticRepairServiceIds = [
                    'semantic-repair-zh',
                    'semantic-repair-en',
                    'en-normalize',
                ];
                const toStart = [];
                for (const service of installed) {
                    if (semanticRepairServiceIds.includes(service.service_id)) {
                        const serviceId = service.service_id;
                        let shouldStart = false;
                        if (serviceId === 'semantic-repair-zh') {
                            shouldStart = prefs.semanticRepairZhEnabled !== false;
                        }
                        else if (serviceId === 'semantic-repair-en') {
                            shouldStart = prefs.semanticRepairEnEnabled !== false;
                        }
                        else if (serviceId === 'en-normalize') {
                            shouldStart = prefs.enNormalizeEnabled !== false;
                        }
                        else if (serviceId === 'semantic-repair-en-zh') {
                            shouldStart = prefs.semanticRepairEnZhEnabled !== false;
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
                                        : serviceId === 'semantic-repair-en-zh'
                                            ? prefs.semanticRepairEnZhEnabled
                                            : prefs.enNormalizeEnabled,
                            }, 'Semantic repair service auto-start disabled by user preference');
                        }
                    }
                }
                const sortedToStart = toStart.sort((a, b) => {
                    if (a === 'en-normalize')
                        return -1;
                    if (b === 'en-normalize')
                        return 1;
                    return 0;
                });
                for (const serviceId of sortedToStart) {
                    logger_1.default.info({ serviceId }, 'Auto-starting semantic repair service...');
                    try {
                        await managers.semanticRepairServiceManager.startService(serviceId);
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
}
/**
 * 注册 IPC 处理器
 */
function registerIpcHandlers(managers) {
    (0, model_handlers_1.registerModelHandlers)(managers.modelManager);
    (0, service_handlers_1.registerServiceHandlers)(managers.serviceRegistryManager, managers.servicePackageManager, managers.rustServiceManager, managers.pythonServiceManager);
    (0, runtime_handlers_1.registerRuntimeHandlers)(managers.nodeAgent, managers.modelManager, managers.inferenceService, managers.rustServiceManager, managers.pythonServiceManager, managers.serviceRegistryManager, managers.semanticRepairServiceManager);
    // 注册系统资源 IPC 处理器
    electron_1.ipcMain.handle('get-system-resources', async () => {
        try {
            logger_1.default.debug({}, 'Starting to fetch system resources');
            const [cpu, mem, gpuInfo] = await Promise.all([
                si.currentLoad(),
                si.mem(),
                (0, system_resources_1.getGpuUsage)(),
            ]);
            const result = {
                cpu: cpu.currentLoad || 0,
                gpu: gpuInfo?.usage ?? null,
                gpuMem: gpuInfo?.memory ?? null,
                memory: (mem.used / mem.total) * 100,
            };
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
/**
 * 启动 Node Agent
 */
function startNodeAgent(managers) {
    if (!managers.nodeAgent) {
        return;
    }
    logger_1.default.info({}, 'Starting Node Agent (connecting to scheduler server)...');
    managers.nodeAgent.start().catch((error) => {
        logger_1.default.error({ error }, 'Failed to start Node Agent');
    });
    // 预加载服务列表和排行（异步，不阻塞启动）
    setTimeout(() => {
        (0, service_cache_1.preloadServiceData)().catch((error) => {
            logger_1.default.warn({ error }, 'Failed to preload service data, will retry on demand');
        });
    }, 2000);
}
