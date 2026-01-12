"use strict";
/**
 * JobContext - 流水线上唯一上下文结构
 * 存放所有中间结果
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initJobContext = initJobContext;
/**
 * 初始化 JobContext
 */
function initJobContext(job) {
    return {
        // 从 job 中提取音频（如果需要）
        audio: job.audio ? Buffer.from(job.audio, 'base64') : undefined,
        audioFormat: job.audio_format,
    };
}
