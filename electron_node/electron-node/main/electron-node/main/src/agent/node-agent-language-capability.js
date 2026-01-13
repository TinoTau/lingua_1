"use strict";
/**
 * 节点语言能力检测器
 * 负责从服务、模型等信息中提取节点的语言能力
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageCapabilityDetector = void 0;
const messages_1 = require("../../../../shared/protocols/messages");
const logger_1 = __importDefault(require("../logger"));
const language_capability_metadata_1 = require("./language-capability/language-capability-metadata");
const language_capability_normalizer_1 = require("./language-capability/language-capability-normalizer");
const language_capability_asr_1 = require("./language-capability/language-capability-asr");
const language_capability_tts_1 = require("./language-capability/language-capability-tts");
const language_capability_nmt_1 = require("./language-capability/language-capability-nmt");
const language_capability_semantic_1 = require("./language-capability/language-capability-semantic");
const language_capability_pairs_1 = require("./language-capability/language-capability-pairs");
/**
 * 语言能力检测器
 */
class LanguageCapabilityDetector {
    constructor() {
        this.metadataManager = new language_capability_metadata_1.ModelMetadataManager();
        this.metadataManager.loadModelMetadata();
    }
    /**
     * 检测节点的语言能力
     * P0-3: 仅统计 READY 状态的服务
     */
    async detectLanguageCapabilities(installedServices, installedModels, capability_by_type) {
        const capabilities = {
            asr_languages: [],
            tts_languages: [],
            nmt_capabilities: [],
            semantic_languages: [],
        };
        // P0-3: 只处理 READY 状态的服务
        const readyServices = installedServices.filter(s => {
            // 检查服务状态为 running
            if (s.status !== 'running')
                return false;
            // 检查 capability_by_type 中对应类型为 ready
            const capability = capability_by_type.find(c => c.type === s.type);
            return capability?.ready === true;
        });
        // 1. 处理 ASR 服务
        const asrServices = readyServices.filter(s => s.type === messages_1.ServiceType.ASR);
        for (const service of asrServices) {
            const langs = await (0, language_capability_asr_1.detectASRLanguages)(service, installedModels, this.metadataManager);
            capabilities.asr_languages.push(...langs);
        }
        // 2. 处理 TTS 服务
        const ttsServices = readyServices.filter(s => s.type === messages_1.ServiceType.TTS);
        for (const service of ttsServices) {
            const langs = await (0, language_capability_tts_1.detectTTSLanguages)(service, installedModels, this.metadataManager);
            capabilities.tts_languages.push(...langs);
        }
        // 3. 处理 NMT 服务
        const nmtServices = readyServices.filter(s => s.type === messages_1.ServiceType.NMT);
        for (const service of nmtServices) {
            const nmtCap = await (0, language_capability_nmt_1.detectNMTLanguagePairs)(service, installedModels, this.metadataManager);
            if (nmtCap) {
                capabilities.nmt_capabilities.push(nmtCap);
            }
        }
        // 4. 处理语义修复服务（SEMANTIC）
        const semanticServices = readyServices.filter(s => s.type === messages_1.ServiceType.SEMANTIC);
        logger_1.default.debug({
            semantic_service_count: semanticServices.length
        }, '检测到语义修复服务');
        for (const service of semanticServices) {
            const langs = await (0, language_capability_semantic_1.detectSemanticLanguages)(service, installedModels, this.metadataManager);
            if (langs.length > 0) {
                logger_1.default.debug({
                    service_id: service.service_id,
                    model_id: service.model_id,
                    languages: langs,
                    language_count: langs.length
                }, '语义修复服务支持的语言');
            }
            else {
                logger_1.default.warn({
                    service_id: service.service_id,
                    model_id: service.model_id
                }, '语义修复服务未检测到支持的语言');
            }
            capabilities.semantic_languages.push(...langs);
        }
        // 去重和规范化
        capabilities.asr_languages = (0, language_capability_normalizer_1.normalizeLanguages)([...new Set(capabilities.asr_languages)]);
        capabilities.tts_languages = (0, language_capability_normalizer_1.normalizeLanguages)([...new Set(capabilities.tts_languages)]);
        capabilities.semantic_languages = (0, language_capability_normalizer_1.normalizeLanguages)([...new Set(capabilities.semantic_languages)]);
        // 5. 计算所有服务的交集，生成语言对列表（节点端计算）
        capabilities.supported_language_pairs = (0, language_capability_pairs_1.computeLanguagePairs)(capabilities.asr_languages, capabilities.tts_languages, capabilities.nmt_capabilities, capabilities.semantic_languages);
        // 记录语言能力检测结果
        logger_1.default.info({
            asr_languages: capabilities.asr_languages.length,
            tts_languages: capabilities.tts_languages.length,
            nmt_capabilities: capabilities.nmt_capabilities.length,
            semantic_languages: capabilities.semantic_languages.length,
            supported_language_pairs: capabilities.supported_language_pairs.length,
            language_pairs_detail: capabilities.supported_language_pairs?.map(p => `${p.src}-${p.tgt}`).join(', ') || 'none'
        }, 'Language capabilities detected');
        return capabilities;
    }
}
exports.LanguageCapabilityDetector = LanguageCapabilityDetector;
