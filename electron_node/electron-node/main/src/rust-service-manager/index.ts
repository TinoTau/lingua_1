import { ChildProcess } from 'child_process';
import logger from '../logger';
import { GpuUsageTracker } from '../utils/gpu-tracker';
import { RustServiceStatus } from './types';
import { findProjectPaths } from './project-root';
import { startRustProcess, stopRustProcess } from './process-manager';
import { waitForServiceReady } from './service-health';
import * as path from 'path';
import { getServiceRegistry } from '../service-layer';

export type { RustServiceStatus };
export { RustServiceManager };

class RustServiceManager {
    private process: ChildProcess | null = null;
    private status: RustServiceStatus = {
        running: false,
        starting: false,
        pid: null,
        port: null,
        startedAt: null,
        lastError: null,
        taskCount: 0,
        gpuUsageMs: 0,
    };
    private taskCount: number = 0; // 任务计数
    private gpuTracker: GpuUsageTracker = new GpuUsageTracker(); // GPU 跟踪器
    private projectPaths: { projectRoot: string; servicePath: string; logDir: string };
    private port: number = 5009;

    constructor() {
        this.projectPaths = findProjectPaths();

        // 确保日志目录存在
        if (!require('fs').existsSync(this.projectPaths.logDir)) {
            require('fs').mkdirSync(this.projectPaths.logDir, { recursive: true });
        }

        // 端口号（从环境变量读取，默认 5009）
        this.port = parseInt(process.env.INFERENCE_SERVICE_PORT || '5009', 10);
    }

    async start(): Promise<void> {
        if (this.process) {
            logger.warn({}, 'Rust service is already running');
            return;
        }

        if (this.status.starting) {
            logger.warn({}, 'Rust service is starting, please wait');
            return;
        }

        // 设置启动中状态
        this.status.starting = true;
        this.status.lastError = null;

        try {
            // 从服务发现获取配置
            const registry = getServiceRegistry();
            if (!registry || !registry.has('node-inference')) {
                throw new Error('node-inference service not found in registry');
            }

            const serviceEntry = registry.get('node-inference')!;
            logger.info({}, 'Loading Rust service configuration from service discovery');
            
            const servicePath = serviceEntry.installPath;
            const port = serviceEntry.def.port || this.port;
            const logFile = path.join(this.projectPaths.logDir, 'node-inference.log');

            // 启动服务进程
            this.process = startRustProcess(
                servicePath,
                this.projectPaths.projectRoot,
                port,
                logFile,
                {
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
                        // 注意：在 Windows 上使用 taskkill /F 强制终止时，退出码为 1 是正常的，不应该视为错误
                        const isWindows = require('process').platform === 'win32';
                        if (code !== 0 && code !== null && !(code === 1 && isWindows)) {
                            const errorMsg = `Process exited with code: ${code}`;
                            this.status.lastError = errorMsg;
                            logger.error(
                                {
                                    code,
                                    signal,
                                    servicePath: this.projectPaths.servicePath,
                                    workingDir: require('path').join(
                                        this.projectPaths.projectRoot,
                                        'electron_node',
                                        'services',
                                        'node-inference'
                                    ),
                                    modelsDir: require('path').join(
                                        this.projectPaths.projectRoot,
                                        'electron_node',
                                        'services',
                                        'node-inference',
                                        'models'
                                    ),
                                },
                                errorMsg
                            );
                        } else if (code === 1 && isWindows) {
                            // Windows 上 taskkill /F 导致的退出码 1，这是正常的
                            logger.info({ code, signal }, 'Rust service stopped via taskkill (normal termination)');
                        }
                    },
                }
            );

            // 等待服务启动（检查端口是否可用）
            // 先等待一小段时间，让服务有时间初始化（模型加载可能需要几秒）
            logger.info(
                {
                    servicePath: this.projectPaths.servicePath,
                    workingDir: require('path').join(
                        this.projectPaths.projectRoot,
                        'electron_node',
                        'services',
                        'node-inference'
                    ),
                    port: this.port,
                    pid: this.process?.pid,
                },
                'Rust service process started, waiting for service to be ready...'
            );

            // 给服务更多时间初始化（模型加载需要时间）
            await new Promise((resolve) => setTimeout(resolve, 2000));

            await waitForServiceReady(
                this.port,
                60000, // 增加到60秒超时
                () => {
                    // 检查进程是否还在运行
                    return {
                        running: this.process !== null && !this.process.killed && this.process.exitCode === null,
                        pid: this.process?.pid,
                        exitCode: this.process?.exitCode,
                    };
                }
            );

            // 使用实际使用的端口（可能从 service.json 读取）
            const actualPort = port;

            this.status.running = true;
            this.status.starting = false;
            this.status.pid = this.process.pid || null;
            this.status.port = actualPort;
            this.status.startedAt = new Date();
            this.status.lastError = null;

            // 更新内部端口变量
            this.port = actualPort;

            // 注意：GPU跟踪不会在服务启动时开始，而是在第一个任务处理时才开始（在incrementTaskCount中）
            // 这样可以确保只有在有实际任务时才统计GPU使用时间

            logger.info(
                {
                    pid: this.status.pid,
                    port: this.status.port,
                    servicePath: this.projectPaths.servicePath,
                    logDir: this.projectPaths.logDir,
                },
                'Rust service started'
            );
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error(
                {
                    errorMessage: errorMsg,
                    errorStack: errorStack,
                    errorType: error instanceof Error ? error.constructor.name : typeof error,
                    servicePath: this.projectPaths.servicePath,
                    projectRoot: this.projectPaths.projectRoot,
                    workingDir: require('path').join(
                        this.projectPaths.projectRoot,
                        'electron_node',
                        'services',
                        'node-inference'
                    ),
                    modelsDir: require('path').join(
                        this.projectPaths.projectRoot,
                        'electron_node',
                        'services',
                        'node-inference',
                        'models'
                    ),
                    port: this.port,
                    processPid: this.process?.pid,
                    processExitCode: this.process?.exitCode,
                    processKilled: this.process?.killed,
                    lastError: this.status.lastError,
                },
                `Failed to start Rust service: ${errorMsg}`
            );
            this.status.starting = false;
            this.status.lastError = errorMsg;
            throw error;
        }
    }

    async stop(): Promise<void> {
        // 停止GPU使用时间跟踪并重置
        this.stopGpuTracking();
        this.gpuTracker.reset();

        await stopRustProcess(this.process, this.port);

        // 重置任务计数和状态（下次启动时从0开始）
        this.taskCount = 0;
        this.status.running = false;
        this.status.pid = null;
        this.status.taskCount = 0;
        this.status.gpuUsageMs = 0;
        this.process = null;
    }

    getStatus(): RustServiceStatus {
        // 更新统计信息
        this.status.taskCount = this.taskCount;

        // 获取GPU使用时间（无论是否有任务，都返回累计值）
        // 注意：如果跟踪器未启动，getGpuUsageMs() 会返回 0
        this.status.gpuUsageMs = this.gpuTracker.getGpuUsageMs();

        return { ...this.status };
    }

    /**
     * 增加任务计数
     * 注意：GPU跟踪现在由任务开始/结束回调控制，不在这个方法中启动
     */
    incrementTaskCount(): void {
        this.taskCount++;
        this.status.taskCount = this.taskCount;
    }

    /**
     * 开始跟踪GPU使用时间
     */
    startGpuTracking(): void {
        this.gpuTracker.startTracking();
    }

    /**
     * 停止跟踪GPU使用时间
     */
    stopGpuTracking(): void {
        this.gpuTracker.stopTracking();
    }
}

