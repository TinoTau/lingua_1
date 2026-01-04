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
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = __importDefault(require("../logger"));
const port_manager_1 = require("../utils/port-manager");
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
     * 获取服务配置（从service.json）
     */
    async getServiceConfig(serviceId) {
        if (!this.serviceRegistryManager) {
            throw new Error('Service registry manager not initialized');
        }
        try {
            await this.serviceRegistryManager.loadRegistry();
            const current = this.serviceRegistryManager.getCurrent(serviceId);
            if (!current || !current.install_path) {
                throw new Error(`Service ${serviceId} not found or not installed`);
            }
            // 从install_path构建service.json路径
            const serviceJsonPath = path.join(current.install_path, 'service.json');
            if (!fs.existsSync(serviceJsonPath)) {
                throw new Error(`service.json not found for ${serviceId} at ${serviceJsonPath}`);
            }
            const serviceJsonContent = fs.readFileSync(serviceJsonPath, 'utf-8');
            const serviceJson = JSON.parse(serviceJsonContent);
            logger_1.default.debug({ serviceId, serviceJsonPath, port: serviceJson.port }, 'Loaded service config');
            return serviceJson;
        }
        catch (error) {
            logger_1.default.error({ error, serviceId }, 'Failed to load service config');
            throw error;
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
            config = await this.getServiceConfig(serviceId);
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
            // 检查端口是否可用
            const portAvailable = await (0, port_manager_1.checkPortAvailable)(config.port);
            if (!portAvailable) {
                logger_1.default.warn({ serviceId, port: config.port }, `Port ${config.port} is already in use, attempting to cleanup...`);
                await (0, port_manager_1.cleanupPortProcesses)(config.port, serviceId);
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            // 构建启动命令
            // 尝试查找Python可执行文件（优先使用python3，然后是python）
            let command = config.startup_command || 'python';
            if (command === 'python') {
                // 尝试查找python3或python.exe
                try {
                    const { execSync } = require('child_process');
                    try {
                        execSync('python3 --version', { stdio: 'ignore' });
                        command = 'python3';
                    }
                    catch {
                        try {
                            execSync('python --version', { stdio: 'ignore' });
                            command = 'python';
                        }
                        catch {
                            // 如果都找不到，尝试python.exe（Windows）
                            if (process.platform === 'win32') {
                                command = 'python.exe';
                            }
                        }
                    }
                }
                catch (error) {
                    logger_1.default.warn({ error, serviceId }, 'Failed to detect Python, using default: python');
                }
            }
            const args = config.startup_args || [];
            // 确保工作目录正确
            logger_1.default.info({ serviceId, command, args, workingDir, port: config.port }, 'Starting semantic repair service with command');
            // 设置环境变量
            const envVars = {
                ...process.env,
                PORT: config.port.toString(),
                HOST: '127.0.0.1',
            };
            // 启动进程
            logger_1.default.info({ serviceId, command, args, workingDir, port: config.port }, 'Starting semantic repair service');
            const serviceProcess = (0, child_process_1.spawn)(command, args, {
                env: envVars,
                cwd: workingDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
            });
            // 处理输出（使用更详细的日志级别以便调试）
            serviceProcess.stdout?.on('data', (data) => {
                const text = data.toString('utf8');
                // 输出到控制台以便调试
                console.log(`[${serviceId}] stdout:`, text);
                logger_1.default.info({ serviceId, stdout: text }, 'Service stdout');
            });
            serviceProcess.stderr?.on('data', (data) => {
                const text = data.toString('utf8');
                // 输出到控制台以便调试
                console.error(`[${serviceId}] stderr:`, text);
                logger_1.default.error({ serviceId, stderr: text }, 'Service stderr');
            });
            // 处理进程事件
            serviceProcess.on('error', (error) => {
                const errorMessage = `Failed to start service process: ${error.message}`;
                console.error(`[${serviceId}] Process error:`, error);
                logger_1.default.error({ error, serviceId, command, args, workingDir }, 'Failed to start service process');
                this.updateStatus(serviceId, {
                    starting: false,
                    running: false,
                    lastError: errorMessage,
                });
                this.services.delete(serviceId);
            });
            serviceProcess.on('exit', (code, signal) => {
                const exitMessage = code !== 0 ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : null;
                console.log(`[${serviceId}] Process exited: code=${code}, signal=${signal}`);
                logger_1.default.info({ serviceId, code, signal, command, args, workingDir }, 'Service process exited');
                this.updateStatus(serviceId, {
                    starting: false,
                    running: false,
                    pid: null,
                    lastError: exitMessage,
                });
                this.services.delete(serviceId);
            });
            // 等待服务就绪（通过健康检查）
            this.services.set(serviceId, serviceProcess);
            this.updateStatus(serviceId, {
                starting: true,
                running: false,
                pid: serviceProcess.pid || null,
                port: config.port,
            });
            // 等待服务启动
            // 对于轻量级服务（en-normalize），使用较短的超时时间
            // 对于需要加载模型的服务，使用较长的超时时间
            const isLightweightService = serviceId === 'en-normalize';
            const maxWaitTime = isLightweightService ? 10000 : 120000; // 轻量级服务10秒，模型服务2分钟
            const checkInterval = isLightweightService ? 200 : 1000; // 轻量级服务200ms检查一次，模型服务1秒
            const startTime = Date.now();
            while (Date.now() - startTime < maxWaitTime) {
                try {
                    const http = require('http');
                    const healthCheckPath = config.health_check?.endpoint || '/health';
                    const response = await new Promise((resolve, reject) => {
                        let responseData = '';
                        const req = http.get({
                            hostname: 'localhost',
                            port: config.port,
                            path: healthCheckPath,
                            timeout: config.health_check?.timeout_ms || 5000,
                        }, (res) => {
                            res.on('data', (chunk) => {
                                responseData += chunk.toString();
                            });
                            res.on('end', () => {
                                try {
                                    const healthData = JSON.parse(responseData);
                                    resolve({
                                        ok: res.statusCode === 200,
                                        status: healthData.status
                                    });
                                }
                                catch {
                                    resolve({ ok: res.statusCode === 200 });
                                }
                            });
                        });
                        req.on('error', reject);
                        req.on('timeout', () => {
                            req.destroy();
                            reject(new Error('Request timeout'));
                        });
                    });
                    // 如果status是"healthy"，认为服务已完全就绪
                    if (response.ok && response.status === 'healthy') {
                        logger_1.default.info({ serviceId, port: config.port }, 'Service is ready');
                        this.updateStatus(serviceId, {
                            starting: false,
                            running: true,
                            startedAt: new Date(),
                        });
                        return;
                    }
                    else if (response.ok && response.status === 'loading') {
                        // 服务正在加载模型，继续等待
                        logger_1.default.debug({ serviceId, port: config.port }, 'Service is loading model, waiting...');
                    }
                }
                catch (error) {
                    // 服务可能还在启动中，继续等待
                }
                await new Promise((resolve) => setTimeout(resolve, checkInterval));
            }
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
        logger_1.default.info({ serviceId, pid: process.pid }, 'Stopping service');
        try {
            // 尝试优雅关闭
            const os = require('os');
            const platform = os.platform();
            if (process.pid) {
                // Windows: 使用 taskkill 清理进程树
                // Unix: 使用 kill
                if (platform === 'win32') {
                    try {
                        // 使用 taskkill /F /T /PID 强制终止进程树
                        const killProcess = (0, child_process_1.spawn)('taskkill', ['/F', '/T', '/PID', process.pid.toString()], {
                            stdio: 'ignore',
                            windowsHide: true,
                        });
                        killProcess.on('error', (error) => {
                            logger_1.default.warn({ error, serviceId, pid: process.pid }, 'taskkill failed, trying child.kill');
                            process.kill('SIGTERM');
                        });
                    }
                    catch (error) {
                        logger_1.default.warn({ error, serviceId, pid: process.pid }, 'Failed to spawn taskkill, trying child.kill');
                        process.kill('SIGTERM');
                    }
                }
                else {
                    process.kill('SIGTERM');
                }
            }
            else {
                process.kill('SIGTERM');
            }
            // 等待进程退出（最多等待10秒，增加超时时间）
            const maxWaitTime = 10000;
            const checkInterval = 100;
            const startTime = Date.now();
            while (Date.now() - startTime < maxWaitTime) {
                if (process.killed || process.exitCode !== null) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, checkInterval));
            }
            // 如果进程仍未退出，强制终止
            if (!process.killed && process.exitCode === null) {
                logger_1.default.warn({ serviceId, pid: process.pid }, 'Service did not exit gracefully, forcing termination');
                // Windows: 再次尝试使用 taskkill 强制终止
                if (platform === 'win32' && process.pid) {
                    try {
                        const killProcess = (0, child_process_1.spawn)('taskkill', ['/F', '/T', '/PID', process.pid.toString()], {
                            stdio: 'ignore',
                            windowsHide: true,
                        });
                        killProcess.on('error', (error) => {
                            logger_1.default.error({ error, serviceId, pid: process.pid }, 'Force kill taskkill failed');
                            process.kill('SIGKILL');
                        });
                        // 等待 taskkill 完成
                        await new Promise((resolve) => {
                            killProcess.on('exit', resolve);
                            setTimeout(resolve, 2000); // 2秒超时
                        });
                    }
                    catch (error) {
                        logger_1.default.error({ error, serviceId, pid: process.pid }, 'Exception during force kill');
                        process.kill('SIGKILL');
                    }
                }
                else {
                    process.kill('SIGKILL');
                }
            }
            this.services.delete(serviceId);
            this.updateStatus(serviceId, {
                running: false,
                starting: false,
                pid: null,
                startedAt: null,
                lastError: null,
            });
            logger_1.default.info({ serviceId }, 'Service stopped');
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
