/**
 * 应用服务状态管理模块
 * 负责获取和保存服务运行状态
 */

import { RustServiceManager } from '../rust-service-manager';
import { PythonServiceManager } from '../python-service-manager';
import { SemanticRepairServiceManager } from '../semantic-repair-service-manager';
import { loadNodeConfig, saveNodeConfig } from '../node-config';
import logger from '../logger';

/**
 * 服务运行状态
 */
export interface ServiceStatus {
  rust: boolean;
  nmt: boolean;
  tts: boolean;
  yourtts: boolean;
  fasterWhisperVad: boolean;
  speakerEmbedding: boolean;
  semanticRepairZh: boolean;
  semanticRepairEn: boolean;
  enNormalize: boolean;
  semanticRepairEnZh: boolean;
}

/**
 * 获取当前服务运行状态
 */
export async function getCurrentServiceStatus(
  rustServiceManager: RustServiceManager | null,
  pythonServiceManager: PythonServiceManager | null,
  semanticRepairServiceManager: SemanticRepairServiceManager | null
): Promise<ServiceStatus> {
  const rustStatus = rustServiceManager?.getStatus();
  const pythonStatuses = pythonServiceManager?.getAllServiceStatuses() || [];
  const semanticRepairStatuses = semanticRepairServiceManager
    ? await semanticRepairServiceManager.getAllServiceStatuses()
    : [];

  return {
    rust: !!rustStatus?.running,
    nmt: !!pythonStatuses.find(s => s.name === 'nmt')?.running,
    tts: !!pythonStatuses.find(s => s.name === 'tts')?.running,
    yourtts: !!pythonStatuses.find(s => s.name === 'yourtts')?.running,
    fasterWhisperVad: !!pythonStatuses.find(s => s.name === 'faster_whisper_vad')?.running,
    speakerEmbedding: !!pythonStatuses.find(s => s.name === 'speaker_embedding')?.running,
    semanticRepairZh: !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-zh')?.running,
    semanticRepairEn: !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en')?.running,
    enNormalize: !!semanticRepairStatuses.find(s => s.serviceId === 'en-normalize')?.running,
    semanticRepairEnZh: !!semanticRepairStatuses.find(s => s.serviceId === 'semantic-repair-en-zh')?.running,
  };
}

/**
 * 保存服务状态到配置文件
 */
export function saveServiceStatusToConfig(
  serviceStatus: ServiceStatus,
  savedFrom: string
): void {
  try {
    logger.info(
      { currentServiceStatus: serviceStatus },
      `Current service running status before saving preferences (${savedFrom})`
    );

    const config = loadNodeConfig();
    config.servicePreferences = {
      rustEnabled: serviceStatus.rust,
      nmtEnabled: serviceStatus.nmt,
      ttsEnabled: serviceStatus.tts,
      yourttsEnabled: serviceStatus.yourtts,
      fasterWhisperVadEnabled: serviceStatus.fasterWhisperVad,
      speakerEmbeddingEnabled: serviceStatus.speakerEmbedding,
      semanticRepairZhEnabled: serviceStatus.semanticRepairZh,
      semanticRepairEnEnabled: serviceStatus.semanticRepairEn,
      enNormalizeEnabled: serviceStatus.enNormalize,
      semanticRepairEnZhEnabled: serviceStatus.semanticRepairEnZh,
    };
    saveNodeConfig(config);
    // 根据 savedFrom 生成不同的日志消息，与原始代码保持一致
    let logMessage: string;
    if (savedFrom === 'window-close-event') {
      logMessage = 'User service preferences saved successfully on window close (based on current running status)';
    } else if (savedFrom === 'before-quit-event') {
      logMessage = 'User service preferences saved successfully on before-quit (based on current running status)';
    } else {
      logMessage = `User service preferences saved successfully (${savedFrom})`;
    }
    
    logger.info(
      {
        servicePreferences: config.servicePreferences,
        savedFrom,
      },
      logMessage
    );
  } catch (error) {
    logger.error(
      {
        error,
        message: error instanceof Error ? error.message : String(error),
        savedFrom,
      },
      `Failed to save service preferences (${savedFrom})`
    );
  }
}
