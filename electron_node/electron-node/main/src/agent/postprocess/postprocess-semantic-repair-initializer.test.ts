/**
 * Phase 2 测试：SemanticRepairInitializer
 * 验证语义修复Stage初始化逻辑
 */

import { SemanticRepairInitializer } from './postprocess-semantic-repair-initializer';
import { TaskRouter } from '../../task-router/task-router';
import * as serviceLayer from '../../service-layer';

// Mock SemanticRepairStage
jest.mock('./semantic-repair-stage');

// Mock node-config（初始化时读取语义修复配置）
jest.mock('../../node-config', () => ({
  loadNodeConfig: jest.fn().mockReturnValue({
    features: { semanticRepair: { zh: { qualityThreshold: 0.7 }, en: { qualityThreshold: 0.7 } } },
  }),
}));

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

    it('应该在检测到合并语义修复服务 semantic-repair-en-zh 时初始化', async () => {
      mockRegistry.set('semantic-repair-en-zh', {
        def: { id: 'semantic-repair-en-zh', name: 'Semantic Repair (EN+ZH)', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      await initializer.initialize();

      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).not.toBeNull();
    });

    it('应该支持并发初始化（只初始化一次）', async () => {
      mockRegistry.set('semantic-repair-en-zh', {
        def: { id: 'semantic-repair-en-zh', name: 'Semantic Repair (EN+ZH)', type: 'semantic-repair' },
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
      mockRegistry.set('semantic-repair-en-zh', {
        def: { id: 'semantic-repair-en-zh', name: 'Semantic Repair (EN+ZH)', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      await initializer.initialize();
      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).not.toBeNull();

      mockRegistry.clear();
      mockRegistry.set('semantic-repair-en-zh', {
        def: { id: 'semantic-repair-en-zh', name: 'Semantic Repair (EN+ZH)', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      await initializer.reinitialize();
      expect(initializer.isInitialized()).toBe(true);
    });
  });

  describe('getInitPromise', () => {
    it('初始化进行中应返回同一 Promise，await 后完成', async () => {
      mockRegistry.set('semantic-repair-en-zh', {
        def: { id: 'semantic-repair-en-zh', name: 'Semantic Repair (EN+ZH)', type: 'semantic-repair' },
        runtime: { status: 'running' },
        installPath: '/path/to/service',
      });

      const initPromise = initializer.initialize();
      const promise = initializer.getInitPromise();

      expect(promise).not.toBeNull();
      await initPromise;
      expect(initializer.isInitialized()).toBe(true);
      expect(initializer.getSemanticRepairStage()).not.toBeNull();
    });
  });
});
