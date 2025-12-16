"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RustServiceManager = void 0;
const logger_1 = __importDefault(require("../logger"));
const gpu_tracker_1 = require("../utils/gpu-tracker");
const project_root_1 = require("./project-root");
const process_manager_1 = require("./process-manager");
const service_health_1 = require("./service-health");
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
        this.gpuTracker = new gpu_tracker_1.GpuUsageTracker(); // GPU 跟踪器
        this.port = 5009;
        this.projectPaths = (0, project_root_1.findProjectPaths)();
        // 确保日志目录存在
        if (!require('fs').existsSync(this.projectPaths.logDir)) {
            require('fs').mkdirSync(this.projectPaths.logDir, { recursive: true });
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
        // 设置启动中状态
        this.status.starting = true;
        this.status.lastError = null;
        try {
            const logFile = require('path').join(this.projectPaths.logDir, 'node-inference.log');
            // 启动服务进程
            this.process = (0, process_manager_1.startRustProcess)(this.projectPaths.servicePath, this.projectPaths.projectRoot, this.port, logFile, {
                onProcessError: (error) => {
                    this.status.lastError = error.message;
                    this.status.running = false;
                    this.status.starting = false;
                    this.process = null;
                },
                onProcessExit: (code, signal) => {
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
                            servicePath: this.projectPaths.servicePath,
                            workingDir: require('path').join(this.projectPaths.projectRoot, 'electron_node', 'services', 'node-inference'),
                            modelsDir: require('path').join(this.projectPaths.projectRoot, 'electron_node', 'services', 'node-inference', 'models'),
                        }, errorMsg);
                    }
                },
            });
            // 等待服务启动（检查端口是否可用）
            // 先等待一小段时间，让服务有时间初始化（模型加载可能需要几秒）
            logger_1.default.info({
                servicePath: this.projectPaths.servicePath,
                workingDir: require('path').join(this.projectPaths.projectRoot, 'electron_node', 'services', 'node-inference'),
                port: this.port,
                pid: this.process?.pid,
            }, 'Rust 服务进程已启动，等待服务就绪...');
            // 给服务更多时间初始化（模型加载需要时间）
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await (0, service_health_1.waitForServiceReady)(this.port, 60000, // 增加到60秒超时
            () => {
                // 检查进程是否还在运行
                return {
                    running: this.process !== null && !this.process.killed && this.process.exitCode === null,
                    pid: this.process?.pid,
                    exitCode: this.process?.exitCode,
                };
            });
            this.status.running = true;
            this.status.starting = false;
            this.status.pid = this.process.pid || null;
            this.status.port = this.port;
            this.status.startedAt = new Date();
            this.status.lastError = null;
            // 注意：GPU跟踪不会在服务启动时开始，而是在第一个任务处理时才开始（在incrementTaskCount中）
            // 这样可以确保只有在有实际任务时才统计GPU使用时间
            logger_1.default.info({
                pid: this.status.pid,
                port: this.status.port,
                servicePath: this.projectPaths.servicePath,
                logDir: this.projectPaths.logDir,
            }, 'Rust 服务已启动');
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger_1.default.error({
                errorMessage: errorMsg,
                errorStack: errorStack,
                errorType: error instanceof Error ? error.constructor.name : typeof error,
                servicePath: this.projectPaths.servicePath,
                projectRoot: this.projectPaths.projectRoot,
                workingDir: require('path').join(this.projectPaths.projectRoot, 'electron_node', 'services', 'node-inference'),
                modelsDir: require('path').join(this.projectPaths.projectRoot, 'electron_node', 'services', 'node-inference', 'models'),
                port: this.port,
                processPid: this.process?.pid,
                processExitCode: this.process?.exitCode,
                processKilled: this.process?.killed,
                lastError: this.status.lastError,
            }, `启动 Rust 服务失败: ${errorMsg}`);
            this.status.starting = false;
            this.status.lastError = errorMsg;
            throw error;
        }
    }
    async stop() {
        // 停止GPU使用时间跟踪并重置
        this.stopGpuTracking();
        this.gpuTracker.reset();
        await (0, process_manager_1.stopRustProcess)(this.process, this.port);
        // 重置任务计数和状态（下次启动时从0开始）
        this.taskCount = 0;
        this.status.running = false;
        this.status.pid = null;
        this.status.taskCount = 0;
        this.status.gpuUsageMs = 0;
        this.process = null;
    }
    getStatus() {
        // 更新统计信息
        this.status.taskCount = this.taskCount;
        // 只有在有任务时才返回GPU使用时间，否则返回0
        if (this.taskCount > 0) {
            this.status.gpuUsageMs = this.gpuTracker.getGpuUsageMs();
        }
        else {
            this.status.gpuUsageMs = 0;
        }
        return { ...this.status };
    }
    /**
     * 增加任务计数
     * 注意：GPU跟踪现在由任务开始/结束回调控制，不在这个方法中启动
     */
    incrementTaskCount() {
        this.taskCount++;
        this.status.taskCount = this.taskCount;
    }
    /**
     * 开始跟踪GPU使用时间
     */
    startGpuTracking() {
        this.gpuTracker.startTracking();
    }
    /**
     * 停止跟踪GPU使用时间
     */
    stopGpuTracking() {
        this.gpuTracker.stopTracking();
    }
}
exports.RustServiceManager = RustServiceManager;
