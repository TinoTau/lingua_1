/**
 * ServiceRegistry 单元测试
 * 
 * 测试服务注册表管理器的核心功能：
 * - 注册表加载和保存
 * - 已安装服务版本注册
 * - 当前激活版本管理
 * - 回滚版本获取
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ServiceRegistryManager } from '../../main/src/service-registry';

describe('ServiceRegistryManager', () => {
  let registryManager: ServiceRegistryManager;
  let testServicesDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testServicesDir = path.join(os.tmpdir(), `lingua-service-registry-test-${Date.now()}`);
    await fs.mkdir(testServicesDir, { recursive: true });
    
    registryManager = new ServiceRegistryManager(testServicesDir);
    await registryManager.loadRegistry();
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testServicesDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('注册表加载和保存', () => {
    it('应该能够加载空的注册表', async () => {
      const registry = await registryManager.loadRegistry();
      expect(registry.installed).toEqual({});
      expect(registry.current).toEqual({});
    });

    it('应该能够保存和加载注册表', async () => {
      // 注册一个已安装的服务
      await registryManager.registerInstalled(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/install',
        '/path/to/service.json'
      );

      // 创建新的管理器实例来测试持久化
      const newRegistryManager = new ServiceRegistryManager(testServicesDir);
      const loaded = await newRegistryManager.loadRegistry();
      
      const installed = newRegistryManager.getInstalled('test-service', '1.0.0', 'windows-x64');
      expect(installed).toBeDefined();
      expect(installed?.service_id).toBe('test-service');
      expect(installed?.version).toBe('1.0.0');
    });
  });

  describe('已安装服务版本注册', () => {
    it('应该能够注册已安装的服务版本', async () => {
      await registryManager.registerInstalled(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/install',
        '/path/to/service.json'
      );

      const installed = registryManager.getInstalled('test-service', '1.0.0', 'windows-x64');
      expect(installed).toBeDefined();
      expect(installed?.service_id).toBe('test-service');
      expect(installed?.version).toBe('1.0.0');
      expect(installed?.platform).toBe('windows-x64');
    });

    it('应该能够列出所有已安装的服务版本', async () => {
      await registryManager.registerInstalled(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/install',
        '/path/to/service.json'
      );

      await registryManager.registerInstalled(
        'test-service',
        '1.1.0',
        'windows-x64',
        '/path/to/install2',
        '/path/to/service2.json'
      );

      const allInstalled = registryManager.listInstalled();
      expect(allInstalled.length).toBeGreaterThanOrEqual(2);
      
      const serviceInstalled = registryManager.listInstalled('test-service');
      expect(serviceInstalled.length).toBe(2);
    });

    it('应该能够取消注册已安装的服务版本', async () => {
      await registryManager.registerInstalled(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/install',
        '/path/to/service.json'
      );

      await registryManager.unregisterInstalled('test-service', '1.0.0', 'windows-x64');

      const installed = registryManager.getInstalled('test-service', '1.0.0', 'windows-x64');
      expect(installed).toBeNull();
    });
  });

  describe('当前激活版本管理', () => {
    it('应该能够设置和获取当前激活版本', async () => {
      await registryManager.setCurrent(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/service.json',
        '/path/to/install'
      );

      const current = registryManager.getCurrent('test-service');
      expect(current).toBeDefined();
      expect(current?.service_id).toBe('test-service');
      expect(current?.version).toBe('1.0.0');
      expect(current?.platform).toBe('windows-x64');
    });

    it('应该能够移除当前激活版本', async () => {
      await registryManager.setCurrent(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/service.json',
        '/path/to/install'
      );

      await registryManager.removeCurrent('test-service');

      const current = registryManager.getCurrent('test-service');
      expect(current).toBeNull();
    });
  });

  describe('回滚版本获取', () => {
    it('应该能够获取上一个版本用于回滚', async () => {
      // 安装两个版本
      await registryManager.registerInstalled(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/install1',
        '/path/to/service1.json'
      );

      await registryManager.registerInstalled(
        'test-service',
        '1.1.0',
        'windows-x64',
        '/path/to/install2',
        '/path/to/service2.json'
      );

      // 设置当前版本为 1.1.0
      await registryManager.setCurrent(
        'test-service',
        '1.1.0',
        'windows-x64',
        '/path/to/service2.json',
        '/path/to/install2'
      );

      // 获取上一个版本
      const previous = registryManager.getPrevious('test-service');
      expect(previous).toBeDefined();
      expect(previous?.version).toBe('1.0.0');
    });

    it('如果没有安装其他版本，应该返回 null', async () => {
      await registryManager.registerInstalled(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/install',
        '/path/to/service.json'
      );

      await registryManager.setCurrent(
        'test-service',
        '1.0.0',
        'windows-x64',
        '/path/to/service.json',
        '/path/to/install'
      );

      const previous = registryManager.getPrevious('test-service');
      expect(previous).toBeNull();
    });
  });
});

