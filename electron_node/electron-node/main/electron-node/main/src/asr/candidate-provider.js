"use strict";
/* S2: Candidate Provider - 候选生成
   优先使用N-best，其次二次解码
*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CandidateProvider = void 0;
const logger_1 = __importDefault(require("../logger"));
/**
 * Candidate Provider
 * 优先级：N-best → 二次解码 → 不触发
 *
 * 当前状态：
 * - N-best: 不支持（faster-whisper不支持）
 * - 二次解码: 已实现（S2-6）
 */
class CandidateProvider {
    /**
     * 生成候选
     */
    async provide(ctx) {
        const candidates = [];
        // 添加primary作为候选
        candidates.push({
            text: ctx.primaryText,
            source: 'primary',
            score: ctx.primaryResult.language_probability,
        });
        // (1) N-best - faster-whisper不支持，跳过
        // 已验证：faster-whisper不支持N-best（见 SPIKE-1 验证报告）
        // (2) 二次解码 - 如果满足条件且提供了worker
        if (ctx.shouldUseSecondaryDecode &&
            ctx.audioRef &&
            ctx.secondaryDecodeWorker &&
            ctx.secondaryDecodeWorker.canDecode()) {
            try {
                logger_1.default.debug({
                    jobId: ctx.task.job_id,
                    hasAudioRef: !!ctx.audioRef.audio,
                }, 'S2-6: Attempting secondary decode');
                const secondaryResult = await ctx.secondaryDecodeWorker.decode(ctx.audioRef, ctx.task);
                if (secondaryResult && secondaryResult.text) {
                    candidates.push({
                        text: secondaryResult.text,
                        source: 'secondary_decode',
                        score: secondaryResult.score,
                    });
                    logger_1.default.info({
                        jobId: ctx.task.job_id,
                        primaryText: ctx.primaryText.substring(0, 50),
                        secondaryText: secondaryResult.text.substring(0, 50),
                        latencyMs: secondaryResult.latencyMs,
                    }, 'S2-6: Secondary decode candidate generated');
                    return {
                        candidates,
                        source: 'secondary_decode',
                    };
                }
                else {
                    logger_1.default.debug({
                        jobId: ctx.task.job_id,
                        reason: secondaryResult ? 'No text in result' : 'Decode returned null',
                    }, 'S2-6: Secondary decode did not produce candidate');
                }
            }
            catch (error) {
                logger_1.default.error({
                    error,
                    jobId: ctx.task.job_id,
                }, 'S2-6: Secondary decode failed');
                // 降级：继续使用primary
            }
        }
        return {
            candidates,
            source: 'none', // 只有primary，没有其他候选
        };
    }
    /**
     * 检查是否支持N-best
     */
    supportsNBest() {
        // 已验证：faster-whisper不支持N-best
        return false;
    }
    /**
     * 检查是否有音频引用（用于二次解码）
     */
    hasAudioRef(ctx) {
        return ctx.audioRef !== undefined && ctx.audioRef.audio !== undefined && ctx.audioRef.audio.length > 0;
    }
}
exports.CandidateProvider = CandidateProvider;
