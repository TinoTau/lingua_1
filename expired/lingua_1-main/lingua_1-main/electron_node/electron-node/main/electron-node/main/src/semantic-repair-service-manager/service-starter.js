"use strict";
/**
 * Semantic Repair Service Manager - Service Starter
 * 服务启动逻辑
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
exports.getServiceConfig = getServiceConfig;
exports.detectPythonCommand = detectPythonCommand;
exports.waitForServiceReady = waitForServiceReady;
exports.startServiceProcess = startServiceProcess;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const logger_1 = __importDefault(require("../logger"));
const port_manager_1 = require("../utils/port-manager");
/**
 * 获取服务配置（从service.json）
 */
async function getServiceConfig(serviceId, serviceRegistryManager) {
    try {
        await serviceRegistryManager.loadRegistry();
        const current = serviceRegistryManager.getCurrent(serviceId);
        if (!current || !current.install_path) {
            throw new Error(`Service ${serviceId} not found or not installed`);
        }
        // 从install_path构建service.json路径
        const serviceJsonPath = path.join(current.install_path, 'service.json');
        if (!require('fs').existsSync(serviceJsonPath)) {
            throw new Error(`service.json not found for ${serviceId} at ${serviceJsonPath}`);
        }
        const serviceJsonContent = require('fs').readFileSync(serviceJsonPath, 'utf-8');
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
 * 检测Python命令
 */
function detectPythonCommand() {
    let command = 'python';
    try {
        try {
            (0, child_process_1.execSync)('python3 --version', { stdio: 'ignore' });
            command = 'python3';
        }
        catch {
            try {
                (0, child_process_1.execSync)('python --version', { stdio: 'ignore' });
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
        logger_1.default.warn({ error }, 'Failed to detect Python, using default: python');
    }
    return command;
}
/**
 * 等待服务就绪（通过健康检查）
 */
async function waitForServiceReady(serviceId, config, isLightweightService, updateStatus) {
    const maxWaitTime = isLightweightService ? 10000 : 120000; // 轻量级服务10秒，模型服务2分钟
    const checkInterval = isLightweightService ? 200 : 1000; // 轻量级服务200ms检查一次，模型服务1秒
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitTime) {
        try {
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
                updateStatus({
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
    throw new Error('Service health check timeout');
}
/**
 * 启动服务进程
 */
async function startServiceProcess(serviceId, config, workingDir, updateStatus) {
    // 检查端口是否可用
    const portAvailable = await (0, port_manager_1.checkPortAvailable)(config.port);
    if (!portAvailable) {
        logger_1.default.warn({ serviceId, port: config.port }, `Port ${config.port} is already in use, attempting to cleanup...`);
        await (0, port_manager_1.cleanupPortProcesses)(config.port, serviceId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    // 构建启动命令
    let command = config.startup_command || 'python';
    if (command === 'python') {
        command = detectPythonCommand();
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
        updateStatus({
            starting: false,
            running: false,
            lastError: errorMessage,
        });
    });
    serviceProcess.on('exit', (code, signal) => {
        const exitMessage = code !== 0 ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : null;
        console.log(`[${serviceId}] Process exited: code=${code}, signal=${signal}`);
        logger_1.default.info({ serviceId, code, signal, command, args, workingDir }, 'Service process exited');
        updateStatus({
            starting: false,
            running: false,
            pid: null,
            lastError: exitMessage,
        });
    });
    // 设置初始状态
    updateStatus({
        starting: true,
        running: false,
        pid: serviceProcess.pid || null,
        port: config.port,
    });
    return serviceProcess;
}
