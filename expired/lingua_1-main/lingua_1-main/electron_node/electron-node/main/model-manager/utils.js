"use strict";
// ===== 工具方法 =====
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
exports.fileExists = fileExists;
exports.findAlternativePath = findAlternativePath;
exports.sleep = sleep;
exports.isRetryableError = isRetryableError;
exports.getErrorStage = getErrorStage;
const os = __importStar(require("os"));
const fs = __importStar(require("fs/promises"));
/**
 * 检查文件是否存在
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * 查找替代路径（非 C 盘）
 */
function findAlternativePath() {
    if (os.platform() === 'win32') {
        const fs = require('fs');
        const drives = ['D', 'E', 'F', 'G', 'H'];
        for (const drive of drives) {
            const testPath = `${drive}:\\LinguaNode`;
            try {
                if (!fs.existsSync(testPath)) {
                    fs.mkdirSync(testPath, { recursive: true });
                }
                return testPath;
            }
            catch {
                // 继续尝试下一个盘
            }
        }
    }
    return null;
}
/**
 * 延迟函数
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * 判断错误是否可重试
 */
function isRetryableError(error) {
    return error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.response?.status >= 500;
}
/**
 * 获取错误阶段
 */
function getErrorStage(error) {
    // 网络错误
    if (error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.response?.status >= 500) {
        return 'network';
    }
    // 磁盘错误
    if (error.code === 'ENOSPC' ||
        error.code === 'EACCES' ||
        error.code === 'EIO' ||
        error.code === 'EROFS') {
        return 'disk';
    }
    // 校验错误
    if (error.message?.includes('校验') ||
        error.message?.includes('checksum') ||
        error.message?.includes('SHA256') ||
        error.message?.includes('大小不匹配')) {
        return 'checksum';
    }
    return 'unknown';
}
