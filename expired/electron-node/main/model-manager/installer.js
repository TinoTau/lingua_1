"use strict";
// ===== 模型安装 =====
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
exports.ModelInstaller = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
/**
 * 模型安装器
 */
class ModelInstaller {
    constructor(modelsDir, tempDir, registryManager) {
        this.modelsDir = modelsDir;
        this.tempDir = tempDir;
        this.registryManager = registryManager;
    }
    /**
     * 安装模型文件
     */
    async installFiles(modelId, version, versionInfo, registry) {
        const versionDir = path.join(this.modelsDir, modelId, version);
        for (const fileInfo of versionInfo.files) {
            const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
            const finalPath = path.join(versionDir, fileInfo.path);
            // 确保目标目录存在
            const finalDir = path.dirname(finalPath);
            await fs.mkdir(finalDir, { recursive: true });
            // 移动文件
            await fs.rename(partPath, finalPath);
        }
        // 更新 registry
        if (!registry[modelId]) {
            registry[modelId] = {};
        }
        registry[modelId][version] = {
            status: 'ready',
            installed_at: new Date().toISOString(),
            size_bytes: versionInfo.size_bytes,
            checksum_sha256: versionInfo.checksum_sha256,
        };
        await this.registryManager.saveRegistry(registry);
    }
}
exports.ModelInstaller = ModelInstaller;
