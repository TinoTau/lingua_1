"use strict";
// ===== 模型验证 =====
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
exports.ModelVerifier = void 0;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const utils_1 = require("./utils");
/**
 * 模型验证器
 */
class ModelVerifier {
    constructor(modelHubUrl, modelsDir, tempDir) {
        this.modelHubUrl = modelHubUrl;
        this.modelsDir = modelsDir;
        this.tempDir = tempDir;
    }
    /**
     * 验证模型文件
     */
    async verifyFiles(modelId, version, versionInfo, onProgress) {
        const versionDir = path.join(this.modelsDir, modelId, version);
        const checksumPath = path.join(versionDir, 'checksum.sha256');
        // 下载 checksum 文件
        const checksumUrl = `${this.modelHubUrl}/storage/models/${modelId}/${version}/checksum.sha256`;
        let checksumData = null;
        try {
            const checksumResponse = await axios_1.default.get(checksumUrl);
            checksumData = checksumResponse.data;
            await fs.writeFile(checksumPath, JSON.stringify(checksumData, null, 2), 'utf-8');
        }
        catch (error) {
            // 如果服务器没有 checksum 文件，使用版本信息中的
            console.warn(`无法下载 checksum 文件，将仅验证文件大小: ${error}`);
        }
        // 验证每个文件
        for (let i = 0; i < versionInfo.files.length; i++) {
            const fileInfo = versionInfo.files[i];
            const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
            // 更新验证进度
            onProgress({
                modelId,
                version,
                downloadedBytes: versionInfo.size_bytes,
                totalBytes: versionInfo.size_bytes,
                percent: 100,
                state: 'verifying',
                currentFile: `验证文件 ${i + 1}/${versionInfo.files.length}: ${fileInfo.path}`,
                currentFileProgress: ((i + 1) / versionInfo.files.length) * 100,
            });
            // 检查文件是否存在
            if (!(await (0, utils_1.fileExists)(partPath))) {
                throw new Error(`文件不存在: ${fileInfo.path}`);
            }
            // 验证文件大小
            const stats = await fs.stat(partPath);
            if (stats.size !== fileInfo.size_bytes) {
                throw new Error(`文件大小不匹配: ${fileInfo.path} (期望: ${fileInfo.size_bytes}, 实际: ${stats.size})`);
            }
            // 如果 checksum 数据可用，验证 SHA256
            if (checksumData && checksumData[fileInfo.path]) {
                const fileHash = await this.calculateFileHash(partPath);
                const expectedHash = checksumData[fileInfo.path];
                if (fileHash !== expectedHash) {
                    throw new Error(`文件校验失败: ${fileInfo.path} (SHA256 不匹配)`);
                }
            }
        }
    }
    /**
     * 计算文件 SHA256 哈希
     */
    async calculateFileHash(filePath) {
        const hash = crypto.createHash('sha256');
        const fileBuffer = await fs.readFile(filePath);
        hash.update(fileBuffer);
        return hash.digest('hex');
    }
}
exports.ModelVerifier = ModelVerifier;
