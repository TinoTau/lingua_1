/**
 * 语言能力检测 - ASR 语言检测
 */

import { InstalledService, InstalledModel } from '@shared/protocols/messages';
import { ModelMetadataManager } from './language-capability-metadata';

/**
 * 检测 ASR 服务的语言
 */
export async function detectASRLanguages(
  service: InstalledService,
  models: InstalledModel[],
  metadataManager: ModelMetadataManager
): Promise<string[]> {
  const languages: string[] = [];

  // 优先级1：从服务查询（如果服务提供能力接口）
  // TODO: 实现服务能力查询接口

  // 优先级2：从模型元数据获取
  const modelMeta = metadataManager.findModelMetadata(service.model_id, 'asr');
  if (modelMeta) {
    languages.push(...modelMeta.supported_languages);
  }

  // 优先级3：从已安装模型推断
  if (languages.length === 0) {
    const asrModels = models.filter(m => m.kind === 'asr');
    for (const model of asrModels) {
      if (model.src_lang) {
        languages.push(model.src_lang);
      }
    }
  }

  // 优先级4：使用默认值（Whisper 支持的语言）
  if (languages.length === 0) {
    // Whisper 支持的语言列表（从元数据获取）
    const allMetadata = metadataManager.getAllModelMetadata();
    const whisperMeta = allMetadata.find(m => 
      m.model_id.includes('whisper') || m.model_id.includes('faster-whisper')
    );
    if (whisperMeta) {
      languages.push(...whisperMeta.supported_languages);
    } else {
      // 默认支持的语言
      languages.push('zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi');
    }
  }

  return languages;
}
