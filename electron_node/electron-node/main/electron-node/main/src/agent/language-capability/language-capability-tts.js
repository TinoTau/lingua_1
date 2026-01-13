"use strict";
/**
 * 语言能力检测 - TTS 语言检测
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTTSLanguages = detectTTSLanguages;
const logger_1 = __importDefault(require("../../logger"));
/**
 * 检测 TTS 服务的语言
 */
async function detectTTSLanguages(service, models, metadataManager) {
    const languages = [];
    // 优先级1：从服务查询
    // TODO: 实现服务能力查询接口
    // 优先级2：从模型元数据获取
    const modelMeta = metadataManager.findModelMetadata(service.model_id, 'tts');
    if (modelMeta) {
        languages.push(...modelMeta.supported_languages);
    }
    // 优先级3：从已安装模型推断
    if (languages.length === 0) {
        const ttsModels = models.filter(m => m.kind === 'tts');
        for (const model of ttsModels) {
            if (model.tgt_lang) {
                languages.push(model.tgt_lang);
            }
            else if (model.src_lang) {
                languages.push(model.src_lang);
            }
        }
    }
    // 优先级4：从服务ID推断（如 piper-tts-zh）
    if (languages.length === 0) {
        const serviceId = service.service_id.toLowerCase();
        if (serviceId.includes('zh') || serviceId.includes('chinese'))
            languages.push('zh');
        if (serviceId.includes('en') || serviceId.includes('english'))
            languages.push('en');
        if (serviceId.includes('ja') || serviceId.includes('japanese'))
            languages.push('ja');
        if (serviceId.includes('ko') || serviceId.includes('korean'))
            languages.push('ko');
        if (serviceId.includes('fr') || serviceId.includes('french'))
            languages.push('fr');
        if (serviceId.includes('de') || serviceId.includes('german'))
            languages.push('de');
        if (serviceId.includes('es') || serviceId.includes('spanish'))
            languages.push('es');
        if (serviceId.includes('it') || serviceId.includes('italian'))
            languages.push('it');
        if (serviceId.includes('pt') || serviceId.includes('portuguese'))
            languages.push('pt');
        if (serviceId.includes('ru') || serviceId.includes('russian'))
            languages.push('ru');
    }
    // 优先级5：从服务类型推断（piper-tts 通常支持多种语言）
    if (languages.length === 0) {
        const serviceId = service.service_id.toLowerCase();
        if (serviceId.includes('piper')) {
            // Piper TTS 通常支持多种语言，提供默认列表
            languages.push('zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi');
            logger_1.default.debug({ service_id: service.service_id }, '使用 Piper TTS 默认语言列表');
        }
    }
    return languages;
}
