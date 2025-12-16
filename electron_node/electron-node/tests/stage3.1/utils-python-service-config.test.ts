/**
 * Python 服务配置工具单元测试
 * 
 * 测试功能：
 * - NMT 服务配置生成
 * - TTS 服务配置生成
 * - YourTTS 服务配置生成
 * - 环境变量配置
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getPythonServiceConfig, PythonServiceConfig } from '../../main/src/utils/python-service-config';

describe('Python Service Config', () => {
  let testProjectRoot: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // 创建临时测试目录
    testProjectRoot = path.join(os.tmpdir(), `lingua-test-${Date.now()}`);
    fs.mkdirSync(testProjectRoot, { recursive: true });
    
    // 创建必要的目录结构
    const servicesDir = path.join(testProjectRoot, 'electron_node', 'services');
    fs.mkdirSync(path.join(servicesDir, 'nmt_m2m100'), { recursive: true });
    fs.mkdirSync(path.join(servicesDir, 'piper_tts'), { recursive: true });
    fs.mkdirSync(path.join(servicesDir, 'your_tts'), { recursive: true });
    
    // 保存原始环境变量
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = originalEnv;
    
    // 清理测试目录
    try {
      fs.rmSync(testProjectRoot, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  describe('getPythonServiceConfig', () => {
    it('应该为 NMT 服务生成配置', () => {
      const config = getPythonServiceConfig('nmt', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.name).toBe('NMT');
      expect(config!.port).toBe(5008);
      expect(config!.servicePath).toContain('nmt_m2m100');
      expect(config!.scriptPath).toContain('nmt_service.py');
      expect(config!.env).toHaveProperty('HF_LOCAL_FILES_ONLY');
      expect(config!.env.HF_LOCAL_FILES_ONLY).toBe('true');
    });

    it('应该为 TTS 服务生成配置', () => {
      const config = getPythonServiceConfig('tts', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.name).toBe('TTS (Piper)');
      expect(config!.port).toBe(5006);
      expect(config!.servicePath).toContain('piper_tts');
      expect(config!.scriptPath).toContain('piper_http_server.py');
      expect(config!.env).toHaveProperty('PIPER_MODEL_DIR');
    });

    it('应该为 YourTTS 服务生成配置', () => {
      const config = getPythonServiceConfig('yourtts', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.name).toBe('YourTTS');
      expect(config!.port).toBe(5004);
      expect(config!.servicePath).toContain('your_tts');
      expect(config!.scriptPath).toContain('yourtts_service.py');
      expect(config!.env).toHaveProperty('YOURTTS_MODEL_DIR');
    });

    it('应该创建日志目录', () => {
      const config = getPythonServiceConfig('nmt', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(fs.existsSync(config!.logDir)).toBe(true);
      expect(fs.existsSync(path.dirname(config!.logFile))).toBe(true);
    });

    it('应该读取 HF token 文件（如果存在）', () => {
      const nmtServicePath = path.join(testProjectRoot, 'electron_node', 'services', 'nmt_m2m100');
      const hfTokenFile = path.join(nmtServicePath, 'hf_token.txt');
      const testToken = 'test-token-12345';
      
      fs.writeFileSync(hfTokenFile, testToken, 'utf-8');
      
      const config = getPythonServiceConfig('nmt', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.env.HF_TOKEN).toBe(testToken);
    });

    it('应该处理 HF token 文件不存在的情况', () => {
      const config = getPythonServiceConfig('nmt', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.env.HF_TOKEN).toBe('');
    });

    it('应该使用环境变量中的 PIPER_MODEL_DIR', () => {
      const customModelDir = '/custom/piper/models';
      process.env.PIPER_MODEL_DIR = customModelDir;
      
      const config = getPythonServiceConfig('tts', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.env.PIPER_MODEL_DIR).toBe(customModelDir);
    });

    it('应该使用环境变量中的 YOURTTS_MODEL_DIR', () => {
      const customModelDir = '/custom/yourtts/models';
      process.env.YOURTTS_MODEL_DIR = customModelDir;
      
      const config = getPythonServiceConfig('yourtts', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.env.YOURTTS_MODEL_DIR).toBe(customModelDir);
    });

    it('应该配置虚拟环境路径', () => {
      const config = getPythonServiceConfig('nmt', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.env).toHaveProperty('VIRTUAL_ENV');
      expect(config!.env.VIRTUAL_ENV).toContain('venv');
      expect(config!.env.PATH).toContain('Scripts');
    });

    it('应该包含 CUDA 环境变量', () => {
      const config = getPythonServiceConfig('tts', testProjectRoot);
      
      expect(config).not.toBeNull();
      // CUDA 环境变量可能不存在（如果没有 CUDA）
      // 但函数不应该抛出错误
      expect(typeof config!.env).toBe('object');
    });

    it('应该设置 PYTHONIOENCODING', () => {
      const config = getPythonServiceConfig('nmt', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.env.PYTHONIOENCODING).toBe('utf-8');
    });

    it('应该配置 GPU 使用标志', () => {
      const config = getPythonServiceConfig('tts', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config!.env).toHaveProperty('PIPER_USE_GPU');
      expect(['true', 'false']).toContain(config!.env.PIPER_USE_GPU);
    });

    it('应该为所有服务类型生成正确的端口', () => {
      const nmtConfig = getPythonServiceConfig('nmt', testProjectRoot);
      const ttsConfig = getPythonServiceConfig('tts', testProjectRoot);
      const yourttsConfig = getPythonServiceConfig('yourtts', testProjectRoot);
      
      expect(nmtConfig!.port).toBe(5008);
      expect(ttsConfig!.port).toBe(5006);
      expect(yourttsConfig!.port).toBe(5004);
    });

    it('应该生成完整的配置对象', () => {
      const config = getPythonServiceConfig('nmt', testProjectRoot);
      
      expect(config).not.toBeNull();
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('port');
      expect(config).toHaveProperty('servicePath');
      expect(config).toHaveProperty('venvPath');
      expect(config).toHaveProperty('scriptPath');
      expect(config).toHaveProperty('workingDir');
      expect(config).toHaveProperty('logDir');
      expect(config).toHaveProperty('logFile');
      expect(config).toHaveProperty('env');
      
      // 验证路径是绝对路径
      expect(path.isAbsolute(config!.servicePath)).toBe(true);
      expect(path.isAbsolute(config!.venvPath)).toBe(true);
      expect(path.isAbsolute(config!.scriptPath)).toBe(true);
      expect(path.isAbsolute(config!.workingDir)).toBe(true);
      expect(path.isAbsolute(config!.logDir)).toBe(true);
      expect(path.isAbsolute(config!.logFile)).toBe(true);
    });
  });
});

