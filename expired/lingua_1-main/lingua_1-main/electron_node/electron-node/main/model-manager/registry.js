"use strict";
// ===== Registry 管理 =====
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
exports.RegistryManager = void 0;
const fs = __importStar(require("fs/promises"));
const utils_1 = require("./utils");
/**
 * Registry 管理器
 */
class RegistryManager {
    constructor(registryPath) {
        this.registryPath = registryPath;
    }
    /**
     * 加载 registry
     */
    async loadRegistry() {
        try {
            if (await (0, utils_1.fileExists)(this.registryPath)) {
                const content = await fs.readFile(this.registryPath, 'utf-8');
                return JSON.parse(content);
            }
            else {
                return {};
            }
        }
        catch (error) {
            // 使用动态导入避免循环依赖
            const logger = (await Promise.resolve().then(() => __importStar(require('../logger')))).default;
            logger.error({ error }, '加载 registry 失败');
            return {};
        }
    }
    /**
     * 保存 registry（原子写入）
     */
    async saveRegistry(registry) {
        try {
            // 原子写入：先写临时文件，再重命名
            const tempPath = this.registryPath + '.tmp';
            await fs.writeFile(tempPath, JSON.stringify(registry, null, 2), 'utf-8');
            // fsync 确保数据写入磁盘
            const fd = await fs.open(tempPath, 'r+');
            await fd.sync();
            await fd.close();
            // 原子重命名
            await fs.rename(tempPath, this.registryPath);
        }
        catch (error) {
            // 使用动态导入避免循环依赖
            const logger = (await Promise.resolve().then(() => __importStar(require('../logger')))).default;
            logger.error({ error }, '保存 registry 失败');
            throw error;
        }
    }
}
exports.RegistryManager = RegistryManager;
