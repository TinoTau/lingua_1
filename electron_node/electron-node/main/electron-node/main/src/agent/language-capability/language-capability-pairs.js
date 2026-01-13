"use strict";
/**
 * 语言能力检测 - 语言对计算
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeLanguagePairs = computeLanguagePairs;
const logger_1 = __importDefault(require("../../logger"));
/**
 * 计算所有服务的交集，生成语言对列表
 * 这是节点端应该完成的工作，调度服务器直接使用这个列表
 */
function computeLanguagePairs(asrLanguages, ttsLanguages, nmtCapabilities, semanticLanguages) {
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
