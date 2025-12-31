"use strict";
/**
 * Task Router ASR Metrics Handler
 * 处理ASR指标管理相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASRMetricsHandler = void 0;
const logger_1 = __importDefault(require("../logger"));
class ASRMetricsHandler {
    constructor() {
        this.consecutiveLowQualityCount = new Map();
        this.currentCycleServiceEfficiencies = new Map();
    }
    /**
     * Gate-A: 重置指定 session 的连续低质量计数
     */
    resetConsecutiveLowQualityCount(sessionId) {
        this.consecutiveLowQualityCount.set(sessionId, 0);
        logger_1.default.info({
            sessionId,
        }, 'Gate-A: Reset consecutiveLowQualityCount for session');
    }
    /**
     * 更新连续低质量计数
     */
    updateConsecutiveLowQualityCount(sessionId, qualityScore) {
        if (qualityScore < 0.4) {
            const currentCount = this.consecutiveLowQualityCount.get(sessionId) || 0;
            const newCount = currentCount + 1;
            this.consecutiveLowQualityCount.set(sessionId, newCount);
            if (newCount >= 2) {
                logger_1.default.warn({
                    sessionId,
                    consecutiveLowQualityCount: newCount,
                    qualityScore,
                }, 'P0.5-CTX-2: Consecutive low quality detected (>=2), should reset context');
                return true; // 应该重置上下文
            }
        }
        else {
            this.consecutiveLowQualityCount.set(sessionId, 0);
        }
        return false;
    }
    /**
     * OBS-1: 记录 ASR 处理效率
     */
    recordASREfficiency(serviceId, audioDurationMs, processingTimeMs) {
        if (!audioDurationMs || audioDurationMs <= 0 || processingTimeMs <= 0) {
            logger_1.default.debug({ serviceId, audioDurationMs, processingTimeMs }, 'OBS-1: Skipping ASR efficiency recording due to invalid parameters');
            return;
        }
        const efficiency = audioDurationMs / processingTimeMs;
        let efficiencies = this.currentCycleServiceEfficiencies.get(serviceId);
        if (!efficiencies) {
            efficiencies = [];
            this.currentCycleServiceEfficiencies.set(serviceId, efficiencies);
        }
        efficiencies.push(efficiency);
        logger_1.default.debug({ serviceId, audioDurationMs, processingTimeMs, efficiency: efficiency.toFixed(2) }, 'OBS-1: Recorded ASR processing efficiency');
    }
    /**
     * OBS-1: 获取当前心跳周期的处理效率指标
     */
    getProcessingMetrics() {
        const result = {};
        for (const [serviceId, efficiencies] of this.currentCycleServiceEfficiencies.entries()) {
            if (efficiencies.length > 0) {
                const sum = efficiencies.reduce((a, b) => a + b, 0);
                const average = sum / efficiencies.length;
                result[serviceId] = average;
            }
        }
        return result;
    }
    /**
     * OBS-1: 重置当前心跳周期的统计数据
     */
    resetCycleMetrics() {
        this.currentCycleServiceEfficiencies.clear();
    }
}
exports.ASRMetricsHandler = ASRMetricsHandler;
