"use strict";
/**
 * ServiceRuntimeManager - 服务运行时管理器
 *
 * 统一启动/停止服务进程（通过平台适配器）
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
exports.ServiceRuntimeManager = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../logger"));
const platform_adapter_1 = require("../platform-adapter");
const service_registry_1 = require("../service-registry");
const port_manager_1 = require("../utils/port-manager");
class ServiceRuntimeManager {
    constructor(servicesDir) {
        this.runningServices = new Map();
        this.serviceStatuses = new Map();
        this.platformAdapter = (0, platform_adapter_1.getPlatformAdapter)();
        this.registryManager = new service_registry_1.ServiceRegistryManager(servicesDir);
    }
    /**
     * 启动服务
     */
    async startService(serviceId) {
        const platform = this.platformAdapter.getPlatformId();
        // 检查是否已在运行
        if (this.runningServices.has(serviceId)) {
            logger_1.default.warn({ serviceId }, 'Service is already running');
            return;
        }
        // 1. 从 current.json 读取当前版本与平台路径
        const current = this.registryManager.getCurrent(serviceId);
        if (!current) {
            throw new Error(`Service not installed or activated: ${serviceId}`);
        }
        // 2. 读取 service.json → 选择 platforms[platformId]
        const serviceJsonPath = current.service_json_path;
        const serviceJson = await this.loadServiceJson(serviceJsonPath);
        const platformConfig = serviceJson.platforms[platform];
        if (!platformConfig) {
            throw new Error(`Platform config not found: ${platform} for service ${serviceId}`);
        }
        // 3. Node 分配可用端口（使用默认端口，如果被占用则查找下一个可用端口）
        let port = platformConfig.default_port;
        // 检查端口是否可用
        const portAvailable = await (0, port_manager_1.checkPortAvailable)(port);
        if (!portAvailable) {
            // 如果端口被占用，尝试查找下一个可用端口
            logger_1.default.warn({ port, serviceId }, 'Default port is in use, finding alternative port');
            for (let p = port + 1; p < port + 100; p++) {
                if (await (0, port_manager_1.checkPortAvailable)(p)) {
                    port = p;
                    logger_1.default.info({ port, serviceId }, 'Found alternative port');
                    break;
                }
            }
        }
        // 4. 注入 env
        const env = {
            ...process.env,
            SERVICE_PORT: String(port),
            MODEL_PATH: path.join(current.install_path, 'models'),
            SERVICE_ID: serviceId,
            SERVICE_VERSION: current.version,
        };
        // 5. PlatformAdapter.spawn(program, args, env, cwd)
        const execConfig = platformConfig.exec;
        const program = path.join(current.install_path, execConfig.program);
        const args = execConfig.args.map(arg => {
            // 替换路径变量
            return arg.replace('${cwd}', current.install_path);
        });
        const cwd = path.join(current.install_path, execConfig.cwd);
        this.updateStatus(serviceId, {
            service_id: serviceId,
            version: current.version,
            platform,
            running: false,
            starting: true,
            pid: null,
            port,
            startedAt: null,
            lastError: null,
        });
        try {
            const process = this.platformAdapter.spawn(program, args, {
                cwd,
                env,
                stdio: 'pipe',
            });
            // 处理进程事件
            process.on('error', (error) => {
                logger_1.default.error({ error, serviceId }, 'Service process error');
                this.updateStatus(serviceId, {
                    service_id: serviceId,
                    version: current.version,
                    platform,
                    running: false,
                    starting: false,
                    pid: null,
                    port,
                    startedAt: null,
                    lastError: error.message,
                });
                this.runningServices.delete(serviceId);
            });
            process.on('exit', (code, signal) => {
                logger_1.default.info({ serviceId, code, signal }, 'Service process exited');
                this.updateStatus(serviceId, {
                    service_id: serviceId,
                    version: current.version,
                    platform,
                    running: false,
                    starting: false,
                    pid: null,
                    port,
                    startedAt: null,
                    lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
                });
                this.runningServices.delete(serviceId);
            });
            this.runningServices.set(serviceId, process);
            // 6. 等待 health_check
            await this.waitForHealthCheck(serviceJson.health_check, port, serviceId);
            this.updateStatus(serviceId, {
                service_id: serviceId,
                version: current.version,
                platform,
                running: true,
                starting: false,
                pid: process.pid || null,
                port,
                startedAt: new Date(),
                lastError: null,
            });
            logger_1.default.info({ serviceId, pid: process.pid, port }, 'Service started successfully');
        }
        catch (error) {
            logger_1.default.error({ error, serviceId }, 'Failed to start service');
            this.updateStatus(serviceId, {
                service_id: serviceId,
                version: current.version,
                platform,
                running: false,
                starting: false,
                pid: null,
                port,
                startedAt: null,
                lastError: error instanceof Error ? error.message : String(error),
            });
            this.runningServices.delete(serviceId);
            throw error;
        }
    }
    /**
     * 停止服务
     */
    async stopService(serviceId) {
        const process = this.runningServices.get(serviceId);
        if (!process) {
            logger_1.default.info({ serviceId }, 'Service is not running');
            return;
        }
        const status = this.serviceStatuses.get(serviceId);
        const port = status?.port || null;
        try {
            // 先发送优雅停止（如果服务支持）
            // TODO: 发送 SIGTERM 或其他停止信号
            // 等待进程退出（最多等待 5 秒）
            const exitPromise = new Promise((resolve) => {
                process.once('exit', () => resolve());
            });
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => resolve(), 5000);
            });
            await Promise.race([exitPromise, timeoutPromise]);
            // 如果进程还在运行，强制 kill
            if (!process.killed && process.pid) {
                try {
                    process.kill('SIGKILL');
                }
                catch (error) {
                    logger_1.default.error({ error, serviceId }, 'Failed to kill service process');
                }
            }
            // 回收端口
            if (port) {
                await (0, port_manager_1.verifyPortReleased)(port);
            }
            this.runningServices.delete(serviceId);
            this.updateStatus(serviceId, {
                ...status,
                running: false,
                starting: false,
                pid: null,
                startedAt: null,
            });
            logger_1.default.info({ serviceId, port }, 'Service stopped');
        }
        catch (error) {
            logger_1.default.error({ error, serviceId }, 'Failed to stop service');
            throw error;
        }
    }
    /**
     * 获取服务状态
     */
    getServiceStatus(serviceId) {
        return this.serviceStatuses.get(serviceId) || null;
    }
    /**
     * 等待健康检查
     */
    async waitForHealthCheck(healthCheck, port, serviceId) {
        const startTime = Date.now();
        const gracePeriod = healthCheck.startup_grace_ms;
        const checkInterval = 500;
        const timeout = healthCheck.timeout_ms;
        return new Promise((resolve, reject) => {
            const checkHealth = async () => {
                const elapsed = Date.now() - startTime;
                if (elapsed > gracePeriod) {
                    reject(new Error(`Service health check timeout: ${serviceId} (grace period: ${gracePeriod}ms)`));
                    return;
                }
                try {
                    const endpoint = healthCheck.endpoint.startsWith('/')
                        ? healthCheck.endpoint
                        : `/${healthCheck.endpoint}`;
                    const response = await axios_1.default.get(`http://localhost:${port}${endpoint}`, {
                        timeout,
                        validateStatus: (status) => status < 500,
                    });
                    if (response.status < 400) {
                        logger_1.default.info({ serviceId, port, elapsed }, 'Service health check passed');
                        resolve();
                        return;
                    }
                }
                catch (error) {
                    // 连接错误是正常的（服务可能还在启动），继续等待
                    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                        // 继续等待
                    }
                    else {
                        logger_1.default.warn({ error, serviceId, port, elapsed }, 'Service health check error');
                    }
                }
                // 继续等待
                setTimeout(checkHealth, checkInterval);
            };
            checkHealth();
        });
    }
    /**
     * 加载 service.json
     */
    async loadServiceJson(serviceJsonPath) {
        try {
            const content = await fs.readFile(serviceJsonPath, 'utf-8');
            return JSON.parse(content);
        }
        catch (error) {
            logger_1.default.error({ error, serviceJsonPath }, 'Failed to load service.json');
            throw error;
        }
    }
    /**
     * 更新服务状态
     */
    updateStatus(serviceId, status) {
        this.serviceStatuses.set(serviceId, status);
    }
}
exports.ServiceRuntimeManager = ServiceRuntimeManager;
