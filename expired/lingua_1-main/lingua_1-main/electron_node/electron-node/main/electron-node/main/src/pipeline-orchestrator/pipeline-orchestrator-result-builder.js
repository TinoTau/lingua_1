"use strict";
/**
 * Pipeline结果构建模块
 * 负责构建JobResult，包括质量级别计算、segments_meta计算等
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineOrchestratorResultBuilder = void 0;
class PipelineOrchestratorResultBuilder {
    /**
     * 构建JobResult
     */
    buildResult(textForNMT, asrResult, rerunCount) {
        // OBS-2: 计算 ASR 质量级别
        let asrQualityLevel;
        if (asrResult.badSegmentDetection) {
            const qualityScore = asrResult.badSegmentDetection.qualityScore;
            if (qualityScore >= 0.7) {
                asrQualityLevel = 'good';
            }
            else if (qualityScore >= 0.4) {
                asrQualityLevel = 'suspect';
            }
            else {
                asrQualityLevel = 'bad';
            }
        }
        // OBS-2: 计算 segments_meta
        let segmentsMeta;
        if (asrResult.segments && asrResult.segments.length > 0) {
            const segments = asrResult.segments;
            let maxGap = 0;
            let totalDuration = 0;
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                if (segment.end && segment.start) {
                    const duration = segment.end - segment.start;
                    totalDuration += duration;
                    // 计算与前一个 segment 的间隔
                    if (i > 0 && segments[i - 1].end !== undefined) {
                        const prevEnd = segments[i - 1].end;
                        const gap = segment.start - prevEnd;
                        if (gap > maxGap) {
                            maxGap = gap;
                        }
                    }
                }
            }
            segmentsMeta = {
                count: segments.length,
                max_gap: maxGap,
                avg_duration: segments.length > 0 ? totalDuration / segments.length : 0,
            };
        }
        const result = {
            text_asr: textForNMT, // 使用聚合后的文本（如果 AggregatorMiddleware 处理过）
            text_translated: '', // 空翻译，由 PostProcess 填充
            tts_audio: '', // TTS 也由 PostProcess 处理
            tts_format: 'pcm16',
            extra: {
                emotion: undefined,
                speech_rate: undefined,
                voice_style: undefined,
                language_probability: asrResult.language_probability, // 新增：检测到的语言的概率
                language_probabilities: asrResult.language_probabilities, // 新增：所有语言的概率信息
            },
            // OBS-2: ASR 质量信息
            asr_quality_level: asrQualityLevel,
            reason_codes: asrResult.badSegmentDetection?.reasonCodes,
            quality_score: asrResult.badSegmentDetection?.qualityScore,
            rerun_count: rerunCount,
            segments_meta: segmentsMeta,
            // 传递 segments 信息给中间件使用
            segments: asrResult.segments,
        };
        return result;
    }
    /**
     * 构建空结果
     */
    buildEmptyResult(asrResult) {
        return {
            text_asr: '',
            text_translated: '',
            tts_audio: '',
            tts_format: 'pcm16',
            extra: {
                emotion: undefined,
                speech_rate: undefined,
                voice_style: undefined,
                language_probability: asrResult?.language_probability,
                language_probabilities: asrResult?.language_probabilities,
            },
        };
    }
    /**
     * 构建无意义文本结果
     */
    buildMeaninglessTextResult(asrText, asrResult) {
        return {
            text_asr: asrText,
            text_translated: '',
            tts_audio: '',
            tts_format: 'pcm16',
            extra: {
                emotion: undefined,
                speech_rate: undefined,
                voice_style: undefined,
                language_probability: asrResult.language_probability,
                language_probabilities: asrResult.language_probabilities,
            },
        };
    }
}
exports.PipelineOrchestratorResultBuilder = PipelineOrchestratorResultBuilder;
