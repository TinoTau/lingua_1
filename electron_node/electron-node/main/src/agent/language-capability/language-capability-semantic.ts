/**
 * 语言能力检测 - 语义修复语言检测
 */

import { InstalledService, InstalledModel } from '@shared/protocols/messages';
import { ModelMetadataManager } from './language-capability-metadata';
import logger from '../../logger';

/**
 * 检测语义修复服务的语言
 */
export async function detectSemanticLanguages(
  service: InstalledService,
  models: InstalledModel[],
  metadataManager: ModelMetadataManager
): Promise<string[]> {
  const languages: string[] = [];

  // 优先级1：从服务ID推断（如 semantic-repair-zh, semantic-repair-en）
  if (service.service_id) {
    const serviceId = service.service_id.toLowerCase();
    logger.debug({ 
      service_id: service.service_id 
    }, '从服务ID推断语义修复语言');
    
    if (serviceId.includes('zh') || serviceId.includes('chinese')) {
      languages.push('zh');
    }
    if (serviceId.includes('en') || serviceId.includes('english')) {
      languages.push('en');
    }
    if (serviceId.includes('ja') || serviceId.includes('japanese')) {
      languages.push('ja');
    }
    if (serviceId.includes('ko') || serviceId.includes('korean')) {
      languages.push('ko');
    }
    
    if (languages.length > 0) {
      logger.debug({ 
        service_id: service.service_id,
        languages: languages,
        method: 'service_id'
      }, '从服务ID推断出语言');
    }
  }

  // 优先级2：从模型元数据获取
  if (languages.length === 0) {
    logger.debug({ 
      model_id: service.model_id 
    }, '从模型元数据获取语义修复语言');
    
    const modelMeta = metadataManager.findModelMetadata(service.model_id, 'semantic');
    if (modelMeta) {
      languages.push(...modelMeta.supported_languages);
      logger.debug({ 
        model_id: service.model_id,
        languages: modelMeta.supported_languages,
        method: 'metadata'
      }, '从模型元数据获取到语言');
    } else {
      logger.debug({ 
        model_id: service.model_id 
      }, '未找到模型元数据');
    }
  }

  // 优先级3：从已安装模型推断
  if (languages.length === 0) {
    // 注意：InstalledModel.kind 中没有 'semantic'，只有 'other' 可能包含语义修复模型
    const semanticModels = models.filter(m => m.kind === 'other');
    for (const model of semanticModels) {
      if (model.src_lang) {
        languages.push(model.src_lang);
      }
      if (model.tgt_lang) {
        languages.push(model.tgt_lang);
      }
    }
  }

  // 优先级4：从模型ID推断（如 semantic-repair-zh）
  if (languages.length === 0 && service.model_id) {
    const modelId = service.model_id.toLowerCase();
    if (modelId.includes('zh') || modelId.includes('chinese')) {
      languages.push('zh');
    }
    if (modelId.includes('en') || modelId.includes('english')) {
      languages.push('en');
    }
    if (modelId.includes('ja') || modelId.includes('japanese')) {
      languages.push('ja');
    }
    if (modelId.includes('ko') || modelId.includes('korean')) {
      languages.push('ko');
    }
    if (modelId.includes('fr') || modelId.includes('french')) {
      languages.push('fr');
    }
    if (modelId.includes('de') || modelId.includes('german')) {
      languages.push('de');
    }
    if (modelId.includes('es') || modelId.includes('spanish')) {
      languages.push('es');
    }
    if (modelId.includes('it') || modelId.includes('italian')) {
      languages.push('it');
    }
    if (modelId.includes('pt') || modelId.includes('portuguese')) {
      languages.push('pt');
    }
    if (modelId.includes('ru') || modelId.includes('russian')) {
      languages.push('ru');
    }
  }

  // 优先级5：从服务ID中的 normalize 推断（如 en-normalize）
  if (languages.length === 0) {
    const serviceId = service.service_id.toLowerCase();
    if (serviceId.includes('normalize')) {
      // normalize 服务通常支持英语
      if (serviceId.includes('en') || serviceId.includes('english')) {
        languages.push('en');
      } else {
        // 如果没有指定语言，默认支持英语
        languages.push('en');
        logger.debug({ service_id: service.service_id }, '从 normalize 服务推断为英语');
      }
    }
  }

  // 默认：如果无法推断，返回空数组（不假设默认语言）
  return languages;
}
