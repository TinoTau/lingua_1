import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import logger from '../logger';
import { PythonServiceConfig } from './types';

/**
 * 检查虚拟环境是否存在
 */
export function venvExists(venvPath: string): boolean {
    const pythonExe = path.join(venvPath, 'Scripts', 'python.exe');
    return fs.existsSync(pythonExe);
}

/**
 * 创建虚拟环境
 */
export async function createVenv(venvPath: string, serviceName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        logger.info({ serviceName, venvPath }, 'Creating virtual environment...');

        // 确保父目录存在
        const parentDir = path.dirname(venvPath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        // 使用系统 Python 创建虚拟环境
        const process = spawn('python', ['-m', 'venv', venvPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });

        let stdout = '';
        let stderr = '';

        process.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        process.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0) {
                logger.info({ serviceName, venvPath }, 'Virtual environment created successfully');
                resolve();
            } else {
                const error = `Failed to create virtual environment: ${stderr || stdout}`;
                logger.error({ serviceName, venvPath, code, stderr, stdout }, error);
                reject(new Error(error));
            }
        });

        process.on('error', (error) => {
            logger.error({ serviceName, venvPath, error }, 'Failed to spawn venv creation process');
            reject(error);
        });
    });
}

/**
 * 安装依赖
 */
export async function installDependencies(
    venvPath: string,
    requirementsPath: string,
    serviceName: string
): Promise<void> {
    const pythonExe = path.join(venvPath, 'Scripts', 'python.exe');
    const pipExe = path.join(venvPath, 'Scripts', 'pip.exe');

    if (!fs.existsSync(pythonExe)) {
        throw new Error(`Python executable not found in virtual environment: ${pythonExe}`);
    }

    if (!fs.existsSync(requirementsPath)) {
        logger.warn({ serviceName, requirementsPath }, 'Requirements file not found, skipping dependency installation');
        return;
    }

    return new Promise((resolve, reject) => {
        logger.info({ serviceName, requirementsPath }, 'Installing dependencies...');

        // 先升级 pip
        const upgradePip = spawn(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: true,
        });

        let upgradeStdout = '';
        let upgradeStderr = '';

        upgradePip.stdout?.on('data', (data: Buffer) => {
            upgradeStdout += data.toString();
        });

        upgradePip.stderr?.on('data', (data: Buffer) => {
            upgradeStderr += data.toString();
        });

        upgradePip.on('close', (code) => {
            if (code !== 0) {
                logger.warn({ serviceName, code, stderr: upgradeStderr }, 'Failed to upgrade pip, continuing anyway...');
            }

            // 安装依赖
            const installDeps = spawn(pipExe, ['install', '-r', requirementsPath], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });

            let installStdout = '';
            let installStderr = '';

            installDeps.stdout?.on('data', (data: Buffer) => {
                installStdout += data.toString();
            });

            installDeps.stderr?.on('data', (data: Buffer) => {
                installStderr += data.toString();
            });

            installDeps.on('close', (installCode) => {
                if (installCode === 0) {
                    logger.info({ serviceName }, 'Dependencies installed successfully');
                    resolve();
                } else {
                    const error = `Failed to install dependencies: ${installStderr || installStdout}`;
                    logger.error({ serviceName, requirementsPath, code: installCode, stderr: installStderr, stdout: installStdout }, error);
                    reject(new Error(error));
                }
            });

            installDeps.on('error', (error) => {
                logger.error({ serviceName, requirementsPath, error }, 'Failed to spawn pip install process');
                reject(error);
            });
        });

        upgradePip.on('error', (error) => {
            logger.error({ serviceName, error }, 'Failed to spawn pip upgrade process');
            reject(error);
        });
    });
}

/**
 * 确保虚拟环境已设置（如果不存在则创建并安装依赖）
 */
export async function ensureVenvSetup(
    config: PythonServiceConfig,
    serviceName: string
): Promise<void> {
    const { venvPath, servicePath } = config;
    const requirementsPath = path.join(servicePath, 'requirements.txt');

    // 检查虚拟环境是否存在
    if (!venvExists(venvPath)) {
        logger.info({ serviceName, venvPath }, 'Virtual environment does not exist, setting up...');

        try {
            // 创建虚拟环境
            await createVenv(venvPath, serviceName);

            // 安装依赖
            await installDependencies(venvPath, requirementsPath, serviceName);

            logger.info({ serviceName, venvPath }, 'Virtual environment setup completed');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(
                {
                    serviceName,
                    venvPath,
                    requirementsPath,
                    error: errorMessage,
                },
                'Failed to setup virtual environment'
            );
            throw new Error(`Failed to setup virtual environment for ${serviceName}: ${errorMessage}`);
        }
    } else {
        logger.debug({ serviceName, venvPath }, 'Virtual environment already exists');
    }
}

