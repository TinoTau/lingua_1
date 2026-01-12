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
exports.PythonServiceManager = void 0;
const logger_1 = __importDefault(require("../logger"));
const gpu_tracker_1 = require("../utils/gpu-tracker");
const port_manager_1 = require("../utils/port-manager");
const python_service_config_1 = require("../utils/python-service-config");
const project_root_1 = require("./project-root");
const service_process_1 = require("./service-process");
const service_config_loader_1 = require("../utils/service-config-loader");
const path = __importStar(require("path"));
class PythonServiceManager {
    constructor() {
        this.services = new Map();
        this.statuses = new Map();
        this.taskCounts = new Map(); // 任务计数
        this.gpuTrackers = new Map(); // GPU 跟踪器
        this.projectRoot = '';
        this.onStatusChangeCallback = null; // 状态变化回调
        this.projectRoot = (0, project_root_1.findProjectRoot)();
    }
    /**
     * 注册服务状态变化回调
     * 当服务的 running 状态发生变化时，会调用此回调
     */
    setOnStatusChangeCallback(callback) {
        this.onStatusChangeCallback = callback;
    }
    /**
     * 获取服务配置（优先从 service.json 读取，否则使用硬编码配置）
     */
    async getServiceConfig(serviceName) {
        // 映射服务名称到 service_id
        const serviceIdMap = {
            nmt: 'nmt-m2m100',
            tts: 'piper-tts',
            yourtts: 'your-tts',
            speaker_embedding: 'speaker-embedding',
            faster_whisper_vad: 'faster-whisper-vad',
        };
        const serviceId = serviceIdMap[serviceName];
        // 尝试从 service.json 加载配置
        try {
            // 获取服务目录（userData/services 或项目目录）
            let servicesDir;
            try {
                // 尝试使用 electron app（如果可用）
                const { app } = require('electron');
                if (app && app.getPath) {
                    const userData = app.getPath('userData');
                    servicesDir = path.join(userData, 'services');
                }
                else {
                    // 如果没有 app，使用项目目录下的 services
                    servicesDir = path.join(this.projectRoot, 'electron_node', 'services');
                }
            }
            catch {
                // 如果 electron 不可用，使用项目目录
                servicesDir = path.join(this.projectRoot, 'electron_node', 'services');
            }
            const serviceConfig = await (0, service_config_loader_1.loadServiceConfigFromJson)(serviceId, servicesDir);
            if (serviceConfig) {
                logger_1.default.info({ serviceName, serviceId }, 'Using service.json configuration');
                // 转换为 PythonServiceConfig 格式
                const converted = (0, service_config_loader_1.convertToPythonServiceConfig)(serviceId, serviceConfig.platformConfig, serviceConfig.installPath, this.projectRoot);
                // 获取硬编码配置以补充缺失的字段（如 env、logDir 等）
                const fallbackConfig = (0, python_service_config_1.getPythonServiceConfig)(serviceName, this.projectRoot);
                if (fallbackConfig) {
                    // 合并配置：使用 service.json 的配置，但保留硬编码配置的其他字段
                    return {
                        ...fallbackConfig,
                        name: converted.name,
                        port: converted.port,
                        servicePath: converted.servicePath,
                        scriptPath: converted.scriptPath,
                        workingDir: converted.workingDir,
                    };
                }
            }
        }
        catch (error) {
            logger_1.default.debug({ error, serviceName }, 'Failed to load service.json, using fallback config');
        }
        // 回退到硬编码配置
        return (0, python_service_config_1.getPythonServiceConfig)(serviceName, this.projectRoot);
    }
    async startService(serviceName) {
        if (this.services.has(serviceName)) {
            logger_1.default.warn({ serviceName }, 'Service is already running');
            return;
        }
        let config = null;
        try {
            config = await this.getServiceConfig(serviceName);
            if (!config) {
                throw new Error(`Unknown service: ${serviceName}`);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger_1.default.error({
                error: {
                    message: errorMessage,
                    name: error instanceof Error ? error.name : typeof error,
                },
                serviceName,
            }, 'Failed to get service config');
            throw error;
        }
        // 设置启动中状态
        this.updateStatus(serviceName, {
            running: false,
            starting: true,
            pid: null,
            port: config.port,
            startedAt: null,
            lastError: null,
        });
        try {
            // 启动服务进程
            const process = await (0, service_process_1.startServiceProcess)(serviceName, config, {
                onProcessError: (error) => {
                    this.updateStatus(serviceName, {
                        running: false,
                        starting: false,
                        pid: null,
                        port: config.port,
                        startedAt: null,
                        lastError: error.message,
                    });
                    this.services.delete(serviceName);
                },
                onProcessExit: (code, signal) => {
                    this.updateStatus(serviceName, {
                        running: false,
                        starting: false,
                        pid: null,
                        port: config.port,
                        startedAt: null,
                        lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
                    });
                    this.services.delete(serviceName);
                },
            });
            this.services.set(serviceName, process);
            // 等待服务就绪
            await (0, service_process_1.waitForServiceReadyWithProcessCheck)(config.port, process, serviceName);
            // 初始化统计信息
            if (!this.taskCounts.has(serviceName)) {
                this.taskCounts.set(serviceName, 0);
            }
            // 初始化 GPU 跟踪器
            if (!this.gpuTrackers.has(serviceName)) {
                this.gpuTrackers.set(serviceName, new gpu_tracker_1.GpuUsageTracker());
            }
            this.updateStatus(serviceName, {
                running: true,
                starting: false,
                pid: process.pid || null,
                port: config.port,
                startedAt: new Date(),
                lastError: null,
            });
            // 注意：GPU跟踪不会在服务启动时开始，而是在第一个任务处理时才开始（在incrementTaskCount中）
            // 这样可以确保只有在有实际任务时才统计GPU使用时间
            logger_1.default.info({ serviceName, pid: process.pid, port: config.port }, 'Python service started');
        }
        catch (error) {
            // 记录详细的错误信息
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger_1.default.error({
                error: {
                    message: errorMessage,
                    stack: errorStack,
                    name: error instanceof Error ? error.name : typeof error,
                },
                serviceName,
                config: {
                    venvPath: config?.venvPath,
                    scriptPath: config?.scriptPath,
                    port: config?.port,
                },
            }, 'Failed to start Python service');
            this.updateStatus(serviceName, {
                running: false,
                starting: false,
                pid: null,
                port: config?.port || null,
                startedAt: null,
                lastError: errorMessage,
            });
            throw error;
        }
    }
    async stopService(serviceName) {
        const child = this.services.get(serviceName);
        if (!child) {
            const status = this.statuses.get(serviceName);
            logger_1.default.info({ serviceName, port: status?.port, running: status?.running }, 'Service is not running, no need to stop');
            return;
        }
        const status = this.statuses.get(serviceName);
        const port = status?.port || null;
        // 停止GPU使用时间跟踪并重置
        this.stopGpuTracking(serviceName);
        const tracker = this.gpuTrackers.get(serviceName);
        if (tracker) {
            tracker.reset();
        }
        await (0, service_process_1.stopServiceProcess)(serviceName, child, port);
        // 重置任务计数和GPU跟踪器（下次启动时从0开始）
        this.taskCounts.delete(serviceName);
        this.gpuTrackers.delete(serviceName);
        this.updateStatus(serviceName, {
            running: false,
            starting: false,
            pid: null,
            port: port,
            startedAt: null,
            lastError: null,
            taskCount: 0,
            gpuUsageMs: 0,
        });
        this.services.delete(serviceName);
    }
    async stopAllServices() {
        const serviceNames = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];
        // 记录当前运行的服务状态
        const runningServices = serviceNames
            .map((name) => {
            const status = this.statuses.get(name);
            return status?.running ? { name, port: status.port, pid: status.pid } : null;
        })
            .filter((s) => s !== null);
        logger_1.default.info({ runningServices, total: runningServices.length }, `Stopping all Python services (${runningServices.length} service(s) running)...`);
        await Promise.all(serviceNames.map((name) => this.stopService(name).catch((err) => {
            logger_1.default.error({ error: err, serviceName: name }, 'Failed to stop service');
        })));
        // 验证所有端口是否已释放
        const allPorts = runningServices.map((s) => s?.port).filter((p) => p !== null);
        if (allPorts.length > 0) {
            logger_1.default.info({ ports: allPorts }, `Verifying all service ports are released: ${allPorts.join(', ')}`);
            for (const port of allPorts) {
                // 等待一小段时间让端口完全释放
                await new Promise((resolve) => setTimeout(resolve, 500));
                await (0, port_manager_1.verifyPortReleased)(port, 'all');
            }
        }
        logger_1.default.info({}, 'All Python services stopped');
    }
    getServiceStatus(serviceName) {
        const status = this.statuses.get(serviceName);
        if (status) {
            // 更新统计信息
            const taskCount = this.taskCounts.get(serviceName) || 0;
            status.taskCount = taskCount;
            // 只有在有任务时才返回GPU使用时间，否则返回0
            if (taskCount > 0) {
                const tracker = this.gpuTrackers.get(serviceName);
                status.gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
            }
            else {
                status.gpuUsageMs = 0;
            }
        }
        return status || null;
    }
    getAllServiceStatuses() {
        return Array.from(this.statuses.values()).map((status) => {
            // 更新统计信息
            const taskCount = this.taskCounts.get(status.name) || 0;
            status.taskCount = taskCount;
            // 只有在有任务时才返回GPU使用时间，否则返回0
            if (taskCount > 0) {
                const tracker = this.gpuTrackers.get(status.name);
                status.gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
            }
            else {
                status.gpuUsageMs = 0;
            }
            return status;
        });
    }
    /**
     * 增加任务计数
     * 注意：GPU跟踪现在在任务路由时（routeASRTask/routeNMTTask/routeTTSTask）启动，
     * 而不是在这里启动，以确保能够捕获整个任务期间的 GPU 使用
     */
    incrementTaskCount(serviceName) {
        const current = this.taskCounts.get(serviceName) || 0;
        const newCount = current + 1;
        this.taskCounts.set(serviceName, newCount);
        // GPU 跟踪现在在任务路由时启动，这里不再启动
        // 但确保跟踪器已创建（如果还没有创建）
        if (current === 0 && !this.gpuTrackers.has(serviceName)) {
            // 创建跟踪器但不启动（将在任务路由时启动）
            this.gpuTrackers.set(serviceName, new gpu_tracker_1.GpuUsageTracker());
            logger_1.default.debug({ serviceName }, 'Created GPU tracker for service (will be started when task routes)');
        }
        const status = this.statuses.get(serviceName);
        if (status) {
            status.taskCount = newCount;
        }
    }
    /**
     * 开始跟踪GPU使用时间
     */
    startGpuTracking(serviceName) {
        let tracker = this.gpuTrackers.get(serviceName);
        if (!tracker) {
            tracker = new gpu_tracker_1.GpuUsageTracker();
            this.gpuTrackers.set(serviceName, tracker);
        }
        tracker.startTracking();
    }
    /**
     * 停止跟踪GPU使用时间
     */
    stopGpuTracking(serviceName) {
        const tracker = this.gpuTrackers.get(serviceName);
        if (tracker) {
            tracker.stopTracking();
        }
    }
    updateStatus(serviceName, status) {
        const current = this.statuses.get(serviceName);
        const taskCount = this.taskCounts.get(serviceName) || 0;
        // 获取GPU使用时间（无论是否有任务，都返回累计值）
        // 注意：如果跟踪器未启动，getGpuUsageMs() 会返回 0
        const tracker = this.gpuTrackers.get(serviceName);
        const gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
        // 检查 running 状态是否发生变化
        const previousRunning = current?.running ?? false;
        const newRunning = status.running !== undefined ? status.running : (current?.running ?? false);
        // 合并状态，确保统计信息不被覆盖
        const mergedStatus = {
            name: serviceName,
            running: false,
            starting: false,
            pid: null,
            port: null,
            startedAt: null,
            lastError: null,
            taskCount: 0,
            gpuUsageMs: 0,
            ...current,
            ...status,
        };
        // 如果status中没有指定taskCount和gpuUsageMs，使用当前值
        if (status.taskCount === undefined) {
            mergedStatus.taskCount = current?.taskCount ?? taskCount;
        }
        if (status.gpuUsageMs === undefined) {
            // 只有在有任务时才使用GPU使用时间，否则保持为0
            mergedStatus.gpuUsageMs = (taskCount > 0) ? (current?.gpuUsageMs ?? gpuUsageMs) : 0;
        }
        this.statuses.set(serviceName, mergedStatus);
        // 如果 running 状态发生变化，触发回调
        if (previousRunning !== newRunning && this.onStatusChangeCallback) {
            try {
                this.onStatusChangeCallback(serviceName, mergedStatus);
            }
            catch (error) {
                logger_1.default.error({ error, serviceName }, 'Error in onStatusChangeCallback');
            }
        }
    }
}
exports.PythonServiceManager = PythonServiceManager;
