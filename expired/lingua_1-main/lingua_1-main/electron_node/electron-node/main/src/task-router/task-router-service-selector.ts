/**
 * Task Router Service Selector
 * 处理服务选择相关的逻辑
 */

import { ServiceType } from '../../../../shared/protocols/messages';
import { ServiceEndpoint, ServiceSelectionStrategy } from './types';

export class TaskRouterServiceSelector {
  private roundRobinIndex: Map<ServiceType, number> = new Map();

  /**
   * 选择服务端点
   */
  selectServiceEndpoint(
    serviceType: ServiceType,
    serviceEndpoints: Map<ServiceType, ServiceEndpoint[]>,
    selectionStrategy: ServiceSelectionStrategy = 'round_robin'
  ): ServiceEndpoint | null {
    const endpoints = serviceEndpoints.get(serviceType) || [];
    
    if (endpoints.length === 0) {
      return null;
    }

    if (selectionStrategy === 'round_robin') {
      const currentIndex = this.roundRobinIndex.get(serviceType) || 0;
      const selected = endpoints[currentIndex % endpoints.length];
      this.roundRobinIndex.set(serviceType, (currentIndex + 1) % endpoints.length);
      return selected;
    }

    // 默认返回第一个
    return endpoints[0];
  }
}
