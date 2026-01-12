"use strict";
// ===== 锁管理 =====
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockManager = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const utils_1 = require("./utils");
/**
 * 锁管理器
 */
class LockManager {
    constructor(lockDir, taskLockTimeout = 30 * 60 * 1000 // 30 分钟
    ) {
        this.lockDir = lockDir;
        this.taskLockTimeout = taskLockTimeout;
    }
    /**
     * 获取任务锁路径
     */
    getTaskLockPath(modelId, version) {
        return path.join(this.lockDir, `${modelId}_${version}.lock`);
    }
    /**
     * 获取文件锁路径
     */
    getFileLockPath(tempDir, modelId, version, fileName) {
        return path.join(tempDir, `${modelId}_${version}.${fileName}.part.lock`);
    }
    /**
     * 获取任务锁
     */
    async acquireTaskLock(modelId, version) {
        const lockPath = this.getTaskLockPath(modelId, version);
        // 检查锁是否存在且有效
        if (await (0, utils_1.fileExists)(lockPath)) {
            try {
                const lockContent = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
                // 检查是否超时
                if (Date.now() - lockContent.timestamp > lockContent.timeout) {
                    // 锁已超时，删除
                    await fs.unlink(lockPath);
                }
                else {
                    // 检查进程是否还在运行
                    if (await this.isProcessAlive(lockContent.pid)) {
                        return false; // 锁有效，任务正在运行
                    }
                    else {
                        // 进程不存在，删除孤儿锁
                        await fs.unlink(lockPath);
                    }
                }
            }
            catch {
                // 锁文件损坏，删除
                await fs.unlink(lockPath).catch(() => { });
            }
        }
        // 创建新锁
        const lock = {
            pid: process.pid,
            timestamp: Date.now(),
            modelId,
            version,
            timeout: this.taskLockTimeout,
        };
        await fs.writeFile(lockPath, JSON.stringify(lock, null, 2));
        return true;
    }
    /**
     * 释放任务锁
     */
    async releaseTaskLock(modelId, version) {
        const lockPath = this.getTaskLockPath(modelId, version);
        await fs.unlink(lockPath).catch(() => { });
    }
    /**
     * 检查进程是否存活
     */
    async isProcessAlive(pid) {
        try {
            // Windows 使用 tasklist，Linux/Mac 使用 kill -0
            if (os.platform() === 'win32') {
                const { exec } = require('child_process');
                return new Promise((resolve) => {
                    exec(`tasklist /FI "PID eq ${pid}"`, (error, stdout) => {
                        resolve(stdout.includes(String(pid)));
                    });
                });
            }
            else {
                process.kill(pid, 0);
                return true;
            }
        }
        catch {
            return false;
        }
    }
    /**
     * 清理孤儿锁
     */
    async cleanupOrphanLocks() {
        try {
            const locks = await fs.readdir(this.lockDir);
            const now = Date.now();
            for (const lockFile of locks) {
                const lockPath = path.join(this.lockDir, lockFile);
                try {
                    const lockContent = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
                    // 检查是否超时（超过 1 小时）
                    if (now - lockContent.timestamp > 60 * 60 * 1000) {
                        await fs.unlink(lockPath);
                        continue;
                    }
                    // 检查进程是否还在运行
                    if (!(await this.isProcessAlive(lockContent.pid))) {
                        await fs.unlink(lockPath);
                    }
                }
                catch {
                    // 锁文件损坏，删除
                    await fs.unlink(lockPath).catch(() => { });
                }
            }
        }
        catch (error) {
            // 使用动态导入避免循环依赖
            const logger = (await Promise.resolve().then(() => __importStar(require('../logger')))).default;
            logger.error({ error }, 'Failed to cleanup orphan locks');
        }
    }
}
exports.LockManager = LockManager;
