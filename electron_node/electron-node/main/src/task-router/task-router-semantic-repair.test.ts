/**
 * TaskRouterSemanticRepairHandler 单元测试
 * 测试服务端点查找优化后的行为
 */

import { TaskRouterSemanticRepairHandler } from './task-router-semantic-repair';
import { ServiceType, ServiceStatus } from '../../../../shared/protocols/messages';
import { ServiceEndpoint, SemanticRepairTask } from './types';

describe('TaskRouterSemanticRepairHandler - 服务端点查找优化', () => {
  let handler: TaskRouterSemanticRepairHandler;
  let mockSelectServiceEndpoint: jest.Mock;
  let mockGetServiceEndpointById: jest.Mock;
  let mockStartGpuTracking: jest.Mock;
  let mockUpdateConnections: jest.Mock;
  let serviceConnections: Map<string, number>;

  beforeEach(() => {
    serviceConnections = new Map();
    mockSelectServiceEndpoint = jest.fn();
    mockGetServiceEndpointById = jest.fn();
    mockStartGpuTracking = jest.fn();
    mockUpdateConnections = jest.fn();

    handler = new TaskRouterSemanticRepairHandler(
      mockSelectServiceEndpoint,
      mockStartGpuTracking,
      serviceConnections,
      mockUpdateConnections,
      2, // maxConcurrency
      undefined, // isServiceRunningCallback
      undefined, // cacheConfig
      false, // enableModelIntegrityCheck
      undefined, // getServicePathCallback
      mockGetServiceEndpointById
    );
  });

  describe('getServiceIdForLanguage 职责简化', () => {
    it('应该只返回服务ID，不检查服务可用性', () => {
      // 使用反射访问私有方法进行测试
      const getServiceIdForLanguage = (handler as any).getServiceIdForLanguage.bind(handler);

      // 测试中文
      const zhServiceId = getServiceIdForLanguage('zh');
      expect(zhServiceId).toBe('semantic-repair-zh');
      expect(mockGetServiceEndpointById).not.toHaveBeenCalled();

      // 测试英文
      const enServiceId = getServiceIdForLanguage('en');
      expect(enServiceId).toBe('semantic-repair-en');
      expect(mockGetServiceEndpointById).not.toHaveBeenCalled();
    });
  });

  describe('routeSemanticRepairTask 统一服务端点查找', () => {
    const createTask = (lang: 'zh' | 'en' = 'en'): SemanticRepairTask => ({
      job_id: 'job-1',
      session_id: 'session-1',
      utterance_index: 0,
      lang,
      text_in: 'test text',
      quality_score: 0.9,
    });

    afterEach(() => {
      handler.clearEndpointCache();
    });

    it('应该优先尝试统一服务', () => {
      const unifiedEndpoint: ServiceEndpoint = {
        serviceId: 'semantic-repair-en-zh',
        baseUrl: 'http://localhost:8001',
        status: 'running',
      };

      mockGetServiceEndpointById.mockReturnValue(unifiedEndpoint);

      // 验证：getServiceIdForLanguage只返回服务ID，不检查可用性
      const getServiceIdForLanguage = (handler as any).getServiceIdForLanguage.bind(handler);
      const serviceId = getServiceIdForLanguage('en');
      expect(serviceId).toBe('semantic-repair-en');
      expect(mockGetServiceEndpointById).not.toHaveBeenCalled();
    });

    it('getServiceIdForLanguage应该只返回服务ID，不调用getServiceEndpointById', () => {
      const getServiceIdForLanguage = (handler as any).getServiceIdForLanguage.bind(handler);

      expect(getServiceIdForLanguage('zh')).toBe('semantic-repair-zh');
      expect(getServiceIdForLanguage('en')).toBe('semantic-repair-en');
      expect(mockGetServiceEndpointById).not.toHaveBeenCalled();
    });
  });
});
