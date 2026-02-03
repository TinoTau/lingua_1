/**
 * ServiceEndpointResolver - 服务端点解析器
 * 
 * 用途：根据能力（capability）查找可用的服务endpoint
 * 
 * 设计原则：
 * 1. 只返回正在运行的服务的endpoint
 * 2. 服务不可用时返回null，让调用方决定如何处理
 * 3. baseUrl 来自配置（getServicesBaseUrl），不再硬编码
 */

import { ServiceRegistry } from './ServiceTypes';
import logger from '../logger';

export class ServiceEndpointResolver {
  constructor(
    private registry: ServiceRegistry,
    private getServicesBaseUrl: () => string
  ) {}

  /**
   * 根据能力查找服务endpoint
   * @param capability 能力名称，如 "nmt", "tts", "asr" 等
   * @returns 服务的 HTTP endpoint URL（由配置 baseUrl 与端口拼接），如果服务不可用则返回 null
   */
  resolve(capability: string): string | null {
    // 遍历所有服务，查找匹配的capability
    // 匹配规则：type字段或tags字段包含capability
    for (const entry of this.registry.values()) {
      const tags = entry.def.tags || [];
      const matchType = entry.def.type === capability;
      const matchTag = tags.includes(capability);

      if (
        (matchType || matchTag) &&
        entry.runtime.status === 'running' &&
        entry.def.port
      ) {
        const base = this.getServicesBaseUrl().replace(/\/$/, '');
        const endpoint = `${base}:${entry.def.port}`;

        logger.debug(
          {
            capability,
            serviceId: entry.def.id,
            endpoint,
          },
          'Resolved service endpoint'
        );

        return endpoint;
      }
    }

    logger.warn({ capability }, 'No running service found for capability');
    return null;
  }

  /**
   * 根据服务ID查找endpoint
   * @param serviceId 服务ID
   * @returns 服务的HTTP endpoint URL，如果服务不可用则返回null
   */
  resolveById(serviceId: string): string | null {
    const entry = this.registry.get(serviceId);

    if (!entry) {
      logger.warn({ serviceId }, 'Service not found in registry');
      return null;
    }

    if (entry.runtime.status !== 'running') {
      logger.warn({ serviceId, status: entry.runtime.status }, 'Service not running');
      return null;
    }

    if (!entry.def.port) {
      logger.warn({ serviceId }, 'Service has no port configured');
      return null;
    }

    const base = this.getServicesBaseUrl().replace(/\/$/, '');
    const endpoint = `${base}:${entry.def.port}`;

    logger.debug(
      {
        serviceId,
        endpoint,
      },
      'Resolved service endpoint by ID'
    );

    return endpoint;
  }

  /**
   * 获取所有可用的服务endpoint
   * @returns Map<serviceId, endpoint>
   */
  getAllAvailable(): Map<string, string> {
    const endpoints = new Map<string, string>();

    const base = this.getServicesBaseUrl().replace(/\/$/, '');
    for (const entry of this.registry.values()) {
      if (entry.runtime.status === 'running' && entry.def.port) {
        endpoints.set(entry.def.id, `${base}:${entry.def.port}`);
      }
    }

    return endpoints;
  }

  /**
   * 检查某个能力是否可用
   */
  isAvailable(capability: string): boolean {
    return this.resolve(capability) !== null;
  }
}
