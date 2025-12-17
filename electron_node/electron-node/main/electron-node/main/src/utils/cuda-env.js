"use strict";
//! CUDA 环境设置工具
//! 
//! 提供 CUDA 环境变量配置功能
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
exports.setupCudaEnvironment = setupCudaEnvironment;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const logger_1 = __importDefault(require("../logger"));
/**
 * 设置 CUDA 环境变量
 */
function setupCudaEnvironment() {
    const env = {};
    const cudaPaths = [
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4',
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.1',
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.8',
    ];
    for (const cudaPath of cudaPaths) {
        if (fs.existsSync(cudaPath)) {
            const cudaBin = path.join(cudaPath, 'bin');
            const cudaLibnvvp = path.join(cudaPath, 'libnvvp');
            const cudaNvcc = path.join(cudaBin, 'nvcc.exe');
            env.CUDA_PATH = cudaPath;
            env.CUDAToolkit_ROOT = cudaPath;
            env.CUDA_ROOT = cudaPath;
            env.CUDA_HOME = cudaPath;
            env.CMAKE_CUDA_COMPILER = cudaNvcc;
            const currentPath = process.env.PATH || '';
            env.PATH = `${cudaBin};${cudaLibnvvp};${currentPath}`;
            logger_1.default.info({ cudaPath }, 'CUDA environment configured');
            break;
        }
    }
    return env;
}
