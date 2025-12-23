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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.venvExists = venvExists;
exports.createVenv = createVenv;
exports.installDependencies = installDependencies;
exports.ensureVenvSetup = ensureVenvSetup;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const logger_1 = __importDefault(require("../logger"));
/**
 * 检查虚拟环境是否存在
 */
function venvExists(venvPath) {
    const pythonExe = path.join(venvPath, 'Scripts', 'python.exe');
    return fs.existsSync(pythonExe);
}
/**
 * 创建虚拟环境
 */
async function createVenv(venvPath, serviceName) {
    return new Promise((resolve, reject) => {
        logger_1.default.info({ serviceName, venvPath }, 'Creating virtual environment...');
        // 确保父目录存在
        const parentDir = path.dirname(venvPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        // 使用系统 Python 创建虚拟环境
        const process = (0, child_process_1.spawn)('python', ['-m', 'venv', venvPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });
        let stdout = '';
        let stderr = '';
        process.stdout?.on('data', (data) => {
            stdout += data.toString();
        });
        process.stderr?.on('data', (data) => {
            stderr += data.toString();
        });
        process.on('close', (code) => {
            if (code === 0) {
                logger_1.default.info({ serviceName, venvPath }, 'Virtual environment created successfully');
                resolve();
            }
            else {
                const error = `Failed to create virtual environment: ${stderr || stdout}`;
                logger_1.default.error({ serviceName, venvPath, code, stderr, stdout }, error);
                reject(new Error(error));
            }
        });
        process.on('error', (error) => {
            logger_1.default.error({ serviceName, venvPath, error }, 'Failed to spawn venv creation process');
            reject(error);
        });
    });
}
/**
 * 安装依赖
 */
async function installDependencies(venvPath, requirementsPath, serviceName) {
    const pythonExe = path.join(venvPath, 'Scripts', 'python.exe');
    const pipExe = path.join(venvPath, 'Scripts', 'pip.exe');
    if (!fs.existsSync(pythonExe)) {
        throw new Error(`Python executable not found in virtual environment: ${pythonExe}`);
    }
    if (!fs.existsSync(requirementsPath)) {
        logger_1.default.warn({ serviceName, requirementsPath }, 'Requirements file not found, skipping dependency installation');
        return;
    }
    return new Promise((resolve, reject) => {
        logger_1.default.info({ serviceName, requirementsPath }, 'Installing dependencies...');
        // 先升级 pip
        const upgradePip = (0, child_process_1.spawn)(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });
        let upgradeStdout = '';
        let upgradeStderr = '';
        upgradePip.stdout?.on('data', (data) => {
            upgradeStdout += data.toString();
        });
        upgradePip.stderr?.on('data', (data) => {
            upgradeStderr += data.toString();
        });
        upgradePip.on('close', (code) => {
            if (code !== 0) {
                logger_1.default.warn({ serviceName, code, stderr: upgradeStderr }, 'Failed to upgrade pip, continuing anyway...');
            }
            // 安装依赖
            const installDeps = (0, child_process_1.spawn)(pipExe, ['install', '-r', requirementsPath], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });
            let installStdout = '';
            let installStderr = '';
            installDeps.stdout?.on('data', (data) => {
                installStdout += data.toString();
            });
            installDeps.stderr?.on('data', (data) => {
                installStderr += data.toString();
            });
            installDeps.on('close', (installCode) => {
                if (installCode === 0) {
                    logger_1.default.info({ serviceName }, 'Dependencies installed successfully');
                    resolve();
                }
                else {
                    const error = `Failed to install dependencies: ${installStderr || installStdout}`;
                    logger_1.default.error({ serviceName, requirementsPath, code: installCode, stderr: installStderr, stdout: installStdout }, error);
                    reject(new Error(error));
                }
            });
            installDeps.on('error', (error) => {
                logger_1.default.error({ serviceName, requirementsPath, error }, 'Failed to spawn pip install process');
                reject(error);
            });
        });
        upgradePip.on('error', (error) => {
            logger_1.default.error({ serviceName, error }, 'Failed to spawn pip upgrade process');
            reject(error);
        });
    });
}
/**
 * 确保虚拟环境已设置（如果不存在则创建并安装依赖）
 */
async function ensureVenvSetup(config, serviceName) {
    const { venvPath, servicePath } = config;
    const requirementsPath = path.join(servicePath, 'requirements.txt');
    // 检查虚拟环境是否存在
    if (!venvExists(venvPath)) {
        logger_1.default.info({ serviceName, venvPath }, 'Virtual environment does not exist, setting up...');
        try {
            // 创建虚拟环境
            await createVenv(venvPath, serviceName);
            // 安装依赖
            await installDependencies(venvPath, requirementsPath, serviceName);
            logger_1.default.info({ serviceName, venvPath }, 'Virtual environment setup completed');
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger_1.default.error({
                serviceName,
                venvPath,
                requirementsPath,
                error: errorMessage,
            }, 'Failed to setup virtual environment');
            throw new Error(`Failed to setup virtual environment for ${serviceName}: ${errorMessage}`);
        }
    }
    else {
        logger_1.default.debug({ serviceName, venvPath }, 'Virtual environment already exists');
    }
}
