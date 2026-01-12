"use strict";
//! 端口管理工具
//! 
//! 提供跨平台的端口检查、清理和验证功能
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPortAvailable = checkPortAvailable;
exports.findPortProcessWindows = findPortProcessWindows;
exports.findPortProcessUnix = findPortProcessUnix;
exports.findPortProcess = findPortProcess;
exports.killProcessWindows = killProcessWindows;
exports.killProcessUnix = killProcessUnix;
exports.killProcess = killProcess;
exports.cleanupPortProcesses = cleanupPortProcesses;
exports.verifyPortReleased = verifyPortReleased;
exports.logPortOccupier = logPortOccupier;
const logger_1 = __importDefault(require("../logger"));
/**
 * 检查端口是否可用
 */
async function checkPortAvailable(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const net = require('net');
        const testServer = net.createServer();
        testServer.listen(port, host, () => {
            testServer.close(() => resolve(true));
        });
        testServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            }
            else {
                resolve(false);
            }
        });
    });
}
/**
 * 查找占用端口的进程 PID（Windows）
 */
async function findPortProcessWindows(port) {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
        const lines = stdout.trim().split('\n');
        const pids = [];
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[1].includes(`:${port}`)) {
                const pid = parts[parts.length - 1];
                if (pid && !isNaN(parseInt(pid))) {
                    pids.push(parseInt(pid));
                }
            }
        }
        return pids;
    }
    catch (error) {
        logger_1.default.warn({ port, error }, 'Failed to find process occupying port (Windows)');
        return [];
    }
}
/**
 * 查找占用端口的进程 PID（Linux/Mac）
 */
async function findPortProcessUnix(port) {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(`lsof -ti:${port}`);
        const pids = stdout.trim().split('\n').filter((pid) => pid);
        return pids.map((pid) => parseInt(pid));
    }
    catch (error) {
        logger_1.default.warn({ port, error }, 'Failed to find process occupying port (Unix)');
        return [];
    }
}
/**
 * 查找占用端口的进程 PID（跨平台）
 */
async function findPortProcess(port) {
    const nodeProcess = require('process');
    if (nodeProcess.platform === 'win32') {
        return findPortProcessWindows(port);
    }
    else {
        return findPortProcessUnix(port);
    }
}
/**
 * 终止进程（Windows）
 */
async function killProcessWindows(pid) {
    try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        await execAsync(`taskkill /PID ${pid} /F`);
        return true;
    }
    catch (error) {
        logger_1.default.warn({ pid, error }, 'Failed to kill process (Windows)');
        return false;
    }
}
/**
 * 终止进程（Linux/Mac）
 */
async function killProcessUnix(pid) {
    try {
        const nodeProcess = require('process');
        nodeProcess.kill(pid, 'SIGTERM');
        return true;
    }
    catch (error) {
        logger_1.default.warn({ pid, error }, 'Failed to kill process (Unix)');
        return false;
    }
}
/**
 * 终止进程（跨平台）
 */
async function killProcess(pid) {
    const nodeProcess = require('process');
    if (nodeProcess.platform === 'win32') {
        return killProcessWindows(pid);
    }
    else {
        return killProcessUnix(pid);
    }
}
/**
 * 清理占用端口的进程
 */
async function cleanupPortProcesses(port, serviceName) {
    const pids = await findPortProcess(port);
    if (pids.length === 0) {
        return;
    }
    logger_1.default.info({ serviceName, port, pids }, `Found process occupying port ${port}, attempting to kill...`);
    for (const pid of pids) {
        const success = await killProcess(pid);
        if (success) {
            logger_1.default.info({ serviceName, port, pid }, 'Killed process occupying port');
            // 等待端口释放
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        else {
            logger_1.default.warn({ serviceName, port, pid }, 'Failed to kill process');
        }
    }
}
/**
 * 验证端口是否已释放
 */
async function verifyPortReleased(port, serviceName, timeout = 2000) {
    try {
        const net = require('net');
        const testServer = net.createServer();
        return new Promise((resolve) => {
            const timeoutHandle = setTimeout(() => {
                testServer.close();
                logger_1.default.warn({ serviceName, port }, `Port ${port} release verification timeout (may still be occupied)`);
                resolve(false);
            }, timeout);
            testServer.listen(port, '127.0.0.1', () => {
                clearTimeout(timeoutHandle);
                testServer.close(() => {
                    logger_1.default.info({ serviceName, port }, `Port ${port} successfully released`);
                    resolve(true);
                });
            });
            testServer.on('error', (err) => {
                clearTimeout(timeoutHandle);
                if (err.code === 'EADDRINUSE') {
                    logger_1.default.error({ serviceName, port, error: err }, `Port ${port} is still occupied, service may not have closed properly`);
                    resolve(false);
                }
                else {
                    logger_1.default.warn({ serviceName, port, error: err }, `Port ${port} release verification failed`);
                    resolve(false);
                }
            });
        });
    }
    catch (error) {
        logger_1.default.warn({ serviceName, port, error }, `Port ${port} release verification exception`);
        return false;
    }
}
/**
 * 记录占用端口的进程信息
 */
async function logPortOccupier(port, serviceName) {
    const pids = await findPortProcess(port);
    if (pids.length > 0) {
        logger_1.default.warn({ serviceName, port, pids }, `Port ${port} is occupied by process PID(s) ${pids.join(', ')}`);
    }
    else {
        logger_1.default.warn({ serviceName, port }, 'Unable to find process occupying port');
    }
}
