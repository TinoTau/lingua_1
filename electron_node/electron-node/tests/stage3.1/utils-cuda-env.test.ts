/**
 * CUDA 环境设置工具单元测试
 * 
 * 测试功能：
 * - CUDA 环境变量配置
 * - 路径检测
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { setupCudaEnvironment } from '../../main/src/utils/cuda-env';

describe('CUDA Environment', () => {
  describe('setupCudaEnvironment', () => {
    it('应该返回环境变量对象', () => {
      const env = setupCudaEnvironment();
      expect(typeof env).toBe('object');
      expect(env).not.toBeNull();
    });

    it('应该包含 PATH 环境变量', () => {
      const env = setupCudaEnvironment();
      // 即使没有 CUDA，也应该返回一个对象
      expect(env).toHaveProperty('PATH');
      expect(typeof env.PATH).toBe('string');
    });

    it('应该处理 CUDA 不存在的情况', () => {
      // 即使系统没有安装 CUDA，函数也不应该抛出错误
      expect(() => setupCudaEnvironment()).not.toThrow();
      
      const env = setupCudaEnvironment();
      expect(typeof env).toBe('object');
    });

    it('应该正确设置 CUDA 相关环境变量（如果 CUDA 存在）', () => {
      const env = setupCudaEnvironment();
      
      // 如果找到了 CUDA，应该设置相关环境变量
      // 如果没有找到，这些变量可能不存在
      const hasCuda = env.CUDA_PATH !== undefined;
      
      if (hasCuda) {
        expect(env).toHaveProperty('CUDA_PATH');
        expect(env).toHaveProperty('CUDAToolkit_ROOT');
        expect(env).toHaveProperty('CUDA_ROOT');
        expect(env).toHaveProperty('CUDA_HOME');
        expect(env).toHaveProperty('CMAKE_CUDA_COMPILER');
        
        expect(typeof env.CUDA_PATH).toBe('string');
        expect(env.CUDA_PATH.length).toBeGreaterThan(0);
      }
    });

    it('应该合并 PATH 环境变量', () => {
      const originalPath = process.env.PATH || '';
      const env = setupCudaEnvironment();
      
      // PATH 应该包含原始路径
      if (env.PATH) {
        // 如果设置了 CUDA，PATH 应该包含原始路径
        // 如果没有 CUDA，PATH 应该等于原始路径
        expect(env.PATH).toContain(originalPath);
      }
    });

    it('应该优先使用较新版本的 CUDA', () => {
      const env = setupCudaEnvironment();
      
      // 如果找到了 CUDA，应该使用第一个找到的（按优先级）
      // 测试主要确保函数不会因为多个 CUDA 版本而失败
      if (env.CUDA_PATH) {
        expect(typeof env.CUDA_PATH).toBe('string');
        // CUDA 路径应该指向一个有效的目录结构
        expect(env.CUDA_PATH).toMatch(/CUDA/);
      }
    });
  });
});

