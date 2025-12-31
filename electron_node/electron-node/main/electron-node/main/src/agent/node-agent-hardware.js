"use strict";
/**
 * Node Agent Hardware Info Handler
 * 处理硬件信息获取相关的逻辑
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HardwareInfoHandler = void 0;
const si = __importStar(require("systeminformation"));
const os = __importStar(require("os"));
const logger_1 = __importDefault(require("../logger"));
class HardwareInfoHandler {
    /**
     * 获取平台信息
     */
    getPlatform() {
        const platform = os.platform();
        if (platform === 'win32')
            return 'windows';
        if (platform === 'darwin')
            return 'macos';
        return 'linux';
    }
    /**
     * 获取硬件信息
     */
    async getHardwareInfo() {
        try {
            const mem = await si.mem();
            const cpu = await si.cpu();
            // 获取 GPU 硬件信息（使用 nvidia-smi）
            const gpus = await this.getGpuHardwareInfo();
            return {
                cpu_cores: cpu.cores || os.cpus().length,
                memory_gb: Math.round(mem.total / (1024 * 1024 * 1024)),
                gpus: gpus.length > 0 ? gpus : undefined,
            };
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to get hardware info');
            return {
                cpu_cores: os.cpus().length,
                memory_gb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
            };
        }
    }
    /**
     * 获取 GPU 硬件信息（名称和显存大小）
     * 使用 nvidia-smi 命令获取
     */
    async getGpuHardwareInfo() {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            // nvidia-smi 命令：获取GPU名称和显存大小
            const nvidiaSmi = spawn('nvidia-smi', [
                '--query-gpu=name,memory.total',
                '--format=csv,noheader,nounits'
            ]);
            let output = '';
            let errorOutput = '';
            nvidiaSmi.stdout.on('data', (data) => {
                output += data.toString();
            });
            nvidiaSmi.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });
            nvidiaSmi.on('close', (code) => {
                if (code === 0 && output.trim()) {
                    try {
                        const lines = output.trim().split('\n');
                        const gpus = [];
                        for (const line of lines) {
                            // 格式: "GPU Name, Memory Total (MB)"
                            const parts = line.split(',');
                            if (parts.length >= 2) {
                                const name = parts[0].trim();
                                const memoryMb = parseFloat(parts[1].trim());
                                const memoryGb = Math.round(memoryMb / 1024);
                                if (!isNaN(memoryGb) && name) {
                                    gpus.push({ name, memory_gb: memoryGb });
                                }
                            }
                        }
                        if (gpus.length > 0) {
                            logger_1.default.info({ gpus }, 'Successfully fetched GPU hardware info');
                            resolve(gpus);
                        }
                        else {
                            logger_1.default.warn({ output }, 'Failed to parse GPU hardware info');
                            resolve([]);
                        }
                    }
                    catch (parseError) {
                        logger_1.default.warn({ parseError, output }, 'Failed to parse nvidia-smi output');
                        resolve([]);
                    }
                }
                else {
                    logger_1.default.warn({ code, errorOutput: errorOutput.trim() }, 'nvidia-smi command failed or no GPU found');
                    resolve([]);
                }
            });
            nvidiaSmi.on('error', (error) => {
                // nvidia-smi 命令不存在或无法执行
                logger_1.default.warn({ error: error.message }, 'nvidia-smi command not available');
                resolve([]);
            });
        });
    }
}
exports.HardwareInfoHandler = HardwareInfoHandler;
