"use strict";
/**
 * Task Router TONE Handler
 * 处理TONE路由相关的逻辑
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskRouterTONEHandler = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../logger"));
const messages_1 = require("../../../../shared/protocols/messages");
class TaskRouterTONEHandler {
    constructor(selectServiceEndpoint, serviceConnections, updateServiceConnections) {
        this.selectServiceEndpoint = selectServiceEndpoint;
        this.serviceConnections = serviceConnections;
        this.updateServiceConnections = updateServiceConnections;
        this.jobAbortControllers = new Map();
    }
    /**
     * 路由 TONE 任务
     */
    async routeTONETask(task) {
        const endpoint = this.selectServiceEndpoint(messages_1.ServiceType.TONE);
        if (!endpoint) {
            throw new Error('No available TONE service');
        }
        this.updateServiceConnections(endpoint.serviceId, 1);
        try {
            // 创建 AbortController 用于支持任务取消
            // 注意：job_id 是调度服务器发送的，用于任务管理和取消
            // trace_id 用于全链路追踪，不用于任务管理
            if (!task.job_id) {
                logger_1.default.warn({}, 'TONE task missing job_id, cannot support cancellation');
            }
            const abortController = new AbortController();
            if (task.job_id) {
                this.jobAbortControllers.set(task.job_id, abortController);
            }
            const httpClient = axios_1.default.create({
                baseURL: endpoint.baseUrl,
                timeout: 60000, // 60秒超时（参考 Rust 客户端使用 30 秒，这里使用 60 秒以应对更复杂的任务）
            });
            const endpointPath = task.action === 'embed' ? '/v1/tone/embed' : '/v1/tone/clone';
            const response = await httpClient.post(endpointPath, {
                audio: task.audio,
                audio_format: task.audio_format,
                sample_rate: task.sample_rate,
                speaker_id: task.speaker_id,
            }, {
                signal: abortController.signal, // 支持任务取消
            });
            return {
                embedding: response.data.embedding,
                speaker_id: response.data.speaker_id,
                audio: response.data.audio,
            };
        }
        catch (error) {
            logger_1.default.error({ error, serviceId: endpoint.serviceId }, 'TONE task failed');
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
}
exports.TaskRouterTONEHandler = TaskRouterTONEHandler;
