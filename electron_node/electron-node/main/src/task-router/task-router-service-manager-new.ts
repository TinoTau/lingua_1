/**
 * Task Router Service Manager (New Architecture)
 * 直接从 ServiceRegistry 读取服务信息，不再依赖旧Manager
 * 
 * 设计原则：
 * 1. 服务信息全部来自 ServiceRegistry
 * 2. 端口来自 service.json 的 port 字段
 * 3. 运行状态来自 entry.runtime.status
 * 4. 不做任何兼容层、fallback、映射表
 */

import logger from '../logger';
import { ServiceType, InstalledService } from '../../../../shared/protocols/messages';
import { ServiceEndpoint } from './types';
import { ServiceRegistry } from '../service-layer/ServiceTypes';

export class TaskRouterServiceManagerNew {
  constructor(private registry: ServiceRegistry) {}

  /**
   * 刷新服务端点列表
   */
  async refreshServiceEndpoints(): Promise<Map<ServiceType, ServiceEndpoint[]>> {
    const endpoints: Map<ServiceType, ServiceEndpoint[]> = new Map();

    // 初始化每个服务类型的列表
    [ServiceType.ASR, ServiceType.NMT, ServiceType.TTS, ServiceType.TONE, ServiceType.SEMANTIC].forEach((type) => {
      endpoints.set(type, []);
    });

    // 遍历 ServiceRegistry
    for (const entry of this.registry.values()) {
      // 只处理运行中的服务
      if (entry.runtime.status !== 'running') {
        continue;
      }

      // 必须有端口
      if (!entry.def.port) {
        logger.warn({ serviceId: entry.def.id }, 'Service running but no port defined');
        continue;
      }

      // 创建端点
      const endpoint: ServiceEndpoint = {
        serviceId: entry.def.id,
        serviceType: this.mapTypeToServiceType(entry.def.type),
        baseUrl: `http://127.0.0.1:${entry.def.port}`,
        port: entry.def.port,
        status: 'running',
      };

      // 添加到对应类型的列表
      const list = endpoints.get(endpoint.serviceType) || [];
      list.push(endpoint);
      endpoints.set(endpoint.serviceType, list);

      logger.debug(
        {
          serviceId: endpoint.serviceId,
          baseUrl: endpoint.baseUrl,
          port: endpoint.port,
          serviceType: endpoint.serviceType,
        },
        'Created service endpoint'
      );
    }

    logger.info(
      {
        asr: endpoints.get(ServiceType.ASR)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        nmt: endpoints.get(ServiceType.NMT)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        tts: endpoints.get(ServiceType.TTS)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        tone: endpoints.get(ServiceType.TONE)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        semantic: endpoints.get(ServiceType.SEMANTIC)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
      },
      'Service endpoints refreshed'
    );

    return endpoints;
  }

  /**
   * 映射 service.json 的 type 到 ServiceType 枚举
   */
  private mapTypeToServiceType(type: string): ServiceType {
    const typeMap: Record<string, ServiceType> = {
      'asr': ServiceType.ASR,
      'nmt': ServiceType.NMT,
      'tts': ServiceType.TTS,
      'tone': ServiceType.TONE,
      'semantic': ServiceType.SEMANTIC,
    };

    const mapped = typeMap[type.toLowerCase()];
    if (!mapped) {
      logger.warn({ type }, `Unknown service type, defaulting to ASR`);
      return ServiceType.ASR;
    }

    return mapped;
  }

  /**
   * 获取已安装的服务列表（用于兼容旧接口）
   */
  async getInstalledServices(): Promise<InstalledService[]> {
    const result: InstalledService[] = [];

    for (const entry of this.registry.values()) {
      const serviceStatus = entry.runtime.status === 'stopped' ? 'stopped' : 'running';
      result.push({
        service_id: entry.def.id,
        type: this.mapTypeToServiceType(entry.def.type),
        device: 'gpu', // 简化：所有服务都标记为GPU
        status: serviceStatus,
        version: entry.def.version || '2.0.0',
      });
    }

    return result;
  }
}
