/**
 * PlatformAdapter 单元测试
 * 
 * 测试平台适配器的核心功能：
 * - 平台识别
 * - 进程启动
 * - 文件权限设置
 * - 路径拼接
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as os from 'os';
import { createPlatformAdapter, getPlatformAdapter, Platform } from '../../main/src/platform-adapter';

describe('PlatformAdapter', () => {
  describe('平台识别', () => {
    it('应该返回正确的平台 ID', () => {
      const adapter = createPlatformAdapter();
      const platformId = adapter.getPlatformId();
      
      // 根据当前平台验证
      const platform = os.platform();
      const arch = os.arch();
      
      if (platform === 'win32' && arch === 'x64') {
        expect(platformId).toBe('windows-x64');
      } else if (platform === 'linux' && arch === 'x64') {
        expect(platformId).toBe('linux-x64');
      }
      // 其他平台可以添加更多测试
    });
  });

  describe('路径拼接', () => {
    it('Windows 应该使用 win32 路径分隔符', () => {
      const adapter = createPlatformAdapter();
      const platformId = adapter.getPlatformId();
      
      if (platformId === 'windows-x64') {
        const result = adapter.pathJoin('C:', 'Users', 'test', 'file.txt');
        expect(result).toBe('C:\\Users\\test\\file.txt');
      }
    });
  });

  describe('单例模式', () => {
    it('getPlatformAdapter 应该返回相同的实例', () => {
      const adapter1 = getPlatformAdapter();
      const adapter2 = getPlatformAdapter();
      
      expect(adapter1).toBe(adapter2);
    });
  });

  describe('进程启动', () => {
    it('应该能够启动进程', (done) => {
      const adapter = createPlatformAdapter();
      
      // 根据平台选择测试命令
      const platform = adapter.getPlatformId();
      let command: string;
      let args: string[];
      
      if (platform === 'windows-x64') {
        command = 'cmd';
        args = ['/c', 'echo', 'test'];
      } else {
        command = 'echo';
        args = ['test'];
      }
      
      const process = adapter.spawn(command, args, {
        stdio: 'pipe',
      });
      
      expect(process).toBeDefined();
      expect(process.pid).toBeDefined();
      
      process.on('exit', (code) => {
        expect(code).toBe(0);
        done();
      });
    });
  });
});

