/**
 * 语言能力检测 - NMT 语言对检测
 */

import { InstalledService, InstalledModel } from '@shared/protocols/messages';
import { ModelMetadataManager } from './language-capability-metadata';
import { NmtCapability } from '../node-agent-language-capability';
import logger from '../../logger';

/**
 * 检测 NMT 服务的语言对能力
 */
export async function detectNMTLanguagePairs(
  service: InstalledService,
  models: InstalledModel[],
  metadataManager: ModelMetadataManager
): Promise<NmtCapability | null> {
  // 优先级1：从服务查询
  // TODO: 实现服务能力查询接口

  // 优先级2：从模型元数据获取
  const modelMeta = metadataManager.findModelMetadata(service.model_id, 'nmt');
  if (modelMeta) {
    return {
      model_id: service.model_id || modelMeta.model_id,
      languages: modelMeta.supported_languages,
      rule: modelMeta.nmt_rule || 'any_to_any',
      blocked_pairs: modelMeta.nmt_blocked_pairs,
      supported_pairs: modelMeta.nmt_supported_pairs
    };
  }

  // 优先级3：从已安装模型推断
  const nmtModels = models.filter(m => m.kind === 'nmt');
  if (nmtModels.length > 0) {
    const allLanguages = new Set<string>();
    const specificPairs: Array<{ src: string; tgt: string }> = [];

    for (const model of nmtModels) {
      if (model.src_lang && model.tgt_lang) {
        allLanguages.add(model.src_lang);
        allLanguages.add(model.tgt_lang);
        specificPairs.push({ src: model.src_lang, tgt: model.tgt_lang });
      }
    }

    // 判断是否为多语言模型（M2M100）
    const serviceId = service.service_id.toLowerCase();
    const isMultilingual = serviceId.includes('m2m100') || 
                          serviceId.includes('m2m');

    if (isMultilingual) {
      // 多语言模型：使用 any_to_any 规则
      // 如果从模型中没有获取到语言，使用 M2M100 的默认语言列表
      if (allLanguages.size === 0) {
        // M2M100 支持的主要语言
        const m2m100Languages = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tr', 'pl', 'cs', 'nl', 'ro', 'hu', 'sv', 'da', 'fi', 'no', 'uk', 'bg', 'hr', 'sk', 'sl', 'sr', 'mk', 'sq', 'et', 'lv', 'lt'];
        m2m100Languages.forEach(lang => allLanguages.add(lang));
        logger.debug({ service_id: service.service_id }, '使用 M2M100 默认语言列表');
      }
      return {
        model_id: service.model_id || nmtModels[0].model_id,
        languages: Array.from(allLanguages),
        rule: 'any_to_any'
      };
    } else if (specificPairs.length > 0) {
      // 单语言对模型：使用 specific_pairs 规则
      return {
        model_id: service.model_id || nmtModels[0].model_id,
        languages: Array.from(allLanguages),
        rule: 'specific_pairs',
        supported_pairs: specificPairs
      };
    }
  }

  // 优先级4：从服务ID推断多语言模型（即使没有已安装模型）
  const serviceId = service.service_id.toLowerCase();
  if (serviceId.includes('m2m100') || serviceId.includes('m2m')) {
    // M2M100 支持的主要语言
    const m2m100Languages = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tr', 'pl', 'cs', 'nl', 'ro', 'hu', 'sv', 'da', 'fi', 'no', 'uk', 'bg', 'hr', 'sk', 'sl', 'sr', 'mk', 'sq', 'et', 'lv', 'lt'];
    logger.debug({ service_id: service.service_id }, '从服务ID推断为 M2M100，使用默认语言列表');
    return {
      model_id: service.model_id || service.service_id,
      languages: m2m100Languages,
      rule: 'any_to_any'
    };
  }

  return null;
}
