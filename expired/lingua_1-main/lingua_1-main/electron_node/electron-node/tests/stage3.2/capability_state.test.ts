/**
 * 测试 capability_state 的状态判断逻辑
 * 验证不同运行状态的服务是否能返回正确的 ready 计数
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock 服务管理器
interface MockRustServiceStatus {
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number;
  gpuUsageMs: number;
}

interface MockPythonServiceStatus {
  name: string;
  running: boolean;
  starting: boolean;
  pid: number | null;
  port: number | null;
  startedAt: Date | null;
  lastError: string | null;
  taskCount: number;
  gpuUsageMs: number;
}

class MockRustServiceManager {
  private status: MockRustServiceStatus = {
    running: false,
    starting: false,
    pid: null,
    port: null,
    startedAt: null,
    lastError: null,
    taskCount: 0,
    gpuUsageMs: 0,
  };

  getStatus(): MockRustServiceStatus {
    return { ...this.status };
  }

  setRunning(running: boolean) {
    this.status.running = running;
    if (running) {
      this.status.pid = 12345;
      this.status.port = 5009;
      this.status.startedAt = new Date();
    } else {
      this.status.pid = null;
      this.status.port = null;
      this.status.startedAt = null;
    }
  }
}

class MockPythonServiceManager {
  private statuses: Map<string, MockPythonServiceStatus> = new Map([
    ['nmt', {
      name: 'nmt',
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
    }],
    ['tts', {
      name: 'tts',
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
    }],
    ['yourtts', {
      name: 'yourtts',
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
    }],
  ]);

  getServiceStatus(serviceName: 'nmt' | 'tts' | 'yourtts'): MockPythonServiceStatus {
    const status = this.statuses.get(serviceName);
    return status ? { ...status } : {
      name: serviceName,
      running: false,
      starting: false,
      pid: null,
      port: null,
      startedAt: null,
      lastError: null,
      taskCount: 0,
      gpuUsageMs: 0,
    };
  }

  setRunning(serviceName: 'nmt' | 'tts' | 'yourtts', running: boolean) {
    const status = this.statuses.get(serviceName);
    if (status) {
      status.running = running;
      if (running) {
        status.pid = 10000 + serviceName.charCodeAt(0);
        status.port = serviceName === 'nmt' ? 5008 : serviceName === 'tts' ? 5007 : 5006;
        status.startedAt = new Date();
      } else {
        status.pid = null;
        status.port = null;
        status.startedAt = null;
      }
    }
  }
}

class MockServiceRegistryManager {
  private installed: any = {
    'node-inference': {
      '1.0.0::windows-x64': {
        service_id: 'node-inference',
        version: '1.0.0',
        platform: 'windows-x64',
        installed_at: new Date().toISOString(),
        install_path: '/path/to/node-inference',
      },
    },
    'nmt-m2m100': {
      '1.0.0::windows-x64': {
        service_id: 'nmt-m2m100',
        version: '1.0.0',
        platform: 'windows-x64',
        installed_at: new Date().toISOString(),
        install_path: '/path/to/nmt-m2m100',
      },
    },
    'piper-tts': {
      '1.0.0::windows-x64': {
        service_id: 'piper-tts',
        version: '1.0.0',
        platform: 'windows-x64',
        installed_at: new Date().toISOString(),
        install_path: '/path/to/piper-tts',
      },
    },
    'your-tts': {
      '1.0.0::windows-x64': {
        service_id: 'your-tts',
        version: '1.0.0',
        platform: 'windows-x64',
        installed_at: new Date().toISOString(),
        install_path: '/path/to/your-tts',
      },
    },
  };

  async loadRegistry(): Promise<void> {
    // Mock: 模拟加载注册表
  }

  listInstalled(): any[] {
    const result: any[] = [];
    for (const [serviceId, versions] of Object.entries(this.installed)) {
      for (const versionInfo of Object.values(versions as any)) {
        result.push(versionInfo);
      }
    }
    return result;
  }
}

// 简化版的 capability_state 构建逻辑（模拟 NodeAgent.getCapabilityState 的核心逻辑）
async function buildCapabilityState(
  serviceRegistryManager: MockServiceRegistryManager,
  rustServiceManager: MockRustServiceManager,
  pythonServiceManager: MockPythonServiceManager
): Promise<Record<string, string>> {
  const capabilityState: Record<string, string> = {};

  await serviceRegistryManager.loadRegistry();
  const installedServices = serviceRegistryManager.listInstalled();
  const serviceIds = new Set<string>();
  installedServices.forEach((service: any) => {
    serviceIds.add(service.service_id);
  });

  for (const serviceId of serviceIds) {
    let isRunning = false;
    
    if (serviceId === 'node-inference') {
      const status = rustServiceManager.getStatus();
      isRunning = status?.running === true;
    } else if (serviceId === 'nmt-m2m100') {
      const status = pythonServiceManager.getServiceStatus('nmt');
      isRunning = status?.running === true;
    } else if (serviceId === 'piper-tts') {
      const status = pythonServiceManager.getServiceStatus('tts');
      isRunning = status?.running === true;
    } else if (serviceId === 'your-tts') {
      const status = pythonServiceManager.getServiceStatus('yourtts');
      isRunning = status?.running === true;
    }

    capabilityState[serviceId] = isRunning ? 'ready' : 'not_installed';
  }

  return capabilityState;
}

describe('CapabilityState - Service Running Status', () => {
  let rustServiceManager: MockRustServiceManager;
  let pythonServiceManager: MockPythonServiceManager;
  let serviceRegistryManager: MockServiceRegistryManager;

  beforeEach(() => {
    rustServiceManager = new MockRustServiceManager();
    pythonServiceManager = new MockPythonServiceManager();
    serviceRegistryManager = new MockServiceRegistryManager();
  });

  it('should return all services as not_installed when no services are running', async () => {
    // 所有服务都未运行
    const capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );

    expect(capabilityState['node-inference']).toBe('not_installed');
    expect(capabilityState['nmt-m2m100']).toBe('not_installed');
    expect(capabilityState['piper-tts']).toBe('not_installed');
    expect(capabilityState['your-tts']).toBe('not_installed');

    const readyCount = Object.values(capabilityState).filter(s => s === 'ready').length;
    expect(readyCount).toBe(0);
  });

  it('should return correct ready count when some services are running', async () => {
    // 只启动 node-inference 和 nmt-m2m100
    rustServiceManager.setRunning(true);
    pythonServiceManager.setRunning('nmt', true);

    const capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );

    expect(capabilityState['node-inference']).toBe('ready');
    expect(capabilityState['nmt-m2m100']).toBe('ready');
    expect(capabilityState['piper-tts']).toBe('not_installed');
    expect(capabilityState['your-tts']).toBe('not_installed');

    const readyCount = Object.values(capabilityState).filter(s => s === 'ready').length;
    expect(readyCount).toBe(2);
  });

  it('should return all services as ready when all services are running', async () => {
    // 启动所有服务
    rustServiceManager.setRunning(true);
    pythonServiceManager.setRunning('nmt', true);
    pythonServiceManager.setRunning('tts', true);
    pythonServiceManager.setRunning('yourtts', true);

    const capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );

    expect(capabilityState['node-inference']).toBe('ready');
    expect(capabilityState['nmt-m2m100']).toBe('ready');
    expect(capabilityState['piper-tts']).toBe('ready');
    expect(capabilityState['your-tts']).toBe('ready');

    const readyCount = Object.values(capabilityState).filter(s => s === 'ready').length;
    expect(readyCount).toBe(4);
  });

  it('should correctly reflect status changes when services start/stop', async () => {
    // 初始状态：所有服务都未运行
    let capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );
    expect(Object.values(capabilityState).filter(s => s === 'ready').length).toBe(0);

    // 启动 node-inference
    rustServiceManager.setRunning(true);
    capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );
    expect(capabilityState['node-inference']).toBe('ready');
    expect(Object.values(capabilityState).filter(s => s === 'ready').length).toBe(1);

    // 再启动 nmt-m2m100
    pythonServiceManager.setRunning('nmt', true);
    capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );
    expect(capabilityState['node-inference']).toBe('ready');
    expect(capabilityState['nmt-m2m100']).toBe('ready');
    expect(Object.values(capabilityState).filter(s => s === 'ready').length).toBe(2);

    // 停止 node-inference
    rustServiceManager.setRunning(false);
    capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );
    expect(capabilityState['node-inference']).toBe('not_installed');
    expect(capabilityState['nmt-m2m100']).toBe('ready');
    expect(Object.values(capabilityState).filter(s => s === 'ready').length).toBe(1);
  });

  it('should handle unknown service IDs gracefully', async () => {
    // 添加一个未知的服务包（不在映射表中的）
    // 注意：由于我们修改了 MockServiceRegistryManager，需要直接修改其内部状态
    const installed = (serviceRegistryManager as any).installed;
    installed['unknown-service'] = {
      '1.0.0::windows-x64': {
        service_id: 'unknown-service',
        version: '1.0.0',
        platform: 'windows-x64',
        installed_at: new Date().toISOString(),
        install_path: '/path/to/unknown-service',
      },
    };

    const capabilityState = await buildCapabilityState(
      serviceRegistryManager,
      rustServiceManager,
      pythonServiceManager
    );

    // 未知服务应该被标记为 not_installed（因为 isServiceRunning 返回 false）
    expect(capabilityState['unknown-service']).toBe('not_installed');
  });
});

