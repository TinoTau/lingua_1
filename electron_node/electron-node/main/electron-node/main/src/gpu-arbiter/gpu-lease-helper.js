"use strict";
/**
 * GPU 租约辅助函数
 * 提供便捷的GPU租约获取和释放包装
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withGpuLease = withGpuLease;
exports.tryAcquireGpuLease = tryAcquireGpuLease;
const gpu_arbiter_factory_1 = require("./gpu-arbiter-factory");
const logger_1 = __importDefault(require("../logger"));
const node_config_1 = require("../node-config");
/**
 * 使用GPU租约执行函数
 * 自动处理租约的获取和释放
 */
async function withGpuLease(taskType, fn, trace) {
    const gpuArbiter = (0, gpu_arbiter_factory_1.getGpuArbiter)();
    if (!gpuArbiter) {
        // GPU仲裁器未启用，直接执行
        const dummyLease = {
            leaseId: 'no-arbiter',
            gpuKey: 'gpu:0',
            taskType,
            acquiredAt: Date.now(),
            holdMaxMs: 8000,
            release: () => { },
        };
        return await fn(dummyLease);
    }
    const config = (0, node_config_1.loadNodeConfig)();
    const defaultConfig = config.gpuArbiter || {
        enabled: false,
        gpuKeys: ['gpu:0'],
        defaultQueueLimit: 8,
        defaultHoldMaxMs: 8000,
    };
    // 安全获取policy（处理OTHER类型）
    const policy = (taskType !== 'OTHER' && config.gpuArbiter?.policies?.[taskType])
        ? config.gpuArbiter.policies[taskType]
        : undefined;
    const request = {
        gpuKey: (defaultConfig.gpuKeys && defaultConfig.gpuKeys[0]) || 'gpu:0',
        taskType,
        priority: policy?.priority ?? 50,
        maxWaitMs: policy?.maxWaitMs ?? (defaultConfig.defaultHoldMaxMs ?? 8000),
        holdMaxMs: defaultConfig.defaultHoldMaxMs ?? 8000,
        queueLimit: defaultConfig.defaultQueueLimit ?? 8,
        busyPolicy: policy?.busyPolicy ?? 'WAIT',
        trace: trace || {},
    };
    const result = await gpuArbiter.acquire(request);
    if (result.status === 'SKIPPED') {
        logger_1.default.debug({
            taskType,
            reason: result.reason,
            ...trace,
        }, 'GpuLeaseHelper: GPU lease skipped');
        throw new Error(`GPU lease skipped: ${result.reason}`);
    }
    if (result.status === 'FALLBACK_CPU') {
        logger_1.default.debug({
            taskType,
            reason: result.reason,
            ...trace,
        }, 'GpuLeaseHelper: GPU lease fallback to CPU');
        throw new Error(`GPU lease fallback to CPU: ${result.reason}`);
    }
    // 获取租约成功
    const lease = {
        leaseId: result.leaseId,
        gpuKey: request.gpuKey,
        taskType,
        acquiredAt: result.acquiredAt,
        holdMaxMs: request.holdMaxMs,
        release: () => gpuArbiter.release(result.leaseId),
    };
    try {
        return await fn(lease);
    }
    finally {
        lease.release();
    }
}
/**
 * 尝试获取GPU租约（非阻塞）
 * 如果获取失败，返回null
 */
async function tryAcquireGpuLease(taskType, trace) {
    const gpuArbiter = (0, gpu_arbiter_factory_1.getGpuArbiter)();
    if (!gpuArbiter) {
        // GPU仲裁器未启用，返回虚拟租约
        return {
            leaseId: 'no-arbiter',
            gpuKey: 'gpu:0',
            taskType,
            acquiredAt: Date.now(),
            holdMaxMs: 8000,
            release: () => { },
        };
    }
    const config = (0, node_config_1.loadNodeConfig)();
    const defaultConfig = config.gpuArbiter || {
        enabled: false,
        gpuKeys: ['gpu:0'],
        defaultQueueLimit: 8,
        defaultHoldMaxMs: 8000,
    };
    // 安全获取policy（处理OTHER类型）
    const policy = (taskType !== 'OTHER' && config.gpuArbiter?.policies?.[taskType])
        ? config.gpuArbiter.policies[taskType]
        : undefined;
    const request = {
        gpuKey: (defaultConfig.gpuKeys && defaultConfig.gpuKeys[0]) || 'gpu:0',
        taskType,
        priority: policy?.priority ?? 50,
        maxWaitMs: policy?.maxWaitMs ?? (defaultConfig.defaultHoldMaxMs ?? 8000),
        holdMaxMs: defaultConfig.defaultHoldMaxMs ?? 8000,
        queueLimit: defaultConfig.defaultQueueLimit ?? 8,
        busyPolicy: policy?.busyPolicy ?? 'WAIT',
        trace: trace || {},
    };
    const result = await gpuArbiter.acquire(request);
    if (result.status !== 'ACQUIRED') {
        return null;
    }
    return {
        leaseId: result.leaseId,
        gpuKey: request.gpuKey,
        taskType,
        acquiredAt: result.acquiredAt,
        holdMaxMs: request.holdMaxMs,
        release: () => gpuArbiter.release(result.leaseId),
    };
}
