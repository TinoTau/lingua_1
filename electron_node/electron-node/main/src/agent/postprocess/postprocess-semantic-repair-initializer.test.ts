/**
 * Phase 2 测试：SemanticRepairInitializer
 * 验证语义修复Stage初始化逻辑
 */

import { SemanticRepairInitializer } from './postprocess-semantic-repair-initializer';
import { ServicesHandler } from '../node-agent-services';
import { TaskRouter } from '../../task-router/task-router';

// Mock SemanticRepairStage
jest.mock('./semantic-repair-stage');

describe('SemanticRepairInitializer - Phase 2', () => {
  let initializer: SemanticRepairInitializer;
  let mockServicesHandler: jest.Mocked<ServicesHandler>;
  let mockTaskRouter: TaskRouter | null;

  beforeEach(() => {
    mockServicesHandler = {
      getInstalledSemanticRepairServices: jest.fn(),
    } as any;

    mockTaskRouter = {} as TaskRouter;

    initializer = new SemanticRepairInitializer(mockServicesHandler, mockTaskRouter);
  });

  describe('initialize', () => {
    it('应该在ServicesHandler不可用时跳过初始化', async () => {
      const initializerWithoutHandler = new SemanticRepairInitializer(null, mockTaskRouter);
      await initializerWithoutHandler.initialize();

      expect(initializerWithoutHandler.isInitialized()).toBe(true);
    });

    it('应该在TaskRouter不可用时跳过初始化', async () => {
      const initializerWithoutRouter = new SemanticRepairInitializer(mockServicesHandler, null);
      await initializerWithoutRouter.initialize();

      expect(initializerWithoutRouter.isInitialized()).toBe(true);
    });

    it('应该在无服务安装时跳过初始化', async () => {
      mockServicesHandler.getInstalledSemanticRepairServices.mockResolvedValue({
        zh: false,
        en: false,
        enNormalize: false,
        services: [],
      });

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
    });

    it('应该在检测到中文服务时初始化', async () => {
      mockServicesHandler.getInstalledSemanticRepairServices.mockResolvedValue({
        zh: true,
        en: false,
        enNormalize: false,
        services: [
          { serviceId: 'semantic-repair-zh', status: 'running' },
        ],
      });

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).not.toBeNull();
    });

    it('应该在检测到英文服务时初始化', async () => {
      mockServicesHandler.getInstalledSemanticRepairServices.mockResolvedValue({
        zh: false,
        en: true,
        enNormalize: true,
        services: [
          { serviceId: 'semantic-repair-en', status: 'running' },
          { serviceId: 'en-normalize', status: 'running' },
        ],
      });

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).not.toBeNull();
    });

    it('应该支持并发初始化（只初始化一次）', async () => {
      mockServicesHandler.getInstalledSemanticRepairServices.mockResolvedValue({
        zh: true,
        en: false,
        enNormalize: false,
        services: [
          { serviceId: 'semantic-repair-zh', status: 'running' },
        ],
      });

      // 并发调用initialize
      const promises = [
        initializer.initialize(),
        initializer.initialize(),
        initializer.initialize(),
      ];

      await Promise.all(promises);

      expect(initializer.isInitialized()).toBe(true);
      // 应该只调用一次getInstalledSemanticRepairServices
      expect(mockServicesHandler.getInstalledSemanticRepairServices).toHaveBeenCalledTimes(1);
    });

    it('应该在初始化失败时标记为已初始化（避免阻塞）', async () => {
      mockServicesHandler.getInstalledSemanticRepairServices.mockRejectedValue(new Error('Service error'));

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).toBeNull();
    });
  });

  describe('reinitialize', () => {
    it('应该能够重新初始化', async () => {
      mockServicesHandler.getInstalledSemanticRepairServices
        .mockResolvedValueOnce({
          zh: true,
          en: false,
          enNormalize: false,
          services: [{ serviceId: 'semantic-repair-zh', status: 'running' }],
        })
        .mockResolvedValueOnce({
          zh: false,
          en: true,
          enNormalize: false,
          services: [{ serviceId: 'semantic-repair-en', status: 'running' }],
        });

      await initializer.initialize();
      expect(initializer.isInitialized()).toBe(true);

      await initializer.reinitialize();
      expect(initializer.isInitialized()).toBe(true);
      expect(mockServicesHandler.getInstalledSemanticRepairServices).toHaveBeenCalledTimes(2);
    });
  });

  describe('getInitPromise', () => {
    it('应该返回初始化Promise', async () => {
      mockServicesHandler.getInstalledSemanticRepairServices.mockResolvedValue({
        zh: true,
        en: false,
        enNormalize: false,
        services: [{ serviceId: 'semantic-repair-zh', status: 'running' }],
      });

      const initPromise = initializer.initialize();
      const promise = initializer.getInitPromise();

      // Promise对象可能不同，但应该都存在
      expect(promise).not.toBeNull();
      expect(initPromise).not.toBeNull();
      await initPromise;
      expect(initializer.getInitPromise()).toBeNull();
    });
  });
});
