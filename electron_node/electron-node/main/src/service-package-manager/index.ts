/**
 * ServicePackageManager - 服务包管理器
 * 
 * 负责下载、校验、安装、回滚服务包
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import axios, { AxiosProgressEvent } from 'axios';
import { createWriteStream } from 'fs';
// @ts-ignore - adm-zip types may not be available
import AdmZip from 'adm-zip';
import logger from '../logger';
import { getPlatformAdapter, Platform } from '../platform-adapter';
import { ServiceRegistryManager } from '../service-registry';
import { ServiceJson, ServiceVariant, ServiceInfo } from './types';
import { loadNodeConfig } from '../node-config';
import { getSignatureVerifier } from './signature-verifier';

export { ServiceJson, ServiceVariant, ServiceInfo } from './types';

interface InstallProgress {
  service_id: string;
  version: string;
  platform: string;
  stage: 'downloading' | 'verifying' | 'extracting' | 'installing' | 'completed';
  downloadedBytes?: number;
  totalBytes?: number;
  percent?: number;
}

type ProgressCallback = (progress: InstallProgress) => void;

export class ServicePackageManager {
  private modelHubUrl: string;
  private servicesDir: string;
  private stagingDir: string;
  private platformAdapter = getPlatformAdapter();
  private registryManager: ServiceRegistryManager;

  constructor(servicesDir: string) {
    const config = loadNodeConfig();
    const configUrl = config.modelHub?.url;
    const envUrl = process.env.MODEL_HUB_URL;
    
    let urlToUse: string;
    if (configUrl) {
      urlToUse = configUrl;
    } else if (envUrl) {
      urlToUse = envUrl;
    } else {
      urlToUse = 'http://127.0.0.1:5000';
    }
    
    this.modelHubUrl = urlToUse.replace(/localhost/g, '127.0.0.1');
    this.servicesDir = servicesDir;
    this.stagingDir = path.join(servicesDir, '_staging');
    this.registryManager = new ServiceRegistryManager(servicesDir);

    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.servicesDir, { recursive: true });
      await fs.mkdir(this.stagingDir, { recursive: true });
      await this.registryManager.loadRegistry();
    } catch (error) {
      logger.error({ error }, 'Failed to initialize ServicePackageManager');
      throw error;
    }
  }

  /**
   * 获取可用服务列表
   */
  async getAvailableServices(platform?: string): Promise<ServiceInfo[]> {
    try {
      const params: any = {};
      if (platform) {
        params.platform = platform;
      }

      const response = await axios.get<{ services: ServiceInfo[] }>(
        `${this.modelHubUrl}/api/services`,
        { params }
      );

      return response.data.services;
    } catch (error: any) {
      logger.error({ error, modelHubUrl: this.modelHubUrl }, 'Failed to get available services');
      throw new Error(`Failed to get available services: ${error.message}`);
    }
  }

  /**
   * 安装服务包
   */
  async installService(
    serviceId: string,
    version?: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const platform = this.platformAdapter.getPlatformId();
    
    // 1. 获取本机 platform
    logger.info({ serviceId, version, platform }, 'Starting service installation');

    // 2. 从 Model Hub 选择匹配的 variant
    const services = await this.getAvailableServices(platform);
    const service = services.find(s => s.service_id === serviceId);
    
    if (!service) {
      throw new Error(`Service not found: ${serviceId}`);
    }

    const variant = service.variants.find(
      v => v.platform === platform && (!version || v.version === version)
    );

    if (!variant) {
      throw new Error(
        `Service variant not found: ${serviceId} ${version || service.latest_version} ${platform}`
      );
    }

    const targetVersion = variant.version;

    // 检查是否已安装
    const installed = this.registryManager.getInstalled(serviceId, targetVersion, platform);
    if (installed) {
      logger.info({ serviceId, version: targetVersion, platform }, 'Service already installed');
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
    const stagingPath = await this.extractToStaging(
      zipPath,
      serviceId,
      targetVersion,
      platform,
      onProgress
    );

    // 7. 解析 service.json，校验平台配置存在
    const serviceJson = await this.parseServiceJson(stagingPath);

    // 8. 进行基础启动前检查
    await this.validateService(stagingPath, serviceJson, platform);

    // 9. 原子切换：rename staging → versions/<version>/<platform>/
    const installPath = await this.atomicSwitch(stagingPath, serviceId, targetVersion, platform);

    // 10. 更新 installed.json
    const serviceJsonPath = path.join(installPath, 'service.json');
    await this.registryManager.registerInstalled(
      serviceId,
      targetVersion,
      platform,
      installPath,
      serviceJsonPath
    );

    // 11. 如配置要求自动激活：更新 current.json
    // 这里暂时自动激活（可以根据配置决定）
    await this.registryManager.setCurrent(
      serviceId,
      targetVersion,
      platform,
      serviceJsonPath,
      installPath
    );

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

    logger.info({ serviceId, version: targetVersion, platform }, 'Service installed successfully');
  }

  /**
   * 下载服务包
   */
  private async downloadPackage(
    serviceId: string,
    version: string,
    platform: string,
    variant: ServiceVariant,
    onProgress?: ProgressCallback
  ): Promise<string> {
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
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }

      const url = `${this.modelHubUrl}${variant.artifact.url}`;
      
      const response = await axios.get(url, {
        headers: startByte > 0 ? { Range: `bytes=${startByte}-` } : {},
        responseType: 'stream',
        onDownloadProgress: (progressEvent: AxiosProgressEvent) => {
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

      const writer = createWriteStream(zipPath, { flags: startByte > 0 ? 'a' : 'w' });

      await new Promise<void>((resolve, reject) => {
        response.data.pipe(writer);
        response.data.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', resolve);
      });

      logger.info({ serviceId, version, platform, zipPath }, 'Service package downloaded');
      return zipPath;
    } catch (error) {
      logger.error({ error, serviceId, version, platform }, 'Failed to download service package');
      throw error;
    }
  }

  /**
   * 计算文件的 SHA256 哈希
   */
  private async calculateSHA256(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    return hash.digest('hex');
  }

  /**
   * 校验 SHA256
   */
  private async verifySHA256(
    filePath: string,
    expectedHash: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
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

      logger.debug({ filePath, hash: actualHash }, 'SHA256 verification passed');
    } catch (error) {
      logger.error({ error, filePath }, 'SHA256 verification failed');
      throw error;
    }
  }

  /**
   * 校验签名（Ed25519）
   */
  private async verifySignature(
    variant: ServiceVariant,
    fileHash: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (onProgress) {
      onProgress({
        service_id: '',
        version: '',
        platform: '',
        stage: 'verifying',
      });
    }

    try {
      const verifier = getSignatureVerifier();
      const isValid = await verifier.verifySignature(variant, fileHash);

      if (!isValid) {
        throw new Error(`Signature verification failed for service package`);
      }

      logger.debug({ service_id: variant.artifact.url }, 'Signature verification passed');
    } catch (error) {
      logger.error({ error, variant: variant.artifact.url }, 'Signature verification failed');
      throw error;
    }
  }

  /**
   * 解压到 staging 目录
   */
  private async extractToStaging(
    zipPath: string,
    serviceId: string,
    version: string,
    platform: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    if (onProgress) {
      onProgress({
        service_id: serviceId,
        version,
        platform,
        stage: 'extracting',
      });
    }

    try {
      const stagingPath = path.join(
        this.stagingDir,
        `${serviceId}-${version}-${platform}-${Date.now()}`
      );
      await fs.mkdir(stagingPath, { recursive: true });

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(stagingPath, true);

      logger.info({ serviceId, version, platform, stagingPath }, 'Service package extracted');
      return stagingPath;
    } catch (error) {
      logger.error({ error, zipPath }, 'Failed to extract service package');
      throw error;
    }
  }

  /**
   * 解析 service.json
   */
  private async parseServiceJson(stagingPath: string): Promise<ServiceJson> {
    const serviceJsonPath = path.join(stagingPath, 'service.json');
    
    try {
      const content = await fs.readFile(serviceJsonPath, 'utf-8');
      const serviceJson: ServiceJson = JSON.parse(content);
      
      // 验证必填字段
      if (!serviceJson.service_id || !serviceJson.version || !serviceJson.platforms) {
        throw new Error('Invalid service.json: missing required fields');
      }

      return serviceJson;
    } catch (error) {
      logger.error({ error, serviceJsonPath }, 'Failed to parse service.json');
      throw error;
    }
  }

  /**
   * 验证服务（检查文件存在性等）
   */
  private async validateService(
    stagingPath: string,
    serviceJson: ServiceJson,
    platform: Platform
  ): Promise<void> {
    const platformConfig = serviceJson.platforms[platform];
    
    if (!platformConfig) {
      throw new Error(`Platform config not found: ${platform}`);
    }

    // 检查必需文件
    for (const requiredFile of platformConfig.files.requires) {
      const filePath = path.join(stagingPath, requiredFile);
      try {
        await fs.access(filePath);
      } catch (error) {
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
      } catch (error) {
        throw new Error(`Executable file not found: ${platformConfig.exec.program}`);
      }
    }

    logger.debug({ stagingPath, platform }, 'Service validation passed');
  }

  /**
   * 原子切换（rename staging → versions/<version>/<platform>/）
   */
  private async atomicSwitch(
    stagingPath: string,
    serviceId: string,
    version: string,
    platform: string
  ): Promise<string> {
    try {
      const targetPath = path.join(
        this.servicesDir,
        serviceId,
        'versions',
        version,
        platform
      );

      // 确保目标目录的父目录存在
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      // Windows 使用 rename，Linux 使用 move
      await fs.rename(stagingPath, targetPath);

      logger.info({ serviceId, version, platform, targetPath }, 'Atomic switch completed');
      return targetPath;
    } catch (error) {
      logger.error({ error, stagingPath, serviceId, version, platform }, 'Atomic switch failed');
      throw error;
    }
  }

  /**
   * 清理 staging 和超旧版本
   */
  private async cleanup(stagingPath: string, serviceId: string): Promise<void> {
    try {
      // 删除 staging 目录（如果存在）
      try {
        await fs.rm(stagingPath, { recursive: true, force: true });
      } catch (error) {
        // 忽略删除错误
      }

      // 清理超旧版本（保留 current + previous）
      // TODO: 实现版本清理逻辑

      logger.debug({ stagingPath, serviceId }, 'Cleanup completed');
    } catch (error) {
      logger.error({ error, stagingPath, serviceId }, 'Cleanup failed');
      // 清理失败不应影响安装
    }
  }

  /**
   * 回滚到上一个版本
   */
  async rollbackService(serviceId: string): Promise<void> {
    const platform = this.platformAdapter.getPlatformId();
    const previous = this.registryManager.getPrevious(serviceId);

    if (!previous) {
      throw new Error(`No previous version to rollback to: ${serviceId}`);
    }

    logger.info({ serviceId, previousVersion: previous.version, platform }, 'Rolling back service');

    // 更新 current.json
    await this.registryManager.setCurrent(
      serviceId,
      previous.version,
      previous.platform,
      previous.service_json_path,
      previous.install_path
    );

    logger.info({ serviceId, version: previous.version, platform }, 'Service rolled back');
  }
}

