"use strict";
/**
 * 节点语言能力检测器
 * 负责从服务、模型等信息中提取节点的语言能力
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageCapabilityDetector = void 0;
const messages_1 = require("../../../../shared/protocols/messages");
const logger_1 = __importDefault(require("../logger"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * 语言能力检测器
 */
class LanguageCapabilityDetector {
    constructor() {
        this.modelMetadata = [];
        this.metadataLoaded = false;
        this.loadModelMetadata();
    }
    /**
     * 加载模型语言能力元数据
     */
    loadModelMetadata() {
        try {
            const metadataPath = path.join(__dirname, '../config/model-language-metadata.json');
            if (fs.existsSync(metadataPath)) {
                const content = fs.readFileSync(metadataPath, 'utf-8');
                const data = JSON.parse(content);
                this.modelMetadata = data.models || [];
                this.metadataLoaded = true;
                logger_1.default.debug({ modelCount: this.modelMetadata.length }, 'Model language metadata loaded');
            }
            else {
                logger_1.default.warn({ path: metadataPath }, 'Model language metadata file not found');
            }
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to load model language metadata');
        }
    }
    /**
     * 规范化语言代码（P1-1: 统一大小写、处理别名、排除 auto）
     */
    normalizeLanguageCode(lang) {
        if (!lang)
            return '';
        const lower = lang.toLowerCase();
        // 处理语言代码变体
        const normalizationMap = {
            'zh-cn': 'zh',
            'zh-tw': 'zh',
            'zh-hans': 'zh',
            'zh-hant': 'zh',
            'pt-br': 'pt',
            'pt-pt': 'pt',
            'en-us': 'en',
            'en-gb': 'en',
            'in': 'id', // 印尼语旧代码
            'iw': 'he', // 希伯来语旧代码
        };
        return normalizationMap[lower] || lower;
    }
    /**
     * 规范化语言列表
     */
    normalizeLanguages(languages) {
        return languages
            .map(lang => this.normalizeLanguageCode(lang))
            .filter(lang => lang && lang !== 'auto') // P1-1: auto 不进入索引
            .filter((lang, index, self) => self.indexOf(lang) === index); // 去重
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
            const langs = await this.detectASRLanguages(service, installedModels);
            capabilities.asr_languages.push(...langs);
        }
        // 2. 处理 TTS 服务
        const ttsServices = readyServices.filter(s => s.type === messages_1.ServiceType.TTS);
        for (const service of ttsServices) {
            const langs = await this.detectTTSLanguages(service, installedModels);
            capabilities.tts_languages.push(...langs);
        }
        // 3. 处理 NMT 服务
        const nmtServices = readyServices.filter(s => s.type === messages_1.ServiceType.NMT);
        for (const service of nmtServices) {
            const nmtCap = await this.detectNMTLanguagePairs(service, installedModels);
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
            const langs = await this.detectSemanticLanguages(service, installedModels);
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
        capabilities.asr_languages = this.normalizeLanguages([...new Set(capabilities.asr_languages)]);
        capabilities.tts_languages = this.normalizeLanguages([...new Set(capabilities.tts_languages)]);
        capabilities.semantic_languages = this.normalizeLanguages([...new Set(capabilities.semantic_languages)]);
        // 5. 计算所有服务的交集，生成语言对列表（节点端计算）
        capabilities.supported_language_pairs = this.computeLanguagePairs(capabilities.asr_languages, capabilities.tts_languages, capabilities.nmt_capabilities, capabilities.semantic_languages);
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
    /**
     * 计算所有服务的交集，生成语言对列表
     * 这是节点端应该完成的工作，调度服务器直接使用这个列表
     */
    computeLanguagePairs(asrLanguages, ttsLanguages, nmtCapabilities, semanticLanguages) {
        let pairs = [];
        const pairSet = new Set(); // 用于去重
        // 如果没有 ASR、TTS 或 NMT 能力，返回空列表
        if (asrLanguages.length === 0 || ttsLanguages.length === 0 || nmtCapabilities.length === 0) {
            logger_1.default.debug('缺少 ASR、TTS 或 NMT 能力，无法生成语言对');
            return [];
        }
        // 遍历 NMT 能力，生成语言对
        for (const nmtCap of nmtCapabilities) {
            switch (nmtCap.rule) {
                case 'any_to_any': {
                    // 任意语言到任意语言：遍历所有 ASR 和 TTS 语言的组合
                    for (const src of asrLanguages) {
                        for (const tgt of ttsLanguages) {
                            if (src !== tgt &&
                                nmtCap.languages.includes(src) &&
                                nmtCap.languages.includes(tgt)) {
                                // 检查是否被阻止
                                const isBlocked = nmtCap.blocked_pairs?.some(p => p.src === src && p.tgt === tgt) ?? false;
                                if (!isBlocked) {
                                    const pairKey = `${src}-${tgt}`;
                                    if (!pairSet.has(pairKey)) {
                                        pairSet.add(pairKey);
                                        pairs.push({ src, tgt });
                                    }
                                }
                            }
                        }
                    }
                    break;
                }
                case 'any_to_en': {
                    // 任意语言到英文
                    if (!ttsLanguages.includes('en')) {
                        break;
                    }
                    for (const src of asrLanguages) {
                        if (src !== 'en' && nmtCap.languages.includes(src)) {
                            const isBlocked = nmtCap.blocked_pairs?.some(p => p.src === src && p.tgt === 'en') ?? false;
                            if (!isBlocked) {
                                const pairKey = `${src}-en`;
                                if (!pairSet.has(pairKey)) {
                                    pairSet.add(pairKey);
                                    pairs.push({ src, tgt: 'en' });
                                }
                            }
                        }
                    }
                    break;
                }
                case 'en_to_any': {
                    // 英文到任意语言
                    if (!asrLanguages.includes('en')) {
                        break;
                    }
                    for (const tgt of ttsLanguages) {
                        if (tgt !== 'en' && nmtCap.languages.includes(tgt)) {
                            const isBlocked = nmtCap.blocked_pairs?.some(p => p.src === 'en' && p.tgt === tgt) ?? false;
                            if (!isBlocked) {
                                const pairKey = `en-${tgt}`;
                                if (!pairSet.has(pairKey)) {
                                    pairSet.add(pairKey);
                                    pairs.push({ src: 'en', tgt });
                                }
                            }
                        }
                    }
                    break;
                }
                case 'specific_pairs': {
                    // 明确支持的语言对
                    if (nmtCap.supported_pairs) {
                        for (const pair of nmtCap.supported_pairs) {
                            if (asrLanguages.includes(pair.src) && ttsLanguages.includes(pair.tgt)) {
                                const pairKey = `${pair.src}-${pair.tgt}`;
                                if (!pairSet.has(pairKey)) {
                                    pairSet.add(pairKey);
                                    pairs.push({ src: pair.src, tgt: pair.tgt });
                                }
                            }
                        }
                    }
                    break;
                }
            }
        }
        // 基于语义修复服务的语言能力过滤语言对
        // 节点端的语言可用性以语义修复服务的能力为准
        // 源语言和目标语言都必须在语义修复服务支持的语言列表中
        if (semanticLanguages.length > 0) {
            const semanticLangSet = new Set(semanticLanguages);
            const filteredPairs = pairs.filter(pair => {
                // 源语言和目标语言都必须在语义修复服务支持的语言列表中
                const srcSupported = semanticLangSet.has(pair.src);
                const tgtSupported = semanticLangSet.has(pair.tgt);
                return srcSupported && tgtSupported;
            });
            const filteredCount = pairs.length - filteredPairs.length;
            if (filteredCount > 0) {
                const removedPairs = pairs.filter(pair => {
                    const srcSupported = semanticLangSet.has(pair.src);
                    const tgtSupported = semanticLangSet.has(pair.tgt);
                    return !(srcSupported && tgtSupported);
                });
                logger_1.default.info({
                    original_count: pairs.length,
                    filtered_count: filteredPairs.length,
                    removed_count: filteredCount,
                    semantic_languages: semanticLanguages,
                    removed_pairs: removedPairs.map(p => `${p.src}-${p.tgt}`),
                    kept_pairs: filteredPairs.map(p => `${p.src}-${p.tgt}`)
                }, '基于语义修复服务语言能力过滤语言对：移除了 {} 个语言对，保留 {} 个语言对', filteredCount, filteredPairs.length);
            }
            else {
                logger_1.default.debug({
                    total_pairs: pairs.length,
                    semantic_languages: semanticLanguages,
                    pairs: pairs.map(p => `${p.src}-${p.tgt}`)
                }, '所有语言对都通过语义修复服务语言能力检查');
            }
            pairs = filteredPairs;
        }
        else {
            // 如果没有语义修复服务，返回空列表（因为语言可用性以语义修复服务为准）
            logger_1.default.warn({
                pair_count: pairs.length,
                pairs: pairs.map(p => `${p.src}-${p.tgt}`)
            }, '未检测到语义修复服务，清空语言对列表（语言可用性以语义修复服务为准）。原本有 {} 个语言对被过滤', pairs.length);
            pairs = [];
        }
        // 记录完整的语言对列表（info 级别，方便调试）
        if (pairs.length > 0) {
            logger_1.default.info({
                total_pairs: pairs.length,
                pairs: pairs, // 记录所有语言对
                pair_summary: pairs.map(p => `${p.src}-${p.tgt}`).join(', ') // 便于阅读的格式
            }, '计算完成，生成语言对列表');
        }
        else {
            logger_1.default.warn({
                asr_languages: asrLanguages.length,
                tts_languages: ttsLanguages.length,
                nmt_capabilities: nmtCapabilities.length,
                semantic_languages: semanticLanguages.length
            }, '未生成任何语言对，请检查服务能力');
        }
        return pairs;
    }
    /**
     * 检测 ASR 服务的语言
     */
    async detectASRLanguages(service, models) {
        const languages = [];
        // 优先级1：从服务查询（如果服务提供能力接口）
        // TODO: 实现服务能力查询接口
        // 优先级2：从模型元数据获取
        const modelMeta = this.findModelMetadata(service.model_id, 'asr');
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
            const whisperMeta = this.modelMetadata.find(m => m.model_id.includes('whisper') || m.model_id.includes('faster-whisper'));
            if (whisperMeta) {
                languages.push(...whisperMeta.supported_languages);
            }
            else {
                // 默认支持的语言
                languages.push('zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'ar', 'hi', 'th', 'vi');
            }
        }
        return languages;
    }
    /**
     * 检测 TTS 服务的语言
     */
    async detectTTSLanguages(service, models) {
        const languages = [];
        // 优先级1：从服务查询
        // TODO: 实现服务能力查询接口
        // 优先级2：从模型元数据获取
        const modelMeta = this.findModelMetadata(service.model_id, 'tts');
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
    /**
     * 检测 NMT 服务的语言对能力
     */
    async detectNMTLanguagePairs(service, models) {
        // 优先级1：从服务查询
        // TODO: 实现服务能力查询接口
        // 优先级2：从模型元数据获取
        const modelMeta = this.findModelMetadata(service.model_id, 'nmt');
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
            const allLanguages = new Set();
            const specificPairs = [];
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
                    logger_1.default.debug({ service_id: service.service_id }, '使用 M2M100 默认语言列表');
                }
                return {
                    model_id: service.model_id || nmtModels[0].model_id,
                    languages: Array.from(allLanguages),
                    rule: 'any_to_any'
                };
            }
            else if (specificPairs.length > 0) {
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
            logger_1.default.debug({ service_id: service.service_id }, '从服务ID推断为 M2M100，使用默认语言列表');
            return {
                model_id: service.model_id || service.service_id,
                languages: m2m100Languages,
                rule: 'any_to_any'
            };
        }
        return null;
    }
    /**
     * 检测语义修复服务的语言
     */
    async detectSemanticLanguages(service, models) {
        const languages = [];
        // 优先级1：从服务ID推断（如 semantic-repair-zh, semantic-repair-en）
        if (service.service_id) {
            const serviceId = service.service_id.toLowerCase();
            logger_1.default.debug({
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
                logger_1.default.debug({
                    service_id: service.service_id,
                    languages: languages,
                    method: 'service_id'
                }, '从服务ID推断出语言');
            }
        }
        // 优先级2：从模型元数据获取
        if (languages.length === 0) {
            logger_1.default.debug({
                model_id: service.model_id
            }, '从模型元数据获取语义修复语言');
            const modelMeta = this.findModelMetadata(service.model_id, 'semantic');
            if (modelMeta) {
                languages.push(...modelMeta.supported_languages);
                logger_1.default.debug({
                    model_id: service.model_id,
                    languages: modelMeta.supported_languages,
                    method: 'metadata'
                }, '从模型元数据获取到语言');
            }
            else {
                logger_1.default.debug({
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
                }
                else {
                    // 如果没有指定语言，默认支持英语
                    languages.push('en');
                    logger_1.default.debug({ service_id: service.service_id }, '从 normalize 服务推断为英语');
                }
            }
        }
        // 默认：如果无法推断，返回空数组（不假设默认语言）
        return languages;
    }
    /**
     * 查找模型元数据
     */
    findModelMetadata(modelId, modelType) {
        if (!modelId)
            return undefined;
        const modelIdLower = modelId.toLowerCase();
        // 精确匹配
        let meta = this.modelMetadata.find(m => m.model_id === modelId && m.model_type === modelType);
        // 模糊匹配（包含关键词）
        if (!meta) {
            meta = this.modelMetadata.find(m => {
                if (m.model_type !== modelType)
                    return false;
                const mIdLower = m.model_id.toLowerCase();
                return modelIdLower.includes(mIdLower) || mIdLower.includes(modelIdLower);
            });
        }
        // 特殊匹配规则
        if (!meta) {
            if (modelType === 'nmt') {
                // 匹配 nmt-m2m100 到 m2m100-* 模型
                if (modelIdLower.includes('m2m100') || modelIdLower.includes('m2m')) {
                    meta = this.modelMetadata.find(m => m.model_type === 'nmt' &&
                        (m.model_id.includes('m2m100') || m.model_id.includes('m2m')));
                }
            }
            else if (modelType === 'tts') {
                // 匹配 piper-tts 到 piper-tts-* 模型
                if (modelIdLower.includes('piper')) {
                    // 优先匹配通用 piper 模型，如果没有则匹配第一个 piper 模型
                    meta = this.modelMetadata.find(m => m.model_type === 'tts' && m.model_id.includes('piper'));
                }
            }
            else if (modelType === 'semantic') {
                // 匹配 semantic-repair-* 到 semantic-repair-* 模型
                if (modelIdLower.includes('semantic') || modelIdLower.includes('repair')) {
                    meta = this.modelMetadata.find(m => m.model_type === 'semantic' &&
                        (m.model_id.includes('semantic') || m.model_id.includes('repair')));
                }
            }
        }
        return meta;
    }
}
exports.LanguageCapabilityDetector = LanguageCapabilityDetector;
