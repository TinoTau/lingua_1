"use strict";
/**
 * 流水线并行调度器（PipelineScheduler）
 * 实现流水线并行处理，让不同服务可以并行处理不同的job
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineScheduler = void 0;
const logger_1 = __importDefault(require("../logger"));
class PipelineScheduler {
    constructor(config) {
        this.jobStates = new Map(); // jobId -> JobState
        // 当前正在处理的阶段（每个服务同时只处理一个job）
        this.currentProcessing = {
            asr: null,
            semanticRepair: null,
            nmt: null,
            tts: null,
        };
        this.config = config;
        this.enabled = config.enabled;
        logger_1.default.info({
            enabled: this.enabled,
            maxConcurrentJobs: config.maxConcurrentJobs,
        }, 'PipelineScheduler initialized');
    }
    /**
     * 添加新job
     */
    addJob(job) {
        const jobState = {
            jobId: job.job_id,
            utteranceIndex: job.utterance_index || 0,
            sessionId: job.session_id || '',
            job,
            asr: {
                status: 'pending',
                canStart: true, // ASR 总是可以开始
            },
            semanticRepair: {
                status: 'pending',
                canStart: false, // 需要等待 ASR 完成
            },
            nmt: {
                status: 'pending',
                canStart: false, // 需要等待语义修复完成
            },
            tts: {
                status: 'pending',
                canStart: false, // 需要等待 NMT 完成
            },
            createdAt: Date.now(),
        };
        this.jobStates.set(job.job_id, jobState);
        logger_1.default.debug({
            jobId: job.job_id,
            utteranceIndex: job.utterance_index,
            sessionId: job.session_id,
        }, 'PipelineScheduler: Job added');
        // 尝试启动可执行的阶段
        this.checkAndStartStages();
        return jobState;
    }
    /**
     * 检查并启动可执行的阶段
     */
    checkAndStartStages() {
        if (!this.enabled) {
            return;
        }
        // 按 utterance_index 排序的job列表
        const sortedJobs = Array.from(this.jobStates.values())
            .sort((a, b) => a.utteranceIndex - b.utteranceIndex);
        // 1. 检查 ASR：找到第一个 pending 的 job
        if (!this.currentProcessing.asr) {
            const asrJob = sortedJobs.find((job) => job.asr.status === 'pending' && job.asr.canStart);
            if (asrJob) {
                this.startASR(asrJob);
            }
        }
        // 2. 检查语义修复：找到 ASR 已完成且语义修复 pending 的 job
        if (!this.currentProcessing.semanticRepair) {
            const repairJob = sortedJobs.find((job) => job.asr.status === 'completed' &&
                job.semanticRepair.status === 'pending' &&
                job.semanticRepair.canStart);
            if (repairJob) {
                this.startSemanticRepair(repairJob);
            }
        }
        // 3. 检查 NMT：找到语义修复已完成且 NMT pending 的 job
        if (!this.currentProcessing.nmt) {
            const nmtJob = sortedJobs.find((job) => (job.semanticRepair.status === 'completed' ||
                job.semanticRepair.status === 'skipped') &&
                job.nmt.status === 'pending' &&
                job.nmt.canStart);
            if (nmtJob) {
                this.startNMT(nmtJob);
            }
        }
        // 4. 检查 TTS：找到 NMT 已完成且 TTS pending 的 job
        if (!this.currentProcessing.tts) {
            const ttsJob = sortedJobs.find((job) => job.nmt.status === 'completed' &&
                job.tts.status === 'pending' &&
                job.tts.canStart);
            if (ttsJob) {
                this.startTTS(ttsJob);
            }
        }
    }
    /**
     * 启动 ASR 阶段
     */
    startASR(jobState) {
        jobState.asr.status = 'processing';
        jobState.asr.startedAt = Date.now();
        this.currentProcessing.asr = jobState.jobId;
        logger_1.default.debug({
            jobId: jobState.jobId,
            utteranceIndex: jobState.utteranceIndex,
        }, 'PipelineScheduler: ASR stage started');
    }
    /**
     * ASR 完成回调
     */
    onASRCompleted(jobId, result) {
        const jobState = this.jobStates.get(jobId);
        if (!jobState) {
            logger_1.default.warn({ jobId }, 'PipelineScheduler: Job not found for ASR completion');
            return;
        }
        jobState.asr.status = 'completed';
        jobState.asr.result = result;
        jobState.asr.completedAt = Date.now();
        jobState.semanticRepair.canStart = true; // 语义修复现在可以开始
        this.currentProcessing.asr = null;
        logger_1.default.debug({
            jobId,
            utteranceIndex: jobState.utteranceIndex,
            duration: jobState.asr.completedAt - (jobState.asr.startedAt || 0),
        }, 'PipelineScheduler: ASR stage completed');
        // 检查并启动下一阶段
        this.checkAndStartStages();
    }
    /**
     * 启动语义修复阶段
     */
    startSemanticRepair(jobState) {
        jobState.semanticRepair.status = 'processing';
        jobState.semanticRepair.startedAt = Date.now();
        this.currentProcessing.semanticRepair = jobState.jobId;
        logger_1.default.debug({
            jobId: jobState.jobId,
            utteranceIndex: jobState.utteranceIndex,
        }, 'PipelineScheduler: SemanticRepair stage started');
    }
    /**
     * 语义修复完成回调
     */
    onSemanticRepairCompleted(jobId, result, skipped = false) {
        const jobState = this.jobStates.get(jobId);
        if (!jobState) {
            logger_1.default.warn({ jobId }, 'PipelineScheduler: Job not found for SemanticRepair completion');
            return;
        }
        jobState.semanticRepair.status = skipped ? 'skipped' : 'completed';
        jobState.semanticRepair.result = result;
        jobState.semanticRepair.completedAt = Date.now();
        jobState.nmt.canStart = true; // NMT 现在可以开始
        this.currentProcessing.semanticRepair = null;
        logger_1.default.debug({
            jobId,
            utteranceIndex: jobState.utteranceIndex,
            skipped,
            duration: jobState.semanticRepair.completedAt - (jobState.semanticRepair.startedAt || 0),
        }, 'PipelineScheduler: SemanticRepair stage completed');
        // 检查并启动下一阶段
        this.checkAndStartStages();
    }
    /**
     * 启动 NMT 阶段
     */
    startNMT(jobState) {
        jobState.nmt.status = 'processing';
        jobState.nmt.startedAt = Date.now();
        this.currentProcessing.nmt = jobState.jobId;
        logger_1.default.debug({
            jobId: jobState.jobId,
            utteranceIndex: jobState.utteranceIndex,
        }, 'PipelineScheduler: NMT stage started');
    }
    /**
     * NMT 完成回调
     */
    onNMTCompleted(jobId, result) {
        const jobState = this.jobStates.get(jobId);
        if (!jobState) {
            logger_1.default.warn({ jobId }, 'PipelineScheduler: Job not found for NMT completion');
            return;
        }
        jobState.nmt.status = 'completed';
        jobState.nmt.result = result;
        jobState.nmt.completedAt = Date.now();
        jobState.tts.canStart = true; // TTS 现在可以开始
        this.currentProcessing.nmt = null;
        logger_1.default.debug({
            jobId,
            utteranceIndex: jobState.utteranceIndex,
            duration: jobState.nmt.completedAt - (jobState.nmt.startedAt || 0),
        }, 'PipelineScheduler: NMT stage completed');
        // 检查并启动下一阶段
        this.checkAndStartStages();
    }
    /**
     * 启动 TTS 阶段
     */
    startTTS(jobState) {
        jobState.tts.status = 'processing';
        jobState.tts.startedAt = Date.now();
        this.currentProcessing.tts = jobState.jobId;
        logger_1.default.debug({
            jobId: jobState.jobId,
            utteranceIndex: jobState.utteranceIndex,
        }, 'PipelineScheduler: TTS stage started');
    }
    /**
     * TTS 完成回调
     */
    onTTSCompleted(jobId, result) {
        const jobState = this.jobStates.get(jobId);
        if (!jobState) {
            logger_1.default.warn({ jobId }, 'PipelineScheduler: Job not found for TTS completion');
            return;
        }
        jobState.tts.status = 'completed';
        jobState.tts.result = result;
        jobState.tts.completedAt = Date.now();
        this.currentProcessing.tts = null;
        logger_1.default.debug({
            jobId,
            utteranceIndex: jobState.utteranceIndex,
            duration: jobState.tts.completedAt - (jobState.tts.startedAt || 0),
        }, 'PipelineScheduler: TTS stage completed');
        // 检查并启动下一阶段
        this.checkAndStartStages();
    }
    /**
     * 获取job状态
     */
    getJobState(jobId) {
        return this.jobStates.get(jobId);
    }
    /**
     * 移除job（处理完成后）
     */
    removeJob(jobId) {
        const jobState = this.jobStates.get(jobId);
        if (jobState) {
            // 清理当前处理状态
            if (this.currentProcessing.asr === jobId) {
                this.currentProcessing.asr = null;
            }
            if (this.currentProcessing.semanticRepair === jobId) {
                this.currentProcessing.semanticRepair = null;
            }
            if (this.currentProcessing.nmt === jobId) {
                this.currentProcessing.nmt = null;
            }
            if (this.currentProcessing.tts === jobId) {
                this.currentProcessing.tts = null;
            }
            this.jobStates.delete(jobId);
            logger_1.default.debug({ jobId }, 'PipelineScheduler: Job removed');
            // 检查并启动下一阶段
            this.checkAndStartStages();
        }
    }
    /**
     * 获取当前状态快照（用于监控/调试）
     */
    getSnapshot() {
        return {
            totalJobs: this.jobStates.size,
            currentProcessing: { ...this.currentProcessing },
            jobs: Array.from(this.jobStates.values())
                .sort((a, b) => a.utteranceIndex - b.utteranceIndex)
                .map((job) => ({
                jobId: job.jobId,
                utteranceIndex: job.utteranceIndex,
                stages: {
                    asr: job.asr.status,
                    semanticRepair: job.semanticRepair.status,
                    nmt: job.nmt.status,
                    tts: job.tts.status,
                },
            })),
        };
    }
}
exports.PipelineScheduler = PipelineScheduler;
