/**
 * NodeAgent 服务处理模块（简化版 - Day 2 Refactor）
 * 使用快照函数而不是直接访问 ServiceRegistry
 *
 * 语义修复：与备份一致，用「单一映射 + 单循环」—— 哪些 service_id 算语义修复、各提供 zh/en/enNormalize 由本表定义。
 */
import logger from '../logger';

/** 语义修复相关 service_id 及其提供的能力（与备份 node-agent-services-semantic-repair 同构，现仅合并服务） */
const SEMANTIC_REPAIR_SERVICE_CAPS: Record<string, { zh: boolean; en: boolean; enNormalize: boolean }> = {
  'semantic-repair-en-zh': { zh: true, en: true, enNormalize: true },
};

export class ServicesHandlerSimple {
  /**
   * ✅ Day 2: 使用快照函数代替Registry getter
   */
  constructor(private getServiceSnapshot: () => any[]) { }

  /**
   * 获取已安装的服务列表（用于心跳和注册）
   * ✅ Day 2: 直接使用快照函数（保持async以兼容调用者）
   */
  async getInstalledServices(): Promise<any[]> {
    const services = this.getServiceSnapshot();

    logger.debug(
      {
        totalCount: services.length,
        services: services.map((s) => `${s.service_id}:${s.type}:${s.status}`),
      },
      'Service snapshot obtained'
    );

    return services;
  }

  /**
   * 聚合 type 级可用性：同一类型只要有 GPU+running 的实现即 ready
   * ✅ Day 2: 基于快照构建，不再依赖Registry
   */
  async getCapabilityByType(installedServices: any[]): Promise<any[]> {
    // 从已安装服务构建capability map
    const capabilityMap: Record<string, { ready: boolean; devices: string[] }> = {};

    for (const svc of installedServices) {
      if (!capabilityMap[svc.type]) {
        capabilityMap[svc.type] = { ready: false, devices: [] };
      }

      // 如果有任何running + gpu的服务，则该类型ready
      if (svc.status === 'running' && svc.device === 'gpu') {
        capabilityMap[svc.type].ready = true;
      }

      // 收集设备类型
      if (!capabilityMap[svc.type].devices.includes(svc.device)) {
        capabilityMap[svc.type].devices.push(svc.device);
      }
    }

    const capability = Object.entries(capabilityMap).map(([type, info]) => ({
      type,
      ready: info.ready,
      devices: info.devices,
    }));

    logger.debug({ capability }, 'Built capability_by_type from snapshot');
    return capability;
  }

  /**
   * 动态检测是否应该收集 Rerun 指标
   * 检查是否有 ASR 服务运行（Rerun 功能依赖 ASR）
   */
  shouldCollectRerunMetrics(installedServices: any[]): boolean {
    const hasASRService = installedServices.some(
      (s) => s.type === 'asr' && s.status === 'running'
    );
    return hasASRService;
  }

  /**
   * 动态检测是否应该收集 ASR 指标
   * 检查是否有 ASR 服务运行
   */
  shouldCollectASRMetrics(installedServices: any[]): boolean {
    const hasASRService = installedServices.some(
      (s) => s.type === 'asr' && s.status === 'running'
    );
    return hasASRService;
  }

  /**
   * 获取语义修复服务列表（与备份一致：按「语义修复 service_id 映射」单循环）
   */
  async getInstalledSemanticRepairServices(): Promise<{
    zh: boolean;
    en: boolean;
    enNormalize: boolean;
    services: Array<{
      serviceId: string;
      status: string;
      version?: string;
    }>;
  }> {
    const allServices = this.getServiceSnapshot();
    const result = {
      zh: false,
      en: false,
      enNormalize: false,
      services: [] as Array<{ serviceId: string; status: string; version?: string }>,
    };

    for (const svc of allServices) {
      const cap = SEMANTIC_REPAIR_SERVICE_CAPS[svc.service_id];
      if (svc.type !== 'semantic' || !cap) continue;

      const running = svc.status === 'running';
      result.services.push({
        serviceId: svc.service_id,
        status: svc.status,
        version: svc.version,
      });
      if (cap.zh) result.zh = result.zh || running;
      if (cap.en) result.en = result.en || running;
      if (cap.enNormalize) result.enNormalize = result.enNormalize || running;
    }

    logger.debug(
      { zh: result.zh, en: result.en, enNormalize: result.enNormalize, services: result.services },
      'Getting installed semantic repair services from snapshot'
    );
    return result;
  }

  /**
   * 检查语义修复服务是否运行（仅对「语义修复映射表」内的 service_id 有效，与备份一致）
   */
  isSemanticRepairServiceRunning(serviceId: string): boolean {
    if (!(serviceId in SEMANTIC_REPAIR_SERVICE_CAPS)) return false;
    const svc = this.getServiceSnapshot().find(s => s.service_id === serviceId && s.type === 'semantic');
    return svc?.status === 'running';
  }
}
