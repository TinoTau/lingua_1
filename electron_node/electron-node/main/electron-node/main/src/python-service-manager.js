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
const port_manager_1 = require("./utils/port-manager");
const gpu_tracker_1 = require("./utils/gpu-tracker");
const python_service_config_1 = require("./utils/python-service-config");
class PythonServiceManager {
    constructor() {
        this.services = new Map();
        this.statuses = new Map();
        this.taskCounts = new Map(); // 任务计数
        this.gpuTrackers = new Map(); // GPU 跟踪器
        this.projectRoot = '';
        this.isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
        if (this.isDev) {
            // 开发环境：项目根目录（例如 d:\Programs\github\lingua_1）
            // 在 Electron 中：
            // - process.cwd() 可能是 electron-node 目录或项目根目录
            // - __dirname 是编译后的 JS 文件位置（electron-node/main）
            // - 项目根目录需要包含 electron_node/services 目录
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
            // 去重并检查哪个路径包含 electron_node/services 目录
            const uniqueCandidates = Array.from(new Set(candidates));
            for (const candidate of uniqueCandidates) {
                const servicesPath = path.join(candidate, 'electron_node', 'services');
                if (fs.existsSync(servicesPath)) {
                    this.projectRoot = candidate;
                    logger_1.default.info({
                        __dirname,
                        cwd: process.cwd(),
                        projectRoot: this.projectRoot,
                    }, 'Python 服务管理器：找到项目根目录');
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
            this.projectRoot = path.dirname(process.execPath);
        }
    }
    getServiceConfig(serviceName) {
        return (0, python_service_config_1.getPythonServiceConfig)(serviceName, this.projectRoot);
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
        // 设置启动中状态
        this.updateStatus(serviceName, {
            running: false,
            starting: true,
            pid: null,
            port: config.port,
            startedAt: null,
            lastError: null,
        });
        // 检查虚拟环境
        const pythonExe = path.join(config.venvPath, 'Scripts', 'python.exe');
        if (!fs.existsSync(pythonExe)) {
            const error = `虚拟环境不存在: ${config.venvPath}`;
            logger_1.default.error({ serviceName, venvPath: config.venvPath }, error);
            this.updateStatus(serviceName, {
                running: false,
                starting: false,
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
                starting: false,
                pid: null,
                port: config.port,
                startedAt: null,
                lastError: error,
            });
            throw new Error(error);
        }
        try {
            // 检查端口是否被占用，如果被占用则尝试清理
            const { checkPortAvailable } = require('./utils/port-manager');
            const portAvailable = await checkPortAvailable(config.port);
            if (!portAvailable) {
                logger_1.default.warn({ serviceName, port: config.port }, `端口 ${config.port} 已被占用，尝试清理...`);
                await (0, port_manager_1.cleanupPortProcesses)(config.port, serviceName);
                // 等待端口释放
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
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
                    '--model-dir', config.env.YOURTTS_MODEL_DIR || '',
                ];
            }
            // 启动进程
            const process = (0, child_process_1.spawn)(pythonExe, args, {
                env: config.env,
                cwd: config.workingDir,
                stdio: ['ignore', 'pipe', 'pipe'], // 重定向输出到日志文件
                detached: false,
            });
            // 创建日志文件流（使用 UTF-8 编码）
            const logStream = fs.createWriteStream(config.logFile, {
                flags: 'a',
                encoding: 'utf8'
            });
            // 处理输出 - 按行分割并添加时间戳
            let stdoutBuffer = '';
            let stderrBuffer = '';
            // 辅助函数：智能识别日志级别
            const detectLogLevel = (line, isStderr) => {
                const upperLine = line.toUpperCase();
                // 检查是否包含明确的错误标记
                if (upperLine.includes('[ERROR]') ||
                    upperLine.includes('ERROR:') ||
                    upperLine.includes('EXCEPTION:') ||
                    upperLine.includes('TRACEBACK') ||
                    (upperLine.includes('FAILED') && !upperLine.includes('WARNING'))) {
                    return '[ERROR]';
                }
                // 检查是否包含警告标记
                if (upperLine.includes('[WARN]') ||
                    upperLine.includes('WARNING:') ||
                    upperLine.includes('FUTUREWARNING') ||
                    upperLine.includes('DEPRECATIONWARNING') ||
                    upperLine.includes('USERWARNING')) {
                    return '[WARN]';
                }
                // 检查是否包含信息标记
                if (upperLine.includes('[INFO]') ||
                    upperLine.includes('INFO:')) {
                    return '[INFO]';
                }
                // 检查 Flask/服务器相关的正常信息
                if (upperLine.includes('RUNNING ON') ||
                    upperLine.includes('SERVING FLASK APP') ||
                    upperLine.includes('DEBUG MODE:') ||
                    upperLine.includes('PRESS CTRL+C') ||
                    upperLine.includes('PRESS CTRL+C TO QUIT') ||
                    upperLine.includes('THIS IS A DEVELOPMENT SERVER')) {
                    return '[INFO]';
                }
                // 默认：stderr 作为警告，stdout 作为信息
                return isStderr ? '[WARN]' : '[INFO]';
            };
            // 辅助函数：将缓冲区内容按行写入日志
            const flushLogBuffer = (buffer, isStderr) => {
                const lines = buffer.split(/\r?\n/);
                // 保留最后一行（可能不完整）在缓冲区
                const completeLines = lines.slice(0, -1);
                const remainingLine = lines[lines.length - 1];
                for (const line of completeLines) {
                    if (line.trim()) { // 只记录非空行
                        const timestamp = new Date().toISOString();
                        const level = detectLogLevel(line, isStderr);
                        const logLine = `${timestamp} ${level} ${line}\n`;
                        logStream.write(logLine, 'utf8');
                    }
                }
                return remainingLine;
            };
            process.stdout?.on('data', (data) => {
                // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
                const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
                stdoutBuffer += text;
                stdoutBuffer = flushLogBuffer(stdoutBuffer, false);
            });
            process.stderr?.on('data', (data) => {
                // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
                const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
                stderrBuffer += text;
                stderrBuffer = flushLogBuffer(stderrBuffer, true);
                // 同时输出到控制台以便调试
                logger_1.default.error({ serviceName, stderr: text }, 'Python service stderr output');
            });
            process.on('error', (error) => {
                logger_1.default.error({ error, serviceName }, 'Python 服务进程启动失败');
                logStream.end();
                this.updateStatus(serviceName, {
                    running: false,
                    starting: false,
                    pid: null,
                    port: config.port,
                    startedAt: null,
                    lastError: error.message,
                });
                this.services.delete(serviceName);
            });
            process.on('exit', (code, signal) => {
                // 刷新剩余的缓冲区内容
                if (stdoutBuffer.trim()) {
                    const timestamp = new Date().toISOString();
                    const level = detectLogLevel(stdoutBuffer, false);
                    const logLine = `${timestamp} ${level} ${stdoutBuffer}\n`;
                    logStream.write(logLine, 'utf8');
                }
                if (stderrBuffer.trim()) {
                    const timestamp = new Date().toISOString();
                    const level = detectLogLevel(stderrBuffer, true);
                    const logLine = `${timestamp} ${level} ${stderrBuffer}\n`;
                    logStream.write(logLine, 'utf8');
                }
                logger_1.default.info({ code, signal, serviceName }, 'Python 服务进程已退出');
                if (code !== 0 && code !== null) {
                    logger_1.default.error({
                        code,
                        signal,
                        serviceName,
                        port: config.port,
                        logFile: config.logFile
                    }, `Python service exited with code ${code}. Check log file for details: ${config.logFile}`);
                }
                logStream.end();
                // 如果进程在启动阶段（waitForServiceReady 之前）退出，记录更详细的错误信息
                // 对于退出码为 1 的情况，可能是端口被占用或模型加载失败
                if (code === 1) {
                    logger_1.default.warn({ serviceName, port: config.port, code, signal }, '服务进程在启动阶段退出（退出码 1），可能是端口被占用或初始化失败。如果随后启动成功，这可能是正常的（端口释放延迟）');
                }
                this.updateStatus(serviceName, {
                    running: false,
                    starting: false,
                    pid: null,
                    port: config.port,
                    startedAt: null,
                    lastError: code !== 0 ? `进程退出，退出码: ${code}` : null,
                });
                this.services.delete(serviceName);
            });
            this.services.set(serviceName, process);
            // 等待服务就绪
            // YourTTS 服务需要更长的启动时间（模型加载需要 30-60 秒）
            const timeout = serviceName === 'yourtts' ? 90000 : 30000;
            // 检查进程是否在等待期间退出
            let processExited = false;
            const exitHandler = () => {
                processExited = true;
            };
            process.once('exit', exitHandler);
            try {
                await this.waitForServiceReady(config.port, timeout, () => {
                    // 检查进程是否还在运行
                    if (processExited || process.killed || process.exitCode !== null) {
                        throw new Error(`服务进程在启动过程中退出（退出码: ${process.exitCode}）`);
                    }
                });
            }
            finally {
                process.removeListener('exit', exitHandler);
            }
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
            // 开始GPU使用时间跟踪
            this.startGpuTracking(serviceName);
            logger_1.default.info({ serviceName, pid: process.pid, port: config.port }, 'Python 服务已启动');
        }
        catch (error) {
            logger_1.default.error({ error, serviceName }, '启动 Python 服务失败');
            this.updateStatus(serviceName, {
                running: false,
                starting: false,
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
            const status = this.statuses.get(serviceName);
            logger_1.default.info({ serviceName, port: status?.port, running: status?.running }, '服务未在运行，无需停止');
            return;
        }
        const status = this.statuses.get(serviceName);
        const port = status?.port || null;
        const pid = child.pid;
        logger_1.default.info({ serviceName, pid, port }, `正在停止 Python 服务 (端口: ${port}, PID: ${pid})...`);
        return new Promise((resolve) => {
            child.once('exit', async (code, signal) => {
                logger_1.default.info({ serviceName, pid, port, code, signal }, `Python 服务进程已退出 (端口: ${port}, 退出码: ${code})`);
                // 停止GPU使用时间跟踪
                this.stopGpuTracking(serviceName);
                this.updateStatus(serviceName, {
                    running: false,
                    starting: false,
                    pid: null,
                    port: port,
                    startedAt: null,
                    lastError: null,
                });
                this.services.delete(serviceName);
                // 验证端口是否已释放
                if (port) {
                    await (0, port_manager_1.verifyPortReleased)(port, serviceName);
                }
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
            setTimeout(async () => {
                if (this.services.has(serviceName)) {
                    logger_1.default.warn({ serviceName, pid, port }, `服务未在 5 秒内停止，强制终止 (端口: ${port}, PID: ${pid})`);
                    child.kill('SIGKILL');
                    // 即使强制终止，也验证端口是否释放
                    if (port) {
                        await (0, port_manager_1.verifyPortReleased)(port, serviceName);
                    }
                }
            }, 5000);
        });
    }
    async stopAllServices() {
        const serviceNames = ['nmt', 'tts', 'yourtts'];
        // 记录当前运行的服务状态
        const runningServices = serviceNames
            .map(name => {
            const status = this.statuses.get(name);
            return status?.running ? { name, port: status.port, pid: status.pid } : null;
        })
            .filter(s => s !== null);
        logger_1.default.info({ runningServices, total: runningServices.length }, `正在停止所有 Python 服务 (运行中的服务: ${runningServices.length})...`);
        await Promise.all(serviceNames.map(name => this.stopService(name).catch(err => {
            logger_1.default.error({ error: err, serviceName: name }, '停止服务失败');
        })));
        // 验证所有端口是否已释放
        const allPorts = runningServices.map(s => s?.port).filter(p => p !== null);
        if (allPorts.length > 0) {
            logger_1.default.info({ ports: allPorts }, `验证所有服务端口是否已释放: ${allPorts.join(', ')}`);
            for (const port of allPorts) {
                // 等待一小段时间让端口完全释放
                await new Promise(resolve => setTimeout(resolve, 500));
                await (0, port_manager_1.verifyPortReleased)(port, 'all');
            }
        }
        logger_1.default.info({}, '所有 Python 服务已停止');
    }
    getServiceStatus(serviceName) {
        const status = this.statuses.get(serviceName);
        if (status) {
            // 更新统计信息
            status.taskCount = this.taskCounts.get(serviceName) || 0;
            const tracker = this.gpuTrackers.get(serviceName);
            status.gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
        }
        return status || null;
    }
    getAllServiceStatuses() {
        return Array.from(this.statuses.values()).map(status => {
            // 更新统计信息
            status.taskCount = this.taskCounts.get(status.name) || 0;
            const tracker = this.gpuTrackers.get(status.name);
            status.gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
            return status;
        });
    }
    /**
     * 增加任务计数
     */
    incrementTaskCount(serviceName) {
        const current = this.taskCounts.get(serviceName) || 0;
        this.taskCounts.set(serviceName, current + 1);
        const status = this.statuses.get(serviceName);
        if (status) {
            status.taskCount = current + 1;
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
        const tracker = this.gpuTrackers.get(serviceName);
        const gpuUsageMs = tracker ? tracker.getGpuUsageMs() : 0;
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
            mergedStatus.gpuUsageMs = current?.gpuUsageMs ?? gpuUsageMs;
        }
        this.statuses.set(serviceName, mergedStatus);
    }
    async waitForServiceReady(port, maxWaitMs = 30000, processCheck) {
        const startTime = Date.now();
        const checkInterval = 500;
        let lastLogTime = 0;
        return new Promise((resolve, reject) => {
            const checkHealth = async () => {
                // 检查进程状态（如果提供了检查函数）
                if (processCheck) {
                    try {
                        processCheck();
                    }
                    catch (error) {
                        reject(error);
                        return;
                    }
                }
                try {
                    const axios = require('axios');
                    // 尝试健康检查端点
                    const response = await axios.get(`http://localhost:${port}/health`, {
                        timeout: 2000, // 增加超时时间到 2 秒
                        validateStatus: (status) => status < 500, // 接受 2xx, 3xx, 4xx
                    });
                    if (response.status < 400) {
                        logger_1.default.info({ port, elapsed: Date.now() - startTime }, '服务健康检查通过');
                        resolve();
                        return;
                    }
                }
                catch (error) {
                    const elapsed = Date.now() - startTime;
                    // 每 5 秒记录一次等待信息
                    if (elapsed - lastLogTime >= 5000) {
                        logger_1.default.info({
                            port,
                            elapsed,
                            errorCode: error?.code,
                            errorMessage: error?.message,
                            maxWaitMs
                        }, '等待服务就绪...');
                        lastLogTime = elapsed;
                    }
                    // 如果是连接错误（ECONNREFUSED），服务还未就绪，继续等待
                    // 其他错误可能是服务已启动但端点不同，也认为就绪
                    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
                        // 继续等待
                    }
                    else {
                        // 其他错误（如 404），可能服务已启动但端点不同，认为就绪
                        logger_1.default.warn({ port, errorCode: error?.code, errorMessage: error?.message }, '健康检查返回非连接错误，认为服务已就绪');
                        resolve();
                        return;
                    }
                }
                if (Date.now() - startTime > maxWaitMs) {
                    // 超时后不拒绝，让服务继续运行（可能健康检查端点不同或服务启动较慢）
                    logger_1.default.warn({ port, maxWaitMs, elapsed: Date.now() - startTime }, '服务健康检查超时，但继续运行（服务可能已启动但响应较慢）');
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
