"use strict";
/**
 * ServicePackageManager - 服务包管理器
 *
 * 负责下载、校验、安装、回滚服务包
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
exports.ServicePackageManager = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = require("fs");
// @ts-ignore - adm-zip types may not be available
const adm_zip_1 = __importDefault(require("adm-zip"));
const logger_1 = __importDefault(require("../logger"));
const platform_adapter_1 = require("../platform-adapter");
const service_registry_1 = require("../service-registry");
const node_config_1 = require("../node-config");
const signature_verifier_1 = require("./signature-verifier");
class ServicePackageManager {
    constructor(servicesDir) {
        this.platformAdapter = (0, platform_adapter_1.getPlatformAdapter)();
        const config = (0, node_config_1.loadNodeConfig)();
        const configUrl = config.modelHub?.url;
        const envUrl = process.env.MODEL_HUB_URL;
        let urlToUse;
        if (configUrl) {
            urlToUse = configUrl;
        }
        else if (envUrl) {
            urlToUse = envUrl;
        }
        else {
            urlToUse = 'http://127.0.0.1:5000';
        }
        this.modelHubUrl = urlToUse.replace(/localhost/g, '127.0.0.1');
        this.servicesDir = servicesDir;
        this.stagingDir = path.join(servicesDir, '_staging');
        this.registryManager = new service_registry_1.ServiceRegistryManager(servicesDir);
        this.initialize();
    }
    async initialize() {
        try {
            await fs.mkdir(this.servicesDir, { recursive: true });
            await fs.mkdir(this.stagingDir, { recursive: true });
            await this.registryManager.loadRegistry();
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to initialize ServicePackageManager');
            throw error;
        }
    }
    /**
     * 获取可用服务列表
     */
    async getAvailableServices(platform) {
        try {
            const params = {};
            if (platform) {
                params.platform = platform;
            }
            const response = await axios_1.default.get(`${this.modelHubUrl}/api/services`, { params });
            return response.data.services;
        }
        catch (error) {
            logger_1.default.error({ error, modelHubUrl: this.modelHubUrl }, 'Failed to get available services');
            throw new Error(`Failed to get available services: ${error.message}`);
        }
    }
    /**
     * 安装服务包
     */
    async installService(serviceId, version, onProgress) {
        const platform = this.platformAdapter.getPlatformId();
        // 1. 获取本机 platform
        logger_1.default.info({ serviceId, version, platform }, 'Starting service installation');
        // 2. 从 Model Hub 选择匹配的 variant
        const services = await this.getAvailableServices(platform);
        const service = services.find(s => s.service_id === serviceId);
        if (!service) {
            throw new Error(`Service not found: ${serviceId}`);
        }
        const variant = service.variants.find(v => v.platform === platform && (!version || v.version === version));
        if (!variant) {
            throw new Error(`Service variant not found: ${serviceId} ${version || service.latest_version} ${platform}`);
        }
        const targetVersion = variant.version;
        // 检查是否已安装
        const installed = this.registryManager.getInstalled(serviceId, targetVersion, platform);
        if (installed) {
            logger_1.default.info({ serviceId, version: targetVersion, platform }, 'Service already installed');
            return;
        }
        // 3. 下载 zip（断点续传）
        const zipPath = await this.downloadPackage(serviceId, targetVersion, platform, variant, onProgress);
        // 4. 校验 SHA256（完整性）
        const fileHash = await this.calculateSHA256(zipPath);
        await this.verifySHA256(zipPath, variant.artifact.sha256, onProgress);
        // 5. 校验签名（可信性）
        await this.verifySignature(variant, fileHash, onProgress);
        // 6. 解压到 staging 目录
        const stagingPath = await this.extractToStaging(zipPath, serviceId, targetVersion, platform, onProgress);
        // 7. 解析 service.json，校验平台配置存在
        const serviceJson = await this.parseServiceJson(stagingPath);
        // 8. 进行基础启动前检查
        await this.validateService(stagingPath, serviceJson, platform);
        // 9. 原子切换：rename staging → versions/<version>/<platform>/
        const installPath = await this.atomicSwitch(stagingPath, serviceId, targetVersion, platform);
        // 10. 更新 installed.json
        const serviceJsonPath = path.join(installPath, 'service.json');
        await this.registryManager.registerInstalled(serviceId, targetVersion, platform, installPath, serviceJsonPath);
        // 11. 如配置要求自动激活：更新 current.json
        // 这里暂时自动激活（可以根据配置决定）
        await this.registryManager.setCurrent(serviceId, targetVersion, platform, serviceJsonPath, installPath);
        // 12. 清理 staging 与超旧版本
        await this.cleanup(stagingPath, serviceId);
        if (onProgress) {
            onProgress({
                service_id: serviceId,
                version: targetVersion,
                platform,
                stage: 'completed',
                percent: 100,
            });
        }
        logger_1.default.info({ serviceId, version: targetVersion, platform }, 'Service installed successfully');
    }
    /**
     * 下载服务包
     */
    async downloadPackage(serviceId, version, platform, variant, onProgress) {
        const zipFileName = `service.zip`;
        const zipPath = path.join(this.stagingDir, `${serviceId}-${version}-${platform}-${Date.now()}.zip`);
        if (onProgress) {
            onProgress({
                service_id: serviceId,
                version,
                platform,
                stage: 'downloading',
                downloadedBytes: 0,
                totalBytes: variant.artifact.size_bytes,
                percent: 0,
            });
        }
        try {
            // 检查断点续传
            let startByte = 0;
            try {
                const stats = await fs.stat(zipPath);
                startByte = stats.size;
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
            }
            const url = `${this.modelHubUrl}${variant.artifact.url}`;
            const response = await axios_1.default.get(url, {
                headers: startByte > 0 ? { Range: `bytes=${startByte}-` } : {},
                responseType: 'stream',
                onDownloadProgress: (progressEvent) => {
                    const loaded = (progressEvent.loaded || 0) + startByte;
                    const total = variant.artifact.size_bytes;
                    const percent = Math.round((loaded / total) * 100);
                    if (onProgress) {
                        onProgress({
                            service_id: serviceId,
                            version,
                            platform,
                            stage: 'downloading',
                            downloadedBytes: loaded,
                            totalBytes: total,
                            percent,
                        });
                    }
                },
            });
            const writer = (0, fs_1.createWriteStream)(zipPath, { flags: startByte > 0 ? 'a' : 'w' });
            await new Promise((resolve, reject) => {
                response.data.pipe(writer);
                response.data.on('error', reject);
                writer.on('error', reject);
                writer.on('finish', resolve);
            });
            logger_1.default.info({ serviceId, version, platform, zipPath }, 'Service package downloaded');
            return zipPath;
        }
        catch (error) {
            logger_1.default.error({ error, serviceId, version, platform }, 'Failed to download service package');
            throw error;
        }
    }
    /**
     * 计算文件的 SHA256 哈希
     */
    async calculateSHA256(filePath) {
        const fileBuffer = await fs.readFile(filePath);
        const hash = crypto.createHash('sha256');
        hash.update(fileBuffer);
        return hash.digest('hex');
    }
    /**
     * 校验 SHA256
     */
    async verifySHA256(filePath, expectedHash, onProgress) {
        if (onProgress) {
            onProgress({
                service_id: '',
                version: '',
                platform: '',
                stage: 'verifying',
            });
        }
        try {
            const actualHash = await this.calculateSHA256(filePath);
            if (actualHash !== expectedHash) {
                throw new Error(`SHA256 verification failed: expected ${expectedHash}, got ${actualHash}`);
            }
            logger_1.default.debug({ filePath, hash: actualHash }, 'SHA256 verification passed');
        }
        catch (error) {
            logger_1.default.error({ error, filePath }, 'SHA256 verification failed');
            throw error;
        }
    }
    /**
     * 校验签名（Ed25519）
     */
    async verifySignature(variant, fileHash, onProgress) {
        if (onProgress) {
            onProgress({
                service_id: '',
                version: '',
                platform: '',
                stage: 'verifying',
            });
        }
        try {
            const verifier = (0, signature_verifier_1.getSignatureVerifier)();
            const isValid = await verifier.verifySignature(variant, fileHash);
            if (!isValid) {
                throw new Error(`Signature verification failed for service package`);
            }
            logger_1.default.debug({ service_id: variant.artifact.url }, 'Signature verification passed');
        }
        catch (error) {
            logger_1.default.error({ error, variant: variant.artifact.url }, 'Signature verification failed');
            throw error;
        }
    }
    /**
     * 解压到 staging 目录
     */
    async extractToStaging(zipPath, serviceId, version, platform, onProgress) {
        if (onProgress) {
            onProgress({
                service_id: serviceId,
                version,
                platform,
                stage: 'extracting',
            });
        }
        try {
            const stagingPath = path.join(this.stagingDir, `${serviceId}-${version}-${platform}-${Date.now()}`);
            await fs.mkdir(stagingPath, { recursive: true });
            const zip = new adm_zip_1.default(zipPath);
            zip.extractAllTo(stagingPath, true);
            logger_1.default.info({ serviceId, version, platform, stagingPath }, 'Service package extracted');
            return stagingPath;
        }
        catch (error) {
            logger_1.default.error({ error, zipPath }, 'Failed to extract service package');
            throw error;
        }
    }
    /**
     * 解析 service.json
     */
    async parseServiceJson(stagingPath) {
        const serviceJsonPath = path.join(stagingPath, 'service.json');
        try {
            const content = await fs.readFile(serviceJsonPath, 'utf-8');
            const serviceJson = JSON.parse(content);
            // 验证必填字段
            if (!serviceJson.service_id || !serviceJson.version || !serviceJson.platforms) {
                throw new Error('Invalid service.json: missing required fields');
            }
            return serviceJson;
        }
        catch (error) {
            logger_1.default.error({ error, serviceJsonPath }, 'Failed to parse service.json');
            throw error;
        }
    }
    /**
     * 验证服务（检查文件存在性等）
     */
    async validateService(stagingPath, serviceJson, platform) {
        const platformConfig = serviceJson.platforms[platform];
        if (!platformConfig) {
            throw new Error(`Platform config not found: ${platform}`);
        }
        // 检查必需文件
        for (const requiredFile of platformConfig.files.requires) {
            const filePath = path.join(stagingPath, requiredFile);
            try {
                await fs.access(filePath);
            }
            catch (error) {
                throw new Error(`Required file not found: ${requiredFile}`);
            }
        }
        // 检查可执行文件（如果存在）
        if (platformConfig.exec?.program) {
            const execPath = path.join(stagingPath, platformConfig.exec.program);
            try {
                await fs.access(execPath);
                // 如果是 Linux/macOS，确保文件可执行
                if (platform !== 'windows-x64') {
                    await this.platformAdapter.makeExecutable(execPath);
                }
            }
            catch (error) {
                throw new Error(`Executable file not found: ${platformConfig.exec.program}`);
            }
        }
        logger_1.default.debug({ stagingPath, platform }, 'Service validation passed');
    }
    /**
     * 原子切换（rename staging → versions/<version>/<platform>/）
     */
    async atomicSwitch(stagingPath, serviceId, version, platform) {
        try {
            const targetPath = path.join(this.servicesDir, serviceId, 'versions', version, platform);
            // 确保目标目录的父目录存在
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            // Windows 使用 rename，Linux 使用 move
            await fs.rename(stagingPath, targetPath);
            logger_1.default.info({ serviceId, version, platform, targetPath }, 'Atomic switch completed');
            return targetPath;
        }
        catch (error) {
            logger_1.default.error({ error, stagingPath, serviceId, version, platform }, 'Atomic switch failed');
            throw error;
        }
    }
    /**
     * 清理 staging 和超旧版本
     */
    async cleanup(stagingPath, serviceId) {
        try {
            // 删除 staging 目录（如果存在）
            try {
                await fs.rm(stagingPath, { recursive: true, force: true });
            }
            catch (error) {
                // 忽略删除错误
            }
            // 清理超旧版本（保留 current + previous）
            // TODO: 实现版本清理逻辑
            logger_1.default.debug({ stagingPath, serviceId }, 'Cleanup completed');
        }
        catch (error) {
            logger_1.default.error({ error, stagingPath, serviceId }, 'Cleanup failed');
            // 清理失败不应影响安装
        }
    }
    /**
     * 回滚到上一个版本
     */
    async rollbackService(serviceId) {
        const platform = this.platformAdapter.getPlatformId();
        const previous = this.registryManager.getPrevious(serviceId);
        if (!previous) {
            throw new Error(`No previous version to rollback to: ${serviceId}`);
        }
        logger_1.default.info({ serviceId, previousVersion: previous.version, platform }, 'Rolling back service');
        // 更新 current.json
        await this.registryManager.setCurrent(serviceId, previous.version, previous.platform, previous.service_json_path, previous.install_path);
        logger_1.default.info({ serviceId, version: previous.version, platform }, 'Service rolled back');
    }
}
exports.ServicePackageManager = ServicePackageManager;
