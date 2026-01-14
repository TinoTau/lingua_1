"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNodeConfig = loadNodeConfig;
exports.loadNodeConfigAsync = loadNodeConfigAsync;
exports.saveNodeConfig = saveNodeConfig;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const fsPromises = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const DEFAULT_CONFIG = {
    servicePreferences: {
        rustEnabled: false, // 默认关闭节点推理服务（Rust）
        nmtEnabled: true, // 默认启用 NMT
        ttsEnabled: true, // 默认启用 Piper TTS
        yourttsEnabled: false, // 默认关闭 YourTTS（资源较重）
        fasterWhisperVadEnabled: true, // 默认启用 Faster Whisper VAD 语音识别服务
        speakerEmbeddingEnabled: false, // 默认关闭 Speaker Embedding
    },
    scheduler: {
        url: 'ws://127.0.0.1:5010/ws/node', // 默认本地地址，使用 127.0.0.1 避免 IPv6 解析问题
    },
    modelHub: {
        url: 'http://127.0.0.1:5000', // 默认本地地址，使用 127.0.0.1 避免 IPv6 解析问题
    },
    // ASR配置已移除：各服务的参数应该随着服务走，避免节点端与服务强制绑定
    metrics: {
        enabled: true, // 默认启用指标收集（向后兼容）
        metrics: {
            rerun: true, // 默认启用 Rerun 指标
            asr: true, // 默认启用 ASR 指标
            // 未来扩展：nmt, tts 等
        },
    },
    features: {
        enablePostProcessTranslation: true, // 默认启用 PostProcess 翻译
        enableS1PromptBias: false, // 默认禁用 S1 Prompt Bias（暂时禁用，避免错误传播）
        enableS2Rescoring: false, // 默认禁用 S2 Rescoring（已禁用）
    },
    textLength: {
        minLengthToKeep: 6, // 最小保留长度：6个字符（太短的文本直接丢弃）
        minLengthToSend: 20, // 最小发送长度：20个字符（6-20字符之间的文本等待合并）
        maxLengthToWait: 40, // 最大等待长度：40个字符（20-40字符之间的文本等待3秒确认是否有后续输入，超过40字符强制截断）
        waitTimeoutMs: 3000, // 等待超时：3秒
    },
};
function getConfigPath() {
    const userData = electron_1.app.getPath('userData');
    return path.join(userData, 'electron-node-config.json');
}
// 同步版本（用于向后兼容，但尽量使用异步版本）
function loadNodeConfig() {
    try {
        const configPath = getConfigPath();
        if (!fs.existsSync(configPath)) {
            return { ...DEFAULT_CONFIG };
        }
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 简单合并，避免缺字段
        // 注意：先展开默认配置，然后用用户配置覆盖，确保用户保存的值优先
        return {
            servicePreferences: {
                ...DEFAULT_CONFIG.servicePreferences,
                ...(parsed.servicePreferences || {}),
            },
            scheduler: {
                ...DEFAULT_CONFIG.scheduler,
                ...(parsed.scheduler || {}),
            },
            modelHub: {
                ...DEFAULT_CONFIG.modelHub,
                ...(parsed.modelHub || {}),
            },
            // ASR配置已移除：各服务的参数应该随着服务走
            metrics: {
                ...DEFAULT_CONFIG.metrics,
                ...(parsed.metrics || {}),
                // 深度合并 metrics.metrics 对象
                metrics: {
                    ...DEFAULT_CONFIG.metrics?.metrics,
                    ...(parsed.metrics?.metrics || {}),
                },
            },
            features: {
                ...DEFAULT_CONFIG.features,
                ...(parsed.features || {}),
            },
            gpuArbiter: parsed.gpuArbiter || DEFAULT_CONFIG.gpuArbiter,
            sequentialExecutor: {
                ...(DEFAULT_CONFIG.sequentialExecutor || {}),
                ...(parsed.sequentialExecutor || {}),
            },
            textLength: {
                ...(DEFAULT_CONFIG.textLength || {}),
                ...(parsed.textLength || {}),
            },
        };
    }
    catch (error) {
        // 读取失败时使用默认配置
        // 注意：这里不应该保存默认配置，因为可能是文件格式错误，保存会覆盖用户之前的配置
        // 保存操作应该在调用方明确知道需要保存时才执行
        return { ...DEFAULT_CONFIG };
    }
}
// 异步版本（推荐使用，不阻塞）
async function loadNodeConfigAsync() {
    try {
        const configPath = getConfigPath();
        try {
            await fsPromises.access(configPath);
        }
        catch {
            // 文件不存在，返回默认配置
            return { ...DEFAULT_CONFIG };
        }
        const raw = await fsPromises.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 简单合并，避免缺字段
        return {
            servicePreferences: {
                ...DEFAULT_CONFIG.servicePreferences,
                ...(parsed.servicePreferences || {}),
            },
            scheduler: {
                ...DEFAULT_CONFIG.scheduler,
                ...(parsed.scheduler || {}),
            },
            modelHub: {
                ...DEFAULT_CONFIG.modelHub,
                ...(parsed.modelHub || {}),
            },
            // ASR配置已移除：各服务的参数应该随着服务走
            metrics: {
                ...DEFAULT_CONFIG.metrics,
                ...(parsed.metrics || {}),
                // 深度合并 metrics.metrics 对象
                metrics: {
                    ...DEFAULT_CONFIG.metrics?.metrics,
                    ...(parsed.metrics?.metrics || {}),
                },
            },
            features: {
                ...DEFAULT_CONFIG.features,
                ...(parsed.features || {}),
            },
            gpuArbiter: parsed.gpuArbiter || DEFAULT_CONFIG.gpuArbiter,
            sequentialExecutor: {
                ...(DEFAULT_CONFIG.sequentialExecutor || {}),
                ...(parsed.sequentialExecutor || {}),
            },
            textLength: {
                ...(DEFAULT_CONFIG.textLength || {}),
                ...(parsed.textLength || {}),
            },
        };
    }
    catch (error) {
        // 读取失败时使用默认配置
        return { ...DEFAULT_CONFIG };
    }
}
function saveNodeConfig(config) {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    // 确保所有必需字段都存在（合并默认配置，避免丢失字段）
    const configToSave = {
        servicePreferences: {
            ...DEFAULT_CONFIG.servicePreferences,
            ...(config.servicePreferences || {}),
        },
        scheduler: {
            ...DEFAULT_CONFIG.scheduler,
            ...(config.scheduler || {}),
        },
        modelHub: {
            ...DEFAULT_CONFIG.modelHub,
            ...(config.modelHub || {}),
        },
        metrics: {
            ...DEFAULT_CONFIG.metrics,
            ...(config.metrics || {}),
            metrics: {
                ...DEFAULT_CONFIG.metrics?.metrics,
                ...(config.metrics?.metrics || {}),
            },
        },
        features: {
            ...DEFAULT_CONFIG.features,
            ...(config.features || {}),
        },
        gpuArbiter: config.gpuArbiter || DEFAULT_CONFIG.gpuArbiter,
        sequentialExecutor: {
            ...(DEFAULT_CONFIG.sequentialExecutor || {}),
            ...(config.sequentialExecutor || {}),
        },
        textLength: {
            ...(DEFAULT_CONFIG.textLength || {}),
            ...(config.textLength || {}),
        },
    };
    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
}
