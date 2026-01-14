"use strict";
/**
 * Pipeline 模式配置
 * 定义不同服务组合模式的配置，支持按需服务选择
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIPELINE_MODES = void 0;
exports.inferPipelineMode = inferPipelineMode;
exports.shouldExecuteStep = shouldExecuteStep;
/**
 * 预定义的 Pipeline 模式
 */
exports.PIPELINE_MODES = {
    /**
     * 个人特色语音转译
     * ASR → Aggregation → Semantic Repair → Dedup → Translation → YourTTS
     * 注意：YourTTS 会从 reference_audio 中自动提取音色向量，不需要单独的 Embedding 步骤
     */
    PERSONAL_VOICE_TRANSLATION: {
        name: '个人特色语音转译',
        steps: ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'YOURTTS'],
        dependencies: {
            AGGREGATION: ['ASR'],
            SEMANTIC_REPAIR: ['AGGREGATION'],
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
        steps: ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'TTS'],
        dependencies: {
            AGGREGATION: ['ASR'],
            SEMANTIC_REPAIR: ['AGGREGATION'],
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
        steps: ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION'],
        dependencies: {
            AGGREGATION: ['ASR'],
            SEMANTIC_REPAIR: ['AGGREGATION'],
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
        steps: ['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP'],
        dependencies: {
            AGGREGATION: ['ASR'],
            SEMANTIC_REPAIR: ['AGGREGATION'],
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
function inferPipelineMode(job) {
    const { use_asr = true, use_nmt = true, use_tts = true, use_tone = false } = job.pipeline || {};
    // 个人特色语音转译：ASR + NMT + TTS + TONE（启用音色克隆）
    if (use_asr && use_nmt && use_tts && use_tone) {
        return exports.PIPELINE_MODES.PERSONAL_VOICE_TRANSLATION;
    }
    // 通用语音转译：ASR + NMT + TTS
    if (use_asr && use_nmt && use_tts) {
        return exports.PIPELINE_MODES.GENERAL_VOICE_TRANSLATION;
    }
    // 字幕模式：ASR + NMT（无 TTS）
    if (use_asr && use_nmt && !use_tts) {
        return exports.PIPELINE_MODES.SUBTITLE_MODE;
    }
    // 只执行 ASR：只有 ASR（无 NMT，无 TTS）
    if (use_asr && !use_nmt && !use_tts) {
        return exports.PIPELINE_MODES.ASR_ONLY;
    }
    // 文本翻译模式：只有 NMT（不需要 ASR）
    if (!use_asr && use_nmt && !use_tts) {
        return exports.PIPELINE_MODES.TEXT_TRANSLATION;
    }
    // 其他组合：动态构建模式
    // 例如：ASR + TTS（无 NMT）、NMT + TTS（无 ASR）等
    return buildDynamicMode(job);
}
/**
 * 动态构建 Pipeline 模式（处理未预定义的组合）
 */
function buildDynamicMode(job) {
    const { use_asr = true, use_nmt = true, use_tts = true, use_tone = false } = job.pipeline || {};
    const steps = [];
    // ASR 相关步骤（如果启用 ASR）
    if (use_asr) {
        steps.push('ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP');
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
function shouldExecuteStep(step, mode, job, ctx // 可选的上下文，用于检查语义修复标志
) {
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
    const use_semantic = 'use_semantic' in pipeline ? pipeline.use_semantic : false;
    switch (step) {
        case 'ASR':
        case 'AGGREGATION':
        case 'DEDUP':
            return use_asr !== false;
        case 'SEMANTIC_REPAIR':
            // 简化逻辑：只要 shouldSendToSemanticRepair 为 true，就执行语义修复
            // 不再需要显式设置 use_semantic，避免多层判断导致的问题
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
