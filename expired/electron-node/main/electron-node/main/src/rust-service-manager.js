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
        };
        this.projectRoot = '';
        // 判断开发/生产环境
        const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
        if (isDev) {
            // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
            // 参考 scripts/start_node_inference.ps1 的路径计算逻辑：
            // $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path  (scripts 目录)
            // $projectRoot = Split-Path -Parent $scriptDir  (项目根目录)
            // 
            // 在 Electron 中：
            // - process.cwd() 通常是 electron-node 目录（应用启动目录）
            // - __dirname 是编译后的 JS 文件位置（electron-node/main）
            // - 项目根目录是 electron-node 的父目录
            // 方法1：从 process.cwd() 推断（最可靠，因为应用从 electron-node 目录启动）
            const cwd = process.cwd();
            const possibleRootFromCwd = path.resolve(cwd, '..');
            // 方法2：从 __dirname 推断（编译后是 electron-node/main）
            const possibleRootFromDirname = path.resolve(__dirname, '../..');
            // 检查哪个路径包含 node-inference 目录（这是项目根目录的标志）
            const candidates = [possibleRootFromCwd, possibleRootFromDirname];
            for (const candidate of candidates) {
                const nodeInferencePath = path.join(candidate, 'node-inference');
                if (fs.existsSync(nodeInferencePath)) {
                    this.projectRoot = candidate;
                    logger_1.default.info({
                        __dirname,
                        cwd: process.cwd(),
                        projectRoot: this.projectRoot,
                        servicePath: path.join(this.projectRoot, 'node-inference', 'target', 'release', 'inference-service.exe')
                    }, 'Rust 服务管理器：找到项目根目录');
                    break;
                }
            }
            // 如果都没找到，使用从 cwd 向上 1 级的方法（最可能正确）
            if (!this.projectRoot) {
                this.projectRoot = possibleRootFromCwd;
                logger_1.default.warn({
                    __dirname,
                    cwd: process.cwd(),
                    projectRoot: this.projectRoot,
                    note: '使用默认方法（从 cwd 向上 1 级）'
                }, 'Rust 服务管理器：使用默认项目根目录');
            }
            // Rust 可执行文件路径：node-inference/target/release/inference-service.exe
            this.servicePath = path.join(this.projectRoot, 'node-inference', 'target', 'release', 'inference-service.exe');
        }
        else {
            // 生产环境：以应用安装路径为根目录
            // electron-builder 已将 inference-service.exe 放在安装路径根目录
            this.projectRoot = path.dirname(process.execPath);
            this.servicePath = path.join(this.projectRoot, 'inference-service.exe');
        }
        // 日志目录：始终使用「根目录/node-inference/logs」
        // 开发环境：<repo>/node-inference/logs
        // 生产环境：<安装路径>/node-inference/logs
        this.logDir = path.join(this.projectRoot, 'node-inference', 'logs');
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
            // 注意：Rust 服务期望在 node-inference 目录下运行
            const modelsDir = process.env.MODELS_DIR
                || path.join(this.projectRoot, 'node-inference', 'models');
            const env = {
                ...process.env,
                ...cudaEnv,
                INFERENCE_SERVICE_PORT: this.port.toString(),
                RUST_LOG: process.env.RUST_LOG || 'info',
                LOG_FORMAT: process.env.LOG_FORMAT || 'json',
                MODELS_DIR: modelsDir,
            };
            // 设置工作目录：始终为「根目录/node-inference」
            const workingDir = path.join(this.projectRoot, 'node-inference');
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
                logger_1.default.error({ error }, 'Rust 服务进程启动失败');
                logStream.end();
                this.status.lastError = error.message;
                this.status.running = false;
                this.process = null;
            });
            this.process.on('exit', (code, signal) => {
                logger_1.default.info({ code, signal }, 'Rust 服务进程已退出');
                logStream.end();
                this.status.starting = false;
                this.status.running = false;
                this.status.pid = null;
                this.process = null;
                // 如果非正常退出，记录错误
                if (code !== 0 && code !== null) {
                    this.status.lastError = `进程退出，退出码: ${code}`;
                }
            });
            // 等待服务启动（检查端口是否可用）
            await this.waitForServiceReady();
            this.status.running = true;
            this.status.starting = false;
            this.status.pid = this.process.pid || null;
            this.status.port = this.port;
            this.status.startedAt = new Date();
            this.status.lastError = null;
            logger_1.default.info({
                pid: this.status.pid,
                port: this.status.port,
                servicePath: this.servicePath,
                logDir: this.logDir,
            }, 'Rust 服务已启动');
        }
        catch (error) {
            logger_1.default.error({ error }, '启动 Rust 服务失败');
            this.status.starting = false;
            this.status.lastError = error instanceof Error ? error.message : String(error);
            throw error;
        }
    }
    async stop() {
        if (!this.process) {
            return;
        }
        logger_1.default.info({ pid: this.process.pid }, '正在停止 Rust 服务...');
        return new Promise((resolve) => {
            if (!this.process) {
                resolve();
                return;
            }
            const pid = this.process.pid;
            this.process.once('exit', () => {
                logger_1.default.info({ pid }, 'Rust 服务已停止');
                this.status.running = false;
                this.status.pid = null;
                this.process = null;
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
            setTimeout(() => {
                if (this.process) {
                    logger_1.default.warn({ pid }, '服务未在 5 秒内停止，强制终止');
                    this.process.kill('SIGKILL');
                }
            }, 5000);
        });
    }
    getStatus() {
        return { ...this.status };
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
                    const response = await axios.get(`http://localhost:${this.port}/health`, {
                        timeout: 1000,
                    });
                    if (response.status === 200) {
                        resolve();
                        return;
                    }
                }
                catch (error) {
                    // 服务还未就绪，继续等待
                }
                if (Date.now() - startTime > maxWaitMs) {
                    reject(new Error(`服务在 ${maxWaitMs}ms 内未就绪`));
                    return;
                }
                setTimeout(checkHealth, checkInterval);
            };
            checkHealth();
        });
    }
}
exports.RustServiceManager = RustServiceManager;
