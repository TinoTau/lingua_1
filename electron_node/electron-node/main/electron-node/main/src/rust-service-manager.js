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
exports.RustServiceManager = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const logger_1 = __importDefault(require("./logger"));
class RustServiceManager {
    constructor() {
        this.process = null;
        this.status = {
            running: false,
            starting: false,
            pid: null,
            port: null,
            startedAt: null,
            lastError: null,
            taskCount: 0,
            gpuUsageMs: 0,
        };
        this.taskCount = 0; // 任务计数
        this.gpuUsageStartTime = null; // GPU使用开始时间
        this.gpuUsageMs = 0; // GPU累计使用时长（毫秒）
        this.gpuCheckInterval = null; // GPU检查定时器
        this.servicePath = '';
        this.logDir = '';
        this.port = 5009;
        this.projectRoot = '';
        // 判断开发/生产环境
        const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
        if (isDev) {
            // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
            // 在 Electron 中：
            // - process.cwd() 可能是 electron-node 目录或项目根目录
            // - __dirname 是编译后的 JS 文件位置（electron-node/main）
            // - 项目根目录需要包含 electron_node/services/node-inference 目录
            // 从多个可能的路径查找项目根目录
            const cwd = process.cwd();
            const candidates = [];
            // 1. 从 cwd 向上查找（最多向上3级）
            let currentPath = cwd;
            for (let i = 0; i <= 3; i++) {
                candidates.push(currentPath);
                currentPath = path.resolve(currentPath, '..');
            }
            // 2. 从 __dirname 向上查找（最多向上3级）
            currentPath = __dirname;
            for (let i = 0; i <= 3; i++) {
                candidates.push(currentPath);
                currentPath = path.resolve(currentPath, '..');
            }
            // 去重并检查哪个路径包含 electron_node/services/node-inference 目录
            const uniqueCandidates = Array.from(new Set(candidates));
            for (const candidate of uniqueCandidates) {
                const nodeInferencePath = path.join(candidate, 'electron_node', 'services', 'node-inference');
                if (fs.existsSync(nodeInferencePath)) {
                    this.projectRoot = candidate;
                    this.servicePath = path.join(this.projectRoot, 'electron_node', 'services', 'node-inference', 'target', 'release', 'inference-service.exe');
                    logger_1.default.info({
                        __dirname,
                        cwd: process.cwd(),
                        projectRoot: this.projectRoot,
                        servicePath: this.servicePath,
                    }, 'Rust 服务管理器：找到项目根目录');
                    break;
                }
            }
            // 如果都没找到，抛出错误
            if (!this.projectRoot) {
                const error = `无法找到项目根目录。已检查的路径：${uniqueCandidates.join(', ')}`;
                logger_1.default.error({
                    __dirname,
                    cwd: process.cwd(),
                    candidates: uniqueCandidates,
                }, error);
                throw new Error(error);
            }
        }
        else {
            // 生产环境：以应用安装路径为根目录
            // electron-builder 已将 inference-service.exe 放在安装路径根目录
            this.projectRoot = path.dirname(process.execPath);
            this.servicePath = path.join(this.projectRoot, 'inference-service.exe');
        }
        // 日志目录：<repo>/electron_node/services/node-inference/logs
        this.logDir = path.join(this.projectRoot, 'electron_node', 'services', 'node-inference', 'logs');
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
        // 端口号（从环境变量读取，默认 5009）
        this.port = parseInt(process.env.INFERENCE_SERVICE_PORT || '5009', 10);
    }
    async start() {
        if (this.process) {
            logger_1.default.warn({}, 'Rust 服务已在运行');
            return;
        }
        if (this.status.starting) {
            logger_1.default.warn({}, 'Rust 服务正在启动中，请稍候');
            return;
        }
        // 检查可执行文件是否存在
        if (!fs.existsSync(this.servicePath)) {
            const error = `Rust 服务可执行文件不存在: ${this.servicePath}`;
            logger_1.default.error({ servicePath: this.servicePath }, error);
            this.status.lastError = error;
            this.status.starting = false;
            throw new Error(error);
        }
        // 设置启动中状态
        this.status.starting = true;
        this.status.lastError = null;
        try {
            // 配置 CUDA 环境变量（如果 CUDA 已安装）
            const cudaEnv = this.setupCudaEnvironment();
            // 设置环境变量
            // Rust 服务期望在 electron_node/services/node-inference 目录下运行
            const workingDir = path.join(this.projectRoot, 'electron_node', 'services', 'node-inference');
            const modelsDir = process.env.MODELS_DIR || path.join(workingDir, 'models');
            const env = {
                ...process.env,
                ...cudaEnv,
                INFERENCE_SERVICE_PORT: this.port.toString(),
                RUST_LOG: process.env.RUST_LOG || 'info',
                LOG_FORMAT: process.env.LOG_FORMAT || 'json',
                MODELS_DIR: modelsDir,
            };
            if (!fs.existsSync(workingDir)) {
                fs.mkdirSync(workingDir, { recursive: true });
            }
            // 确保 logs / models 目录存在
            const logsDir = path.join(workingDir, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const modelsDirOnDisk = path.join(workingDir, 'models');
            if (!fs.existsSync(modelsDirOnDisk)) {
                fs.mkdirSync(modelsDirOnDisk, { recursive: true });
            }
            // 启动 Rust 服务进程
            // 使用 'pipe' 重定向输出到日志文件，确保完全后台运行（不会打开额外终端窗口）
            const logFile = path.join(this.logDir, 'node-inference.log');
            const logStream = fs.createWriteStream(logFile, { flags: 'a' });
            this.process = (0, child_process_1.spawn)(this.servicePath, [], {
                env,
                cwd: workingDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
            });
            // 处理输出（带时间戳）
            this.process.stdout?.on('data', (data) => {
                const timestamp = new Date().toISOString();
                const line = `${timestamp} ${data.toString()}`;
                logStream.write(line);
            });
            this.process.stderr?.on('data', (data) => {
                const timestamp = new Date().toISOString();
                const line = `${timestamp} ${data.toString()}`;
                logStream.write(line);
            });
            this.process.on('error', (error) => {
                const errorMsg = `Rust 服务进程启动失败: ${error.message}`;
                logger_1.default.error({ error, servicePath: this.servicePath, workingDir }, errorMsg);
                logStream.end();
                this.status.lastError = errorMsg;
                this.status.running = false;
                this.status.starting = false;
                this.process = null;
            });
            this.process.on('exit', (code, signal) => {
                logger_1.default.info({ code, signal, pid: this.process?.pid }, 'Rust 服务进程已退出');
                logStream.end();
                this.status.starting = false;
                this.status.running = false;
                this.status.pid = null;
                this.process = null;
                // 如果非正常退出，记录错误
                if (code !== 0 && code !== null) {
                    const errorMsg = `进程退出，退出码: ${code}`;
                    this.status.lastError = errorMsg;
                    logger_1.default.error({
                        code,
                        signal,
                        servicePath: this.servicePath,
                        workingDir,
                        modelsDir: path.join(workingDir, 'models')
                    }, errorMsg);
                }
            });
            // 等待服务启动（检查端口是否可用）
            // 先等待一小段时间，让服务有时间初始化（模型加载可能需要几秒）
            logger_1.default.info({
                servicePath: this.servicePath,
                workingDir,
                port: this.port,
                pid: this.process?.pid
            }, 'Rust 服务进程已启动，等待服务就绪...');
            // 给服务更多时间初始化（模型加载需要时间）
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.waitForServiceReady(60000); // 增加到60秒超时
            this.status.running = true;
            this.status.starting = false;
            this.status.pid = this.process.pid || null;
            this.status.port = this.port;
            this.status.startedAt = new Date();
            this.status.lastError = null;
            // 开始GPU使用时间跟踪
            this.startGpuTracking();
            logger_1.default.info({
                pid: this.status.pid,
                port: this.status.port,
                servicePath: this.servicePath,
                logDir: this.logDir,
            }, 'Rust 服务已启动');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger_1.default.error({
                errorMessage: errorMsg,
                errorStack: errorStack,
                errorType: error instanceof Error ? error.constructor.name : typeof error,
                servicePath: this.servicePath,
                projectRoot: this.projectRoot,
                workingDir: path.join(this.projectRoot, 'electron_node', 'services', 'node-inference'),
                modelsDir: path.join(this.projectRoot, 'electron_node', 'services', 'node-inference', 'models'),
                port: this.port,
                processPid: this.process?.pid,
                processExitCode: this.process?.exitCode,
                processKilled: this.process?.killed,
                lastError: this.status.lastError
            }, `启动 Rust 服务失败: ${errorMsg}`);
            this.status.starting = false;
            this.status.lastError = errorMsg;
            throw error;
        }
    }
    async stop() {
        if (!this.process) {
            logger_1.default.info({ port: this.port }, `Rust 服务未运行 (端口: ${this.port})，无需停止`);
            return;
        }
        const pid = this.process.pid;
        const port = this.port;
        logger_1.default.info({ pid, port }, `正在停止 Rust 服务 (端口: ${port}, PID: ${pid})...`);
        return new Promise(async (resolve) => {
            if (!this.process) {
                resolve();
                return;
            }
            this.process.once('exit', async () => {
                logger_1.default.info({ pid, port }, `Rust 服务进程已退出 (端口: ${port}, PID: ${pid})`);
                this.status.running = false;
                this.status.pid = null;
                this.process = null;
                // 验证端口是否已释放
                await this.verifyPortReleased(port);
                resolve();
            });
            // 尝试优雅关闭
            if (pid) {
                try {
                    // Windows: 使用 taskkill
                    if (process.platform === 'win32') {
                        (0, child_process_1.spawn)('taskkill', ['/PID', pid.toString(), '/T', '/F']);
                    }
                    else {
                        // Linux/Mac: 使用 kill
                        process.kill(pid, 'SIGTERM');
                    }
                }
                catch (error) {
                    logger_1.default.error({ error, pid }, '停止进程失败，尝试强制终止');
                    if (this.process) {
                        this.process.kill('SIGKILL');
                    }
                }
            }
            else {
                this.process.kill('SIGTERM');
            }
            // 超时强制终止
            setTimeout(async () => {
                if (this.process) {
                    logger_1.default.warn({ pid, port }, `服务未在 5 秒内停止，强制终止 (端口: ${port}, PID: ${pid})`);
                    this.process.kill('SIGKILL');
                    // 即使强制终止，也验证端口是否释放
                    await this.verifyPortReleased(port);
                }
            }, 5000);
        });
    }
    /**
     * 验证端口是否已释放
     */
    async verifyPortReleased(port) {
        try {
            const net = require('net');
            const testServer = net.createServer();
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    testServer.close();
                    logger_1.default.warn({ port }, `端口 ${port} 释放验证超时（可能仍被占用）`);
                    resolve();
                }, 2000);
                testServer.listen(port, '127.0.0.1', () => {
                    clearTimeout(timeout);
                    testServer.close(() => {
                        logger_1.default.info({ port }, `✅ Rust 服务端口 ${port} 已成功释放`);
                        resolve();
                    });
                });
                testServer.on('error', (err) => {
                    clearTimeout(timeout);
                    if (err.code === 'EADDRINUSE') {
                        logger_1.default.error({ port, error: err }, `❌ Rust 服务端口 ${port} 仍被占用，服务可能未正确关闭`);
                    }
                    else {
                        logger_1.default.warn({ port, error: err }, `端口 ${port} 释放验证失败`);
                    }
                    resolve();
                });
            });
        }
        catch (error) {
            logger_1.default.warn({ port, error }, `端口 ${port} 释放验证异常`);
        }
    }
    getStatus() {
        // 更新统计信息
        this.status.taskCount = this.taskCount;
        this.status.gpuUsageMs = this.gpuUsageMs;
        return { ...this.status };
    }
    /**
     * 增加任务计数
     */
    incrementTaskCount() {
        this.taskCount++;
        this.status.taskCount = this.taskCount;
    }
    /**
     * 开始跟踪GPU使用时间
     */
    startGpuTracking() {
        if (this.gpuCheckInterval) {
            return; // 已经在跟踪
        }
        this.gpuUsageStartTime = Date.now();
        // 每500ms检查一次GPU使用率
        this.gpuCheckInterval = setInterval(async () => {
            try {
                const gpuInfo = await this.getGpuUsage();
                const now = Date.now();
                if (gpuInfo && gpuInfo.usage > 0) {
                    // GPU正在使用，累计时间
                    if (this.gpuUsageStartTime) {
                        const elapsed = now - this.gpuUsageStartTime;
                        this.gpuUsageMs += elapsed;
                        this.status.gpuUsageMs = this.gpuUsageMs;
                    }
                    this.gpuUsageStartTime = now; // 重置开始时间
                }
                else {
                    // GPU未使用，重置开始时间
                    this.gpuUsageStartTime = now;
                }
            }
            catch (error) {
                // 忽略错误，继续跟踪
            }
        }, 500);
    }
    /**
     * 停止跟踪GPU使用时间
     */
    stopGpuTracking() {
        if (this.gpuCheckInterval) {
            clearInterval(this.gpuCheckInterval);
            this.gpuCheckInterval = null;
        }
        // 累计最后一次使用时间
        if (this.gpuUsageStartTime) {
            const now = Date.now();
            const elapsed = now - this.gpuUsageStartTime;
            this.gpuUsageMs += elapsed;
            this.status.gpuUsageMs = this.gpuUsageMs;
            this.gpuUsageStartTime = null;
        }
    }
    /**
     * 获取GPU使用率
     */
    async getGpuUsage() {
        try {
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
    setupCudaEnvironment() {
        const env = {};
        // 检查 CUDA 安装路径
        const cudaPaths = [
            'C\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4',
            'C\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.1',
            'C\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.8',
        ];
        for (const cudaPath of cudaPaths) {
            if (fs.existsSync(cudaPath)) {
                const cudaBin = path.join(cudaPath, 'bin');
                const cudaLibnvvp = path.join(cudaPath, 'libnvvp');
                const cudaNvcc = path.join(cudaBin, 'nvcc.exe');
                env.CUDA_PATH = cudaPath;
                env.CUDAToolkit_ROOT = cudaPath;
                env.CUDA_ROOT = cudaPath;
                env.CUDA_HOME = cudaPath;
                env.CMAKE_CUDA_COMPILER = cudaNvcc;
                // 更新 PATH
                const currentPath = process.env.PATH || '';
                env.PATH = `${cudaBin};${cudaLibnvvp};${currentPath}`;
                logger_1.default.info({ cudaPath }, 'CUDA 环境已配置');
                break;
            }
        }
        return env;
    }
    async waitForServiceReady(maxWaitMs = 30000) {
        const startTime = Date.now();
        const checkInterval = 500; // 每 500ms 检查一次
        return new Promise((resolve, reject) => {
            const checkHealth = async () => {
                try {
                    const axios = require('axios');
                    // 使用 127.0.0.1 而不是 localhost，避免 IPv6/IPv4 解析问题
                    const healthUrl = `http://127.0.0.1:${this.port}/health`;
                    logger_1.default.debug({ healthUrl, port: this.port }, '发送健康检查请求...');
                    const response = await axios.get(healthUrl, {
                        timeout: 5000, // 增加到 5 秒，给服务更多时间响应
                    });
                    if (response.status === 200) {
                        logger_1.default.info({ port: this.port, elapsed: Date.now() - startTime }, 'Rust 服务健康检查通过');
                        resolve();
                        return;
                    }
                    else {
                        logger_1.default.warn({ port: this.port, status: response.status }, '健康检查返回非 200 状态码');
                    }
                }
                catch (error) {
                    // 服务还未就绪，继续等待
                    const elapsed = Date.now() - startTime;
                    const isTimeout = error?.code === 'ECONNABORTED' || error?.message?.includes('timeout');
                    const isConnectionRefused = error?.code === 'ECONNREFUSED';
                    // 每 5 秒记录一次等待信息，或者如果是连接错误则更频繁记录
                    if (elapsed % 5000 < checkInterval || isConnectionRefused || isTimeout) {
                        logger_1.default.info({
                            port: this.port,
                            elapsed,
                            errorMessage: error?.message || String(error),
                            errorCode: error?.code,
                            errorType: isTimeout ? 'timeout' : isConnectionRefused ? 'connection_refused' : 'other',
                            processRunning: this.process && !this.process.killed && this.process.exitCode === null,
                            processPid: this.process?.pid,
                            processExitCode: this.process?.exitCode
                        }, '等待 Rust 服务就绪...');
                    }
                }
                if (Date.now() - startTime > maxWaitMs) {
                    // 检查进程是否还在运行
                    const isProcessRunning = this.process && !this.process.killed && this.process.exitCode === null;
                    const errorMsg = `服务在 ${maxWaitMs}ms 内未就绪（端口 ${this.port}）`;
                    logger_1.default.error({
                        port: this.port,
                        maxWaitMs,
                        elapsed: Date.now() - startTime,
                        servicePath: this.servicePath,
                        workingDir: path.join(this.projectRoot, 'electron_node', 'services', 'node-inference'),
                        modelsDir: path.join(this.projectRoot, 'electron_node', 'services', 'node-inference', 'models'),
                        processRunning: isProcessRunning,
                        processPid: this.process?.pid,
                        processExitCode: this.process?.exitCode,
                        lastError: this.status.lastError
                    }, errorMsg);
                    reject(new Error(errorMsg));
                    return;
                }
                setTimeout(checkHealth, checkInterval);
            };
            checkHealth();
        });
    }
}
exports.RustServiceManager = RustServiceManager;
