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

  describe('routeSemanticRepairTask', () => {
    it('只查 semantic-repair-en-zh 端点', async () => {
      mockGetServiceEndpointById.mockReturnValue(null);
      await expect(
        handler.routeSemanticRepairTask({
          job_id: 'job-1',
          session_id: 'session-1',
          utterance_index: 0,
          lang: 'zh',
          text_in: 'test',
          quality_score: 0.9,
        })
      ).rejects.toThrow('SEM_REPAIR_UNAVAILABLE');
      expect(mockGetServiceEndpointById).toHaveBeenCalledWith('semantic-repair-en-zh');
    });
  });
});
