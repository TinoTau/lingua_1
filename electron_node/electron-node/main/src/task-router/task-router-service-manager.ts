/**
 * Task Router Service Manager
 * 处理服务端点管理相关的逻辑
 */

import logger from '../logger';
import { ServiceType, InstalledService } from '../../../../shared/protocols/messages';
import { ServiceEndpoint } from './types';

export class TaskRouterServiceManager {
  constructor(
    private pythonServiceManager: any,
    private rustServiceManager: any,
    private serviceRegistryManager: any,
    private semanticRepairServiceManager?: any
  ) {}

  /**
   * 刷新服务端点列表
   */
  async refreshServiceEndpoints(): Promise<Map<ServiceType, ServiceEndpoint[]>> {
    const endpoints: Map<ServiceType, ServiceEndpoint[]> = new Map();

    // 初始化每个服务类型的列表
    [ServiceType.ASR, ServiceType.NMT, ServiceType.TTS, ServiceType.TONE, ServiceType.SEMANTIC].forEach((type) => {
      endpoints.set(type, []);
    });

    // 从服务管理器获取运行中的服务
    const installedServices = await this.getInstalledServices();

    logger.debug({
      installedServicesCount: installedServices.length,
      installedServices: installedServices.map(s => ({
        service_id: s.service_id,
        type: s.type,
        status: s.status,
      })),
    }, 'Refreshing service endpoints');

    for (const service of installedServices) {
      if (service.status !== 'running') {
        logger.debug({ serviceId: service.service_id, status: service.status }, 'Skipping non-running service');
        continue;
      }

      const endpoint = await this.createServiceEndpoint(service);
      if (endpoint) {
        const existing = endpoints.get(service.type) || [];
        existing.push(endpoint);
        endpoints.set(service.type, existing);
        logger.debug({
          serviceId: endpoint.serviceId,
          baseUrl: endpoint.baseUrl,
          port: endpoint.port,
          serviceType: endpoint.serviceType,
        }, 'Created service endpoint');
      } else {
        logger.warn({
          serviceId: service.service_id,
          serviceType: service.type,
        }, 'Failed to create service endpoint (port not available)');
      }
    }

    logger.info(
      {
        asr: endpoints.get(ServiceType.ASR)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        nmt: endpoints.get(ServiceType.NMT)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        tts: endpoints.get(ServiceType.TTS)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
        tone: endpoints.get(ServiceType.TONE)?.map(e => ({ serviceId: e.serviceId, baseUrl: e.baseUrl })) || [],
      },
      'Service endpoints refreshed'
    );

    return endpoints;
  }

  /**
   * 创建服务端点
   */
  private async createServiceEndpoint(service: InstalledService): Promise<ServiceEndpoint | null> {
    const port = await this.getServicePort(service.service_id);
    if (!port) {
      logger.warn({
        serviceId: service.service_id,
        serviceType: service.type,
        status: service.status,
      }, 'Cannot create service endpoint: port not available');
      return null;
    }

    const endpoint = {
      serviceId: service.service_id,
      serviceType: service.type,
      baseUrl: `http://127.0.0.1:${port}`,
      port,
      status: service.status,
    };

    logger.debug({
      serviceId: endpoint.serviceId,
      baseUrl: endpoint.baseUrl,
      port: endpoint.port,
      serviceType: endpoint.serviceType,
      status: endpoint.status,
    }, 'Created service endpoint');

    return endpoint;
  }

  /**
   * 获取服务端口
   */
  private async getServicePort(serviceId: string): Promise<number | null> {
    // 服务ID到端口的映射
    const portMap: Record<string, number> = {
      'faster-whisper-vad': 6007,
      'node-inference': 5009,
      'nmt-m2m100': 5008,
      'piper-tts': 5006,
      'your-tts': 5004,
      'speaker-embedding': 5003,
      // 语义修复服务端口
      'semantic-repair-zh': 5013,      // 旧服务（已弃用）
      'semantic-repair-en': 5011,      // 旧服务（已弃用）
      'en-normalize': 5012,             // 旧服务（已弃用）
      'semantic-repair-en-zh': 5015,   // 新统一服务
    };

    // 首先尝试从映射表获取
    if (portMap[serviceId]) {
      logger.debug({ serviceId, port: portMap[serviceId], source: 'portMap' }, 'Got service port from portMap');
      return portMap[serviceId];
    }

    // 尝试从服务管理器获取
    if (serviceId === 'node-inference' && this.rustServiceManager) {
      const status = this.rustServiceManager.getStatus();
      if (status?.port) {
        return status.port;
      }
    }

    // 尝试从Python服务管理器获取
    const pythonServiceNameMap: Record<string, string> = {
      'nmt-m2m100': 'nmt',
      'piper-tts': 'tts',
      'your-tts': 'yourtts',
      'speaker-embedding': 'speaker_embedding',
      'faster-whisper-vad': 'faster_whisper_vad',
      // 语义修复服务可能通过Python服务管理器管理
      'semantic-repair-zh': 'semantic_repair_zh',          // 旧服务
      'semantic-repair-en': 'semantic_repair_en',          // 旧服务
      'en-normalize': 'en_normalize',                       // 旧服务
      'semantic-repair-en-zh': 'semantic_repair_en_zh',   // 新统一服务
    };

    const pythonServiceName = pythonServiceNameMap[serviceId];
    if (pythonServiceName && this.pythonServiceManager) {
      const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
      if (status?.port) {
        return status.port;
      }
    }

    return null;
  }

  /**
   * 获取已安装的服务列表
   */
  private async getInstalledServices(): Promise<InstalledService[]> {
    const result: InstalledService[] = [];

    // 从服务注册表获取
    if (this.serviceRegistryManager) {
      try {
        await this.serviceRegistryManager.loadRegistry();
        const installed = this.serviceRegistryManager.listInstalled();
        for (const service of installed) {
          const running = this.isServiceRunning(service.service_id);
          result.push({
            service_id: service.service_id,
            type: this.getServiceType(service.service_id),
            device: 'gpu',
            status: running ? 'running' : 'stopped',
            version: service.version || '2.0.0',
          });
        }
      } catch (error) {
        logger.error({ error }, 'Failed to get installed services from registry');
      }
    }

    // 补充Python服务
    if (this.pythonServiceManager) {
      const pythonServices = ['nmt', 'tts', 'yourtts', 'speaker_embedding', 'faster_whisper_vad'];
      for (const serviceName of pythonServices) {
        const serviceId = this.getServiceIdFromPythonName(serviceName);
        const status = this.pythonServiceManager.getServiceStatus(serviceName);
        if (status?.running) {
          result.push({
            service_id: serviceId,
            type: this.getServiceType(serviceId),
            device: 'gpu',
            status: 'running',
            version: '2.0.0',
          });
        }
      }
    }

    // 补充语义修复服务（从服务注册表获取，检查是否运行）
    const semanticRepairServices = ['semantic-repair-zh', 'semantic-repair-en', 'en-normalize'];
    for (const serviceId of semanticRepairServices) {
      // 检查服务是否在注册表中
      if (this.serviceRegistryManager) {
        try {
          const current = this.serviceRegistryManager.getCurrent(serviceId);
          if (current) {
            // 检查服务是否运行（通过端口检查或进程检查）
            const running = this.isServiceRunning(serviceId);
            result.push({
              service_id: serviceId,
              type: this.getServiceType(serviceId),
              device: 'gpu',
              status: running ? 'running' : 'stopped',
              version: current.version || '2.0.0',
            });
          }
        } catch (error) {
          logger.debug({ serviceId, error }, 'Failed to check semantic repair service in registry');
        }
      }
    }

    // 补充Rust服务
    if (this.rustServiceManager) {
      const status = this.rustServiceManager.getStatus();
      if (status?.running) {
        result.push({
          service_id: 'node-inference',
          type: ServiceType.ASR, // node-inference 可以作为 ASR 服务
          device: 'gpu',
          status: 'running',
          version: '2.0.0',
        });
      }
    }

    return result;
  }

  /**
   * 检查服务是否运行
   */
  private isServiceRunning(serviceId: string): boolean {
    if (serviceId === 'node-inference' && this.rustServiceManager) {
      const status = this.rustServiceManager.getStatus();
      return status?.running === true;
    }

    // 语义修复服务：通过检查SemanticRepairServiceManager来获取实际运行状态
    if (serviceId === 'semantic-repair-zh' || serviceId === 'semantic-repair-en' || serviceId === 'en-normalize') {
      // 优先使用SemanticRepairServiceManager检查实际运行状态
      if (this.semanticRepairServiceManager) {
        try {
          const status = this.semanticRepairServiceManager.getServiceStatus(serviceId);
          // 返回实际运行状态
          return status?.running === true;
        } catch (error) {
          logger.debug({ serviceId, error }, 'Failed to check semantic repair service status from SemanticRepairServiceManager');
        }
      }
      // 如果没有SemanticRepairServiceManager，降级到注册表检查（向后兼容）
      if (this.serviceRegistryManager) {
        try {
          const current = this.serviceRegistryManager.getCurrent(serviceId);
          // 如果服务在注册表中，认为可能运行（实际状态由健康检查决定）
          return current !== null && current !== undefined;
        } catch (error) {
          logger.debug({ serviceId, error }, 'Failed to check semantic repair service in registry');
        }
      }
      return false;
    }

    const pythonServiceNameMap: Record<string, string> = {
      'nmt-m2m100': 'nmt',
      'piper-tts': 'tts',
      'your-tts': 'yourtts',
      'speaker-embedding': 'speaker_embedding',
      'faster-whisper-vad': 'faster_whisper_vad',
    };

    const pythonServiceName = pythonServiceNameMap[serviceId];
    if (pythonServiceName && this.pythonServiceManager) {
      const status = this.pythonServiceManager.getServiceStatus(pythonServiceName);
      return status?.running === true;
    }

    return false;
  }

  /**
   * 获取服务类型
   */
  private getServiceType(serviceId: string): ServiceType {
    const typeMap: Record<string, ServiceType> = {
      'faster-whisper-vad': ServiceType.ASR,
      'node-inference': ServiceType.ASR,
      'nmt-m2m100': ServiceType.NMT,
      'piper-tts': ServiceType.TTS,
      'your-tts': ServiceType.TTS,
      'speaker-embedding': ServiceType.TONE,
      // 语义修复服务归类为SEMANTIC类型
      'semantic-repair-zh': ServiceType.SEMANTIC,
      'semantic-repair-en': ServiceType.SEMANTIC,
      'en-normalize': ServiceType.SEMANTIC,
    };
    return typeMap[serviceId] || ServiceType.ASR;
  }

  /**
   * 从Python服务名获取服务ID
   */
  private getServiceIdFromPythonName(serviceName: string): string {
    const map: Record<string, string> = {
      nmt: 'nmt-m2m100',
      tts: 'piper-tts',
      yourtts: 'your-tts',
      speaker_embedding: 'speaker-embedding',
      faster_whisper_vad: 'faster-whisper-vad',
      // 语义修复服务
      semantic_repair_zh: 'semantic-repair-zh',
      semantic_repair_en: 'semantic-repair-en',
      en_normalize: 'en-normalize',
    };
    return map[serviceName] || serviceName;
  }
}
