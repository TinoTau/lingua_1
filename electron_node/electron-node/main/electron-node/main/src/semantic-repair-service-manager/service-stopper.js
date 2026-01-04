"use strict";
/**
 * Semantic Repair Service Manager - Service Stopper
 * 服务停止逻辑
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
exports.stopServiceProcess = stopServiceProcess;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const logger_1 = __importDefault(require("../logger"));
/**
 * 停止服务进程
 */
async function stopServiceProcess(serviceId, process) {
    logger_1.default.info({ serviceId, pid: process.pid }, 'Stopping service');
    try {
        // 尝试优雅关闭
        const platform = os.platform();
        if (process.pid) {
            // Windows: 使用 taskkill 清理进程树
            // Unix: 使用 kill
            if (platform === 'win32') {
                try {
                    // 使用 taskkill /F /T /PID 强制终止进程树
                    const killProcess = (0, child_process_1.spawn)('taskkill', ['/F', '/T', '/PID', process.pid.toString()], {
                        stdio: 'ignore',
                        windowsHide: true,
                    });
                    killProcess.on('error', (error) => {
                        logger_1.default.warn({ error, serviceId, pid: process.pid }, 'taskkill failed, trying child.kill');
                        process.kill('SIGTERM');
                    });
                }
                catch (error) {
                    logger_1.default.warn({ error, serviceId, pid: process.pid }, 'Failed to spawn taskkill, trying child.kill');
                    process.kill('SIGTERM');
                }
            }
            else {
                process.kill('SIGTERM');
            }
        }
        else {
            process.kill('SIGTERM');
        }
        // 等待进程退出（最多等待10秒，增加超时时间）
        const maxWaitTime = 10000;
        const checkInterval = 100;
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitTime) {
            if (process.killed || process.exitCode !== null) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, checkInterval));
        }
        // 如果进程仍未退出，强制终止
        if (!process.killed && process.exitCode === null) {
            logger_1.default.warn({ serviceId, pid: process.pid }, 'Service did not exit gracefully, forcing termination');
            // Windows: 再次尝试使用 taskkill 强制终止
            if (platform === 'win32' && process.pid) {
                try {
                    const killProcess = (0, child_process_1.spawn)('taskkill', ['/F', '/T', '/PID', process.pid.toString()], {
                        stdio: 'ignore',
                        windowsHide: true,
                    });
                    killProcess.on('error', (error) => {
                        logger_1.default.error({ error, serviceId, pid: process.pid }, 'Force kill taskkill failed');
                        process.kill('SIGKILL');
                    });
                    // 等待 taskkill 完成
                    await new Promise((resolve) => {
                        killProcess.on('exit', resolve);
                        setTimeout(resolve, 2000); // 2秒超时
                    });
                }
                catch (error) {
                    logger_1.default.error({ error, serviceId, pid: process.pid }, 'Exception during force kill');
                    process.kill('SIGKILL');
                }
            }
            else {
                process.kill('SIGKILL');
            }
        }
        logger_1.default.info({ serviceId }, 'Service stopped');
    }
    catch (error) {
        logger_1.default.error({ error, serviceId }, 'Failed to stop service');
        throw error;
    }
}
