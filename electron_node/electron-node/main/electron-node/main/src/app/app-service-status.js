"use strict";
/**
 * 应用服务状态管理模块
 * 负责获取和保存服务运行状态
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentServiceStatus = getCurrentServiceStatus;
exports.saveServiceStatusToConfig = saveServiceStatusToConfig;
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
/**
 * 获取当前服务运行状态
 */
async function getCurrentServiceStatus(rustServiceManager, pythonServiceManager, semanticRepairServiceManager) {
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
    };
}
/**
 * 保存服务状态到配置文件
 */
function saveServiceStatusToConfig(serviceStatus, savedFrom) {
    try {
        logger_1.default.info({ currentServiceStatus: serviceStatus }, `Current service running status before saving preferences (${savedFrom})`);
        const config = (0, node_config_1.loadNodeConfig)();
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
        };
        (0, node_config_1.saveNodeConfig)(config);
        // 根据 savedFrom 生成不同的日志消息，与原始代码保持一致
        let logMessage;
        if (savedFrom === 'window-close-event') {
            logMessage = 'User service preferences saved successfully on window close (based on current running status)';
        }
        else if (savedFrom === 'before-quit-event') {
            logMessage = 'User service preferences saved successfully on before-quit (based on current running status)';
        }
        else {
            logMessage = `User service preferences saved successfully (${savedFrom})`;
        }
        logger_1.default.info({
            servicePreferences: config.servicePreferences,
            savedFrom,
        }, logMessage);
    }
    catch (error) {
        logger_1.default.error({
            error,
            message: error instanceof Error ? error.message : String(error),
            savedFrom,
        }, `Failed to save service preferences (${savedFrom})`);
    }
}
