"use strict";
/* S2-6: Secondary Decode Worker - 二次解码工作器
   使用更保守的配置进行二次解码，生成候选
*/
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecondaryDecodeWorker = void 0;
const logger_1 = __importDefault(require("../logger"));
/**
 * Secondary Decode Worker
 * 使用更保守的配置进行二次解码
 */
class SecondaryDecodeWorker {
    constructor(taskRouter, config, maxConcurrency = 1, maxQueueLength = 3) {
        this.currentConcurrency = 0; // 当前并发数
        this.queueLength = 0; // 队列长度
        this.maxQueueLength = 3; // 最大队列长度（超过则降级）
        this.taskRouter = taskRouter;
        this.config = {
            beamSize: config?.beamSize || 15, // 比 primary 的 10 更大
            patience: config?.patience || 2.0, // 比 primary 的 1.0 更高
            temperature: config?.temperature || 0.0, // 更确定
            bestOf: config?.bestOf || 5,
        };
        this.maxConcurrency = maxConcurrency;
        this.maxQueueLength = maxQueueLength;
    }
    /**
     * 执行二次解码
     */
    async decode(audioRef, primaryTask, timeoutMs = 5000) {
        const startTime = Date.now();
        // 检查并发限制
        if (this.currentConcurrency >= this.maxConcurrency) {
            logger_1.default.warn({
                currentConcurrency: this.currentConcurrency,
                maxConcurrency: this.maxConcurrency,
            }, 'S2-6: Secondary decode skipped due to concurrency limit');
            return null;
        }
        // 检查队列长度
        if (this.queueLength >= this.maxQueueLength) {
            logger_1.default.warn({
                queueLength: this.queueLength,
                maxQueueLength: this.maxQueueLength,
            }, 'S2-6: Secondary decode skipped due to queue limit (overload)');
            return null;
        }
        // 检查音频引用
        if (!audioRef.audio) {
            logger_1.default.warn({}, 'S2-6: Secondary decode skipped, no audio reference');
            return null;
        }
        this.currentConcurrency++;
        this.queueLength++;
        try {
            // 构建二次解码任务（使用更保守的配置）
            const secondaryTask = {
                audio: audioRef.audio,
                audio_format: audioRef.audioFormat || primaryTask.audio_format || 'pcm16',
                sample_rate: audioRef.sampleRate || primaryTask.sample_rate || 16000,
                src_lang: primaryTask.src_lang,
                enable_streaming: false, // 二次解码不使用流式
                context_text: primaryTask.context_text, // 使用相同的 context_text（包含prompt）
                job_id: primaryTask.job_id ? `${primaryTask.job_id}_secondary` : undefined,
                // S2-6: 使用更保守的配置参数
                beam_size: this.config.beamSize, // 更大的 beam_size
                patience: this.config.patience, // 更高的 patience
                temperature: this.config.temperature, // 更低的 temperature
                best_of: this.config.bestOf, // best_of 参数
            };
            // 执行二次解码（带超时）
            const decodePromise = this.taskRouter.routeASRTask(secondaryTask);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Secondary decode timeout')), timeoutMs);
            });
            const result = await Promise.race([decodePromise, timeoutPromise]);
            const latencyMs = Date.now() - startTime;
            logger_1.default.info({
                jobId: primaryTask.job_id,
                latencyMs,
                textLength: result.text?.length || 0,
            }, 'S2-6: Secondary decode completed');
            return {
                text: result.text || '',
                score: result.language_probability, // 使用语言概率作为分数
                latencyMs,
            };
        }
        catch (error) {
            const latencyMs = Date.now() - startTime;
            if (error instanceof Error && error.message === 'Secondary decode timeout') {
                logger_1.default.warn({
                    jobId: primaryTask.job_id,
                    timeoutMs,
                    latencyMs,
                }, 'S2-6: Secondary decode timeout');
            }
            else {
                logger_1.default.error({
                    error,
                    jobId: primaryTask.job_id,
                    latencyMs,
                }, 'S2-6: Secondary decode failed');
            }
            return null;
        }
        finally {
            this.currentConcurrency--;
            this.queueLength--;
        }
    }
    /**
     * 检查是否可以执行二次解码（不增加并发计数）
     */
    canDecode() {
        return (this.currentConcurrency < this.maxConcurrency &&
            this.queueLength < this.maxQueueLength);
    }
    /**
     * 获取统计信息
     */
    getStats() {
        return {
            currentConcurrency: this.currentConcurrency,
            maxConcurrency: this.maxConcurrency,
            queueLength: this.queueLength,
            maxQueueLength: this.maxQueueLength,
        };
    }
}
exports.SecondaryDecodeWorker = SecondaryDecodeWorker;
