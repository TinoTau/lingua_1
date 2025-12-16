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
exports.startRustProcess = startRustProcess;
exports.stopRustProcess = stopRustProcess;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = __importDefault(require("../logger"));
const port_manager_1 = require("../utils/port-manager");
const cuda_setup_1 = require("./cuda-setup");
/**
 * 启动 Rust 服务进程
 */
function startRustProcess(servicePath, projectRoot, port, logFile, handlers) {
    // 检查可执行文件是否存在
    if (!fs.existsSync(servicePath)) {
        const error = `Rust 服务可执行文件不存在: ${servicePath}`;
        logger_1.default.error({ servicePath }, error);
        throw new Error(error);
    }
    // 配置 CUDA 环境变量（如果 CUDA 已安装）
    const cudaEnv = (0, cuda_setup_1.setupCudaEnvironment)();
    // 设置环境变量
    // Rust 服务期望在 electron_node/services/node-inference 目录下运行
    const workingDir = path.join(projectRoot, 'electron_node', 'services', 'node-inference');
    const modelsDir = process.env.MODELS_DIR || path.join(workingDir, 'models');
    const env = {
        ...process.env,
        ...cudaEnv,
        INFERENCE_SERVICE_PORT: port.toString(),
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
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const childProcess = (0, child_process_1.spawn)(servicePath, [], {
        env,
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });
    // 处理输出（带时间戳）
    childProcess.stdout?.on('data', (data) => {
        const timestamp = new Date().toISOString();
        const line = `${timestamp} ${data.toString()}`;
        logStream.write(line);
    });
    childProcess.stderr?.on('data', (data) => {
        const timestamp = new Date().toISOString();
        const line = `${timestamp} ${data.toString()}`;
        logStream.write(line);
    });
    childProcess.on('error', (error) => {
        const errorMsg = `Rust 服务进程启动失败: ${error.message}`;
        logger_1.default.error({ error, servicePath, workingDir }, errorMsg);
        logStream.end();
        handlers.onProcessError(new Error(errorMsg));
    });
    childProcess.on('exit', (code, signal) => {
        logger_1.default.info({ code, signal, pid: childProcess?.pid }, 'Rust 服务进程已退出');
        logStream.end();
        handlers.onProcessExit(code, signal);
    });
    return childProcess;
}
/**
 * 停止服务进程
 */
async function stopRustProcess(childProcess, port) {
    if (!childProcess) {
        logger_1.default.info({ port }, `Rust 服务未运行 (端口: ${port})，无需停止`);
        return;
    }
    const pid = childProcess.pid;
    logger_1.default.info({ pid, port }, `正在停止 Rust 服务 (端口: ${port}, PID: ${pid})...`);
    return new Promise(async (resolve) => {
        if (!childProcess) {
            resolve();
            return;
        }
        childProcess.once('exit', async () => {
            logger_1.default.info({ pid, port }, `Rust 服务进程已退出 (端口: ${port}, PID: ${pid})`);
            // 验证端口是否已释放
            await (0, port_manager_1.verifyPortReleased)(port, 'rust');
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
                if (childProcess) {
                    childProcess.kill('SIGKILL');
                }
            }
        }
        else {
            childProcess.kill('SIGTERM');
        }
        // 超时强制终止
        setTimeout(async () => {
            if (childProcess && childProcess.exitCode === null && !childProcess.killed) {
                logger_1.default.warn({ pid, port }, `服务未在 5 秒内停止，强制终止 (端口: ${port}, PID: ${pid})`);
                childProcess.kill('SIGKILL');
                // 即使强制终止，也验证端口是否释放
                await (0, port_manager_1.verifyPortReleased)(port, 'rust');
            }
        }, 5000);
    });
}
