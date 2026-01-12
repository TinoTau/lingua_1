"use strict";
// ===== 模型下载 =====
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
exports.ModelDownloader = void 0;
const axios_1 = __importDefault(require("axios"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const fs_1 = require("fs");
const utils_1 = require("./utils");
const events_1 = require("events");
/**
 * 模型下载器
 */
class ModelDownloader extends events_1.EventEmitter {
    constructor(modelHubUrl, tempDir, maxConcurrentFiles = 3, maxRetries = 3) {
        super();
        this.modelHubUrl = modelHubUrl;
        this.tempDir = tempDir;
        this.maxConcurrentFiles = maxConcurrentFiles;
        this.maxRetries = maxRetries;
    }
    /**
     * 下载单个文件（带重试）
     */
    async downloadFileWithRetry(modelId, version, fileInfo, onProgress) {
        const partPath = path.join(this.tempDir, `${modelId}_${version}.${fileInfo.path}.part`);
        const url = `${this.modelHubUrl}/storage/models/${modelId}/${version}/${fileInfo.path}`;
        let lastError;
        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                await this.downloadFile(url, partPath, fileInfo.size_bytes, (bytes) => {
                    onProgress(bytes, fileInfo.size_bytes);
                });
                return; // 成功
            }
            catch (error) {
                lastError = error;
                // 判断是否可重试
                if (!(0, utils_1.isRetryableError)(error)) {
                    throw error;
                }
                // 最后一次尝试失败
                if (attempt === this.maxRetries - 1) {
                    throw error;
                }
                // 等待后重试（指数退避）
                const retryDelay = [1000, 2000, 5000][attempt];
                // 使用动态导入避免循环依赖
                const logger = (await Promise.resolve().then(() => __importStar(require('../logger')))).default;
                logger.warn({
                    filePath: fileInfo.path,
                    attempt: attempt + 1,
                    maxRetries: this.maxRetries,
                    retryDelay
                }, '文件下载失败，将重试');
                await (0, utils_1.sleep)(retryDelay);
            }
        }
        throw lastError;
    }
    /**
     * 下载文件（支持断点续传）
     */
    async downloadFile(url, filePath, totalSize, onProgress) {
        // 检查断点
        let startByte = 0;
        if (await (0, utils_1.fileExists)(filePath)) {
            const stats = await fs.stat(filePath);
            startByte = stats.size;
        }
        // 使用流式下载
        const response = await axios_1.default.get(url, {
            headers: startByte > 0 ? { Range: `bytes=${startByte}-` } : {},
            responseType: 'stream',
            onDownloadProgress: (progressEvent) => {
                // 计算已下载的总字节数（包括断点前的）
                const loaded = (progressEvent.loaded || 0) + startByte;
                onProgress(loaded - startByte); // 只报告本次下载的字节数
            },
        });
        // 追加写入流
        const writer = (0, fs_1.createWriteStream)(filePath, { flags: 'a' });
        // 使用 Promise 包装流式写入
        await new Promise((resolve, reject) => {
            response.data.pipe(writer);
            response.data.on('error', reject);
            writer.on('error', reject);
            writer.on('finish', resolve);
        });
    }
    /**
     * 下载模型的所有文件
     */
    async downloadModelFiles(modelId, version, versionInfo, onProgress) {
        const startTime = Date.now();
        let lastProgressTime = Date.now();
        let lastProgressBytes = 0;
        // 创建版本目录
        const versionDir = path.join(this.tempDir, '..', modelId, version);
        await fs.mkdir(versionDir, { recursive: true });
        // 下载所有文件（并发限制）
        const fileProgress = new Map();
        let totalDownloadedBytes = 0;
        let completedFiles = 0;
        // 初始化进度
        versionInfo.files.forEach(fileInfo => {
            fileProgress.set(fileInfo.path, 0);
        });
        // 分批下载，每批最多 maxConcurrentFiles 个文件
        for (let i = 0; i < versionInfo.files.length; i += this.maxConcurrentFiles) {
            const batch = versionInfo.files.slice(i, i + this.maxConcurrentFiles);
            const batchPromises = batch.map(fileInfo => this.downloadFileWithRetry(modelId, version, fileInfo, (bytesDownloaded, fileSize) => {
                // 更新该文件的进度
                const previousBytes = fileProgress.get(fileInfo.path) || 0;
                const newBytes = bytesDownloaded;
                fileProgress.set(fileInfo.path, newBytes);
                // 计算总进度
                totalDownloadedBytes = totalDownloadedBytes - previousBytes + newBytes;
                // 计算下载速度和剩余时间
                const now = Date.now();
                const timeDelta = (now - lastProgressTime) / 1000; // 秒
                const bytesDelta = totalDownloadedBytes - lastProgressBytes;
                let downloadSpeed = 0;
                let estimatedTimeRemaining = 0;
                if (timeDelta > 0.5) { // 每 0.5 秒更新一次速度
                    downloadSpeed = bytesDelta / timeDelta;
                    const remainingBytes = versionInfo.size_bytes - totalDownloadedBytes;
                    estimatedTimeRemaining = downloadSpeed > 0 ? remainingBytes / downloadSpeed : 0;
                    lastProgressTime = now;
                    lastProgressBytes = totalDownloadedBytes;
                }
                // 计算当前文件进度
                const currentFileProgress = fileSize > 0 ? (bytesDownloaded / fileSize) * 100 : 0;
                onProgress({
                    modelId,
                    version,
                    downloadedBytes: totalDownloadedBytes,
                    totalBytes: versionInfo.size_bytes,
                    percent: versionInfo.size_bytes > 0 ? (totalDownloadedBytes / versionInfo.size_bytes) * 100 : 0,
                    state: 'downloading',
                    currentFile: fileInfo.path,
                    currentFileProgress,
                    totalFiles: versionInfo.files.length,
                    downloadedFiles: completedFiles,
                    downloadSpeed,
                    estimatedTimeRemaining,
                });
            }).then(() => {
                completedFiles++;
                // 文件下载完成后更新进度
                onProgress({
                    modelId,
                    version,
                    downloadedBytes: totalDownloadedBytes,
                    totalBytes: versionInfo.size_bytes,
                    percent: versionInfo.size_bytes > 0 ? (totalDownloadedBytes / versionInfo.size_bytes) * 100 : 0,
                    state: 'downloading',
                    totalFiles: versionInfo.files.length,
                    downloadedFiles: completedFiles,
                });
            }));
            await Promise.all(batchPromises);
        }
    }
}
exports.ModelDownloader = ModelDownloader;
