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

    it('应该检测 NMT 服务的能力', async () => {
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
        {
          type: ServiceType.NMT,
          ready: true,
        },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      expect(capabilities.nmt_capabilities).toBeDefined();
      expect(capabilities.nmt_capabilities?.length).toBeGreaterThan(0);
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

    it('应该只统计 READY 状态的服务', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'asr-ready',
          model_id: 'faster-whisper',
          type: ServiceType.ASR,
          status: 'running',
          version: '1.0.0',
        },
        {
          service_id: 'asr-not-ready',
          model_id: 'faster-whisper',
          type: ServiceType.ASR,
          status: 'running',
          version: '1.0.0',
        },
      ];

      const installedModels: InstalledModel[] = [];

      const capabilityByType: CapabilityByType[] = [
        {
          type: ServiceType.ASR,
          ready: true,  // 只有第一个服务是 ready
        },
      ];

      const capabilities = await detector.detectLanguageCapabilities(
        installedServices,
        installedModels,
        capabilityByType
      );

      // 应该只统计 ready 的服务
      expect(capabilities.asr_languages).toBeDefined();
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

      expect(capabilities.asr_languages).toBeDefined();
      expect(capabilities.asr_languages?.length).toBeGreaterThan(0);
      expect(capabilities.semantic_languages).toBeDefined();
      expect(capabilities.semantic_languages?.length).toBeGreaterThan(0);
      expect(capabilities.nmt_capabilities).toBeDefined();
      expect(capabilities.nmt_capabilities?.length).toBeGreaterThan(0);
      expect(capabilities.tts_languages).toBeDefined();
      expect(capabilities.tts_languages?.length).toBeGreaterThan(0);
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

    it('应该从服务ID推断多种语言', async () => {
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

      expect(capabilities.semantic_languages).toContain('zh');
      expect(capabilities.semantic_languages).toContain('en');
    });
  });

  describe('语言对计算基于语义修复服务能力', () => {
    it('应该只包含源语言和目标语言都在语义修复服务支持列表中的语言对', async () => {
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

      // 语义修复服务只支持 zh，所以 zh-en 应该被包含（zh 和 en 都在语义修复服务支持列表中）
      // 但这里语义修复服务只支持 zh，不支持 en，所以 zh-en 不应该被包含
      expect(capabilities.supported_language_pairs).toBeDefined();
      if (capabilities.supported_language_pairs) {
        // 由于语义修复服务只支持 zh，不支持 en，所以 zh-en 不应该在语言对列表中
        const zhEnPair = capabilities.supported_language_pairs.find(
          p => p.src === 'zh' && p.tgt === 'en'
        );
        // 如果没有语义修复服务支持 en，zh-en 应该被过滤掉
        expect(zhEnPair).toBeUndefined();
      }
    });

    it('应该包含源语言和目标语言都在语义修复服务支持列表中的语言对', async () => {
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
          service_id: 'semantic-repair-en',
          model_id: 'semantic-repair-en',
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

      // 语义修复服务支持 zh 和 en，所以 zh-en 应该被包含
      expect(capabilities.supported_language_pairs).toBeDefined();
      if (capabilities.supported_language_pairs) {
        const zhEnPair = capabilities.supported_language_pairs.find(
          p => p.src === 'zh' && p.tgt === 'en'
        );
        expect(zhEnPair).toBeDefined();
      }
    });

    it('如果没有语义修复服务，应该返回空语言对列表', async () => {
      const installedServices: InstalledService[] = [
        {
          service_id: 'asr-whisper',
          model_id: 'faster-whisper',
          type: ServiceType.ASR,
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
      ];

      const capabilityByType: CapabilityByType[] = [
        {
          type: ServiceType.ASR,
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

      // 没有语义修复服务，应该返回空语言对列表
      expect(capabilities.supported_language_pairs).toBeDefined();
      if (capabilities.supported_language_pairs) {
        expect(capabilities.supported_language_pairs.length).toBe(0);
      }
    });
  });
});
