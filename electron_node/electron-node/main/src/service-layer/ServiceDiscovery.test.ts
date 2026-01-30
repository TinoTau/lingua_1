/**
 * ServiceDiscovery 单元测试
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  scanServices,
  getServicesByType,
  getRunningServices,
  buildInstalledServices,
  buildCapabilityByType,
} from './ServiceDiscovery';
import { ServiceDefinition, ServiceRegistry } from './ServiceTypes';

describe('ServiceDiscovery', () => {
  let tempDir: string;

  beforeEach(() => {
    // 创建临时测试目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-test-'));
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('scanServices', () => {
    it('should scan empty directory', async () => {
      const registry = await scanServices(tempDir);
      expect(registry.size).toBe(0);
    });

    it('should scan directory with valid services', async () => {
      // 创建服务目录和 service.json
      const service1Dir = path.join(tempDir, 'asr_service');
      fs.mkdirSync(service1Dir);
      
      const service1Def: ServiceDefinition = {
        id: 'asr_service',
        name: 'ASR Service',
        type: 'asr',
        device: 'gpu',
        exec: {
          command: 'python',
          args: ['main.py'],
          cwd: '.',
        },
        version: '1.0.0',
      };
      
      fs.writeFileSync(
        path.join(service1Dir, 'service.json'),
        JSON.stringify(service1Def, null, 2)
      );

      // 扫描服务
      const registry = await scanServices(tempDir);
      
      expect(registry.size).toBe(1);
      expect(registry.has('asr_service')).toBe(true);
      
      const entry = registry.get('asr_service');
      expect(entry).toBeDefined();
      expect(entry!.def.id).toBe('asr_service');
      expect(entry!.def.name).toBe('ASR Service');
      expect(entry!.def.type).toBe('asr');
      expect(entry!.runtime.status).toBe('stopped');
    });

    it('should ignore directories without service.json', async () => {
      // 创建没有 service.json 的目录
      const emptyDir = path.join(tempDir, 'empty_dir');
      fs.mkdirSync(emptyDir);
      fs.writeFileSync(path.join(emptyDir, 'readme.txt'), 'test');

      const registry = await scanServices(tempDir);
      expect(registry.size).toBe(0);
    });

    it('should ignore invalid service.json', async () => {
      // 创建包含无效 JSON 的目录
      const invalidDir = path.join(tempDir, 'invalid_service');
      fs.mkdirSync(invalidDir);
      fs.writeFileSync(path.join(invalidDir, 'service.json'), '{ invalid json }');

      const registry = await scanServices(tempDir);
      expect(registry.size).toBe(0);
    });

    it('should ignore service.json with missing required fields', async () => {
      // 创建缺少必需字段的 service.json
      const incompleteDir = path.join(tempDir, 'incomplete_service');
      fs.mkdirSync(incompleteDir);
      
      const incompleteDef = {
        id: 'incomplete_service',
        // 缺少 name 和 type
      };
      
      fs.writeFileSync(
        path.join(incompleteDir, 'service.json'),
        JSON.stringify(incompleteDef)
      );

      const registry = await scanServices(tempDir);
      expect(registry.size).toBe(0);
    });

    it('should handle duplicate service IDs by keeping the first one', async () => {
      // 创建两个具有相同 service_id 的服务
      const service1Dir = path.join(tempDir, 'service_v1');
      const service2Dir = path.join(tempDir, 'service_v2');
      fs.mkdirSync(service1Dir);
      fs.mkdirSync(service2Dir);

      const serviceDef: ServiceDefinition = {
        id: 'duplicate_service',
        name: 'Service V1',
        type: 'asr',
        exec: {
          command: 'python',
          args: ['main.py'],
          cwd: '.',
        },
      };

      fs.writeFileSync(
        path.join(service1Dir, 'service.json'),
        JSON.stringify(serviceDef)
      );

      const serviceDef2 = { ...serviceDef, name: 'Service V2' };
      fs.writeFileSync(
        path.join(service2Dir, 'service.json'),
        JSON.stringify(serviceDef2)
      );

      const registry = await scanServices(tempDir);
      
      expect(registry.size).toBe(1);
      expect(registry.get('duplicate_service')!.def.name).toBe('Service V1');
    });

    it('should convert relative cwd to absolute path', async () => {
      const serviceDir = path.join(tempDir, 'test_service');
      fs.mkdirSync(serviceDir);

      const serviceDef: ServiceDefinition = {
        id: 'test_service',
        name: 'Test Service',
        type: 'asr',
        exec: {
          command: 'python',
          args: ['main.py'],
          cwd: './subdir', // 相对路径
        },
      };

      fs.writeFileSync(
        path.join(serviceDir, 'service.json'),
        JSON.stringify(serviceDef)
      );

      const registry = await scanServices(tempDir);
      const entry = registry.get('test_service');
      
      expect(entry).toBeDefined();
      expect(path.isAbsolute(entry!.def.exec.cwd)).toBe(true);
      expect(entry!.def.exec.cwd).toBe(path.join(serviceDir, 'subdir'));
    });
  });

  describe('getServicesByType', () => {
    let registry: ServiceRegistry;

    beforeEach(async () => {
      // 创建多个不同类型的服务
      const services = [
        { id: 'asr1', type: 'asr' },
        { id: 'asr2', type: 'asr' },
        { id: 'nmt1', type: 'nmt' },
        { id: 'tts1', type: 'tts' },
      ];

      for (const svc of services) {
        const serviceDir = path.join(tempDir, svc.id);
        fs.mkdirSync(serviceDir);

        const serviceDef: ServiceDefinition = {
          id: svc.id,
          name: `${svc.id} Service`,
          type: svc.type,
          exec: {
            command: 'python',
            args: ['main.py'],
            cwd: '.',
          },
        };

        fs.writeFileSync(
          path.join(serviceDir, 'service.json'),
          JSON.stringify(serviceDef)
        );
      }

      registry = await scanServices(tempDir);
    });

    it('should get services by type', () => {
      const asrServices = getServicesByType(registry, 'asr');
      expect(asrServices.length).toBe(2);
      expect(asrServices[0].def.type).toBe('asr');
      expect(asrServices[1].def.type).toBe('asr');

      const nmtServices = getServicesByType(registry, 'nmt');
      expect(nmtServices.length).toBe(1);

      const semanticServices = getServicesByType(registry, 'semantic');
      expect(semanticServices.length).toBe(0);
    });
  });

  describe('getRunningServices', () => {
    it('should get only running services', async () => {
      // 创建服务
      const serviceDir = path.join(tempDir, 'test_service');
      fs.mkdirSync(serviceDir);

      const serviceDef: ServiceDefinition = {
        id: 'test_service',
        name: 'Test Service',
        type: 'asr',
        exec: {
          command: 'python',
          args: ['main.py'],
          cwd: '.',
        },
      };

      fs.writeFileSync(
        path.join(serviceDir, 'service.json'),
        JSON.stringify(serviceDef)
      );

      const registry = await scanServices(tempDir);
      
      // 初始状态：没有运行的服务
      let running = getRunningServices(registry);
      expect(running.length).toBe(0);

      // 模拟服务启动
      const entry = registry.get('test_service');
      entry!.runtime.status = 'running';
      entry!.runtime.pid = 12345;

      running = getRunningServices(registry);
      expect(running.length).toBe(1);
      expect(running[0].def.id).toBe('test_service');
    });
  });

  describe('buildInstalledServices', () => {
    it('should build installed services list', async () => {
      // 创建服务
      const serviceDir = path.join(tempDir, 'test_service');
      fs.mkdirSync(serviceDir);

      const serviceDef: ServiceDefinition = {
        id: 'test_service',
        name: 'Test Service',
        type: 'asr',
        device: 'gpu',
        exec: {
          command: 'python',
          args: ['main.py'],
          cwd: '.',
        },
        version: '1.0.0',
      };

      fs.writeFileSync(
        path.join(serviceDir, 'service.json'),
        JSON.stringify(serviceDef)
      );

      const registry = await scanServices(tempDir);
      const installedServices = buildInstalledServices(registry);

      expect(installedServices.length).toBe(1);
      expect(installedServices[0]).toEqual({
        service_id: 'test_service',
        type: 'asr',
        device: 'gpu',
        status: 'stopped',
        version: '1.0.0',
      });

      // 模拟服务启动
      const entry = registry.get('test_service');
      entry!.runtime.status = 'running';

      const installedServicesRunning = buildInstalledServices(registry);
      expect(installedServicesRunning[0].status).toBe('running');
    });
  });

  describe('buildCapabilityByType', () => {
    it('should build capability by type', async () => {
      // 创建多个服务
      const services = [
        { id: 'asr1', type: 'asr', device: 'gpu', running: true },
        { id: 'nmt1', type: 'nmt', device: 'gpu', running: false },
        { id: 'tts1', type: 'tts', device: 'cpu', running: true },
      ];

      for (const svc of services) {
        const serviceDir = path.join(tempDir, svc.id);
        fs.mkdirSync(serviceDir);

        const serviceDef: ServiceDefinition = {
          id: svc.id,
          name: `${svc.id} Service`,
          type: svc.type,
          device: svc.device as 'cpu' | 'gpu',
          exec: {
            command: 'python',
            args: ['main.py'],
            cwd: '.',
          },
        };

        fs.writeFileSync(
          path.join(serviceDir, 'service.json'),
          JSON.stringify(serviceDef)
        );
      }

      const registry = await scanServices(tempDir);

      // 设置运行状态
      registry.get('asr1')!.runtime.status = 'running';
      registry.get('tts1')!.runtime.status = 'running';

      const capability = buildCapabilityByType(registry);

      // ASR: 有 GPU 服务运行
      const asrCap = capability.find((c) => c.type === 'asr');
      expect(asrCap).toBeDefined();
      expect(asrCap!.ready).toBe(true);
      expect(asrCap!.ready_impl_ids).toContain('asr1');

      // NMT: 有 GPU 服务但未运行
      const nmtCap = capability.find((c) => c.type === 'nmt');
      expect(nmtCap).toBeDefined();
      expect(nmtCap!.ready).toBe(false);
      expect(nmtCap!.reason).toBe('gpu_impl_not_running');

      // TTS: 只有 CPU 服务运行
      const ttsCap = capability.find((c) => c.type === 'tts');
      expect(ttsCap).toBeDefined();
      expect(ttsCap!.ready).toBe(false);
      expect(ttsCap!.reason).toBe('only_cpu_running');

      // TONE: 无实现
      const toneCap = capability.find((c) => c.type === 'tone');
      expect(toneCap).toBeDefined();
      expect(toneCap!.ready).toBe(false);
      expect(toneCap!.reason).toBe('no_impl');
    });
  });
});
