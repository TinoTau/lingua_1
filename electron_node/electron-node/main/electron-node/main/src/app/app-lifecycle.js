"use strict";
/**
 * 应用生命周期管理模块
 * 负责处理应用退出、窗口关闭等生命周期事件
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWindowCloseHandler = registerWindowCloseHandler;
exports.registerWindowAllClosedHandler = registerWindowAllClosedHandler;
exports.registerBeforeQuitHandler = registerBeforeQuitHandler;
exports.registerProcessSignalHandlers = registerProcessSignalHandlers;
exports.registerExceptionHandlers = registerExceptionHandlers;
const electron_1 = require("electron");
const service_cleanup_1 = require("../service-cleanup");
const esbuild_cleanup_1 = require("../utils/esbuild-cleanup");
const app_service_status_1 = require("./app-service-status");
const logger_1 = __importDefault(require("../logger"));
/**
 * 清理应用资源
 */
async function cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager) {
    try {
        await (0, service_cleanup_1.cleanupServices)(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
    }
    catch (error) {
        logger_1.default.error({ error }, 'Cleanup failed, but attempting to notify scheduler');
        if (nodeAgent) {
            try {
                nodeAgent.stop();
            }
            catch (e) {
                // 忽略错误
            }
        }
    }
    (0, esbuild_cleanup_1.cleanupEsbuild)();
}
/**
 * 注册窗口关闭事件处理
 */
function registerWindowCloseHandler(mainWindow, rustServiceManager, pythonServiceManager, semanticRepairServiceManager) {
    if (!mainWindow) {
        return;
    }
    mainWindow.on('close', async () => {
        logger_1.default.info({}, 'Window close event triggered, saving user service preferences...');
        try {
            const serviceStatus = await (0, app_service_status_1.getCurrentServiceStatus)(rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
            (0, app_service_status_1.saveServiceStatusToConfig)(serviceStatus, 'window-close-event');
        }
        catch (error) {
            logger_1.default.error({
                error,
                message: error instanceof Error ? error.message : String(error),
                savedFrom: 'window-close-event',
            }, 'Failed to save service preferences on window close');
        }
    });
}
/**
 * 注册 window-all-closed 事件处理
 */
function registerWindowAllClosedHandler(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager) {
    electron_1.app.on('window-all-closed', async () => {
        logger_1.default.info({ platform: process.platform }, 'window-all-closed event triggered');
        if (process.platform !== 'darwin') {
            logger_1.default.info({}, 'Cleaning up services and saving user preferences (window-all-closed)...');
            await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
            electron_1.app.quit();
        }
    });
}
/**
 * 注册 before-quit 事件处理
 */
function registerBeforeQuitHandler(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager) {
    electron_1.app.on('before-quit', async (event) => {
        logger_1.default.info({ platform: process.platform }, 'before-quit event triggered');
        const rustRunning = rustServiceManager?.getStatus().running;
        const pythonRunning = pythonServiceManager?.getAllServiceStatuses().some(s => s.running);
        const semanticRepairRunning = semanticRepairServiceManager
            ? (await semanticRepairServiceManager.getAllServiceStatuses()).some((s) => s.running)
            : false;
        logger_1.default.info({
            rustRunning,
            pythonRunning,
            semanticRepairRunning,
            hasRunningServices: rustRunning || pythonRunning || semanticRepairRunning,
        }, 'Checking service status before quit');
        if (rustRunning || pythonRunning || semanticRepairRunning) {
            event.preventDefault();
            logger_1.default.info({}, 'Services are running, cleaning up and saving user preferences (before-quit)...');
            await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
            electron_1.app.quit();
        }
        else {
            logger_1.default.info({}, 'No services running, saving user preferences (before-quit)...');
            try {
                const serviceStatus = await (0, app_service_status_1.getCurrentServiceStatus)(rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
                (0, app_service_status_1.saveServiceStatusToConfig)(serviceStatus, 'before-quit-event');
            }
            catch (error) {
                logger_1.default.error({ error }, 'Failed to save service status to config file');
            }
            (0, esbuild_cleanup_1.cleanupEsbuild)();
        }
    });
}
/**
 * 注册进程信号处理
 */
function registerProcessSignalHandlers(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager) {
    // 处理 SIGTERM 信号
    process.on('SIGTERM', async () => {
        logger_1.default.info({}, 'Received SIGTERM signal, cleaning up services and notifying scheduler...');
        await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
        process.exit(0);
    });
    // 处理 SIGINT 信号
    process.on('SIGINT', async () => {
        logger_1.default.info({}, 'Received SIGINT signal, cleaning up services and notifying scheduler...');
        await cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
        process.exit(0);
    });
}
/**
 * 注册异常处理
 */
function registerExceptionHandlers(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager) {
    // 处理未捕获的异常
    process.on('uncaughtException', async (error) => {
        logger_1.default.error({ error }, 'Uncaught exception, cleaning up services and notifying scheduler...');
        try {
            const cleanupPromise = cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
            });
            await Promise.race([cleanupPromise, timeoutPromise]);
        }
        catch (cleanupError) {
            logger_1.default.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
            if (nodeAgent) {
                try {
                    nodeAgent.stop();
                }
                catch (e) {
                    // 忽略错误
                }
            }
        }
        process.exit(1);
    });
    // 处理未处理的 Promise 拒绝
    process.on('unhandledRejection', async (reason, promise) => {
        logger_1.default.error({ reason, promise }, 'Unhandled promise rejection, cleaning up services and notifying scheduler...');
        try {
            const cleanupPromise = cleanupAppResources(nodeAgent, rustServiceManager, pythonServiceManager, semanticRepairServiceManager);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
            });
            await Promise.race([cleanupPromise, timeoutPromise]);
        }
        catch (cleanupError) {
            logger_1.default.error({ error: cleanupError }, 'Cleanup failed or timeout, forcing exit');
            if (nodeAgent) {
                try {
                    nodeAgent.stop();
                }
                catch (e) {
                    // 忽略错误
                }
            }
        }
        process.exit(1);
    });
    // 进程退出时的最后清理
    process.on('exit', () => {
        (0, esbuild_cleanup_1.cleanupEsbuild)();
    });
}
