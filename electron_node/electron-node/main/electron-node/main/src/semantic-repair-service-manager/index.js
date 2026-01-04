"use strict";
/**
 * Semantic Repair Service Manager
 * 管理语义修复服务的启动和停止
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
exports.SemanticRepairServiceManager = void 0;
const fs = __importStar(require("fs"));
const logger_1 = __importDefault(require("../logger"));
const service_starter_1 = require("./service-starter");
const service_stopper_1 = require("./service-stopper");
class SemanticRepairServiceManager {
    constructor(serviceRegistryManager, servicesDir) {
        this.serviceRegistryManager = serviceRegistryManager;
        this.servicesDir = servicesDir;
        this.services = new Map();
        this.statuses = new Map();
        // 启动队列：确保需要加载模型的服务串行启动，避免GPU内存过载
        this.startQueue = [];
        this.isProcessingQueue = false;
        // 初始化状态
        const serviceIds = ['en-normalize', 'semantic-repair-zh', 'semantic-repair-en'];
        for (const serviceId of serviceIds) {
            this.statuses.set(serviceId, {
                serviceId,
                running: false,
                starting: false,
                pid: null,
                port: null,
                startedAt: null,
                lastError: null,
            });
        }
    }
    /**
     * 处理启动队列（串行处理，避免GPU内存过载）
     */
    async processStartQueue() {
        if (this.isProcessingQueue || this.startQueue.length === 0) {
            return;
        }
        this.isProcessingQueue = true;
        while (this.startQueue.length > 0) {
            const { serviceId, resolve, reject } = this.startQueue.shift();
            try {
                // 对于需要加载模型的服务，等待前一个服务完全启动后再启动下一个
                const needsModel = serviceId === 'semantic-repair-zh' || serviceId === 'semantic-repair-en';
                if (needsModel) {
                    // 检查是否有其他模型服务正在启动
                    const otherModelServiceStarting = Array.from(this.statuses.values()).some(s => (s.serviceId === 'semantic-repair-zh' || s.serviceId === 'semantic-repair-en') &&
                        s.serviceId !== serviceId && s.starting);
                    if (otherModelServiceStarting) {
                        logger_1.default.info({ serviceId, reason: 'Waiting for other model service to finish loading' }, 'Delaying service start to avoid GPU overload');
                        // 等待其他服务完成启动（最多等待2分钟）
                        const maxWait = 120000; // 2分钟
                        const checkInterval = 2000; // 每2秒检查一次
                        const startTime = Date.now();
                        while (Date.now() - startTime < maxWait) {
                            const stillStarting = Array.from(this.statuses.values()).some(s => (s.serviceId === 'semantic-repair-zh' || s.serviceId === 'semantic-repair-en') &&
                                s.serviceId !== serviceId && s.starting);
                            if (!stillStarting) {
                                break;
                            }
                            await new Promise(resolve => setTimeout(resolve, checkInterval));
                        }
                    }
                }
                await this.startServiceInternal(serviceId);
                resolve();
            }
            catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        }
        this.isProcessingQueue = false;
    }
    /**
     * 启动服务（加入队列，串行处理）
     */
    async startService(serviceId) {
        if (this.services.has(serviceId)) {
            logger_1.default.warn({ serviceId }, 'Service is already running');
            return;
        }
        // 对于需要加载模型的服务，加入队列串行处理
        const needsModel = serviceId === 'semantic-repair-zh' || serviceId === 'semantic-repair-en';
        if (needsModel) {
            return new Promise((resolve, reject) => {
                this.startQueue.push({ serviceId, resolve, reject });
                this.processStartQueue().catch((error) => {
                    logger_1.default.error({ error }, 'Error processing start queue');
                });
            });
        }
        else {
            // 轻量级服务（en-normalize）直接启动
            return this.startServiceInternal(serviceId);
        }
    }
    /**
     * 内部启动服务实现
     */
    async startServiceInternal(serviceId) {
        // 更新状态为启动中
        this.updateStatus(serviceId, {
            starting: true,
            running: false,
            lastError: null,
        });
        let config;
        try {
            if (!this.serviceRegistryManager) {
                throw new Error('Service registry manager not initialized');
            }
            config = await (0, service_starter_1.getServiceConfig)(serviceId, this.serviceRegistryManager);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger_1.default.error({ error, serviceId }, 'Failed to get service config for starting');
            this.updateStatus(serviceId, { starting: false, lastError: errorMessage });
            throw error;
        }
        // 获取服务安装路径
        const current = this.serviceRegistryManager?.getCurrent(serviceId);
        if (!current || !current.install_path) {
            const error = `Service install path not found for ${serviceId}`;
            logger_1.default.error({ serviceId }, error);
            this.updateStatus(serviceId, { starting: false, lastError: error });
            throw new Error(error);
        }
        const workingDir = current.install_path;
        try {
            // 启动服务进程
            const serviceProcess = await (0, service_starter_1.startServiceProcess)(serviceId, config, workingDir, (updates) => this.updateStatus(serviceId, updates));
            // 设置进程引用
            this.services.set(serviceId, serviceProcess);
            // 等待服务就绪（通过健康检查）
            const isLightweightService = serviceId === 'en-normalize';
            try {
                await (0, service_starter_1.waitForServiceReady)(serviceId, config, isLightweightService, (updates) => this.updateStatus(serviceId, updates));
            }
            catch (error) {
                // 如果超时，检查进程是否还在运行
                if (serviceProcess.exitCode === null && !serviceProcess.killed) {
                    logger_1.default.warn({ serviceId }, 'Service health check timeout, but process is still running');
                    this.updateStatus(serviceId, {
                        starting: false,
                        running: true, // 假设服务已启动，但健康检查超时
                        startedAt: new Date(),
                    });
                }
                else {
                    throw new Error('Service failed to start within timeout period');
                }
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger_1.default.error({ error, serviceId }, 'Failed to start service');
            this.updateStatus(serviceId, {
                starting: false,
                running: false,
                lastError: errorMessage,
            });
            this.services.delete(serviceId);
            throw error;
        }
    }
    /**
     * 停止服务
     */
    async stopService(serviceId) {
        const process = this.services.get(serviceId);
        if (!process) {
            logger_1.default.warn({ serviceId }, 'Service is not running');
            return;
        }
        await (0, service_stopper_1.stopServiceProcess)(serviceId, process);
        this.services.delete(serviceId);
        this.updateStatus(serviceId, {
            running: false,
            starting: false,
            pid: null,
            startedAt: null,
            lastError: null,
        });
    }
    /**
     * 获取服务状态
     */
    getServiceStatus(serviceId) {
        const status = this.statuses.get(serviceId);
        if (status) {
            return status;
        }
        // 如果状态不存在，返回默认状态
        return {
            serviceId,
            running: false,
            starting: false,
            pid: null,
            port: null,
            startedAt: null,
            lastError: null,
        };
    }
    /**
     * 获取所有服务状态（只返回已安装的服务）
     */
    async getAllServiceStatuses() {
        if (!this.serviceRegistryManager) {
            return [];
        }
        try {
            await this.serviceRegistryManager.loadRegistry();
            const installed = this.serviceRegistryManager.listInstalled();
            // 只返回已安装的服务状态
            const installedServiceIds = new Set(installed
                .filter((s) => s.service_id === 'en-normalize' ||
                s.service_id === 'semantic-repair-zh' ||
                s.service_id === 'semantic-repair-en')
                .map((s) => s.service_id));
            // 更新端口信息（从service.json读取）
            const result = [];
            for (const serviceId of installedServiceIds) {
                // 确保状态已初始化（如果不存在则创建）
                if (!this.statuses.has(serviceId)) {
                    this.statuses.set(serviceId, {
                        serviceId,
                        running: false,
                        starting: false,
                        pid: null,
                        port: null,
                        startedAt: null,
                        lastError: null,
                    });
                }
                const status = this.statuses.get(serviceId);
                // 如果端口为null，尝试从service.json读取
                if (!status.port) {
                    const current = this.serviceRegistryManager.getCurrent(serviceId);
                    if (current && current.service_json_path) {
                        try {
                            const serviceJsonContent = fs.readFileSync(current.service_json_path, 'utf-8');
                            const serviceJson = JSON.parse(serviceJsonContent);
                            status.port = serviceJson.port;
                        }
                        catch (error) {
                            logger_1.default.debug({ error, serviceId }, 'Failed to read port from service.json');
                        }
                    }
                }
                // 创建状态副本以避免直接修改内部状态
                result.push({ ...status });
            }
            return result;
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get all semantic repair service statuses');
            return [];
        }
    }
    /**
     * 更新服务状态
     */
    updateStatus(serviceId, updates) {
        const current = this.statuses.get(serviceId);
        if (current) {
            this.statuses.set(serviceId, { ...current, ...updates });
        }
    }
    /**
     * 停止所有服务
     */
    async stopAllServices() {
        const serviceIds = Array.from(this.services.keys());
        await Promise.all(serviceIds.map((id) => this.stopService(id)));
    }
}
exports.SemanticRepairServiceManager = SemanticRepairServiceManager;
