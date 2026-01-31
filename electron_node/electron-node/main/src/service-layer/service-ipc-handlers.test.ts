/**
 * 服务发现 IPC Handlers 集成测试
 * 测试 IPC 通信和服务管理功能
 */

import * as path from 'path';
import * as fs from 'fs';
import { 
  initServiceLayer, 
  getServiceRegistry, 
  getServiceRunner 
} from './service-ipc-handlers';

describe('Service IPC Handlers Integration Tests', () => {
  let testServicesDir: string;

  beforeAll(() => {
    // 创建测试服务目录
    testServicesDir = path.join(__dirname, '__test_services__');
    if (!fs.existsSync(testServicesDir)) {
      fs.mkdirSync(testServicesDir, { recursive: true });
    }
  });

  afterAll(() => {
    // 清理测试目录
    if (fs.existsSync(testServicesDir)) {
      fs.rmSync(testServicesDir, { recursive: true, force: true });
    }
  });

  describe('initServiceLayer', () => {
    it('should initialize service layer successfully', async () => {
      const { registry, runner } = await initServiceLayer(testServicesDir);
      
      expect(registry).toBeDefined();
      expect(runner).toBeDefined();
      expect(registry instanceof Map).toBe(true);
    });

    it('should handle non-existent directory gracefully', async () => {
      const nonExistentDir = path.join(testServicesDir, 'non-existent');
      const { registry } = await initServiceLayer(nonExistentDir);
      
      // 应该返回空的 registry
      expect(registry.size).toBe(0);
      
      // 清理（如果创建了）
      if (fs.existsSync(nonExistentDir)) {
        fs.rmSync(nonExistentDir, { recursive: true, force: true });
      }
    });
  });

  describe('Service Discovery and Management', () => {
    let testServiceDir: string;

    beforeEach(() => {
      // 创建测试服务
      testServiceDir = path.join(testServicesDir, 'test-service-1');
      if (!fs.existsSync(testServiceDir)) {
        fs.mkdirSync(testServiceDir, { recursive: true });
      }

      const serviceConfig = {
        id: 'test-service-1',
        name: 'Test Service 1',
        type: 'test',
        device: 'cpu',
        port: 19999,
        exec: {
          command: 'node',
          args: ['-e', 'console.log("test"); setTimeout(() => {}, 60000);'],
          cwd: testServiceDir,
        },
        version: '1.0.0',
        description: '测试服务 1',
      };

      fs.writeFileSync(
        path.join(testServiceDir, 'service.json'),
        JSON.stringify(serviceConfig, null, 2)
      );
    });

    afterEach(async () => {
      try {
        getServiceRunner().stop('test-service-1');
        await new Promise(r => setTimeout(r, 1500));
      } catch {
        // 服务未启动或已停止
      }
      if (fs.existsSync(testServiceDir)) {
        fs.rmSync(testServiceDir, { recursive: true, force: true });
      }
    });

    it('should discover test service', async () => {
      const { registry } = await initServiceLayer(testServicesDir);
      
      expect(registry.size).toBeGreaterThan(0);
      expect(registry.has('test-service-1')).toBe(true);
      
      const service = registry.get('test-service-1');
      expect(service).toBeDefined();
      expect(service?.def.name).toBe('Test Service 1');
      expect(service?.def.type).toBe('test');
      expect(service?.runtime.status).toBe('stopped');
    });

    it('should start and stop service', async () => {
      const { registry, runner } = await initServiceLayer(testServicesDir);
      await runner.start('test-service-1');
      await new Promise(resolve => setTimeout(resolve, 1000));
      const runningEntry = registry.get('test-service-1');
      // 无真实 /health 时状态可能仍为 starting，仅校验已启动且有 pid
      expect(['starting', 'running']).toContain(runningEntry?.runtime.status);
      expect(runningEntry?.runtime.pid).toBeDefined();
      await runner.stop('test-service-1');
      await new Promise(resolve => setTimeout(resolve, 1500));
      const stoppedEntry = registry.get('test-service-1');
      expect(stoppedEntry?.runtime.status).toBe('stopped');
    });

    it('should list all services', async () => {
      const { registry } = await initServiceLayer(testServicesDir);
      
      const services = Array.from(registry.values());
      expect(services.length).toBeGreaterThan(0);
      
      const testService = services.find((s: { def: { id: string } }) => s.def.id === 'test-service-1');
      expect(testService).toBeDefined();
    });

    it('should get service by id', async () => {
      const { registry } = await initServiceLayer(testServicesDir);
      const service = registry.get('test-service-1');
      expect(service).toBeDefined();
      expect(service?.def.id).toBe('test-service-1');
      expect(service?.def.name).toBe('Test Service 1');
    });

    it('should return undefined for non-existent service', async () => {
      const { registry } = await initServiceLayer(testServicesDir);
      const service = registry.get('non-existent-service');
      expect(service).toBeUndefined();
    });

    it('should handle service with invalid config gracefully', async () => {
      // 创建无效配置的服务
      const invalidServiceDir = path.join(testServicesDir, 'invalid-service');
      fs.mkdirSync(invalidServiceDir, { recursive: true });
      fs.writeFileSync(
        path.join(invalidServiceDir, 'service.json'),
        '{ invalid json }'
      );

      const { registry } = await initServiceLayer(testServicesDir);
      
      // 不应包含无效服务
      expect(registry.has('invalid-service')).toBe(false);
      
      // 清理
      fs.rmSync(invalidServiceDir, { recursive: true, force: true });
    });
  });

  describe('Multiple Services', () => {
    let service1Dir: string;
    let service2Dir: string;
    let service3Dir: string;

    beforeEach(() => {
      // 创建3个测试服务
      service1Dir = path.join(testServicesDir, 'multi-test-1');
      service2Dir = path.join(testServicesDir, 'multi-test-2');
      service3Dir = path.join(testServicesDir, 'multi-test-3');

      [service1Dir, service2Dir, service3Dir].forEach((dir, index) => {
        fs.mkdirSync(dir, { recursive: true });
        const config = {
          id: `multi-test-${index + 1}`,
          name: `Multi Test ${index + 1}`,
          type: index === 0 ? 'asr' : index === 1 ? 'nmt' : 'tts',
          device: 'cpu',
          exec: {
            command: 'node',
            args: ['-e', 'setTimeout(() => {}, 60000);'],
            cwd: dir,
          },
          version: '1.0.0',
        };
        fs.writeFileSync(
          path.join(dir, 'service.json'),
          JSON.stringify(config, null, 2)
        );
      });
    });

    afterEach(() => {
      // 清理
      [service1Dir, service2Dir, service3Dir].forEach(dir => {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    });

    it('should discover all services', async () => {
      const { registry } = await initServiceLayer(testServicesDir);
      
      expect(registry.size).toBeGreaterThanOrEqual(3);
      expect(registry.has('multi-test-1')).toBe(true);
      expect(registry.has('multi-test-2')).toBe(true);
      expect(registry.has('multi-test-3')).toBe(true);
    });

    it('should filter services by type', async () => {
      const { registry } = await initServiceLayer(testServicesDir);
      
      const asrServices = Array.from(registry.values()).filter(s => s.def.type === 'asr');
      const nmtServices = Array.from(registry.values()).filter(s => s.def.type === 'nmt');
      const ttsServices = Array.from(registry.values()).filter(s => s.def.type === 'tts');
      
      expect(asrServices.length).toBeGreaterThanOrEqual(1);
      expect(nmtServices.length).toBeGreaterThanOrEqual(1);
      expect(ttsServices.length).toBeGreaterThanOrEqual(1);
    });

    it('should stop all services', async () => {
      const { registry, runner } = await initServiceLayer(testServicesDir);
      
      await Promise.all([
        runner.start('multi-test-1'),
        runner.start('multi-test-2'),
        runner.start('multi-test-3'),
      ]);
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await runner.stopAll();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const services = Array.from(registry.values());
      services.forEach((service: { runtime: { status: string } }) => {
        expect(service.runtime.status).toBe('stopped');
      });
    });
  });

  describe('Service Refresh', () => {
    it('should refresh service list when new service added', async () => {
      const { registry } = await initServiceLayer(testServicesDir);
      const initialCount = registry.size;
      const newServiceDir = path.join(testServicesDir, 'refresh-test');
      fs.mkdirSync(newServiceDir, { recursive: true });
      const config = {
        id: 'refresh-test',
        name: 'Refresh Test',
        type: 'test',
        device: 'cpu',
        exec: {
          command: 'node',
          args: ['-e', 'console.log("test");'],
          cwd: newServiceDir,
        },
        version: '1.0.0',
      };
      fs.writeFileSync(
        path.join(newServiceDir, 'service.json'),
        JSON.stringify(config, null, 2)
      );
      const { registry: refreshedRegistry } = await initServiceLayer(testServicesDir);
      expect(refreshedRegistry.size).toBeGreaterThan(initialCount);
      expect(refreshedRegistry.get('refresh-test')).toBeDefined();
      fs.rmSync(newServiceDir, { recursive: true, force: true });
    });
  });

  describe('Error Handling', () => {
    it('should handle start non-existent service', async () => {
      const { runner } = await initServiceLayer(testServicesDir);
      await expect(runner.start('non-existent')).rejects.toThrow();
    });

    it('should handle stop non-existent service', async () => {
      const { runner } = await initServiceLayer(testServicesDir);
      await expect(runner.stop('non-existent')).rejects.toThrow();
    });
  });
});
