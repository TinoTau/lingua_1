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
import { computeSemanticCentricLanguagePairs, LanguagePair } from './language-capability/language-capability-pairs';

/**
 * NMT 能力
 */
export interface NmtCapability {
  model_id: string;
  languages: string[];
  rule: 'any_to_any' | 'any_to_en' | 'en_to_any' | 'specific_pairs';
  blocked_pairs?: Array<{ src: string; tgt: string }>;
  supported_pairs?: Array<{ src: string; tgt: string }>;
}

/**
 * 节点语言能力
 * 重构日期：2026-01-20
 * 以语义修复为中心的架构
 */
export interface NodeLanguageCapabilities {
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  asr_languages?: string[];
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  tts_languages?: string[];
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  nmt_capabilities?: NmtCapability[];
  /** @deprecated 保留用于向后兼容，优先使用 supported_language_pairs */
  semantic_languages?: string[];  // 语义修复服务支持的语言
  
  /** 节点支持的语言对列表（带语义修复标记） */
  supported_language_pairs?: LanguagePair[];
  
  /** 语义修复核心就绪标记（是否有语义服务） */
  semantic_core_ready?: boolean;
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
   * 检测节点的语言能力
   * P0-3: 仅统计 READY 状态的服务
   */
  async detectLanguageCapabilities(
    installedServices: InstalledService[],
    installedModels: InstalledModel[],
    capability_by_type: CapabilityByType[]
  ): Promise<NodeLanguageCapabilities> {
    const capabilities: NodeLanguageCapabilities = {
      asr_languages: [],
      tts_languages: [],
      nmt_capabilities: [],
      semantic_languages: [],
    };

    // P0-3: 只处理 READY 状态的服务
    const readyServices = installedServices.filter(s => {
      // 检查服务状态为 running
      if (s.status !== 'running') return false;
      // 检查 capability_by_type 中对应类型为 ready
      const capability = capability_by_type.find(c => c.type === s.type);
      return capability?.ready === true;
    });

    // 1. 处理 ASR 服务
    const asrServices = readyServices.filter(s => s.type === ServiceType.ASR);
    for (const service of asrServices) {
      const langs = await detectASRLanguages(service, installedModels, this.metadataManager);
      capabilities.asr_languages!.push(...langs);
    }

    // 2. 处理 TTS 服务
    const ttsServices = readyServices.filter(s => s.type === ServiceType.TTS);
    for (const service of ttsServices) {
      const langs = await detectTTSLanguages(service, installedModels, this.metadataManager);
      capabilities.tts_languages!.push(...langs);
    }

    // 3. 处理 NMT 服务
    const nmtServices = readyServices.filter(s => s.type === ServiceType.NMT);
    for (const service of nmtServices) {
      const nmtCap = await detectNMTLanguagePairs(service, installedModels, this.metadataManager);
      if (nmtCap) {
        capabilities.nmt_capabilities!.push(nmtCap);
      }
    }

    // 4. 处理语义修复服务（SEMANTIC）
    const semanticServices = readyServices.filter(s => s.type === ServiceType.SEMANTIC);
    logger.debug({ 
      semantic_service_count: semanticServices.length 
    }, '检测到语义修复服务');
    
    for (const service of semanticServices) {
      const langs = await detectSemanticLanguages(service, installedModels, this.metadataManager);
      if (langs.length > 0) {
        logger.debug({ 
          service_id: service.service_id,
          model_id: service.model_id,
          languages: langs,
          language_count: langs.length
        }, '语义修复服务支持的语言');
      } else {
        logger.warn({ 
          service_id: service.service_id,
          model_id: service.model_id
        }, '语义修复服务未检测到支持的语言');
      }
      capabilities.semantic_languages!.push(...langs);
    }

    // 去重和规范化
    capabilities.asr_languages = normalizeLanguages([...new Set(capabilities.asr_languages!)]);
    capabilities.tts_languages = normalizeLanguages([...new Set(capabilities.tts_languages!)]);
    capabilities.semantic_languages = normalizeLanguages([...new Set(capabilities.semantic_languages!)]);

    // 5. 以语义修复为中心计算语言对（纯函数，不依赖时序）
    capabilities.supported_language_pairs = computeSemanticCentricLanguagePairs(
      capabilities.asr_languages!,
      capabilities.tts_languages!,
      capabilities.nmt_capabilities!,
      capabilities.semantic_languages!
    );

    // 6. 标记语义修复核心状态
    capabilities.semantic_core_ready = capabilities.semantic_languages!.length > 0;

    // 记录语言能力检测结果（增强版日志）
    const semanticOnTgtCount = capabilities.supported_language_pairs?.filter(p => p.semantic_on_tgt).length || 0;
    logger.info({ 
      asr_languages: capabilities.asr_languages!.length,
      tts_languages: capabilities.tts_languages!.length,
      nmt_capabilities: capabilities.nmt_capabilities!.length,
      semantic_languages: capabilities.semantic_languages!.length,
      semantic_core_ready: capabilities.semantic_core_ready,
      supported_language_pairs: capabilities.supported_language_pairs!.length,
      semantic_on_src: capabilities.supported_language_pairs!.length,  // 全部都有源语言语义修复
      semantic_on_tgt: semanticOnTgtCount,
      language_pairs_detail: capabilities.supported_language_pairs?.slice(0, 10).map(p => 
        `${p.src}-${p.tgt}${p.semantic_on_tgt ? '(+tgt)' : ''}`
      ).join(', ') || 'none'
    }, '✅ Language capabilities detected (semantic-centric)');

    return capabilities;
  }
}
