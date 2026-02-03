/**
 * InferenceService 已安装模型转协议格式逻辑
 * 从 inference-service.ts 迁出，仅迁移实现，不新增逻辑。
 */

import type { InstalledModel } from '@shared/protocols/messages';
import logger from '../logger';
import type { ModelManager } from '../model-manager/model-manager';

/**
 * 从 ModelManager 获取已安装的模型并转换为协议格式 InstalledModel[]
 */
export async function getInstalledModelsAsProtocol(
  modelManager: ModelManager
): Promise<InstalledModel[]> {
  const installed = modelManager.getInstalledModels();

  let availableModels: any[] = [];
  try {
    availableModels = await modelManager.getAvailableModels();
  } catch (error: any) {
    logger.warn(
      {
        error: error.message,
        errorCode: error.code,
      },
      'Failed to get available models from Model Hub, using empty list (node registration will continue)'
    );
  }

  return installed.map(m => {
    const modelInfo = availableModels.find(am => am.id === m.modelId);

    let kind: 'asr' | 'nmt' | 'tts' | 'emotion' | 'other' = 'other';
    if (modelInfo) {
      if (modelInfo.task === 'asr') kind = 'asr';
      else if (modelInfo.task === 'nmt') kind = 'nmt';
      else if (modelInfo.task === 'tts') kind = 'tts';
      else if (modelInfo.task === 'emotion') kind = 'emotion';
    } else {
      if (m.modelId.includes('asr') || m.modelId.includes('whisper')) {
        kind = 'asr';
      } else if (m.modelId.includes('nmt') || m.modelId.includes('m2m')) {
        kind = 'nmt';
      } else if (m.modelId.includes('tts') || m.modelId.includes('piper')) {
        kind = 'tts';
      } else if (m.modelId.includes('emotion')) {
        kind = 'emotion';
      }
    }

    return {
      model_id: m.modelId,
      kind: kind,
      src_lang: modelInfo?.languages?.[0] || null,
      tgt_lang: modelInfo?.languages?.[1] || null,
      dialect: null,
      version: m.version || '1.0.0',
      enabled: m.info.status === 'ready',
    };
  });
}
