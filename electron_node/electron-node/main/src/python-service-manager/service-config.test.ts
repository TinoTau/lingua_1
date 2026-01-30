/**
 * Python Service Manager - 服务配置加载测试
 * 测试从 ServiceRegistry 动态加载配置（无硬编码）
 */

import { PythonServiceManager } from './index';
import * as serviceLayer from '../service-layer';
import { ServiceRegistry, ServiceEntry } from '../service-layer/ServiceTypes';

// Mock dependencies
jest.mock('../logger');
jest.mock('../service-layer', () => ({
  getServiceRegistry: jest.fn(),
}));
jest.mock('./project-root', () => ({
  findProjectRoot: () => '/mock/project/root',
}));
jest.mock('../utils/cuda-env', () => ({
  setupCudaEnvironment: () => ({
    CUDA_VISIBLE_DEVICES: '0',
    CUDA_PATH: '/mock/cuda',
  }),
}));

describe('PythonServiceManager - 服务配置加载（无硬编码）', () => {
  let manager: PythonServiceManager;
  let mockRegistry: ServiceRegistry;

  beforeEach(() => {
    mockRegistry = new Map();
    (serviceLayer.getServiceRegistry as jest.Mock).mockReturnValue(mockRegistry);
    
    manager = new PythonServiceManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getServiceConfig - 正常场景', () => {
    it('应该从 ServiceRegistry 加载 NMT 服务配置', async () => {
      // 模拟 ServiceRegistry 中的 NMT 服务
      const nmtEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'M2M100 Translation Service',
          type: 'nmt',
          device: 'cuda',
          port: 8001,
          exec: {
            command: 'python',
            args: ['nmt_service.py'],
            cwd: '.',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', nmtEntry);

      // 使用反射访问私有方法进行测试
      const config = await (manager as any).getServiceConfig('nmt');

      expect(config).toBeDefined();
      expect(config.name).toBe('M2M100 Translation Service');
      expect(config.port).toBe(8001);
      expect(config.servicePath).toBe('/mock/services/nmt-m2m100');
      expect(config.scriptPath).toContain('nmt-m2m100');
      expect(config.scriptPath).toContain('nmt_service.py');
      expect(config.workingDir).toBe('.'); // cwd 设置为 '.' 时保持原样
      expect(config.venvPath).toContain('nmt-m2m100');
      expect(config.venvPath).toContain('venv');
      expect(config.logFile).toContain('nmt-m2m100');
      expect(config.logFile).toContain('logs');
      
      // 验证环境变量包含 CUDA 配置
      expect(config.env).toBeDefined();
      expect(config.env.CUDA_VISIBLE_DEVICES).toBe('0');
      expect(config.env.PYTHONIOENCODING).toBe('utf-8');
      // 验证 PATH 包含 venv Scripts（使用 toContain 检查关键部分）
      expect(config.env.PATH).toContain('nmt-m2m100');
      expect(config.env.PATH).toContain('Scripts');
    });

    it('应该从 ServiceRegistry 加载 TTS 服务配置', async () => {
      const ttsEntry: ServiceEntry = {
        def: {
          id: 'piper-tts',
          name: 'Piper TTS Service',
          type: 'tts',
          device: 'cpu',
          port: 8002,
          exec: {
            command: 'python',
            args: ['piper_http_server.py'],
            cwd: '.',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/piper-tts',
      };
      
      mockRegistry.set('piper-tts', ttsEntry);

      const config = await (manager as any).getServiceConfig('tts');

      expect(config).toBeDefined();
      expect(config.name).toBe('Piper TTS Service');
      expect(config.port).toBe(8002);
      expect(config.servicePath).toBe('/mock/services/piper-tts');
      expect(config.scriptPath).toContain('piper-tts');
      expect(config.scriptPath).toContain('piper_http_server.py');
    });

    it('应该正确处理绝对路径的脚本', async () => {
      const serviceEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'NMT Service',
          type: 'nmt',
          device: 'cuda',
          port: 8001,
          exec: {
            command: 'python',
            args: ['/absolute/path/to/script.py'],
            cwd: '.',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', serviceEntry);

      const config = await (manager as any).getServiceConfig('nmt');

      expect(config.scriptPath).toBe('/absolute/path/to/script.py');
    });

    it('应该正确处理自定义工作目录', async () => {
      const serviceEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'NMT Service',
          type: 'nmt',
          device: 'cuda',
          port: 8001,
          exec: {
            command: 'python',
            args: ['script.py'],
            cwd: '/custom/working/dir',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', serviceEntry);

      const config = await (manager as any).getServiceConfig('nmt');

      expect(config.workingDir).toBe('/custom/working/dir');
    });

    it('应该为没有指定端口的服务使用默认端口', async () => {
      const serviceEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'NMT Service',
          type: 'nmt',
          device: 'cuda',
          // 没有 port 字段
          exec: {
            command: 'python',
            args: ['script.py'],
            cwd: '.',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', serviceEntry);

      const config = await (manager as any).getServiceConfig('nmt');

      expect(config.port).toBe(8000); // 默认端口
    });
  });

  describe('getServiceConfig - 异常场景', () => {
    it('当服务不在 Registry 中时应该返回 null', async () => {
      // Registry 为空
      mockRegistry.clear();

      const config = await (manager as any).getServiceConfig('nmt');

      expect(config).toBeNull();
    });

    it('当 Registry 为 null 时应该返回 null', async () => {
      (serviceLayer.getServiceRegistry as jest.Mock).mockReturnValue(null);

      const config = await (manager as any).getServiceConfig('nmt');

      expect(config).toBeNull();
    });

    it('当服务配置缺少 exec 定义时应该返回 null', async () => {
      const invalidEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'NMT Service',
          type: 'nmt',
          device: 'cuda',
          port: 8001,
          // 缺少 exec 字段
          version: '1.0.0',
        } as any,
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', invalidEntry);

      const config = await (manager as any).getServiceConfig('nmt');

      expect(config).toBeNull();
    });
  });

  describe('getServiceId - 服务名称映射', () => {
    it('应该正确映射所有服务名称到 service_id', () => {
      const testCases = [
        { name: 'nmt', expectedId: 'nmt-m2m100' },
        { name: 'tts', expectedId: 'piper-tts' },
        { name: 'yourtts', expectedId: 'your-tts' },
        { name: 'speaker_embedding', expectedId: 'speaker-embedding' },
        { name: 'faster_whisper_vad', expectedId: 'faster-whisper-vad' },
      ];

      testCases.forEach(({ name, expectedId }) => {
        const serviceId = (manager as any).getServiceId(name);
        expect(serviceId).toBe(expectedId);
      });
    });
  });

  describe('环境变量构建', () => {
    it('应该包含所有必需的环境变量', async () => {
      const serviceEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'NMT Service',
          type: 'nmt',
          device: 'cuda',
          port: 8001,
          exec: {
            command: 'python',
            args: ['script.py'],
            cwd: '.',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', serviceEntry);

      const config = await (manager as any).getServiceConfig('nmt');

      // 验证必需的环境变量
      expect(config.env.PYTHONIOENCODING).toBe('utf-8');
      expect(config.env.CUDA_VISIBLE_DEVICES).toBe('0');
      expect(config.env.CUDA_PATH).toBe('/mock/cuda');
      
      // 验证 PATH 包含 venv Scripts 目录
      expect(config.env.PATH).toContain('nmt-m2m100');
      expect(config.env.PATH).toContain('venv');
      expect(config.env.PATH).toContain('Scripts');
    });

    it('应该继承系统环境变量', async () => {
      // 设置一个测试用的环境变量
      process.env.TEST_ENV_VAR = 'test_value';

      const serviceEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'NMT Service',
          type: 'nmt',
          device: 'cuda',
          port: 8001,
          exec: {
            command: 'python',
            args: ['script.py'],
            cwd: '.',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', serviceEntry);

      const config = await (manager as any).getServiceConfig('nmt');

      // 验证继承了系统环境变量
      expect(config.env.TEST_ENV_VAR).toBe('test_value');

      // 清理
      delete process.env.TEST_ENV_VAR;
    });
  });

  describe('路径构建', () => {
    it('应该正确构建所有路径', async () => {
      const serviceEntry: ServiceEntry = {
        def: {
          id: 'nmt-m2m100',
          name: 'NMT Service',
          type: 'nmt',
          device: 'cuda',
          port: 8001,
          exec: {
            command: 'python',
            args: ['nmt_service.py'],
            cwd: '.',
          },
          version: '1.0.0',
        },
        runtime: {
          status: 'stopped',
          pid: null,
          lastError: null,
        },
        installPath: '/mock/services/nmt-m2m100',
      };
      
      mockRegistry.set('nmt-m2m100', serviceEntry);

      const config = await (manager as any).getServiceConfig('nmt');

      // 验证所有路径（使用 toContain 以兼容不同平台的路径分隔符）
      expect(config.servicePath).toBe('/mock/services/nmt-m2m100');
      expect(config.venvPath).toContain('nmt-m2m100');
      expect(config.venvPath).toContain('venv');
      expect(config.scriptPath).toContain('nmt-m2m100');
      expect(config.scriptPath).toContain('nmt_service.py');
      expect(config.workingDir).toBe('.'); // cwd 设置为 '.' 时保持原样
      expect(config.logDir).toContain('nmt-m2m100');
      expect(config.logDir).toContain('logs');
      expect(config.logFile).toContain('nmt-m2m100');
      expect(config.logFile).toContain('logs');
      expect(config.logFile).toContain('nmt-m2m100.log');
    });
  });

  describe('集成测试 - 多个服务', () => {
    it('应该能够同时加载多个服务的配置', async () => {
      // 添加多个服务到 Registry
      const services = [
        {
          name: 'nmt',
          entry: {
            def: {
              id: 'nmt-m2m100',
              name: 'NMT Service',
              type: 'nmt',
              device: 'cuda',
              port: 8001,
              exec: { command: 'python', args: ['nmt_service.py'], cwd: '.' },
              version: '1.0.0',
            },
            runtime: { status: 'stopped' as const, pid: null, lastError: null },
            installPath: '/mock/services/nmt-m2m100',
          },
        },
        {
          name: 'tts',
          entry: {
            def: {
              id: 'piper-tts',
              name: 'TTS Service',
              type: 'tts',
              device: 'cpu',
              port: 8002,
              exec: { command: 'python', args: ['tts_service.py'], cwd: '.' },
              version: '1.0.0',
            },
            runtime: { status: 'stopped' as const, pid: null, lastError: null },
            installPath: '/mock/services/piper-tts',
          },
        },
      ];

      services.forEach(({ entry }) => {
        mockRegistry.set(entry.def.id, entry);
      });

      // 加载所有服务配置
      const configs = await Promise.all(
        services.map(({ name }) => (manager as any).getServiceConfig(name))
      );

      expect(configs).toHaveLength(2);
      expect(configs[0].name).toBe('NMT Service');
      expect(configs[1].name).toBe('TTS Service');
      expect(configs[0].port).toBe(8001);
      expect(configs[1].port).toBe(8002);
    });
  });
});
