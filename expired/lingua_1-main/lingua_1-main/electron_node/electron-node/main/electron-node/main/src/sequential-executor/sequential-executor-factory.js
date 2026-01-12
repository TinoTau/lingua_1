"use strict";
/**
 * SequentialExecutorFactory - 顺序执行管理器工厂
 * 提供单例SequentialExecutor实例
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSequentialExecutor = getSequentialExecutor;
exports.resetSequentialExecutor = resetSequentialExecutor;
const sequential_executor_1 = require("./sequential-executor");
const node_config_1 = require("../node-config");
const logger_1 = __importDefault(require("../logger"));
let instance = null;
/**
 * 获取SequentialExecutor实例（单例）
 */
function getSequentialExecutor() {
    if (!instance) {
        const config = loadSequentialExecutorConfig();
        instance = new sequential_executor_1.SequentialExecutor(config);
        logger_1.default.info({
            enabled: config.enabled,
            maxWaitMs: config.maxWaitMs,
        }, 'SequentialExecutorFactory: Created singleton instance');
    }
    return instance;
}
/**
 * 从NodeConfig加载SequentialExecutor配置
 */
function loadSequentialExecutorConfig() {
    const nodeConfig = (0, node_config_1.loadNodeConfig)();
    const config = nodeConfig.sequentialExecutor || {};
    return {
        enabled: config.enabled ?? true,
        maxWaitMs: config.maxWaitMs ?? 30000,
        timeoutCheckIntervalMs: config.timeoutCheckIntervalMs ?? 5000,
    };
}
/**
 * 重置实例（用于测试）
 */
function resetSequentialExecutor() {
    if (instance) {
        instance.destroy();
        instance = null;
    }
}
