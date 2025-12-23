"use strict";
//! Python 服务配置工具
//! 
//! 提供 Python 服务的配置生成功能
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
exports.getPythonServiceConfig = getPythonServiceConfig;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const cuda_env_1 = require("./cuda-env");
/**
 * 获取 Python 服务配置
 */
function getPythonServiceConfig(serviceName, projectRoot) {
    const baseEnv = {
        ...process.env,
        ...(0, cuda_env_1.setupCudaEnvironment)(),
        PYTHONIOENCODING: 'utf-8',
    };
    switch (serviceName) {
        case 'nmt': {
            const servicePath = path.join(projectRoot, 'electron_node', 'services', 'nmt_m2m100');
            const venvPath = path.join(servicePath, 'venv');
            const venvScripts = path.join(venvPath, 'Scripts');
            const logDir = path.join(servicePath, 'logs');
            const logFile = path.join(logDir, 'nmt-service.log');
            // 确保日志目录存在
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            // 读取 Hugging Face token
            const hfTokenFile = path.join(servicePath, 'hf_token.txt');
            let hfToken = '';
            if (fs.existsSync(hfTokenFile)) {
                try {
                    hfToken = fs.readFileSync(hfTokenFile, 'utf-8').trim();
                }
                catch (error) {
                    // 忽略错误
                }
            }
            // 配置虚拟环境环境变量
            const currentPath = baseEnv.PATH || '';
            const venvPathEnv = `${venvScripts};${currentPath}`;
            // 设置 HuggingFace 缓存目录到服务目录
            const modelsDir = path.join(servicePath, 'models');
            const hfCacheDir = path.join(modelsDir, '.cache', 'huggingface', 'hub');
            return {
                name: 'NMT',
                port: 5008,
                servicePath,
                venvPath,
                scriptPath: path.join(servicePath, 'nmt_service.py'),
                workingDir: servicePath,
                logDir,
                logFile,
                env: {
                    ...baseEnv,
                    VIRTUAL_ENV: venvPath,
                    PATH: venvPathEnv,
                    HF_TOKEN: hfToken,
                    HF_LOCAL_FILES_ONLY: 'true',
                    // 设置 HuggingFace 缓存目录（如果服务目录中有模型）
                    ...(fs.existsSync(modelsDir) ? { HF_HOME: modelsDir } : {}),
                },
            };
        }
        case 'tts': {
            const servicePath = path.join(projectRoot, 'electron_node', 'services', 'piper_tts');
            const venvPath = path.join(servicePath, 'venv');
            const venvScripts = path.join(venvPath, 'Scripts');
            const logDir = path.join(servicePath, 'logs');
            const logFile = path.join(logDir, 'tts-service.log');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const modelDir = process.env.PIPER_MODEL_DIR
                || path.join(projectRoot, 'electron_node', 'services', 'piper_tts', 'models');
            // 配置虚拟环境环境变量
            const currentPath = baseEnv.PATH || '';
            const venvPathEnv = `${venvScripts};${currentPath}`;
            return {
                name: 'TTS (Piper)',
                port: 5006,
                servicePath,
                venvPath,
                scriptPath: path.join(servicePath, 'piper_http_server.py'),
                workingDir: servicePath,
                logDir,
                logFile,
                env: {
                    ...baseEnv,
                    VIRTUAL_ENV: venvPath,
                    PATH: venvPathEnv,
                    PIPER_USE_GPU: baseEnv.CUDA_PATH ? 'true' : 'false',
                    PIPER_MODEL_DIR: modelDir,
                },
            };
        }
        case 'yourtts': {
            const servicePath = path.join(projectRoot, 'electron_node', 'services', 'your_tts');
            const venvPath = path.join(servicePath, 'venv');
            const venvScripts = path.join(venvPath, 'Scripts');
            const logDir = path.join(servicePath, 'logs');
            const logFile = path.join(logDir, 'yourtts-service.log');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const modelDir = process.env.YOURTTS_MODEL_DIR
                || path.join(projectRoot, 'electron_node', 'services', 'your_tts', 'models', 'your_tts');
            // 配置虚拟环境环境变量
            const currentPath = baseEnv.PATH || '';
            const venvPathEnv = `${venvScripts};${currentPath}`;
            return {
                name: 'YourTTS',
                port: 5004,
                servicePath,
                venvPath,
                scriptPath: path.join(servicePath, 'yourtts_service.py'),
                workingDir: servicePath,
                logDir,
                logFile,
                env: {
                    ...baseEnv,
                    VIRTUAL_ENV: venvPath,
                    PATH: venvPathEnv,
                    YOURTTS_MODEL_DIR: modelDir,
                    YOURTTS_USE_GPU: baseEnv.CUDA_PATH ? 'true' : 'false',
                },
            };
        }
        case 'speaker_embedding': {
            const servicePath = path.join(projectRoot, 'electron_node', 'services', 'speaker_embedding');
            const venvPath = path.join(servicePath, 'venv');
            const venvScripts = path.join(venvPath, 'Scripts');
            const logDir = path.join(servicePath, 'logs');
            const logFile = path.join(logDir, 'speaker-embedding-service.log');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            // 配置虚拟环境环境变量
            const currentPath = baseEnv.PATH || '';
            const venvPathEnv = `${venvScripts};${currentPath}`;
            return {
                name: 'Speaker Embedding',
                port: 5003,
                servicePath,
                venvPath,
                scriptPath: path.join(servicePath, 'speaker_embedding_service.py'),
                workingDir: servicePath,
                logDir,
                logFile,
                env: {
                    ...baseEnv,
                    VIRTUAL_ENV: venvPath,
                    PATH: venvPathEnv,
                },
            };
        }
        case 'faster_whisper_vad': {
            const servicePath = path.join(projectRoot, 'electron_node', 'services', 'faster_whisper_vad');
            const venvPath = path.join(servicePath, 'venv');
            const venvScripts = path.join(venvPath, 'Scripts');
            const logDir = path.join(servicePath, 'logs');
            const logFile = path.join(logDir, 'faster-whisper-vad-service.log');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            // 配置虚拟环境环境变量
            const currentPath = baseEnv.PATH || '';
            const venvPathEnv = `${venvScripts};${currentPath}`;
            // 模型路径
            // Faster Whisper 模型：只在自己的服务目录下查找，找不到直接报错
            let asrModelPath;
            if (process.env.ASR_MODEL_PATH) {
                asrModelPath = process.env.ASR_MODEL_PATH;
            }
            else {
                // 只检查服务目录下的本地 CTranslate2 模型
                const localCt2ModelPath = path.join(servicePath, 'models', 'asr', 'whisper-base-ct2');
                if (fs.existsSync(localCt2ModelPath)) {
                    // 使用转换后的 CTranslate2 模型
                    // Faster Whisper 可以接受 HuggingFace 缓存目录，会自动查找模型
                    asrModelPath = 'Systran/faster-whisper-base';
                    // 设置缓存目录环境变量，让 Faster Whisper 使用本地缓存
                    baseEnv.WHISPER_CACHE_DIR = localCt2ModelPath;
                }
                else {
                    // 模型不存在，直接报错
                    throw new Error(`Faster Whisper model not found at ${localCt2ModelPath}. ` +
                        `Please ensure the model is converted and placed in the service directory. ` +
                        `You can convert the model using: python convert_model.py --model base --output models/asr/whisper-base-ct2`);
                }
            }
            // VAD 模型路径：只在自己的服务目录下查找，找不到直接报错
            let vadModelPath;
            if (process.env.VAD_MODEL_PATH) {
                vadModelPath = process.env.VAD_MODEL_PATH;
            }
            else {
                // 只检查服务目录下的本地模型
                const localVadPath = path.join(servicePath, 'models', 'vad', 'silero', 'silero_vad_official.onnx');
                if (fs.existsSync(localVadPath)) {
                    vadModelPath = localVadPath;
                }
                else {
                    // 模型不存在，直接报错
                    throw new Error(`VAD model not found at ${localVadPath}. ` +
                        `Please ensure the Silero VAD model is placed in the service directory.`);
                }
            }
            // GPU 配置：如果 CUDA 可用，使用 CUDA 和 float16；否则使用 CPU 和 float32
            // 注意：CPU 不支持 float16，必须使用 float32 或 int8
            const cudaAvailable = !!baseEnv.CUDA_PATH;
            const asrDevice = cudaAvailable ? 'cuda' : 'cpu';
            // CPU 模式下强制使用 float32（不支持 float16）
            // 如果环境变量已设置，使用环境变量的值；否则根据设备自动选择
            let asrComputeType;
            if (process.env.ASR_COMPUTE_TYPE) {
                asrComputeType = process.env.ASR_COMPUTE_TYPE;
            }
            else {
                // 根据设备自动选择：CUDA 使用 float16，CPU 使用 float32
                asrComputeType = cudaAvailable ? 'float16' : 'float32';
            }
            return {
                name: 'Faster Whisper + VAD',
                port: 6007,
                servicePath,
                venvPath,
                scriptPath: path.join(servicePath, 'faster_whisper_vad_service.py'),
                workingDir: servicePath,
                logDir,
                logFile,
                env: {
                    ...baseEnv,
                    VIRTUAL_ENV: venvPath,
                    PATH: venvPathEnv,
                    ASR_MODEL_PATH: asrModelPath,
                    VAD_MODEL_PATH: vadModelPath,
                    ASR_DEVICE: asrDevice,
                    ASR_COMPUTE_TYPE: asrComputeType,
                    FASTER_WHISPER_VAD_PORT: '6007',
                },
            };
        }
        default:
            return null;
    }
}
