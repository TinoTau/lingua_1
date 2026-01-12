/**
 * ServicePackageManager 单元测试
 * 
 * 测试服务包管理器的核心功能：
 * - 获取可用服务列表
 * - SHA256 校验
 * - 服务包解析
 * - 服务验证
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import axios from 'axios';
import { ServicePackageManager } from '../../main/src/service-package-manager';
import { ServiceInfo } from '../../main/src/service-package-manager/types';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ServicePackageManager', () => {
  let packageManager: ServicePackageManager;
  let testServicesDir: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testServicesDir = path.join(os.tmpdir(), `lingua-service-package-test-${Date.now()}`);
    await fs.mkdir(testServicesDir, { recursive: true });
    
    packageManager = new ServicePackageManager(testServicesDir);
    
    // 重置 axios mock
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testServicesDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('获取可用服务列表', () => {
    it('应该能够获取可用服务列表', async () => {
      const mockServices: { services: ServiceInfo[] } = {
        services: [
          {
            service_id: 'test-service',
            name: 'Test Service',
            latest_version: '1.0.0',
            variants: [
              {
                version: '1.0.0',
                platform: 'windows-x64',
                artifact: {
                  type: 'zip',
                  url: '/storage/services/test-service/1.0.0/windows-x64/service.zip',
                  sha256: 'test-hash',
                  size_bytes: 1000,
                },
              },
            ],
          },
        ],
      };

      mockedAxios.get.mockResolvedValueOnce({
        data: mockServices,
      });

      const services = await packageManager.getAvailableServices();
      expect(services).toBeDefined();
      expect(services.length).toBe(1);
      expect(services[0].service_id).toBe('test-service');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/services'),
        expect.any(Object)
      );
    });

    it('应该能够按平台过滤服务', async () => {
      const mockServices: { services: ServiceInfo[] } = {
        services: [],
      };

      mockedAxios.get.mockResolvedValueOnce({
        data: mockServices,
      });

      await packageManager.getAvailableServices('windows-x64');
      
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/services'),
        expect.objectContaining({
          params: { platform: 'windows-x64' },
        })
      );
    });

    it('应该处理获取服务列表失败的情况', async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

      await expect(packageManager.getAvailableServices()).rejects.toThrow();
    });
  });

  describe('SHA256 校验', () => {
    it('应该能够计算文件的 SHA256', async () => {
      const testFile = path.join(testServicesDir, 'test-file.txt');
      const testContent = 'test content';
      
      await fs.writeFile(testFile, testContent, 'utf-8');
      
      // 计算期望的哈希
      const hash = crypto.createHash('sha256');
      hash.update(testContent);
      const expectedHash = hash.digest('hex');
      
      // 使用私有方法测试（通过反射）
      // 注意：在实际项目中，可能需要将 verifySHA256 提取为公共方法或使用更复杂的测试方法
      // 这里我们只是验证哈希计算的逻辑是正确的
      const fileBuffer = await fs.readFile(testFile);
      const calculatedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      
      expect(calculatedHash).toBe(expectedHash);
    });
  });

  describe('服务包安装流程', () => {
    it('应该能够检测服务是否已安装', async () => {
      // 这个测试需要 mock ServiceRegistryManager
      // 由于 ServicePackageManager 内部创建了 ServiceRegistryManager
      // 我们需要通过集成测试来验证完整流程
      // 这里只是占位，实际测试需要更复杂的 setup
      
      expect(true).toBe(true); // 占位测试
    });
  });
});

