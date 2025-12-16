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
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const logger_1 = __importDefault(require("./logger"));
class PythonServiceManager {
    constructor() {
        this.services = new Map();
        this.statuses = new Map();
        this.isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
        if (this.isDev) {
            this.projectRoot = path.resolve(__dirname, '../../../..');
        }
        else {
            this.projectRoot = path.dirname(process.execPath);
        }
    }
    setupCudaEnvironment() {
        const env = {};
        const cudaPaths = [
            'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4',
            'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.1',
            'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.8',
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
                const currentPath = process.env.PATH || '';
                env.PATH = `${cudaBin};${cudaLibnvvp};${currentPath}`;
                logger_1.default.info({ cudaPath }, 'CUDA 环境已配置');
                break;
            }
        }
        return env;
    }
    getServiceConfig(serviceName) {
        const baseEnv = {
            ...process.env,
            ...this.setupCudaEnvironment(),
            PYTHONIOENCODING: 'utf-8',
        };
        switch (serviceName) {
            case 'nmt': {
                const servicePath = path.join(this.projectRoot, 'services', 'nmt_m2m100');
                const venvPath = path.join(servicePath, 'venv');
                const logDir = path.join(servicePath, 'logs');
                const logFile = path.join(logDir, 'nmt-service.log');
                // 确保日志目录存在
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                // 读取 Hugging Face token
                const hfTokenFile = path.join(servicePath, 'hf_token.txt');
                let hfToken = '';
                if (fs.existsSync(hfTokenFile)) {
                    try {
                        hfToken = fs.readFileSync(hfTokenFile, 'utf-8').trim();
                    }
                    catch (error) {
                        logger_1.default.warn({ error }, '读取 HF token 失败');
                    }
                }
                return {
                    name: 'NMT',
                    port: 5008,
                    servicePath,
                    venvPath,
                    scriptPath: path.join(servicePath, 'nmt_service.py'),
                    workingDir: servicePath,
                    logDir,
                    logFile,
                    env: {
                        ...baseEnv,
                        HF_TOKEN: hfToken,
                        HF_LOCAL_FILES_ONLY: 'true',
                    },
                };
            }
            case 'tts': {
                const servicePath = path.join(this.projectRoot, 'services', 'piper_tts');
                const venvPath = path.join(servicePath, 'venv');
                const logDir = path.join(servicePath, 'logs');
                const logFile = path.join(logDir, 'tts-service.log');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                const modelDir = process.env.PIPER_MODEL_DIR
                    || path.join(this.projectRoot, 'node-inference', 'models', 'tts');
                return {
                    name: 'TTS (Piper)',
                    port: 5006,
                    servicePath,
                    venvPath,
                    scriptPath: path.join(servicePath, 'piper_http_server.py'),
                    workingDir: servicePath,
                    logDir,
                    logFile,
                    env: {
                        ...baseEnv,
                        // CUDA_PATH 来自 setupCudaEnvironment，这里通过 any 访问避免类型冲突
                        PIPER_USE_GPU: baseEnv.CUDA_PATH ? 'true' : 'false',
                        PIPER_MODEL_DIR: modelDir,
                    },
                };
            }
            case 'yourtts': {
                const servicePath = path.join(this.projectRoot, 'services', 'your_tts');
                const venvPath = path.join(servicePath, 'venv');
                const logDir = path.join(servicePath, 'logs');
                const logFile = path.join(logDir, 'yourtts-service.log');
                if (!fs.existsSync(logDir)) {
                    fs.mkdirSync(logDir, { recursive: true });
                }
                const modelDir = process.env.YOURTTS_MODEL_DIR
                    || path.join(this.projectRoot, 'node-inference', 'models', 'tts', 'your_tts');
                return {
                    name: 'YourTTS',
                    port: 5004,
                    servicePath,
                    venvPath,
                    scriptPath: path.join(servicePath, 'yourtts_service.py'),
                    workingDir: servicePath,
                    logDir,
                    logFile,
                    env: {
                        ...baseEnv,
                        YOURTTS_MODEL_DIR: modelDir,
                        // CUDA_PATH 来自 setupCudaEnvironment，这里通过 any 访问避免类型冲突
                        YOURTTS_USE_GPU: baseEnv.CUDA_PATH ? 'true' : 'false',
                    },
                };
            }
            default:
                return null;
        }
    }
    async startService(serviceName) {
        if (this.services.has(serviceName)) {
            logger_1.default.warn({ serviceName }, '服务已在运行');
            return;
        }
        const config = this.getServiceConfig(serviceName);
        if (!config) {
            throw new Error(`未知服务: ${serviceName}`);
        }
        // 检查虚拟环境
        const pythonExe = path.join(config.venvPath, 'Scripts', 'python.exe');
        if (!fs.existsSync(pythonExe)) {
            const error = `虚拟环境不存在: ${config.venvPath}`;
            logger_1.default.error({ serviceName, venvPath: config.venvPath }, error);
            this.updateStatus(serviceName, {
                running: false,
                pid: null,
                port: config.port,
                startedAt: null,
                lastError: error,
            });
            throw new Error(error);
        }
        // 检查脚本文件
        if (!fs.existsSync(config.scriptPath)) {
            const error = `服务脚本不存在: ${config.scriptPath}`;
            logger_1.default.error({ serviceName, scriptPath: config.scriptPath }, error);
            this.updateStatus(serviceName, {
                running: false,
                pid: null,
                port: config.port,
                startedAt: null,
                lastError: error,
            });
            throw new Error(error);
        }
        try {
            // 构建启动命令
            let args = [];
            if (serviceName === 'nmt') {
                // NMT 服务使用 uvicorn
                args = ['-m', 'uvicorn', 'nmt_service:app', '--host', '127.0.0.1', '--port', config.port.toString()];
            }
            else if (serviceName === 'tts') {
                // Piper TTS 服务
                args = [
                    config.scriptPath,
                    '--host', '127.0.0.1',
                    '--port', config.port.toString(),
                    '--model-dir', config.env.PIPER_MODEL_DIR || '',
                ];
            }
            else if (serviceName === 'yourtts') {
                // YourTTS 服务
                args = [
                    config.scriptPath,
                    '--host', '127.0.0.1',
                    '--port', config.port.toString(),
                ];
            }
            // 启动进程
            const process = (0, child_process_1.spawn)(pythonExe, args, {
                env: config.env,
                cwd: config.workingDir,
                stdio: ['ignore', 'pipe', 'pipe'], // 重定向输出到日志文件
                detached: false,
            });
            // 创建日志文件流
            const logStream = fs.createWriteStream(config.logFile, { flags: 'a' });
            // 处理输出
            process.stdout?.on('data', (data) => {
                const timestamp = new Date().toISOString();
                const line = `${timestamp} ${data.toString()}`;
                logStream.write(line);
            });
            process.stderr?.on('data', (data) => {
                const timestamp = new Date().toISOString();
                const line = `${timestamp} ${data.toString()}`;
                logStream.write(line);
            });
            process.on('error', (error) => {
                logger_1.default.error({ error, serviceName }, 'Python 服务进程启动失败');
                logStream.end();
                this.updateStatus(serviceName, {
                    running: false,
                    pid: null,
                    port: config.port,
                    startedAt: null,
                    lastError: error.message,
                });
                this.services.delete(serviceName);
            });
            process.on('exit', (code, signal) => {
                logger_1.default.info({ code, signal, serviceName }, 'Python 服务进程已退出');
                logStream.end();
                this.updateStatus(serviceName, {
                    running: false,
                    pid: null,
                    port: config.port,
                    startedAt: null,
                    lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
                });
                this.services.delete(serviceName);
            });
            this.services.set(serviceName, process);
            // 等待服务就绪
            await this.waitForServiceReady(config.port, 30000);
            this.updateStatus(serviceName, {
                running: true,
                pid: process.pid || null,
                port: config.port,
                startedAt: new Date(),
                lastError: null,
            });
            logger_1.default.info({ serviceName, pid: process.pid, port: config.port }, 'Python 服务已启动');
        }
        catch (error) {
            logger_1.default.error({ error, serviceName }, '启动 Python 服务失败');
            this.updateStatus(serviceName, {
                running: false,
                pid: null,
                port: config.port,
                startedAt: null,
                lastError: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async stopService(serviceName) {
        const child = this.services.get(serviceName);
        if (!child) {
            return;
        }
        logger_1.default.info({ serviceName, pid: child.pid }, '正在停止 Python 服务...');
        return new Promise((resolve) => {
            const pid = child.pid;
            child.once('exit', () => {
                logger_1.default.info({ serviceName, pid }, 'Python 服务已停止');
                this.updateStatus(serviceName, {
                    running: false,
                    pid: null,
                    port: this.statuses.get(serviceName)?.port || null,
                    startedAt: null,
                    lastError: null,
                });
                this.services.delete(serviceName);
                resolve();
            });
            if (pid) {
                try {
                    if (process.platform === 'win32') {
                        (0, child_process_1.spawn)('taskkill', ['/PID', pid.toString(), '/T', '/F']);
                    }
                    else {
                        process.kill(pid, 'SIGTERM');
                    }
                }
                catch (error) {
                    logger_1.default.error({ error, serviceName, pid }, '停止进程失败，尝试强制终止');
                    child.kill('SIGKILL');
                }
            }
            else {
                child.kill('SIGTERM');
            }
            setTimeout(() => {
                if (this.services.has(serviceName)) {
                    logger_1.default.warn({ serviceName, pid }, '服务未在 5 秒内停止，强制终止');
                    child.kill('SIGKILL');
                }
            }, 5000);
        });
    }
    async stopAllServices() {
        const serviceNames = ['nmt', 'tts', 'yourtts'];
        await Promise.all(serviceNames.map(name => this.stopService(name).catch(err => {
            logger_1.default.error({ error: err, serviceName: name }, '停止服务失败');
        })));
    }
    getServiceStatus(serviceName) {
        return this.statuses.get(serviceName) || null;
    }
    getAllServiceStatuses() {
        return Array.from(this.statuses.values());
    }
    updateStatus(serviceName, status) {
        this.statuses.set(serviceName, {
            name: serviceName,
            ...status,
        });
    }
    async waitForServiceReady(port, maxWaitMs = 30000) {
        const startTime = Date.now();
        const checkInterval = 500;
        return new Promise((resolve, reject) => {
            const checkHealth = async () => {
                try {
                    const axios = require('axios');
                    // 尝试健康检查端点
                    const response = await axios.get(`http://localhost:${port}/health`, {
                        timeout: 1000,
                        validateStatus: (status) => status < 500, // 接受 2xx, 3xx, 4xx
                    });
                    if (response.status < 400) {
                        resolve();
                        return;
                    }
                }
                catch (error) {
                    // 如果是连接错误（ECONNREFUSED），服务还未就绪，继续等待
                    // 其他错误可能是服务已启动但端点不同，也认为就绪
                    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                        // 继续等待
                    }
                    else {
                        // 其他错误（如 404），可能服务已启动但端点不同，认为就绪
                        resolve();
                        return;
                    }
                }
                if (Date.now() - startTime > maxWaitMs) {
                    // 超时后不拒绝，让服务继续运行（可能健康检查端点不同）
                    resolve();
                    return;
                }
                setTimeout(checkHealth, checkInterval);
            };
            checkHealth();
        });
    }
}
exports.PythonServiceManager = PythonServiceManager;
