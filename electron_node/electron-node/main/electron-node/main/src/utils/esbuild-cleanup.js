"use strict";
/**
 * ESBuild 清理工具
 * 用于在程序退出时自动清理所有 ESBuild 进程
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
exports.cleanupEsbuild = cleanupEsbuild;
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const logger_1 = __importDefault(require("../logger"));
/**
 * 清理所有 ESBuild 进程
 */
function cleanupEsbuild() {
    const platform = os.platform();
    try {
        if (platform === 'win32') {
            // Windows: 使用 taskkill 终止 esbuild 进程
            (0, child_process_1.exec)('taskkill /F /IM esbuild.exe 2>nul', { timeout: 5000 }, (error) => {
                if (error) {
                    // code 128 表示进程不存在，这是正常的
                    if (error.code !== 128 && !error.message.includes('not found')) {
                        logger_1.default.warn({ error: error.message }, '清理 ESBuild 进程时出错');
                    }
                }
                else {
                    logger_1.default.debug({}, '已清理 ESBuild 进程');
                }
            });
        }
        else {
            // Linux/Mac: 使用 pkill 终止 esbuild 进程
            (0, child_process_1.exec)('pkill -f esbuild 2>/dev/null', { timeout: 5000 }, (error) => {
                if (error) {
                    // code 1 表示没有找到进程，这是正常的
                    if (error.code !== 1) {
                        logger_1.default.warn({ error: error.message }, '清理 ESBuild 进程时出错');
                    }
                }
                else {
                    logger_1.default.debug({}, '已清理 ESBuild 进程');
                }
            });
        }
    }
    catch (err) {
        // 忽略清理错误，避免阻塞退出
        logger_1.default.warn({ error: err }, '清理 ESBuild 进程时发生异常');
    }
}
