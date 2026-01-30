/**
 * 语言能力检测 - 语言对计算（以语义修复为中心）
 * 
 * 重构日期：2026-01-20
 * 架构原则：
 * 1. 语义修复是翻译能力的硬依赖（没有语义服务 → 没有语言对）
 * 2. 源语言必须具备语义修复（输入质量必须保证）
 * 3. 目标语言的语义修复是可选增强（不影响可用性）
 * 4. 纯函数实现，不依赖时序、健康检查或延迟
 */

import { NmtCapability } from '../node-agent-language-capability';
import logger from '../../logger';

/**
 * 语言对结构（带语义修复标记）
 */
export interface LanguagePair {
  src: string;
  tgt: string;
  semantic_on_src: boolean;  // 源语言是否有语义修复
  semantic_on_tgt: boolean;  // 目标语言是否有语义修复（增强）
}

/**
 * 以语义修复为中心的语言对计算（纯函数）
 * 
 * @param asrLanguages ASR 支持的语言列表
 * @param ttsLanguages TTS 支持的语言列表
 * @param nmtCapabilities NMT 能力列表
 * @param semanticLanguages 语义修复服务支持的语言列表
 * @returns 语言对列表（带语义修复标记）
 */
export function computeSemanticCentricLanguagePairs(
  asrLanguages: string[],
  ttsLanguages: string[],
  nmtCapabilities: NmtCapability[],
  semanticLanguages: string[]
): LanguagePair[] {
  const asrSet = new Set(asrLanguages);
  const ttsSet = new Set(ttsLanguages);
  const semanticSet = new Set(semanticLanguages);

  // 硬依赖：没有语义服务，整个节点不提供翻译能力
  if (semanticSet.size === 0) {
    logger.warn({
      asr_languages: asrLanguages.length,
      tts_languages: ttsLanguages.length,
      nmt_capabilities: nmtCapabilities.length,
      semantic_languages: 0
    }, '❌ 未检测到语义修复服务，节点不提供翻译能力（语义修复是硬依赖）');
    return [];
  }

  // 基础检查：ASR、TTS、NMT 必须存在
  if (asrLanguages.length === 0 || ttsLanguages.length === 0 || nmtCapabilities.length === 0) {
    logger.warn({
      asr_languages: asrLanguages.length,
      tts_languages: ttsLanguages.length,
      nmt_capabilities: nmtCapabilities.length,
      semantic_languages: semanticLanguages.length
    }, '❌ 缺少 ASR、TTS 或 NMT 能力，无法生成语言对');
    return [];
  }

  const pairs: LanguagePair[] = [];
  const pairSet = new Set<string>(); // 去重

  // 遍历 NMT 能力，生成候选语言对
  for (const nmtCap of nmtCapabilities) {
    const candidatePairs = generateCandidatePairs(nmtCap, asrLanguages, ttsLanguages);
    
    for (const { src, tgt } of candidatePairs) {
      const pairKey = `${src}-${tgt}`;
      if (pairSet.has(pairKey)) continue;

      // 基础能力检查
      if (!asrSet.has(src) || !ttsSet.has(tgt)) continue;

      // 🔥 核心规则：源语言必须具备语义修复（硬依赖）
      if (!semanticSet.has(src)) continue;

      // ✅ 通过所有检查，添加语言对
      pairSet.add(pairKey);
      pairs.push({
        src,
        tgt,
        semantic_on_src: true,  // 源语言语义修复（必然为 true）
        semantic_on_tgt: semanticSet.has(tgt)  // 目标语言语义修复（可选增强）
      });
    }
  }

  // 日志输出
  logLanguagePairsResult(pairs, asrLanguages, ttsLanguages, nmtCapabilities, semanticLanguages);

  return pairs;
}

/**
 * 根据 NMT 能力规则生成候选语言对
 */
function generateCandidatePairs(
  nmtCap: NmtCapability,
  asrLanguages: string[],
  ttsLanguages: string[]
): Array<{ src: string; tgt: string }> {
  const candidates: Array<{ src: string; tgt: string }> = [];

  switch (nmtCap.rule) {
    case 'any_to_any': {
      // 任意语言到任意语言
      for (const src of asrLanguages) {
        for (const tgt of ttsLanguages) {
          if (src !== tgt && 
              nmtCap.languages.includes(src) && 
              nmtCap.languages.includes(tgt)) {
            const isBlocked = nmtCap.blocked_pairs?.some(
              p => p.src === src && p.tgt === tgt
            ) ?? false;
            if (!isBlocked) {
              candidates.push({ src, tgt });
            }
          }
        }
      }
      break;
    }
    case 'any_to_en': {
      // 任意语言到英文
      if (ttsLanguages.includes('en')) {
        for (const src of asrLanguages) {
          if (src !== 'en' && nmtCap.languages.includes(src)) {
            const isBlocked = nmtCap.blocked_pairs?.some(
              p => p.src === src && p.tgt === 'en'
            ) ?? false;
            if (!isBlocked) {
              candidates.push({ src, tgt: 'en' });
            }
          }
        }
      }
      break;
    }
    case 'en_to_any': {
      // 英文到任意语言
      if (asrLanguages.includes('en')) {
        for (const tgt of ttsLanguages) {
          if (tgt !== 'en' && nmtCap.languages.includes(tgt)) {
            const isBlocked = nmtCap.blocked_pairs?.some(
              p => p.src === 'en' && p.tgt === tgt
            ) ?? false;
            if (!isBlocked) {
              candidates.push({ src: 'en', tgt });
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
            candidates.push({ src: pair.src, tgt: pair.tgt });
          }
        }
      }
      break;
    }
  }

  return candidates;
}

/**
 * 记录语言对计算结果
 */
function logLanguagePairsResult(
  pairs: LanguagePair[],
  asrLanguages: string[],
  ttsLanguages: string[],
  nmtCapabilities: NmtCapability[],
  semanticLanguages: string[]
): void {
  const semanticOnTgtCount = pairs.filter(p => p.semantic_on_tgt).length;

  if (pairs.length > 0) {
    logger.info({
      total_pairs: pairs.length,
      asr_languages: asrLanguages.length,
      tts_languages: ttsLanguages.length,
      nmt_capabilities: nmtCapabilities.length,
      semantic_languages: semanticLanguages.length,
      semantic_on_src: pairs.length,  // 全部都有源语言语义修复
      semantic_on_tgt: semanticOnTgtCount,
      pair_summary: pairs.map(p => `${p.src}-${p.tgt}`).slice(0, 20).join(', '),  // 只显示前 20 个
      full_pairs_count: pairs.length > 20 ? `... (total ${pairs.length})` : ''
    }, '✅ 语言对计算完成（以语义修复为中心）');
  } else {
    logger.warn({
      asr_languages: asrLanguages.length,
      tts_languages: ttsLanguages.length,
      nmt_capabilities: nmtCapabilities.length,
      semantic_languages: semanticLanguages.length
    }, '❌ 未生成任何语言对，请检查服务能力（特别是语义修复服务）');
  }
}

/**
 * 兼容性函数：将新结构转换为旧结构
 * @deprecated 保留用于过渡期，未来应直接使用 computeSemanticCentricLanguagePairs
 */
export function computeLanguagePairs(
  asrLanguages: string[],
  ttsLanguages: string[],
  nmtCapabilities: NmtCapability[],
  semanticLanguages: string[]
): Array<{ src: string; tgt: string }> {
  const pairs = computeSemanticCentricLanguagePairs(
    asrLanguages,
    ttsLanguages,
    nmtCapabilities,
    semanticLanguages
  );
  
  // 移除语义修复标记，返回简单结构
  return pairs.map(p => ({ src: p.src, tgt: p.tgt }));
}
