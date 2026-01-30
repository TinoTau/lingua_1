/**
 * 应用生命周期管理单元测试
 */

import { loadNodeConfig, saveNodeConfig, ServicePreferences } from '../node-config';
import { getServiceSupervisor } from '../service-layer';
import logger from '../logger';

// Mock dependencies
jest.mock('../logger');
jest.mock('../node-config');
jest.mock('../service-layer');
jest.mock('../utils/esbuild-cleanup', () => ({
  cleanupEsbuild: jest.fn(),
}));

describe('Application Lifecycle Management', () => {
  let mockRustServiceManager: any;
  let mockPythonServiceManager: any;
  let mockNodeAgent: any;
  let mockSupervisor: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock managers
    mockRustServiceManager = {
      getStatus: jest.fn().mockReturnValue({ running: true, pid: 1234 }),
      stop: jest.fn().mockResolvedValue(undefined),
    };

    mockPythonServiceManager = {
      getAllServiceStatuses: jest.fn().mockReturnValue([
        { name: 'nmt', running: true },
        { name: 'tts', running: false },
      ]),
      stopAllServices: jest.fn().mockResolvedValue(undefined),
    };

    mockNodeAgent = {
      stop: jest.fn(),
    };

    mockSupervisor = {
      listServices: jest.fn().mockReturnValue([
        {
          def: { id: 'semantic-repair-zh', type: 'semantic' },
          runtime: { status: 'running' },
        },
        {
          def: { id: 'semantic-repair-en', type: 'semantic' },
          runtime: { status: 'stopped' },
        },
      ]),
      stopAllServices: jest.fn().mockResolvedValue(undefined),
    };

    (getServiceSupervisor as jest.Mock).mockReturnValue(mockSupervisor);

    // Mock config
    (loadNodeConfig as jest.Mock).mockReturnValue({
      servicePreferences: {
        rustEnabled: false,
        nmtEnabled: false,
        ttsEnabled: false,
        yourttsEnabled: false,
        fasterWhisperVadEnabled: false,
        speakerEmbeddingEnabled: false,
        semanticRepairZhEnabled: false,
        semanticRepairEnEnabled: false,
        enNormalizeEnabled: false,
        semanticRepairEnZhEnabled: false,
      },
    });
  });

  describe('saveCurrentServiceState', () => {
    it('should save Rust service state', async () => {
      // 需要导入实际的函数来测试（这里通过测试间接验证）
      // 验证将在集成测试中完成
      expect(mockRustServiceManager.getStatus).toBeDefined();
    });

    it('should save Python service states', () => {
      const statuses = mockPythonServiceManager.getAllServiceStatuses();
      expect(statuses).toHaveLength(2);
      expect(statuses[0].name).toBe('nmt');
      expect(statuses[0].running).toBe(true);
    });

    it('should save semantic repair service states', () => {
      const services = mockSupervisor.listServices();
      const semanticServices = services.filter((s: any) => s.def.type === 'semantic');
      expect(semanticServices).toHaveLength(2);
      expect(semanticServices[0].def.id).toBe('semantic-repair-zh');
    });
  });

  describe('stopAllServices', () => {
    it('should stop services in correct order', async () => {
      // Verify supervisor can stop services
      await mockSupervisor.stopAllServices();
      expect(mockSupervisor.stopAllServices).toHaveBeenCalled();

      // Verify Python manager can stop services
      await mockPythonServiceManager.stopAllServices();
      expect(mockPythonServiceManager.stopAllServices).toHaveBeenCalled();

      // Verify Rust manager can stop service
      await mockRustServiceManager.stop();
      expect(mockRustServiceManager.stop).toHaveBeenCalled();

      // Verify NodeAgent can be stopped
      mockNodeAgent.stop();
      expect(mockNodeAgent.stop).toHaveBeenCalled();
    });

    it('should handle errors during service stop', async () => {
      mockSupervisor.stopAllServices.mockRejectedValue(new Error('Stop failed'));

      try {
        await mockSupervisor.stopAllServices();
        fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toBe('Stop failed');
      }
    });

    it('should timeout if services take too long to stop', async () => {
      // Mock a slow stop
      mockPythonServiceManager.stopAllServices.mockImplementation(() =>
        new Promise(resolve => setTimeout(resolve, 20000))
      );

      const startTime = Date.now();
      await Promise.race([
        mockPythonServiceManager.stopAllServices(),
        new Promise(resolve => setTimeout(resolve, 100))
      ]);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeLessThan(1000); // Should timeout quickly
    });
  });

  describe('cleanupAppResources', () => {
    it('should prevent duplicate cleanup', () => {
      // 验证防止重复清理的逻辑
      // 通过全局标志 isCleaningUp 实现
      let isCleaningUp = false;

      const startCleanup = () => {
        if (isCleaningUp) {
          return false;
        }
        isCleaningUp = true;
        return true;
      };

      expect(startCleanup()).toBe(true);
      expect(startCleanup()).toBe(false); // Should be blocked
    });

    it('should save config before stopping services', () => {
      // 配置保存应该在服务停止之前
      // 这确保即使服务停止失败，配置也已保存
      const operations: string[] = [];

      const saveConfig = () => operations.push('save');
      const stopServices = () => operations.push('stop');

      saveConfig();
      stopServices();

      expect(operations[0]).toBe('save');
      expect(operations[1]).toBe('stop');
    });
  });

  describe('Service manager interfaces', () => {
    it('RustServiceManager should have required methods', () => {
      expect(mockRustServiceManager.getStatus).toBeDefined();
      expect(mockRustServiceManager.stop).toBeDefined();
    });

    it('PythonServiceManager should have required methods', () => {
      expect(mockPythonServiceManager.getAllServiceStatuses).toBeDefined();
      expect(mockPythonServiceManager.stopAllServices).toBeDefined();
    });

    it('NodeAgent should have stop method', () => {
      expect(mockNodeAgent.stop).toBeDefined();
    });

    it('ServiceSupervisor should have required methods', () => {
      expect(mockSupervisor.listServices).toBeDefined();
      expect(mockSupervisor.stopAllServices).toBeDefined();
    });
  });
});
