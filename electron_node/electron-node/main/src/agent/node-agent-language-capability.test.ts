/**
 * 语言能力检测器单元测试
 */

import { LanguageCapabilityDetector } from './node-agent-language-capability';
import { InstalledService, InstalledModel, ServiceType, CapabilityByType } from '../../../../shared/protocols/messages';

describe('LanguageCapabilityDetector', () => {
  let detector: LanguageCapabilityDetector;

  beforeEach(() => {
    detector = new LanguageCapabilityDetector();
  });

  describe('detectLanguageCapabilities', () => {
    it('应该检测 ASR 服务的语言', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'asr-whisper',
          model_id: 'faster-whisper',
          type: ServiceType.ASR,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const installedModels: InstalledModel[] = [
        {
          model_id: 'faster-whisper',
          kind: 'asr',
          src_lang: 'zh',
          tgt_lang: null,
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
      ];

      const capabilityByType: CapabilityByType[] = [
        {
          type: ServiceType.ASR,
          ready: true,
        },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      expect(capabilities.asr_languages).toBeDefined();
      expect(capabilities.asr_languages?.length).toBeGreaterThan(0);
    });

    it('应该检测 TTS 服务的语言', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'tts-piper',
          model_id: 'piper-tts',
          type: ServiceType.TTS,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const installedModels: InstalledModel[] = [
        {
          model_id: 'piper-tts',
          kind: 'tts',
          src_lang: null,
          tgt_lang: 'en',
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
      ];

      const capabilityByType: CapabilityByType[] = [
        {
          type: ServiceType.TTS,
          ready: true,
        },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      expect(capabilities.tts_languages).toBeDefined();
      expect(capabilities.tts_languages?.length).toBeGreaterThan(0);
    });

    it('应该从 NMT 服务得到语言交集', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'nmt-m2m100',
          model_id: 'm2m100',
          type: ServiceType.NMT,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const installedModels: InstalledModel[] = [
        {
          model_id: 'm2m100',
          kind: 'nmt',
          src_lang: 'zh',
          tgt_lang: 'en',
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
      ];

      const capabilityByType: CapabilityByType[] = [
        { type: ServiceType.NMT, ready: true },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      expect(capabilities.asr_languages).toBeDefined();
      expect(capabilities.semantic_languages).toBeDefined();
      expect(capabilities.tts_languages).toBeDefined();
      expect(capabilities.asr_languages?.length).toBeGreaterThan(0);
    });

    it('应该检测语义修复服务的语言', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'semantic-repair-zh',
          model_id: 'semantic-repair-zh',
          type: ServiceType.SEMANTIC,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const installedModels: InstalledModel[] = [];

      const capabilityByType: CapabilityByType[] = [
        {
          type: ServiceType.SEMANTIC,
          ready: true,
        },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      expect(capabilities.semantic_languages).toBeDefined();
      expect(capabilities.semantic_languages?.length).toBeGreaterThan(0);
      expect(capabilities.semantic_languages).toContain('zh');
    });

    it('应该只统计 running 状态的服务', async () => {
      const installedServices: InstalledService[] = [
        { service_id: 'asr-1', model_id: 'faster-whisper', type: ServiceType.ASR, status: 'running', version: '1.0.0' },
        { service_id: 'asr-2', model_id: 'faster-whisper', type: ServiceType.ASR, status: 'stopped', version: '1.0.0' },
      ];
      const installedModels: InstalledModel[] = [];
      const capabilityByType: CapabilityByType[] = [{ type: ServiceType.ASR, ready: true }];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      expect(capabilities.asr_languages).toBeDefined();
      expect(capabilities.asr_languages?.length).toBeGreaterThan(0);
    });

    it('应该规范化语言代码', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'asr-whisper',
          model_id: 'faster-whisper',
          type: ServiceType.ASR,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const installedModels: InstalledModel[] = [
        {
          model_id: 'faster-whisper',
          kind: 'asr',
          src_lang: 'zh-CN',  // 使用变体
          tgt_lang: null,
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
      ];

      const capabilityByType: CapabilityByType[] = [
        {
          type: ServiceType.ASR,
          ready: true,
        },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      // zh-CN 应该被规范化为 zh
      expect(capabilities.asr_languages).toContain('zh');
      expect(capabilities.asr_languages).not.toContain('zh-cn');
    });

    it('应该处理完整的服务链路（ASR + SEMANTIC + NMT + TTS）', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'asr-whisper',
          model_id: 'faster-whisper',
          type: ServiceType.ASR,
          status: 'running',
          version: '1.0.0',
        },
        {
          service_id: 'semantic-repair-zh',
          model_id: 'semantic-repair-zh',
          type: ServiceType.SEMANTIC,
          status: 'running',
          version: '1.0.0',
        },
        {
          service_id: 'nmt-m2m100',
          model_id: 'm2m100',
          type: ServiceType.NMT,
          status: 'running',
          version: '1.0.0',
        },
        {
          service_id: 'tts-piper',
          model_id: 'piper-tts',
          type: ServiceType.TTS,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const installedModels: InstalledModel[] = [
        {
          model_id: 'faster-whisper',
          kind: 'asr',
          src_lang: 'zh',
          tgt_lang: null,
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
        {
          model_id: 'm2m100',
          kind: 'nmt',
          src_lang: 'zh',
          tgt_lang: 'en',
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
        {
          model_id: 'piper-tts',
          kind: 'tts',
          src_lang: null,
          tgt_lang: 'en',
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
        {
          model_id: 'piper-tts-zh',
          kind: 'tts',
          src_lang: 'zh',
          tgt_lang: null,
          dialect: null,
          version: '1.0.0',
          enabled: true,
        },
      ];

      const capabilityByType: CapabilityByType[] = [
        {
          type: ServiceType.ASR,
          ready: true,
        },
        {
          type: ServiceType.SEMANTIC,
          ready: true,
        },
        {
          type: ServiceType.NMT,
          ready: true,
        },
        {
          type: ServiceType.TTS,
          ready: true,
        },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      // ASR [zh]、SEMANTIC [zh]、NMT [zh,en]、TTS [zh,en] 交集为 [zh]
      expect(capabilities.asr_languages).toBeDefined();
      expect(capabilities.semantic_languages).toBeDefined();
      expect(capabilities.tts_languages).toBeDefined();
      expect(capabilities.asr_languages).toContain('zh');
      expect(capabilities.asr_languages?.length).toBeGreaterThan(0);
    });
  });

  describe('detectSemanticLanguages', () => {
    it('应该从服务ID推断语言（semantic-repair-zh）', async () => {
      const service: InstalledService = {
        service_id: 'semantic-repair-zh',
        model_id: 'semantic-repair-zh',
        type: ServiceType.SEMANTIC,
        status: 'running',
        version: '1.0.0',
      };

      const models: InstalledModel[] = [];

      // 使用反射访问私有方法（仅用于测试）
      const detector = new LanguageCapabilityDetector();
      const capabilities = await detector.detectLanguageCapabilities(
        [service],
        models,
        [{ type: ServiceType.SEMANTIC, ready: true }]
      );

      expect(capabilities.semantic_languages).toContain('zh');
    });

    it('多语义服务不同语言时交为空', async () => {
      const services: InstalledService[] = [
        {
          service_id: 'semantic-repair-zh',
          model_id: 'semantic-repair-zh',
          type: ServiceType.SEMANTIC,
          status: 'running',
          version: '1.0.0',
        },
        {
          service_id: 'semantic-repair-en',
          model_id: 'semantic-repair-en',
          type: ServiceType.SEMANTIC,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const models: InstalledModel[] = [];

      const detector = new LanguageCapabilityDetector();
      const capabilities = await detector.detectLanguageCapabilities(
        services,
        models,
        [{ type: ServiceType.SEMANTIC, ready: true }]
      );

      // 交集：[zh] ∩ [en] = []
      expect(capabilities.semantic_languages).toEqual([]);
    });
  });

  describe('运行中服务语言交集', () => {
    it('多服务时 asr/semantic/tts 均为交集', async () => {
      const installedServices: InstalledService[] = [
        { service_id: 'asr-1', model_id: 'asr', type: ServiceType.ASR, status: 'running', version: '1.0.0' },
        { service_id: 'semantic-1', model_id: 'sem', type: ServiceType.SEMANTIC, status: 'running', version: '1.0.0' },
        { service_id: 'tts-1', model_id: 'tts', type: ServiceType.TTS, status: 'running', version: '1.0.0' },
      ];
      const installedModels: InstalledModel[] = [];
      const capabilityByType: CapabilityByType[] = [
        { type: ServiceType.ASR, ready: true },
        { type: ServiceType.SEMANTIC, ready: true },
        { type: ServiceType.TTS, ready: true },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      expect(capabilities.asr_languages).toEqual(capabilities.semantic_languages);
      expect(capabilities.asr_languages).toEqual(capabilities.tts_languages);
      expect(capabilities.semantic_core_ready).toBe(capabilities.asr_languages && capabilities.asr_languages.length > 0);
    });

    it('无运行中服务时返回空', async () => {
      const installedServices: InstalledService[] = [
        { service_id: 'asr-1', model_id: 'asr', type: ServiceType.ASR, status: 'stopped', version: '1.0.0' },
      ];
      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        [],
        [{ type: ServiceType.ASR, ready: false }]
      );
      expect(capabilities.asr_languages?.length ?? 0).toBe(0);
      expect(capabilities.semantic_core_ready).toBeFalsy();
    });
  });
});
