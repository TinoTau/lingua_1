"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForServiceReady = waitForServiceReady;
const logger_1 = __importDefault(require("../logger"));
/**
 * 等待服务就绪（通过健康检查）
 */
async function waitForServiceReady(port, maxWaitMs = 30000, processCheck) {
    const startTime = Date.now();
    const checkInterval = 500; // 每 500ms 检查一次
    return new Promise((resolve, reject) => {
        const checkHealth = async () => {
            // 检查进程状态（如果提供了检查函数）
            if (processCheck) {
                const processState = processCheck();
                if (!processState.running) {
                    const errorMsg = `服务进程已退出（PID: ${processState.pid}, 退出码: ${processState.exitCode}）`;
                    logger_1.default.error({ port, ...processState }, errorMsg);
                    reject(new Error(errorMsg));
                    return;
                }
            }
            try {
                const axios = require('axios');
                // 使用 127.0.0.1 而不是 localhost，避免 IPv6/IPv4 解析问题
                const healthUrl = `http://127.0.0.1:${port}/health`;
                logger_1.default.debug({ healthUrl, port }, '发送健康检查请求...');
                const response = await axios.get(healthUrl, {
                    timeout: 5000, // 增加到 5 秒，给服务更多时间响应
                });
                if (response.status === 200) {
                    logger_1.default.info({ port, elapsed: Date.now() - startTime }, 'Rust 服务健康检查通过');
                    resolve();
                    return;
                }
                else {
                    logger_1.default.warn({ port, status: response.status }, '健康检查返回非 200 状态码');
                }
            }
            catch (error) {
                // 服务还未就绪，继续等待
                const elapsed = Date.now() - startTime;
                const isTimeout = error?.code === 'ECONNABORTED' || error?.message?.includes('timeout');
                const isConnectionRefused = error?.code === 'ECONNREFUSED';
                // 每 5 秒记录一次等待信息，或者如果是连接错误则更频繁记录
                if (elapsed % 5000 < checkInterval || isConnectionRefused || isTimeout) {
                    logger_1.default.info({
                        port,
                        elapsed,
                        errorMessage: error?.message || String(error),
                        errorCode: error?.code,
                        errorType: isTimeout ? 'timeout' : isConnectionRefused ? 'connection_refused' : 'other',
                    }, '等待 Rust 服务就绪...');
                }
            }
            if (Date.now() - startTime > maxWaitMs) {
                // 检查进程是否还在运行
                const processState = processCheck ? processCheck() : { running: true };
                const errorMsg = `服务在 ${maxWaitMs}ms 内未就绪（端口 ${port}）`;
                logger_1.default.error({
                    port,
                    maxWaitMs,
                    elapsed: Date.now() - startTime,
                    processRunning: processState.running,
                }, errorMsg);
                reject(new Error(errorMsg));
                return;
            }
            setTimeout(checkHealth, checkInterval);
        };
        checkHealth();
    });
}
