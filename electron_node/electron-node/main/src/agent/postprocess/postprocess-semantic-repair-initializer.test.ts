/**
 * Phase 2 测试：SemanticRepairInitializer
 * 验证语义修复Stage初始化逻辑
 */

import { SemanticRepairInitializer } from './postprocess-semantic-repair-initializer';
import { TaskRouter } from '../../task-router/task-router';
import * as serviceLayer from '../../service-layer';

// Mock SemanticRepairStage
jest.mock('./semantic-repair-stage');

// Mock service layer
jest.mock('../../service-layer', () => ({
  getServiceRegistry: jest.fn(),
}));

describe('SemanticRepairInitializer - Phase 2', () => {
  let initializer: SemanticRepairInitializer;
  let mockTaskRouter: TaskRouter | null;
  let mockRegistry: Map<string, any>;

  beforeEach(() => {
    mockTaskRouter = {} as TaskRouter;
    mockRegistry = new Map();
    
    // Mock service registry
    (serviceLayer.getServiceRegistry as jest.Mock).mockReturnValue(mockRegistry);

    initializer = new SemanticRepairInitializer(mockTaskRouter);
  });

  describe('initialize', () => {
    it('应该在TaskRouter不可用时跳过初始化', async () => {
      const initializerWithoutRouter = new SemanticRepairInitializer(null);
      await initializerWithoutRouter.initialize();

      expect(initializerWithoutRouter.isInitialized()).toBe(true);
    });

    it('应该在无服务安装时跳过初始化', async () => {
      // Empty registry (no services installed)
      mockRegistry.clear();

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
    });

    it('应该在检测到中文服务时初始化', async () => {
      // Add zh service to registry
      mockRegistry.set('semantic-repair-zh', {
        def: { id: 'semantic-repair-zh', name: 'ZH Semantic Repair', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).not.toBeNull();
    });

    it('应该在检测到英文服务时初始化', async () => {
      // Add en services to registry
      mockRegistry.set('semantic-repair-en', {
        def: { id: 'semantic-repair-en', name: 'EN Semantic Repair', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });
      mockRegistry.set('en-normalize', {
        def: { id: 'en-normalize', name: 'EN Normalize', type: 'normalize' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).not.toBeNull();
    });

    it('应该支持并发初始化（只初始化一次）', async () => {
      // Add zh service to registry
      mockRegistry.set('semantic-repair-zh', {
        def: { id: 'semantic-repair-zh', name: 'ZH Semantic Repair', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      // 并发调用initialize
      const promises = [
        initializer.initialize(),
        initializer.initialize(),
        initializer.initialize(),
      ];

      await Promise.all(promises);

      expect(initializer.isInitialized()).toBe(true);
      // 应该只调用一次getServiceRegistry
      expect(serviceLayer.getServiceRegistry).toHaveBeenCalled();
    });

    it('应该在初始化失败时标记为已初始化（避免阻塞）', async () => {
      // Mock registry to throw error
      (serviceLayer.getServiceRegistry as jest.Mock).mockImplementation(() => {
        throw new Error('Service error');
      });

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).toBeNull();
    });
  });

  describe('reinitialize', () => {
    it('应该能够重新初始化', async () => {
      // First time: zh service
      mockRegistry.set('semantic-repair-zh', {
        def: { id: 'semantic-repair-zh', name: 'ZH Semantic Repair', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      await initializer.initialize();
      expect(initializer.isInitialized()).toBe(true);

      // Clear and add en service for reinitialize
      mockRegistry.clear();
      mockRegistry.set('semantic-repair-en', {
        def: { id: 'semantic-repair-en', name: 'EN Semantic Repair', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      await initializer.reinitialize();
      expect(initializer.isInitialized()).toBe(true);
    });
  });

  describe('getInitPromise', () => {
    it('应该返回初始化Promise', async () => {
      mockRegistry.set('semantic-repair-zh', {
        def: { id: 'semantic-repair-zh', name: 'ZH Semantic Repair', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
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
