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
exports.buildServiceArgs = buildServiceArgs;
exports.startServiceProcess = startServiceProcess;
exports.stopServiceProcess = stopServiceProcess;
exports.waitForServiceReadyWithProcessCheck = waitForServiceReadyWithProcessCheck;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = __importDefault(require("../logger"));
const port_manager_1 = require("../utils/port-manager");
const service_logging_1 = require("./service-logging");
const service_health_1 = require("./service-health");
/**
 * 构建服务启动参数
 */
function buildServiceArgs(serviceName, config) {
    if (serviceName === 'nmt') {
        // NMT 服务使用 uvicorn
        return ['-m', 'uvicorn', 'nmt_service:app', '--host', '127.0.0.1', '--port', config.port.toString()];
    }
    else if (serviceName === 'tts') {
        // Piper TTS 服务
        return [
            config.scriptPath,
            '--host', '127.0.0.1',
            '--port', config.port.toString(),
            '--model-dir', config.env.PIPER_MODEL_DIR || '',
        ];
    }
    else if (serviceName === 'yourtts') {
        // YourTTS 服务
        return [
            config.scriptPath,
            '--host', '127.0.0.1',
            '--port', config.port.toString(),
            '--model-dir', config.env.YOURTTS_MODEL_DIR || '',
        ];
    }
    return [];
}
/**
 * 启动服务进程
 */
async function startServiceProcess(serviceName, config, handlers) {
    // 检查虚拟环境
    const pythonExe = path.join(config.venvPath, 'Scripts', 'python.exe');
    if (!fs.existsSync(pythonExe)) {
        const error = `Virtual environment does not exist: ${config.venvPath}`;
        logger_1.default.error({ serviceName, venvPath: config.venvPath }, error);
        throw new Error(error);
    }
    // 检查脚本文件
    if (!fs.existsSync(config.scriptPath)) {
        const error = `Service script does not exist: ${config.scriptPath}`;
        logger_1.default.error({ serviceName, scriptPath: config.scriptPath }, error);
        throw new Error(error);
    }
    // 检查端口是否被占用，如果被占用则尝试清理
    const { checkPortAvailable } = require('../utils/port-manager');
    const portAvailable = await checkPortAvailable(config.port);
    if (!portAvailable) {
        logger_1.default.warn({ serviceName, port: config.port }, `Port ${config.port} is already in use, attempting to cleanup...`);
        await (0, port_manager_1.cleanupPortProcesses)(config.port, serviceName);
        // 等待端口释放
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // 构建启动命令
    const args = buildServiceArgs(serviceName, config);
    // 启动进程
    const process = (0, child_process_1.spawn)(pythonExe, args, {
        env: config.env,
        cwd: config.workingDir,
        stdio: ['ignore', 'pipe', 'pipe'], // 重定向输出到日志文件
        detached: false,
    });
    // 创建日志文件流（使用 UTF-8 编码）
    const logStream = (0, service_logging_1.createLogStream)(config.logFile);
    // 处理输出 - 按行分割并添加时间戳
    let stdoutBuffer = '';
    let stderrBuffer = '';
    process.stdout?.on('data', (data) => {
        // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
        const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
        stdoutBuffer += text;
        stdoutBuffer = (0, service_logging_1.flushLogBuffer)(stdoutBuffer, false, logStream);
    });
    process.stderr?.on('data', (data) => {
        // 确保输出使用 UTF-8 编码，移除可能导致乱码的字符（保留 \n 和 \r）
        const text = data.toString('utf8').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
        stderrBuffer += text;
        stderrBuffer = (0, service_logging_1.flushLogBuffer)(stderrBuffer, true, logStream);
        // 同时输出到控制台以便调试
        logger_1.default.error({ serviceName, stderr: text }, 'Python service stderr output');
    });
    process.on('error', (error) => {
        logger_1.default.error({ error, serviceName }, 'Failed to start Python service process');
        logStream.end();
        handlers.onProcessError(error);
    });
    process.on('exit', (code, signal) => {
        // 刷新剩余的缓冲区内容
        if (stdoutBuffer.trim()) {
            const timestamp = new Date().toISOString();
            const level = (0, service_logging_1.detectLogLevel)(stdoutBuffer, false);
            const logLine = `${timestamp} ${level} ${stdoutBuffer}\n`;
            logStream.write(logLine, 'utf8');
        }
        if (stderrBuffer.trim()) {
            const timestamp = new Date().toISOString();
            const level = (0, service_logging_1.detectLogLevel)(stderrBuffer, true);
            const logLine = `${timestamp} ${level} ${stderrBuffer}\n`;
            logStream.write(logLine, 'utf8');
        }
        logger_1.default.info({ code, signal, serviceName }, 'Python service process exited');
        if (code !== 0 && code !== null) {
            logger_1.default.error({
                code,
                signal,
                serviceName,
                port: config.port,
                logFile: config.logFile,
            }, `Python service exited with code ${code}. Check log file for details: ${config.logFile}`);
        }
        logStream.end();
        // 如果进程在启动阶段（waitForServiceReady 之前）退出，记录更详细的错误信息
        // 对于退出码为 1 的情况，可能是端口被占用或模型加载失败
        if (code === 1) {
            logger_1.default.warn({ serviceName, port: config.port, code, signal }, 'Service process exited during startup (exit code 1), possibly due to port conflict or initialization failure. If startup succeeds subsequently, this may be normal (port release delay)');
        }
        handlers.onProcessExit(code, signal);
    });
    return process;
}
/**
 * 停止服务进程
 */
async function stopServiceProcess(serviceName, child, port) {
    const pid = child.pid;
    logger_1.default.info({ serviceName, pid, port }, `Stopping Python service (port: ${port}, PID: ${pid})...`);
    return new Promise((resolve) => {
        child.once('exit', async (code, signal) => {
            logger_1.default.info({ serviceName, pid, port, code, signal }, `Python service process exited (port: ${port}, exit code: ${code})`);
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
                logger_1.default.error({ error, serviceName, pid }, 'Failed to stop process, attempting force kill');
                child.kill('SIGKILL');
            }
        }
        else {
            child.kill('SIGTERM');
        }
        setTimeout(async () => {
            if (child.exitCode === null && !child.killed) {
                logger_1.default.warn({ serviceName, pid, port }, `Service did not stop within 5 seconds, forcing termination (port: ${port}, PID: ${pid})`);
                child.kill('SIGKILL');
                // 即使强制终止，也验证端口是否释放
                if (port) {
                    await (0, port_manager_1.verifyPortReleased)(port, serviceName);
                }
            }
        }, 5000);
    });
}
/**
 * 等待服务就绪（带进程检查）
 */
async function waitForServiceReadyWithProcessCheck(port, process, serviceName) {
    // YourTTS 服务需要更长的启动时间（模型加载需要 30-60 秒）
    const timeout = serviceName === 'yourtts' ? 90000 : 30000;
    // 检查进程是否在等待期间退出
    let processExited = false;
    const exitHandler = () => {
        processExited = true;
    };
    process.once('exit', exitHandler);
    try {
        await (0, service_health_1.waitForServiceReady)(port, timeout, () => {
            // 检查进程是否还在运行
            if (processExited || process.killed || process.exitCode !== null) {
                throw new Error(`Service process exited during startup (exit code: ${process.exitCode})`);
            }
        });
    }
    finally {
        process.removeListener('exit', exitHandler);
    }
}
