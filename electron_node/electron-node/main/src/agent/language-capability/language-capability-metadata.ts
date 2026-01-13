/**
 * 语言能力检测 - 模型元数据管理
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../../logger';

/**
 * 模型语言能力元数据
 */
export interface ModelLanguageMetadata {
  model_id: string;
  model_type: 'asr' | 'nmt' | 'tts' | 'semantic';
  model_name: string;
  supported_languages: string[];
  nmt_rule?: 'any_to_any' | 'any_to_en' | 'en_to_any' | 'specific_pairs';
  nmt_blocked_pairs?: Array<{ src: string; tgt: string }>;
  nmt_supported_pairs?: Array<{ src: string; tgt: string }>;
  source: 'official' | 'manual' | 'inferred';
  last_updated: string;
}

/**
 * 模型元数据管理器
 */
export class ModelMetadataManager {
  private modelMetadata: ModelLanguageMetadata[] = [];
  private metadataLoaded = false;

  /**
   * 加载模型语言能力元数据
   */
  loadModelMetadata(): void {
    try {
      const metadataPath = path.join(__dirname, '../../config/model-language-metadata.json');
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        const data = JSON.parse(content);
        this.modelMetadata = data.models || [];
        this.metadataLoaded = true;
        logger.debug({ modelCount: this.modelMetadata.length }, 'Model language metadata loaded');
      } else {
        logger.warn({ path: metadataPath }, 'Model language metadata file not found');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to load model language metadata');
    }
  }

  /**
   * 查找模型元数据
   */
  findModelMetadata(modelId: string | undefined, modelType: 'asr' | 'nmt' | 'tts' | 'semantic'): ModelLanguageMetadata | undefined {
    if (!modelId || !this.metadataLoaded) {
      return undefined;
    }

    return this.modelMetadata.find(
      meta => meta.model_id === modelId && meta.model_type === modelType
    );
  }

  /**
   * 获取所有模型元数据
   */
  getAllModelMetadata(): ModelLanguageMetadata[] {
    return this.modelMetadata;
  }
}
