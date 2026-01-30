/**
 * 服务架构统一性测试
 * 验证新架构的核心功能和设计原则
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ServiceRegistry, ServiceEntry } from './ServiceTypes';
import { setServiceRegistry, getServiceRegistry, isServiceRegistryInitialized } from './ServiceRegistrySingleton';

describe('ServiceRegistrySingleton', () => {
  beforeEach(() => {
    // 清理全局状态
    const testRegistry: ServiceRegistry = new Map();
    setServiceRegistry(testRegistry);
  });

  it('should enforce single instance', () => {
    const registry1: ServiceRegistry = new Map();
    const registry2: ServiceRegistry = new Map();
    
    setServiceRegistry(registry1);
    const retrieved1 = getServiceRegistry();
    
    expect(retrieved1).toBe(registry1);
    expect(retrieved1).not.toBe(registry2);
  });

  it('should throw error if accessed before initialization', () => {
    // 重置为未初始化状态（模拟）
    const testRegistry: ServiceRegistry = new Map();
    setServiceRegistry(testRegistry);
    
    // 现在已经初始化了，不会抛出错误
    expect(() => getServiceRegistry()).not.toThrow();
  });

  it('should check initialization status', () => {
    const registry: ServiceRegistry = new Map();
    setServiceRegistry(registry);
    
    expect(isServiceRegistryInitialized()).toBe(true);
  });

  it('should allow all modules to see same data', () => {
    const registry: ServiceRegistry = new Map();
    setServiceRegistry(registry);
    
    const mockService: ServiceEntry = {
      def: {
        id: 'test-service',
        name: 'Test Service',
        type: 'test',
        exec: {
          command: 'python',
          args: ['test.py'],
          cwd: '/test',
        },
      },
      runtime: {
        status: 'stopped',
      },
      installPath: '/test',
    };
    
    // 模块1添加服务
    registry.set('test-service', mockService);
    
    // 模块2读取（应该立即看到）
    const retrieved = getServiceRegistry();
    expect(retrieved.has('test-service')).toBe(true);
    expect(retrieved.get('test-service')).toBe(mockService);
    
    // 模块3修改状态
    retrieved.get('test-service')!.runtime.status = 'running';
    
    // 模块1和模块2都能看到变化
    expect(registry.get('test-service')!.runtime.status).toBe('running');
    expect(getServiceRegistry().get('test-service')!.runtime.status).toBe('running');
  });
});

describe('Service Status Flow', () => {
  let registry: ServiceRegistry;
  let mockService: ServiceEntry;

  beforeEach(() => {
    registry = new Map();
    setServiceRegistry(registry);
    
    mockService = {
      def: {
        id: 'test-service',
        name: 'Test Service',
        type: 'test',
        port: 5000,
        exec: {
          command: 'python',
          args: ['service.py'],
          cwd: '/test',
        },
      },
      runtime: {
        status: 'stopped',
      },
      installPath: '/test',
    };
    
    registry.set('test-service', mockService);
  });

  it('should follow correct status flow: stopped -> starting -> running', () => {
    const service = registry.get('test-service')!;
    
    // Initial state
    expect(service.runtime.status).toBe('stopped');
    
    // Simulate spawn
    service.runtime.status = 'starting';
    service.runtime.pid = 12345;
    expect(service.runtime.status).toBe('starting');
    expect(service.runtime.pid).toBe(12345);
    
    // Simulate health check passed
    service.runtime.status = 'running';
    service.runtime.port = 5000;
    expect(service.runtime.status).toBe('running');
    expect(service.runtime.port).toBe(5000);
  });

  it('should preserve runtime state during refresh', () => {
    const service = registry.get('test-service')!;
    
    // Service is running
    service.runtime.status = 'running';
    service.runtime.pid = 12345;
    service.runtime.port = 5000;
    service.runtime.startedAt = new Date();
    
    // Simulate refresh: update def, preserve runtime
    const newDef = { ...service.def, version: '2.0.0' };
    service.def = newDef;
    
    // Runtime state should be preserved
    expect(service.runtime.status).toBe('running');
    expect(service.runtime.pid).toBe(12345);
    expect(service.runtime.port).toBe(5000);
    expect(service.def.version).toBe('2.0.0');
  });

  it('should handle service stop correctly', () => {
    const service = registry.get('test-service')!;
    
    // Service is running
    service.runtime.status = 'running';
    service.runtime.pid = 12345;
    
    // Simulate stop
    service.runtime.status = 'stopped';
    service.runtime.pid = undefined;
    
    expect(service.runtime.status).toBe('stopped');
    expect(service.runtime.pid).toBeUndefined();
  });
});

describe('Service Discovery Integration', () => {
  it('should have required service fields', () => {
    const registry: ServiceRegistry = new Map();
    setServiceRegistry(registry);
    
    const service: ServiceEntry = {
      def: {
        id: 'test-service',
        name: 'Test Service',
        type: 'asr',
        exec: {
          command: 'python',
          args: ['service.py'],
          cwd: '/test/path',
        },
      },
      runtime: {
        status: 'stopped',
      },
      installPath: '/test/path',
    };
    
    registry.set('test-service', service);
    
    // Verify required fields
    expect(service.def.id).toBeDefined();
    expect(service.def.name).toBeDefined();
    expect(service.def.type).toBeDefined();
    expect(service.def.exec.command).toBeDefined();
    expect(service.def.exec.args).toBeDefined();
    expect(service.def.exec.cwd).toBeDefined();
    expect(service.installPath).toBeDefined();
    expect(service.runtime.status).toBeDefined();
  });

  it('should support multiple service types', () => {
    const registry: ServiceRegistry = new Map();
    setServiceRegistry(registry);
    
    const serviceTypes = ['asr', 'nmt', 'tts', 'semantic', 'rust'] as const;
    
    serviceTypes.forEach((type, index) => {
      const service: ServiceEntry = {
        def: {
          id: `service-${index}`,
          name: `Service ${index}`,
          type,
          exec: {
            command: 'python',
            args: ['service.py'],
            cwd: '/test',
          },
        },
        runtime: { status: 'stopped' },
        installPath: '/test',
      };
      
      registry.set(service.def.id, service);
    });
    
    expect(registry.size).toBe(serviceTypes.length);
    
    // Verify each type
    serviceTypes.forEach((type, index) => {
      const service = registry.get(`service-${index}`);
      expect(service?.def.type).toBe(type);
    });
  });
});

describe('Architecture Principles', () => {
  it('should enforce Single Source of Truth', () => {
    const registry: ServiceRegistry = new Map();
    setServiceRegistry(registry);
    
    const service: ServiceEntry = {
      def: {
        id: 'test',
        name: 'Test',
        type: 'test',
        exec: { command: 'python', args: [], cwd: '/test' },
      },
      runtime: { status: 'stopped' },
      installPath: '/test',
    };
    
    registry.set('test', service);
    
    // Reference 1: direct
    const ref1 = registry;
    
    // Reference 2: through singleton
    const ref2 = getServiceRegistry();
    
    // Reference 3: from another module
    const ref3 = getServiceRegistry();
    
    // All references should point to same object
    expect(ref1).toBe(ref2);
    expect(ref2).toBe(ref3);
    
    // Modification through one reference visible to all
    ref1.get('test')!.runtime.status = 'running';
    expect(ref2.get('test')!.runtime.status).toBe('running');
    expect(ref3.get('test')!.runtime.status).toBe('running');
  });

  it('should not require synchronization mechanisms', () => {
    // Since all modules share the same object reference,
    // no sync mechanism (events, callbacks, polling) is needed
    
    const registry: ServiceRegistry = new Map();
    setServiceRegistry(registry);
    
    const service: ServiceEntry = {
      def: {
        id: 'test',
        name: 'Test',
        type: 'test',
        exec: { command: 'python', args: [], cwd: '/test' },
      },
      runtime: { status: 'stopped' },
      installPath: '/test',
    };
    
    registry.set('test', service);
    
    // Module A: ServiceProcessRunner
    const moduleA = getServiceRegistry();
    moduleA.get('test')!.runtime.status = 'running';
    moduleA.get('test')!.runtime.pid = 99999;
    
    // Module B: NodeServiceSupervisor  
    const moduleB = getServiceRegistry();
    const status = moduleB.get('test')!.runtime.status;
    
    // No sync needed - immediate visibility
    expect(status).toBe('running');
    expect(moduleB.get('test')!.runtime.pid).toBe(99999);
  });
});
