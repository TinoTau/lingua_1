"use strict";
/**
 * SequentialExecutor - 顺序执行管理器
 * 确保每个服务按utterance_index顺序执行，避免并发导致的问题
 *
 * 关键特性：
 * 1. 按utterance_index严格顺序执行
 * 2. 支持job合并：合并后的job使用合并后的utterance_index
 * 3. 超时保护：避免死锁
 * 4. 每个session独立管理
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SequentialExecutor = void 0;
const logger_1 = __importDefault(require("../logger"));
const DEFAULT_CONFIG = {
    enabled: true,
    maxWaitMs: 30000, // 30秒超时
    timeoutCheckIntervalMs: 5000, // 每5秒检查一次超时
};
class SequentialExecutor {
    constructor(config = { enabled: true }) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.state = {
            currentIndex: new Map(), // sessionId -> taskType -> 当前处理的utterance_index
            waitingQueue: new Map(), // sessionId -> taskType -> 等待队列
            processing: new Map(), // sessionId -> taskType -> 当前正在处理的任务
        };
        // 如果启用，启动超时检查
        if (this.config.enabled) {
            this.startTimeoutCheck();
        }
        logger_1.default.info({
            enabled: this.config.enabled,
            maxWaitMs: this.config.maxWaitMs,
        }, 'SequentialExecutor: Initialized');
    }
    /**
     * 启动超时检查
     */
    startTimeoutCheck() {
        this.timeoutCheckInterval = setInterval(() => {
            this.checkTimeouts();
        }, this.config.timeoutCheckIntervalMs);
    }
    /**
     * 检查超时任务
     */
    checkTimeouts() {
        const now = Date.now();
        for (const [sessionId, sessionQueues] of this.state.waitingQueue.entries()) {
            for (const [taskType, queue] of sessionQueues.entries()) {
                const expiredTasks = [];
                for (const task of queue) {
                    const waitTime = now - task.timestamp;
                    if (waitTime > this.config.maxWaitMs) {
                        expiredTasks.push(task);
                    }
                }
                // 移除超时任务并拒绝
                for (const task of expiredTasks) {
                    const index = queue.indexOf(task);
                    if (index !== -1) {
                        queue.splice(index, 1);
                    }
                    // 重新计算waitTime，因为它在第二个循环中不在作用域内
                    const waitTime = now - task.timestamp;
                    logger_1.default.warn({
                        sessionId: task.sessionId,
                        utteranceIndex: task.utteranceIndex,
                        jobId: task.jobId,
                        taskType: task.taskType,
                        waitTimeMs: waitTime,
                        maxWaitMs: this.config.maxWaitMs,
                    }, 'SequentialExecutor: Task timeout, rejecting');
                    task.reject(new Error(`SequentialExecutor: Task timeout after ${waitTime}ms`));
                }
            }
        }
    }
    /**
     * 执行任务（按顺序）
     * @param sessionId 会话ID
     * @param utteranceIndex utterance索引（如果是合并的job，使用合并后的索引）
     * @param taskType 任务类型
     * @param execute 执行函数
     * @param jobId 可选的job ID（用于日志）
     */
    async execute(sessionId, utteranceIndex, taskType, execute, jobId) {
        // 如果未启用，直接执行
        if (!this.config.enabled) {
            return await execute();
        }
        return new Promise((resolve, reject) => {
            const task = {
                sessionId,
                utteranceIndex,
                jobId,
                taskType,
                execute,
                resolve,
                reject,
                timestamp: Date.now(),
            };
            // 获取当前处理的索引（按服务类型）
            const sessionState = this.state.currentIndex.get(sessionId);
            const currentIndex = sessionState?.get(taskType) ?? -1;
            const processingState = this.state.processing.get(task.sessionId);
            const currentProcessing = processingState?.get(taskType);
            // 如果当前索引小于utteranceIndex，且没有正在处理的任务，可以立即执行
            if (currentIndex < utteranceIndex && !currentProcessing) {
                this.processTask(task);
            }
            else if (currentIndex >= utteranceIndex) {
                // 如果当前索引已经大于等于utteranceIndex，说明这个任务已经"过期"了
                // 这种情况不应该发生，但为了健壮性，我们记录警告并拒绝
                logger_1.default.warn({
                    sessionId: task.sessionId,
                    utteranceIndex: task.utteranceIndex,
                    currentIndex,
                    jobId: task.jobId,
                    taskType: task.taskType,
                    hasCurrentProcessing: !!currentProcessing,
                    currentProcessingIndex: currentProcessing?.utteranceIndex,
                }, 'SequentialExecutor: Task index is less than or equal to current index, task may have arrived too late');
                task.reject(new Error(`SequentialExecutor: Task index ${task.utteranceIndex} is less than or equal to current index ${currentIndex}, task may have arrived too late`));
            }
            else {
                // 否则加入等待队列（有任务正在处理，或索引不连续）
                this.enqueueTask(task);
            }
        });
    }
    /**
     * 将任务加入等待队列
     */
    enqueueTask(task) {
        let sessionQueues = this.state.waitingQueue.get(task.sessionId);
        if (!sessionQueues) {
            sessionQueues = new Map();
            this.state.waitingQueue.set(task.sessionId, sessionQueues);
        }
        let queue = sessionQueues.get(task.taskType);
        if (!queue) {
            queue = [];
            sessionQueues.set(task.taskType, queue);
        }
        // 按utterance_index排序插入
        let inserted = false;
        for (let i = 0; i < queue.length; i++) {
            if (queue[i].utteranceIndex > task.utteranceIndex) {
                queue.splice(i, 0, task);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            queue.push(task);
        }
        const sessionState = this.state.currentIndex.get(task.sessionId);
        const currentIndex = sessionState?.get(task.taskType) ?? -1;
        logger_1.default.info({
            sessionId: task.sessionId,
            utteranceIndex: task.utteranceIndex,
            jobId: task.jobId,
            taskType: task.taskType,
            queueLength: queue.length,
            currentIndex,
            note: 'Task added to waiting queue, will be processed when previous tasks complete',
        }, 'SequentialExecutor: Task enqueued, waiting for previous tasks');
    }
    /**
     * 处理任务
     */
    async processTask(task) {
        // 检查是否已有任务正在处理（按服务类型）
        const processingState = this.state.processing.get(task.sessionId);
        const currentProcessing = processingState?.get(task.taskType);
        if (currentProcessing) {
            // 如果当前处理的任务索引小于当前任务索引，说明顺序有问题
            if (currentProcessing.utteranceIndex < task.utteranceIndex) {
                logger_1.default.warn({
                    sessionId: task.sessionId,
                    currentIndex: currentProcessing.utteranceIndex,
                    newIndex: task.utteranceIndex,
                    taskType: task.taskType,
                    jobId: task.jobId,
                }, 'SequentialExecutor: Processing task with higher index while lower index task is still processing, this should not happen');
            }
            // 等待当前任务完成
            // 注意：这里不应该等待，因为如果当前任务索引小于新任务索引，说明顺序有问题
            // 如果当前任务索引等于新任务索引，说明是重复任务
            // 如果当前任务索引大于新任务索引，说明顺序有问题
            // 所以这里应该加入队列
            this.enqueueTask(task);
            return;
        }
        // 标记为正在处理（按服务类型）
        if (!processingState) {
            this.state.processing.set(task.sessionId, new Map());
        }
        this.state.processing.get(task.sessionId).set(task.taskType, task);
        // 更新当前索引（按服务类型）
        let sessionState = this.state.currentIndex.get(task.sessionId);
        if (!sessionState) {
            sessionState = new Map();
            this.state.currentIndex.set(task.sessionId, sessionState);
        }
        sessionState.set(task.taskType, task.utteranceIndex);
        logger_1.default.info({
            sessionId: task.sessionId,
            utteranceIndex: task.utteranceIndex,
            jobId: task.jobId,
            taskType: task.taskType,
            currentIndex: task.utteranceIndex,
        }, 'SequentialExecutor: Starting task execution');
        try {
            // 执行任务
            const result = await task.execute();
            // 任务完成，解析Promise
            task.resolve(result);
            logger_1.default.info({
                sessionId: task.sessionId,
                utteranceIndex: task.utteranceIndex,
                jobId: task.jobId,
                taskType: task.taskType,
                currentIndex: task.utteranceIndex,
            }, 'SequentialExecutor: Task completed successfully');
        }
        catch (error) {
            // 任务失败，拒绝Promise
            task.reject(error);
            logger_1.default.error({
                sessionId: task.sessionId,
                utteranceIndex: task.utteranceIndex,
                jobId: task.jobId,
                taskType: task.taskType,
                error: error instanceof Error ? error.message : String(error),
            }, 'SequentialExecutor: Task failed');
        }
        finally {
            // 任务完成，更新当前索引（按服务类型）
            // 注意：在任务完成后才更新currentIndex，确保顺序正确
            let sessionState = this.state.currentIndex.get(task.sessionId);
            if (!sessionState) {
                sessionState = new Map();
                this.state.currentIndex.set(task.sessionId, sessionState);
            }
            sessionState.set(task.taskType, task.utteranceIndex);
            // 清除正在处理标记（按服务类型）
            const processingState = this.state.processing.get(task.sessionId);
            if (processingState) {
                processingState.set(task.taskType, null);
            }
            // 处理等待队列中的下一个任务（按服务类型）
            this.processNextTask(task.sessionId, task.taskType);
        }
    }
    /**
     * 处理下一个任务（按服务类型）
     */
    processNextTask(sessionId, taskType) {
        const sessionQueues = this.state.waitingQueue.get(sessionId);
        if (!sessionQueues) {
            return;
        }
        const queue = sessionQueues.get(taskType);
        if (!queue || queue.length === 0) {
            return;
        }
        const sessionState = this.state.currentIndex.get(sessionId);
        const currentIndex = sessionState?.get(taskType) ?? -1;
        // 查找队列中第一个可以执行的任务（索引等于当前索引+1）
        let foundIndex = -1;
        for (let i = 0; i < queue.length; i++) {
            const task = queue[i];
            if (task.utteranceIndex === currentIndex + 1) {
                foundIndex = i;
                break;
            }
            else if (task.utteranceIndex <= currentIndex) {
                // 如果任务的索引小于等于当前索引，说明这个任务已经"过期"了，跳过
                logger_1.default.warn({
                    sessionId,
                    currentIndex,
                    taskIndex: task.utteranceIndex,
                    taskType: task.taskType,
                    jobId: task.jobId,
                    queuePosition: i,
                }, 'SequentialExecutor: Task index is less than or equal to current index, skipping expired task');
                queue.splice(i, 1);
                task.reject(new Error(`SequentialExecutor: Task index ${task.utteranceIndex} is less than or equal to current index ${currentIndex}, task expired`));
                // 继续查找下一个
                i--;
                continue;
            }
        }
        if (foundIndex !== -1) {
            // 找到可以执行的任务
            const nextTask = queue.splice(foundIndex, 1)[0];
            this.processTask(nextTask);
        }
        else {
            // 没有找到可以执行的任务，等待
            const nextTask = queue[0];
            if (nextTask) {
                const waitTime = Date.now() - nextTask.timestamp;
                // 如果等待时间超过10秒，记录警告
                if (waitTime > 10000) {
                    logger_1.default.warn({
                        sessionId,
                        currentIndex,
                        nextIndex: nextTask.utteranceIndex,
                        taskType: nextTask.taskType,
                        jobId: nextTask.jobId,
                        queueLength: queue.length,
                        waitTimeMs: waitTime,
                        maxWaitMs: this.config.maxWaitMs,
                        note: 'Task has been waiting in queue for a long time, may be blocked',
                    }, 'SequentialExecutor: Next task index is not consecutive, waiting (long wait detected)');
                }
                else {
                    logger_1.default.debug({
                        sessionId,
                        currentIndex,
                        nextIndex: nextTask.utteranceIndex,
                        taskType: nextTask.taskType,
                        jobId: nextTask.jobId,
                        queueLength: queue.length,
                        waitTimeMs: waitTime,
                    }, 'SequentialExecutor: Next task index is not consecutive, waiting');
                }
            }
        }
    }
    /**
     * 获取当前状态（用于调试）
     */
    getState() {
        // 深拷贝currentIndex
        const currentIndex = new Map();
        for (const [sessionId, sessionState] of this.state.currentIndex.entries()) {
            currentIndex.set(sessionId, new Map(sessionState));
        }
        // 深拷贝waitingQueue
        const waitingQueue = new Map();
        for (const [sessionId, sessionQueues] of this.state.waitingQueue.entries()) {
            const queues = new Map();
            for (const [taskType, queue] of sessionQueues.entries()) {
                queues.set(taskType, [...queue]);
            }
            waitingQueue.set(sessionId, queues);
        }
        // 深拷贝processing
        const processing = new Map();
        for (const [sessionId, processingState] of this.state.processing.entries()) {
            processing.set(sessionId, new Map(processingState));
        }
        return {
            currentIndex,
            waitingQueue,
            processing,
        };
    }
    /**
     * 取消指定utterance_index的任务（用于任务被合并的情况）
     * @param sessionId 会话ID
     * @param utteranceIndex 要取消的任务索引
     * @param taskType 可选：指定要取消的服务类型，如果不指定则取消所有类型
     * @param reason 取消原因
     */
    cancelTask(sessionId, utteranceIndex, reason = 'Task merged', taskType) {
        // 从等待队列中移除（按服务类型）
        const sessionQueues = this.state.waitingQueue.get(sessionId);
        if (sessionQueues) {
            const taskTypesToCheck = taskType ? [taskType] : ['ASR', 'NMT', 'TTS', 'SEMANTIC_REPAIR'];
            for (const type of taskTypesToCheck) {
                const queue = sessionQueues.get(type);
                if (queue) {
                    // 查找所有匹配的任务
                    const tasksToCancel = [];
                    for (let i = queue.length - 1; i >= 0; i--) {
                        const task = queue[i];
                        if (task.utteranceIndex === utteranceIndex) {
                            tasksToCancel.push(queue.splice(i, 1)[0]);
                        }
                    }
                    // 取消所有匹配的任务
                    for (const task of tasksToCancel) {
                        logger_1.default.info({
                            sessionId,
                            utteranceIndex,
                            jobId: task.jobId,
                            taskType: task.taskType,
                            reason,
                        }, 'SequentialExecutor: Task cancelled from waiting queue (merged)');
                        task.reject(new Error(`SequentialExecutor: Task cancelled - ${reason}`));
                    }
                }
            }
        }
        // 检查是否正在处理（按服务类型）
        const processingState = this.state.processing.get(sessionId);
        if (processingState) {
            const taskTypesToCheck = taskType ? [taskType] : ['ASR', 'NMT', 'TTS', 'SEMANTIC_REPAIR'];
            for (const type of taskTypesToCheck) {
                const currentProcessing = processingState.get(type);
                if (currentProcessing && currentProcessing.utteranceIndex === utteranceIndex) {
                    logger_1.default.warn({
                        sessionId,
                        utteranceIndex,
                        jobId: currentProcessing.jobId,
                        taskType: currentProcessing.taskType,
                        reason,
                    }, 'SequentialExecutor: Task is currently processing, cannot cancel (will complete normally)');
                    // 注意：正在处理的任务不能取消，只能等待完成
                    // 但是，如果任务完成后发现已经被合并，应该跳过后续处理
                }
            }
        }
    }
    /**
     * 清理session的状态（用于session结束）
     */
    clearSession(sessionId) {
        this.state.currentIndex.delete(sessionId);
        this.state.waitingQueue.delete(sessionId);
        this.state.processing.delete(sessionId);
        logger_1.default.info({ sessionId }, 'SequentialExecutor: Session state cleared');
    }
    /**
     * 销毁（清理资源）
     */
    destroy() {
        if (this.timeoutCheckInterval) {
            clearInterval(this.timeoutCheckInterval);
            this.timeoutCheckInterval = undefined;
        }
        // 拒绝所有等待中的任务
        for (const sessionQueues of this.state.waitingQueue.values()) {
            for (const queue of sessionQueues.values()) {
                for (const task of queue) {
                    task.reject(new Error('SequentialExecutor: Destroyed'));
                }
            }
        }
        this.state.currentIndex.clear();
        this.state.waitingQueue.clear();
        this.state.processing.clear();
        logger_1.default.info({}, 'SequentialExecutor: Destroyed');
    }
}
exports.SequentialExecutor = SequentialExecutor;
