"use strict";
/**
 * Task Router NMT Handler
 * 处理NMT路由相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouterNMTHandler = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../logger"));
const messages_1 = require("../../../../shared/protocols/messages");
class TaskRouterNMTHandler {
    constructor(selectServiceEndpoint, startGpuTrackingForService, serviceConnections, updateServiceConnections, recordServiceEfficiency) {
        this.selectServiceEndpoint = selectServiceEndpoint;
        this.startGpuTrackingForService = startGpuTrackingForService;
        this.serviceConnections = serviceConnections;
        this.updateServiceConnections = updateServiceConnections;
        this.recordServiceEfficiency = recordServiceEfficiency;
        this.jobAbortControllers = new Map();
        this.currentCycleServiceEfficiencies = new Map();
    }
    /**
     * 路由 NMT 任务
     */
    async routeNMTTask(task) {
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.NMT);
        if (!endpoint) {
            throw new Error('No available NMT service');
        }
        // GPU 跟踪：在任务开始时启动 GPU 跟踪（确保能够捕获整个任务期间的 GPU 使用）
        this.startGpuTrackingForService(endpoint.serviceId);
        this.updateServiceConnections(endpoint.serviceId, 1);
        const taskStartTime = Date.now();
        try {
            // 创建 AbortController 用于支持任务取消
            // 注意：job_id 是调度服务器发送的，用于任务管理和取消
            // trace_id 用于全链路追踪，不用于任务管理
            if (!task.job_id) {
                logger_1.default.warn({}, 'NMT task missing job_id, cannot support cancellation');
            }
            const abortController = new AbortController();
            if (task.job_id) {
                this.jobAbortControllers.set(task.job_id, abortController);
            }
            const httpClient = axios_1.default.create({
                baseURL: endpoint.baseUrl,
                timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
            });
            // 详细记录NMT输入
            logger_1.default.info({
                serviceId: endpoint.serviceId,
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                text: task.text,
                textLength: task.text?.length || 0,
                textPreview: task.text?.substring(0, 100),
                srcLang: task.src_lang,
                tgtLang: task.tgt_lang,
                contextText: task.context_text,
                contextTextLength: task.context_text?.length || 0,
                contextTextPreview: task.context_text?.substring(0, 50),
                numCandidates: task.num_candidates,
                timeout: httpClient.defaults.timeout,
                timestamp: new Date().toISOString(),
            }, 'NMT INPUT: Sending NMT request (START)');
            const response = await httpClient.post('/v1/translate', {
                text: task.text,
                src_lang: task.src_lang,
                tgt_lang: task.tgt_lang,
                context_text: task.context_text,
                num_candidates: task.num_candidates, // 传递候选数量（如果指定）
            }, {
                signal: abortController.signal, // 支持任务取消
            });
            const requestDuration = Date.now() - taskStartTime;
            // 详细记录NMT输出
            const translatedText = response.data?.text || '';
            const candidates = response.data?.candidates || [];
            logger_1.default.info({
                serviceId: endpoint.serviceId,
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                status: response.status,
                requestDurationMs: requestDuration,
                translatedText: translatedText,
                translatedTextLength: translatedText.length,
                translatedTextPreview: translatedText.substring(0, 100),
                numCandidates: candidates.length,
                candidatesPreview: candidates.slice(0, 3).map((c) => c.substring(0, 50)),
                timestamp: new Date().toISOString(),
            }, 'NMT OUTPUT: NMT request succeeded (END)');
            if (requestDuration > 30000) {
                logger_1.default.warn({
                    serviceId: endpoint.serviceId,
                    jobId: task.job_id,
                    requestDurationMs: requestDuration,
                    textLength: task.text?.length || 0,
                }, 'NMT request took longer than 30 seconds');
            }
            // OBS-1: 记录 NMT 处理效率
            const taskEndTime = Date.now();
            const processingTimeMs = taskEndTime - taskStartTime;
            const textLength = task.text?.length || 0;
            this.recordNMTEfficiency(endpoint.serviceId, textLength, processingTimeMs);
            logger_1.default.debug({
                serviceId: endpoint.serviceId,
                jobId: task.job_id,
                translatedTextLength: translatedText.length,
                translatedTextPreview: translatedText.substring(0, 100),
                sourceTextLength: task.text.length,
                sourceTextPreview: task.text.substring(0, 50),
            }, 'NMT service returned translation');
            return {
                text: translatedText,
                confidence: response.data.confidence,
                candidates: response.data.candidates || undefined, // 返回候选列表（如果有）
            };
        }
        catch (error) {
            const requestDuration = Date.now() - taskStartTime;
            const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout') || error.name === 'AbortError';
            logger_1.default.error({
                error: error.message,
                errorCode: error.code,
                errorName: error.name,
                serviceId: endpoint.serviceId,
                jobId: task.job_id,
                sessionId: task.session_id,
                utteranceIndex: task.utterance_index,
                requestDurationMs: requestDuration,
                timeout: 60000, // NMT timeout is 60 seconds
                isTimeout,
                timestamp: new Date().toISOString(),
            }, `NMT task failed${isTimeout ? ' (TIMEOUT)' : ''}`);
            throw error;
        }
        finally {
            // 清理 AbortController
            if (task.job_id) {
                this.jobAbortControllers.delete(task.job_id);
            }
            this.updateServiceConnections(endpoint.serviceId, -1);
        }
    }
    /**
     * OBS-1: 记录 NMT 处理效率（按心跳周期）
     * @param serviceId 服务ID（如 'nmt-m2m100'）
     * @param textLength 文本长度（字符数）
     * @param processingTimeMs NMT 处理时间（毫秒）
     */
    recordNMTEfficiency(serviceId, textLength, processingTimeMs) {
        // 如果文本长度无效，跳过记录
        if (!textLength || textLength <= 0 || processingTimeMs <= 0) {
            return;
        }
        // 计算处理效率 = 文本长度(字符) / 处理时间(ms) * 1000 (转换为字符/秒)
        // 为了与其他指标保持一致（值越大越好），使用字符/秒作为效率指标
        const efficiency = (textLength / processingTimeMs) * 1000;
        this.recordServiceEfficiency(serviceId, efficiency);
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
exports.TaskRouterNMTHandler = TaskRouterNMTHandler;
