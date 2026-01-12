"use strict";
//! 依赖检查工具
//! 
//! 检查系统依赖是否已安装（Python, ffmpeg, CUDA等）
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
exports.checkFfmpegAvailable = checkFfmpegAvailable;
exports.checkPythonAvailable = checkPythonAvailable;
exports.checkCudaAvailable = checkCudaAvailable;
exports.checkAllDependencies = checkAllDependencies;
exports.validateRequiredDependencies = validateRequiredDependencies;
const child_process = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const logger_1 = __importDefault(require("../logger"));
/**
 * 查找打包的 ffmpeg 路径
 */
function findBundledFfmpeg() {
    const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
    if (isDev) {
        // 开发环境：从项目根目录查找
        // 从当前文件向上查找项目根目录
        let currentDir = __dirname;
        for (let i = 0; i < 10; i++) {
            const ffmpegPath = path.join(currentDir, '..', '..', '..', 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
            if (fs.existsSync(ffmpegPath)) {
                return ffmpegPath;
            }
            const parentDir = path.dirname(currentDir);
            if (parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    }
    else {
        // 生产环境：从应用资源目录查找
        const appPath = electron_1.app.getAppPath();
        const ffmpegPath = path.join(appPath, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
        if (fs.existsSync(ffmpegPath)) {
            return ffmpegPath;
        }
    }
    return null;
}
/**
 * 检查 ffmpeg 是否可用（优先检查打包版本）
 */
function checkFfmpegAvailable() {
    // 首先检查打包的 ffmpeg
    const bundledFfmpeg = findBundledFfmpeg();
    if (bundledFfmpeg) {
        try {
            const result = child_process.execSync(`"${bundledFfmpeg}" -version`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 5000
            });
            const versionMatch = result.match(/ffmpeg version (\S+)/);
            const version = versionMatch ? versionMatch[1] : 'unknown';
            return {
                name: 'ffmpeg',
                installed: true,
                version,
                required: true,
                message: `ffmpeg ${version} is bundled with the application`,
                path: bundledFfmpeg
            };
        }
        catch (error) {
            // 打包版本存在但无法执行，继续检查系统版本
            logger_1.default.warn({ bundledFfmpeg, error }, 'Bundled ffmpeg found but failed to execute');
        }
    }
    // 检查系统 PATH 中的 ffmpeg
    try {
        const result = child_process.execSync('ffmpeg -version', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000
        });
        const versionMatch = result.match(/ffmpeg version (\S+)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';
        return {
            name: 'ffmpeg',
            installed: true,
            version,
            required: true,
            message: `ffmpeg ${version} is installed in system PATH`
        };
    }
    catch (error) {
        return {
            name: 'ffmpeg',
            installed: false,
            required: true,
            message: 'ffmpeg is not installed or not in PATH. Required for Opus audio decoding.',
            path: 'https://www.gyan.dev/ffmpeg/builds/'
        };
    }
}
/**
 * 检查 Python 是否可用
 */
function checkPythonAvailable() {
    try {
        const result = child_process.execSync('python --version', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000
        });
        const versionMatch = result.match(/Python (\d+)\.(\d+)/);
        if (versionMatch) {
            const major = parseInt(versionMatch[1]);
            const minor = parseInt(versionMatch[2]);
            const installed = major > 3 || (major === 3 && minor >= 10);
            return {
                name: 'Python',
                installed,
                version: `${major}.${minor}`,
                required: true,
                message: installed
                    ? `Python ${major}.${minor} is installed (meets requirement >= 3.10)`
                    : `Python ${major}.${minor} is installed but version is too old (requires >= 3.10)`,
                path: 'https://www.python.org/downloads/'
            };
        }
        return {
            name: 'Python',
            installed: false,
            required: true,
            message: 'Python is not installed or version could not be determined',
            path: 'https://www.python.org/downloads/'
        };
    }
    catch (error) {
        return {
            name: 'Python',
            installed: false,
            required: true,
            message: 'Python is not installed or not in PATH',
            path: 'https://www.python.org/downloads/'
        };
    }
}
/**
 * 检查 CUDA 是否可用（可选依赖）
 */
function checkCudaAvailable() {
    const cudaPaths = [
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.4',
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.1',
        'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v11.8',
    ];
    for (const cudaPath of cudaPaths) {
        if (fs.existsSync(cudaPath)) {
            try {
                const nvccPath = path.join(cudaPath, 'bin', 'nvcc.exe');
                if (fs.existsSync(nvccPath)) {
                    const result = child_process.execSync(`"${nvccPath}" --version`, {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                        timeout: 5000
                    });
                    const versionMatch = result.match(/release (\d+\.\d+)/);
                    const version = versionMatch ? versionMatch[1] : 'unknown';
                    return {
                        name: 'CUDA',
                        installed: true,
                        version,
                        required: false,
                        message: `CUDA ${version} is installed (GPU acceleration available)`,
                        path: cudaPath
                    };
                }
            }
            catch (error) {
                // 继续检查下一个路径
            }
        }
    }
    return {
        name: 'CUDA',
        installed: false,
        required: false,
        message: 'CUDA is not installed (optional, for GPU acceleration)',
        path: 'https://developer.nvidia.com/cuda-downloads'
    };
}
/**
 * 检查所有依赖
 */
function checkAllDependencies() {
    logger_1.default.info('Checking system dependencies...');
    const dependencies = [
        checkPythonAvailable(),
        checkFfmpegAvailable(),
        checkCudaAvailable(),
    ];
    // 记录检查结果
    dependencies.forEach(dep => {
        if (dep.installed) {
            logger_1.default.info({ dependency: dep.name, version: dep.version }, 'Dependency check: OK');
        }
        else if (dep.required) {
            logger_1.default.warn({ dependency: dep.name, message: dep.message }, 'Dependency check: MISSING (required)');
        }
        else {
            logger_1.default.info({ dependency: dep.name, message: dep.message }, 'Dependency check: MISSING (optional)');
        }
    });
    return dependencies;
}
/**
 * 验证必需依赖是否已安装
 */
function validateRequiredDependencies() {
    const dependencies = checkAllDependencies();
    const missing = dependencies
        .filter(dep => dep.required && !dep.installed)
        .map(dep => dep.name);
    return {
        valid: missing.length === 0,
        missing
    };
}
