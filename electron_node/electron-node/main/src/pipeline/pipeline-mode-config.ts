/**
 * Pipeline 模式配置
 * 定义不同服务组合模式的配置，支持按需服务选择
 */

import { JobAssignMessage } from '@shared/protocols/messages';
import { JobContext } from './context/job-context';

/**
 * Pipeline 步骤类型
 */
export type PipelineStepType =
    | 'ASR'
    | 'AGGREGATION'
    | 'PHONETIC_CORRECTION'
    | 'PUNCTUATION_RESTORE'
    | 'SEMANTIC_REPAIR'
    | 'DEDUP'
    | 'TRANSLATION'
    | 'TTS'
    | 'YOURTTS';

/**
 * Pipeline 模式定义
 */
export interface PipelineMode {
    /** 模式名称（用于日志和调试） */
    name: string;

    /** 该模式需要执行的步骤序列 */
    steps: PipelineStepType[];

    /** 步骤依赖关系（可选，用于验证配置） */
    dependencies?: Partial<Record<PipelineStepType, PipelineStepType[]>>;

    /** 步骤执行条件（可选，用于动态判断） */
    conditions?: Partial<Record<PipelineStepType, (job: JobAssignMessage) => boolean>>;
}

/**
 * 预定义的 Pipeline 模式
 */
export const PIPELINE_MODES: Record<string, PipelineMode> = {
    /**
     * 个人特色语音转译
     * ASR → Aggregation → Semantic Repair → Dedup → Translation → YourTTS
     * 注意：YourTTS 会从 reference_audio 中自动提取音色向量，不需要单独的 Embedding 步骤
     */
    PERSONAL_VOICE_TRANSLATION: {
        name: '个人特色语音转译',
        steps: ['ASR', 'AGGREGATION', 'PHONETIC_CORRECTION', 'PUNCTUATION_RESTORE', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'YOURTTS'],
        dependencies: {
            AGGREGATION: ['ASR'],
            PHONETIC_CORRECTION: ['AGGREGATION'],
            PUNCTUATION_RESTORE: ['PHONETIC_CORRECTION'],
            SEMANTIC_REPAIR: ['PUNCTUATION_RESTORE'],
            DEDUP: ['SEMANTIC_REPAIR'],
            TRANSLATION: ['DEDUP'],
            YOURTTS: ['TRANSLATION'],
        },
        conditions: {
            YOURTTS: (job) => job.pipeline?.use_tone === true,
        },
    },

    /**
     * 通用语音转译
     * ASR → Aggregation → Semantic Repair → Dedup → Translation → TTS
     */
    GENERAL_VOICE_TRANSLATION: {
        name: '通用语音转译',
        steps: ['ASR', 'AGGREGATION', 'PHONETIC_CORRECTION', 'PUNCTUATION_RESTORE', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'TTS'],
        dependencies: {
            AGGREGATION: ['ASR'],
            PHONETIC_CORRECTION: ['AGGREGATION'],
            PUNCTUATION_RESTORE: ['PHONETIC_CORRECTION'],
            SEMANTIC_REPAIR: ['PUNCTUATION_RESTORE'],
            DEDUP: ['SEMANTIC_REPAIR'],
            TRANSLATION: ['DEDUP'],
            TTS: ['TRANSLATION'],
        },
    },

    /**
     * 字幕模式
     * ASR → Aggregation → Semantic Repair → Dedup → Translation
     */
    SUBTITLE_MODE: {
        name: '字幕模式',
        steps: ['ASR', 'AGGREGATION', 'PHONETIC_CORRECTION', 'PUNCTUATION_RESTORE', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION'],
        dependencies: {
            AGGREGATION: ['ASR'],
            PHONETIC_CORRECTION: ['AGGREGATION'],
            PUNCTUATION_RESTORE: ['PHONETIC_CORRECTION'],
            SEMANTIC_REPAIR: ['PUNCTUATION_RESTORE'],
            DEDUP: ['SEMANTIC_REPAIR'],
            TRANSLATION: ['DEDUP'],
        },
    },

    /**
     * 只执行 ASR
     * ASR → Aggregation → Semantic Repair → Dedup
     */
    ASR_ONLY: {
        name: '只执行 ASR',
        steps: ['ASR', 'AGGREGATION', 'PHONETIC_CORRECTION', 'PUNCTUATION_RESTORE', 'SEMANTIC_REPAIR', 'DEDUP'],
        dependencies: {
            AGGREGATION: ['ASR'],
            PHONETIC_CORRECTION: ['AGGREGATION'],
            PUNCTUATION_RESTORE: ['PHONETIC_CORRECTION'],
            SEMANTIC_REPAIR: ['PUNCTUATION_RESTORE'],
            DEDUP: ['SEMANTIC_REPAIR'],
        },
    },

    /**
     * 文本翻译模式（只执行 NMT）
     * Translation
     */
    TEXT_TRANSLATION: {
        name: '文本翻译模式',
        steps: ['TRANSLATION'],
    },
};

/**
 * 根据 job.pipeline 配置自动推断 Pipeline 模式
 */
export function inferPipelineMode(job: JobAssignMessage): PipelineMode {
    const { use_asr = true, use_nmt = true, use_tts = true, use_tone = false } = job.pipeline || {};

    // 个人特色语音转译：ASR + NMT + TTS + TONE（启用音色克隆）
    if (use_asr && use_nmt && use_tts && use_tone) {
        return PIPELINE_MODES.PERSONAL_VOICE_TRANSLATION;
    }

    // 通用语音转译：ASR + NMT + TTS
    if (use_asr && use_nmt && use_tts) {
        return PIPELINE_MODES.GENERAL_VOICE_TRANSLATION;
    }

    // 字幕模式：ASR + NMT（无 TTS）
    if (use_asr && use_nmt && !use_tts) {
        return PIPELINE_MODES.SUBTITLE_MODE;
    }

    // 只执行 ASR：只有 ASR（无 NMT，无 TTS）
    if (use_asr && !use_nmt && !use_tts) {
        return PIPELINE_MODES.ASR_ONLY;
    }

    // 文本翻译模式：只有 NMT（不需要 ASR）
    if (!use_asr && use_nmt && !use_tts) {
        return PIPELINE_MODES.TEXT_TRANSLATION;
    }

    // 其他组合：动态构建模式
    // 例如：ASR + TTS（无 NMT）、NMT + TTS（无 ASR）等
    return buildDynamicMode(job);
}

/**
 * 动态构建 Pipeline 模式（处理未预定义的组合）
 */
function buildDynamicMode(job: JobAssignMessage): PipelineMode {
    const { use_asr = true, use_nmt = true, use_tts = true, use_tone = false } = job.pipeline || {};
    const steps: PipelineStepType[] = [];

    // ASR 相关步骤（如果启用 ASR）
    if (use_asr) {
        steps.push('ASR', 'AGGREGATION', 'PHONETIC_CORRECTION', 'PUNCTUATION_RESTORE', 'SEMANTIC_REPAIR', 'DEDUP');
    }

    // 翻译步骤（如果启用 NMT）
    if (use_nmt) {
        steps.push('TRANSLATION');
    }

    // TTS 步骤（如果启用 TTS）
    if (use_tts) {
        steps.push('TTS');
    }

    // YourTTS 步骤（如果启用 TONE，替代 TTS）
    // 注意：YourTTS 会从 reference_audio 中自动提取音色向量，不需要单独的 Embedding 步骤
    if (use_tone) {
        steps.push('YOURTTS');
    }

    return {
        name: '动态模式',
        steps,
        conditions: {
            YOURTTS: (job) => use_tone === true,
        },
    };
}

/**
 * 检查步骤是否应该执行
 */
export function shouldExecuteStep(
    step: PipelineStepType,
    mode: PipelineMode,
    job: JobAssignMessage,
    ctx?: JobContext  // 可选的上下文，用于检查语义修复标志
): boolean {
    // 检查步骤是否在模式的步骤列表中
    if (!mode.steps.includes(step)) {
        return false;
    }

    // 检查是否有自定义条件
    if (mode.conditions?.[step]) {
        return mode.conditions[step](job);
    }

    // 检查 pipeline 配置
    const pipeline = job.pipeline || {};
    const use_asr = pipeline.use_asr ?? true;
    const use_nmt = pipeline.use_nmt ?? true;
    const use_tts = pipeline.use_tts ?? true;
    const use_tone = pipeline.use_tone ?? false;
    // use_semantic 是可选字段，需要类型断言
    const use_semantic = 'use_semantic' in pipeline ? (pipeline as any).use_semantic : false;

    switch (step) {
        case 'ASR':
        case 'AGGREGATION':
        case 'DEDUP':
            return use_asr !== false;
        case 'PHONETIC_CORRECTION':
            return ctx?.shouldSendToSemanticRepair === true && (job.src_lang === 'zh' || (ctx?.detectedSourceLang ?? '') === 'zh');
        case 'PUNCTUATION_RESTORE': {
            if (ctx?.shouldSendToSemanticRepair !== true) return false;
            const srcLang = job.src_lang === 'auto' ? (ctx?.detectedSourceLang ?? 'zh') : job.src_lang;
            return srcLang === 'zh' || srcLang === 'en';
        }
        case 'SEMANTIC_REPAIR':
            return ctx?.shouldSendToSemanticRepair === true;
        case 'TRANSLATION':
            return use_nmt !== false;
        case 'TTS':
            return use_tts !== false && use_tone !== true; // 如果启用 TONE，则跳过 TTS
        case 'YOURTTS':
            return use_tone === true;
        default:
            return true;
    }
}
