/**
 * 节点语言能力检测器
 * 负责从服务、模型等信息中提取节点的语言能力
 */

import { InstalledService, InstalledModel, ServiceType, CapabilityByType } from '../../../../shared/protocols/messages';
import logger from '../logger';
import { ModelMetadataManager } from './language-capability/language-capability-metadata';
import { normalizeLanguages } from './language-capability/language-capability-normalizer';
import { detectASRLanguages } from './language-capability/language-capability-asr';
import { detectTTSLanguages } from './language-capability/language-capability-tts';
import { detectNMTLanguagePairs } from './language-capability/language-capability-nmt';
import { detectSemanticLanguages } from './language-capability/language-capability-semantic';

/** NMT 服务返回的语言集合（用于求交集） */
export interface NmtCapability {
  model_id: string;
  languages: string[];
  rule: 'any_to_any' | 'any_to_en' | 'en_to_any' | 'specific_pairs';
  blocked_pairs?: Array<{ src: string; tgt: string }>;
  supported_pairs?: Array<{ src: string; tgt: string }>;
}

/** 节点语言能力：asr/semantic/tts 均为运行中服务语言的交集，供心跳与注册上报 */
export interface NodeLanguageCapabilities {
  asr_languages?: string[];
  tts_languages?: string[];
  semantic_languages?: string[];
  semantic_core_ready?: boolean;
}

/**
 * 按服务类型获取该服务支持的语言集合（用于求交集）
 */
async function getServiceSupportedLanguages(
  service: InstalledService,
  installedModels: InstalledModel[],
  metadataManager: ModelMetadataManager
): Promise<string[]> {
  switch (service.type) {
    case ServiceType.ASR:
      return detectASRLanguages(service, installedModels, metadataManager);
    case ServiceType.TTS:
      return detectTTSLanguages(service, installedModels, metadataManager);
    case ServiceType.SEMANTIC:
      return detectSemanticLanguages(service, installedModels, metadataManager);
    case ServiceType.NMT: {
      const cap = await detectNMTLanguagePairs(service, installedModels, metadataManager);
      return cap?.languages ?? [];
    }
    default:
      return [];
  }
}

/**
 * 节点支持语言 = 所有已运行服务支持语言的交集（最大公约数）。
 * 各服务启动/停止后，心跳时重新计算，调度端据此更新节点池。
 */
export async function detectNodeSupportedLanguagesIntersection(
  installedServices: InstalledService[],
  installedModels: InstalledModel[],
  metadataManager: ModelMetadataManager
): Promise<string[]> {
  const running = installedServices.filter(s => s.status === 'running');
  if (running.length === 0) return [];

  const langSets: string[][] = [];
  for (const service of running) {
    const langs = await getServiceSupportedLanguages(service, installedModels, metadataManager);
    if (langs.length > 0) {
      langSets.push(normalizeLanguages([...new Set(langs)]));
    }
  }
  if (langSets.length === 0) return [];

  let intersection = new Set(langSets[0]);
  for (let i = 1; i < langSets.length; i++) {
    intersection = new Set(langSets[i].filter(l => intersection.has(l)));
  }
  return normalizeLanguages([...intersection]);
}

/**
 * 语言能力检测器
 */
export class LanguageCapabilityDetector {
  private metadataManager: ModelMetadataManager;

  constructor() {
    this.metadataManager = new ModelMetadataManager();
    this.metadataManager.loadModelMetadata();
  }

  /**
   * 检测节点语言能力：用所有已运行服务语言的交集作为 asr/semantic/tts 能力，
   * 供心跳与注册上报；调度端按心跳更新节点池。
   */
  async detectLanguageCapabilities(
    installedServices: InstalledService[],
    installedModels: InstalledModel[],
    _capability_by_type: CapabilityByType[]
  ): Promise<NodeLanguageCapabilities> {
    const intersection = await detectNodeSupportedLanguagesIntersection(
      installedServices,
      installedModels,
      this.metadataManager
    );

    const asr_languages = intersection;
    const semantic_languages = intersection;
    const tts_languages = intersection;

    const capabilities: NodeLanguageCapabilities = {
      asr_languages,
      tts_languages,
      semantic_languages,
      semantic_core_ready: intersection.length > 0,
    };

    logger.info(
      { supported_languages: intersection, count: intersection.length },
      '节点语言能力（运行中服务交集）'
    );
    return capabilities;
  }
}
