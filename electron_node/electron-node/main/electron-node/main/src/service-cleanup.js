"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupServices = cleanupServices;
const node_config_1 = require("./node-config");
const logger_1 = __importDefault(require("./logger"));
async function cleanupServices(nodeAgent, rustServiceManager, pythonServiceManager) {
    logger_1.default.info({}, '========================================');
    logger_1.default.info({}, 'Starting cleanup of all services...');
    logger_1.default.info({}, '========================================');
    // 记录当前运行的服务状态
    const rustStatus = rustServiceManager?.getStatus();
    const pythonStatuses = pythonServiceManager?.getAllServiceStatuses() || [];
    const runningPythonServices = pythonStatuses.filter(s => s.running);
    logger_1.default.info({
        rustRunning: rustStatus?.running,
        rustPort: rustStatus?.port,
        rustPid: rustStatus?.pid,
        pythonServices: runningPythonServices.map(s => ({
            name: s.name,
            port: s.port,
            pid: s.pid,
        })),
    }, `Current service status - Rust: ${rustStatus?.running ? `port ${rustStatus.port}, PID ${rustStatus.pid}` : 'not running'}, Python: ${runningPythonServices.length} service(s) running`);
    // 在清理服务前，保存当前服务状态到配置文件
    // 这样即使窗口意外关闭，下次启动时也能恢复服务状态
    try {
        const rustEnabled = !!rustStatus?.running;
        const nmtEnabled = !!pythonStatuses.find(s => s.name === 'nmt')?.running;
        const ttsEnabled = !!pythonStatuses.find(s => s.name === 'tts')?.running;
        const yourttsEnabled = !!pythonStatuses.find(s => s.name === 'yourtts')?.running;
        const fasterWhisperVadEnabled = !!pythonStatuses.find(s => s.name === 'faster_whisper_vad')?.running;
        const speakerEmbeddingEnabled = !!pythonStatuses.find(s => s.name === 'speaker_embedding')?.running;
        const config = (0, node_config_1.loadNodeConfig)();
        config.servicePreferences = {
            rustEnabled,
            nmtEnabled,
            ttsEnabled,
            yourttsEnabled,
            fasterWhisperVadEnabled,
            speakerEmbeddingEnabled,
        };
        (0, node_config_1.saveNodeConfig)(config);
        logger_1.default.info({ servicePreferences: config.servicePreferences }, 'Saved current service status to config file');
    }
    catch (error) {
        logger_1.default.error({ error }, 'Failed to save service status to config file');
    }
    // 停止 Node Agent
    if (nodeAgent) {
        try {
            logger_1.default.info({}, 'Stopping Node Agent...');
            nodeAgent.stop();
            logger_1.default.info({}, 'Node Agent stopped');
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to stop Node Agent');
        }
    }
    // 停止 Rust 服务
    if (rustServiceManager) {
        try {
            const status = rustServiceManager.getStatus();
            if (status.running) {
                logger_1.default.info({ port: status.port, pid: status.pid }, `Stopping Rust service (port: ${status.port}, PID: ${status.pid})...`);
                await rustServiceManager.stop();
                logger_1.default.info({ port: status.port }, `Rust service stopped (port: ${status.port})`);
            }
            else {
                logger_1.default.info({}, 'Rust service is not running, no need to stop');
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to stop Rust service');
        }
    }
    // 停止所有 Python 服务
    if (pythonServiceManager) {
        try {
            logger_1.default.info({ count: runningPythonServices.length }, `Stopping all Python services (${runningPythonServices.length} service(s))...`);
            // 添加超时保护，确保清理不会无限期等待
            const cleanupTimeout = 30000; // 30秒超时
            const cleanupPromise = pythonServiceManager.stopAllServices();
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Python services cleanup timeout after ${cleanupTimeout}ms`));
                }, cleanupTimeout);
            });
            await Promise.race([cleanupPromise, timeoutPromise]);
            logger_1.default.info({}, 'All Python services stopped');
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to stop Python services');
            // 即使清理失败，也继续执行，避免阻塞应用退出
        }
    }
    logger_1.default.info({}, '========================================');
    logger_1.default.info({}, 'All services cleanup completed');
    logger_1.default.info({}, '========================================');
}
