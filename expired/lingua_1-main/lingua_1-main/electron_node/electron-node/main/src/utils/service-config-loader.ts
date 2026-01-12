/**
 * ServiceConfigLoader - 服务配置加载器
 * 
 * 从 service.json 读取服务配置，提供向后兼容性
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '../logger';
import { ServiceJson, PlatformConfig } from '../service-package-manager/types';
import { ServiceRegistryManager } from '../service-registry';
import { getPlatformAdapter } from '../platform-adapter';

/**
 * 从 service.json 加载配置（如果服务已安装）
 */
export async function loadServiceConfigFromJson(
  serviceId: string,
  servicesDir: string
): Promise<{ serviceJson: ServiceJson; platformConfig: PlatformConfig; installPath: string } | null> {
  try {
    const registryManager = new ServiceRegistryManager(servicesDir);
    await registryManager.loadRegistry();
    
    const current = registryManager.getCurrent(serviceId);
    if (!current) {
      return null;
    }

    // 如果没有 service_json_path，说明是手动安装的服务，没有 service.json
    if (!current.service_json_path) {
      logger.debug({ serviceId }, 'Service does not have service.json (manually installed), using fallback config');
      return null;
    }

    const serviceJsonPath = current.service_json_path;
    
    // 读取 service.json
    const content = await fs.readFile(serviceJsonPath, 'utf-8');
    const serviceJson: ServiceJson = JSON.parse(content);

    // 获取平台配置
    const platform = getPlatformAdapter().getPlatformId();
    const platformConfig = serviceJson.platforms[platform];
    
    if (!platformConfig) {
      logger.warn({ serviceId, platform }, 'Platform config not found in service.json');
      return null;
    }

    return {
      serviceJson,
      platformConfig,
      installPath: current.install_path,
    };
  } catch (error) {
    logger.debug({ error, serviceId }, 'Failed to load service.json, will use fallback config');
    return null;
  }
}

/**
 * 将 service.json 的配置转换为 PythonServiceConfig 格式
 */
export function convertToPythonServiceConfig(
  serviceId: string,
  platformConfig: PlatformConfig,
  installPath: string,
  projectRoot: string
): {
  name: string;
  port: number;
  servicePath: string;
  scriptPath: string;
  workingDir: string;
  exec: {
    program: string;
    args: string[];
  };
} {
  const execProgram = path.isAbsolute(platformConfig.exec.program)
    ? platformConfig.exec.program
    : path.join(installPath, platformConfig.exec.program);

  const workingDir = path.isAbsolute(platformConfig.exec.cwd)
    ? platformConfig.exec.cwd
    : path.join(installPath, platformConfig.exec.cwd);

  return {
    name: serviceId,
    port: platformConfig.default_port,
    servicePath: installPath,
    scriptPath: execProgram,
    workingDir,
    exec: {
      program: execProgram,
      args: platformConfig.exec.args.map(arg => {
        // 替换路径变量
        return arg
          .replace('${cwd}', workingDir)
          .replace('${install_path}', installPath);
      }),
    },
  };
}

