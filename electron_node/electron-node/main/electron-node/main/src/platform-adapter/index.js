"use strict";
/**
 * PlatformAdapter - 平台适配层
 *
 * 所有平台差异逻辑只允许出现在 PlatformAdapter 内
 * 禁止散落到各个 manager
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
exports.createPlatformAdapter = createPlatformAdapter;
exports.getPlatformAdapter = getPlatformAdapter;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const child_process_1 = require("child_process");
const logger_1 = __importDefault(require("../logger"));
/**
 * Windows 平台适配器实现
 */
class WindowsPlatformAdapter {
    getPlatformId() {
        return 'windows-x64';
    }
    spawn(program, args, options) {
        return (0, child_process_1.spawn)(program, args, {
            ...options,
            shell: false, // 使用 argv 方式，避免 shell 差异
            stdio: options.stdio || 'pipe',
        });
    }
    async makeExecutable(filePath) {
        // Windows 不需要 chmod，文件权限由文件系统管理
        logger_1.default.debug({ filePath }, 'Windows: makeExecutable is no-op');
    }
    async acquireLock(key) {
        // Windows 文件锁实现
        // TODO: 实现基于文件锁的机制
        // 可以使用 proper-lockfile 或自定义实现
        logger_1.default.debug({ key }, 'Windows: acquireLock placeholder');
    }
    pathJoin(...paths) {
        return path.win32.join(...paths);
    }
}
/**
 * Linux 平台适配器实现（预留）
 */
class LinuxPlatformAdapter {
    getPlatformId() {
        return 'linux-x64';
    }
    spawn(program, args, options) {
        return (0, child_process_1.spawn)(program, args, {
            ...options,
            shell: false,
            stdio: options.stdio || 'pipe',
        });
    }
    async makeExecutable(filePath) {
        // Linux 需要 chmod +x
        try {
            await fs.chmod(filePath, 0o755);
            logger_1.default.debug({ filePath }, 'Linux: made file executable');
        }
        catch (error) {
            logger_1.default.error({ error, filePath }, 'Failed to make file executable');
            throw error;
        }
    }
    async acquireLock(key) {
        // Linux 文件锁实现
        // TODO: 实现基于文件锁的机制
        logger_1.default.debug({ key }, 'Linux: acquireLock placeholder');
    }
    pathJoin(...paths) {
        return path.posix.join(...paths);
    }
}
/**
 * 创建平台适配器实例（根据当前平台）
 */
function createPlatformAdapter() {
    const platform = os.platform();
    const arch = os.arch();
    if (platform === 'win32' && arch === 'x64') {
        return new WindowsPlatformAdapter();
    }
    else if (platform === 'linux' && arch === 'x64') {
        return new LinuxPlatformAdapter();
    }
    else if (platform === 'darwin') {
        if (arch === 'arm64') {
            // TODO: 实现 darwin-arm64 适配器
            throw new Error('darwin-arm64 platform adapter not yet implemented');
        }
        else if (arch === 'x64') {
            // TODO: 实现 darwin-x64 适配器
            throw new Error('darwin-x64 platform adapter not yet implemented');
        }
    }
    throw new Error(`Unsupported platform: ${platform}-${arch}`);
}
/**
 * 全局平台适配器实例
 */
let platformAdapterInstance = null;
/**
 * 获取全局平台适配器实例（单例）
 */
function getPlatformAdapter() {
    if (!platformAdapterInstance) {
        platformAdapterInstance = createPlatformAdapter();
    }
    return platformAdapterInstance;
}
