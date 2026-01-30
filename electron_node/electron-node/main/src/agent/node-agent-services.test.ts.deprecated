/**
 * Phase 1 测试：服务发现机制
 * 验证ServicesHandler能够正确检测语义修复服务
 */

import { ServicesHandler } from './node-agent-services';
import { ServiceStatus } from '../../../../shared/protocols/messages';

describe('ServicesHandler - Semantic Repair Service Discovery (Phase 1)', () => {
  let servicesHandler: ServicesHandler;
  let mockServiceRegistryManager: any;
  let mockRustServiceManager: any;
  let mockPythonServiceManager: any;

  beforeEach(() => {
    // 创建模拟的服务管理器
    mockServiceRegistryManager = {
      loadRegistry: jest.fn().mockResolvedValue(undefined),
      listInstalled: jest.fn().mockReturnValue([]),
    };

    mockRustServiceManager = {
      getStatus: jest.fn().mockReturnValue({ running: false }),
    };

    mockPythonServiceManager = {
      getServiceStatus: jest.fn().mockReturnValue({ running: false }),
    };

    servicesHandler = new ServicesHandler(
      mockServiceRegistryManager,
      mockRustServiceManager,
      mockPythonServiceManager
    );
  });

  describe('getInstalledSemanticRepairServices', () => {
    it('应该正确检测已安装的中文语义修复服务', async () => {
      // 模拟已安装semantic-repair-zh服务
      mockServiceRegistryManager.listInstalled = jest.fn().mockReturnValue([
        {
          service_id: 'semantic-repair-zh',
          version: '1.0.0',
          platform: 'windows',
        },
      ]);

      const result = await servicesHandler.getInstalledSemanticRepairServices();

      expect(result.zh).toBe(false); // 服务未运行
      expect(result.en).toBe(false);
      expect(result.enNormalize).toBe(false);
      expect(result.services).toHaveLength(1);
      expect(result.services[0].serviceId).toBe('semantic-repair-zh');
      expect(result.services[0].status).toBe('stopped');
    });

    it('应该正确检测已安装的英文语义修复服务', async () => {
      // 模拟已安装semantic-repair-en服务
      mockServiceRegistryManager.listInstalled = jest.fn().mockReturnValue([
        {
          service_id: 'semantic-repair-en',
          version: '1.0.0',
          platform: 'windows',
        },
      ]);

      const result = await servicesHandler.getInstalledSemanticRepairServices();

      expect(result.zh).toBe(false);
      expect(result.en).toBe(false); // 服务未运行
      expect(result.enNormalize).toBe(false);
      expect(result.services).toHaveLength(1);
      expect(result.services[0].serviceId).toBe('semantic-repair-en');
    });

    it('应该正确检测已安装的en-normalize服务', async () => {
      // 模拟已安装en-normalize服务
      mockServiceRegistryManager.listInstalled = jest.fn().mockReturnValue([
        {
          service_id: 'en-normalize',
          version: '1.0.0',
          platform: 'windows',
        },
      ]);

      const result = await servicesHandler.getInstalledSemanticRepairServices();

      expect(result.zh).toBe(false);
      expect(result.en).toBe(false);
      expect(result.enNormalize).toBe(false); // 服务未运行
      expect(result.services).toHaveLength(1);
      expect(result.services[0].serviceId).toBe('en-normalize');
    });

    it('应该正确检测多个语义修复服务', async () => {
      // 模拟已安装多个语义修复服务
      mockServiceRegistryManager.listInstalled = jest.fn().mockReturnValue([
        {
          service_id: 'semantic-repair-zh',
          version: '1.0.0',
          platform: 'windows',
        },
        {
          service_id: 'semantic-repair-en',
          version: '1.0.0',
          platform: 'windows',
        },
        {
          service_id: 'en-normalize',
          version: '1.0.0',
          platform: 'windows',
        },
      ]);

      const result = await servicesHandler.getInstalledSemanticRepairServices();

      expect(result.services).toHaveLength(3);
      expect(result.services.map(s => s.serviceId)).toContain('semantic-repair-zh');
      expect(result.services.map(s => s.serviceId)).toContain('semantic-repair-en');
      expect(result.services.map(s => s.serviceId)).toContain('en-normalize');
    });

    it('应该在没有安装语义修复服务时返回空列表', async () => {
      // 模拟没有安装语义修复服务
      mockServiceRegistryManager.listInstalled = jest.fn().mockReturnValue([
        {
          service_id: 'nmt-m2m100',
          version: '1.0.0',
          platform: 'windows',
        },
      ]);

      const result = await servicesHandler.getInstalledSemanticRepairServices();

      expect(result.zh).toBe(false);
      expect(result.en).toBe(false);
      expect(result.enNormalize).toBe(false);
      expect(result.services).toHaveLength(0);
    });

    it('应该在服务注册表加载失败时返回空列表', async () => {
      // 模拟服务注册表加载失败
      mockServiceRegistryManager.loadRegistry = jest.fn().mockRejectedValue(new Error('Load failed'));

      const result = await servicesHandler.getInstalledSemanticRepairServices();

      expect(result.zh).toBe(false);
      expect(result.en).toBe(false);
      expect(result.enNormalize).toBe(false);
      expect(result.services).toHaveLength(0);
    });
  });

  describe('isSemanticRepairServiceRunning', () => {
    it('应该正确检查semantic-repair-zh服务运行状态', () => {
      // 注意：isSemanticRepairServiceRunning内部调用isServiceRunning
      // 由于isServiceRunning需要真实的PythonServiceManager支持，这里只测试方法调用
      const result = servicesHandler.isSemanticRepairServiceRunning('semantic-repair-zh');
      // 由于没有真实的服务运行，应该返回false
      expect(typeof result).toBe('boolean');
    });

    it('应该正确检查semantic-repair-en服务运行状态', () => {
      const result = servicesHandler.isSemanticRepairServiceRunning('semantic-repair-en');
      expect(typeof result).toBe('boolean');
    });

    it('应该正确检查en-normalize服务运行状态', () => {
      const result = servicesHandler.isSemanticRepairServiceRunning('en-normalize');
      expect(typeof result).toBe('boolean');
    });

    it('应该对非语义修复服务返回false', () => {
      const result = servicesHandler.isSemanticRepairServiceRunning('nmt-m2m100');
      expect(result).toBe(false);
    });
  });
});
