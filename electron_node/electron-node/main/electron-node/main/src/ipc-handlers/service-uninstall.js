"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopServiceById = stopServiceById;
exports.uninstallService = uninstallService;
const logger_1 = __importDefault(require("../logger"));
/**
 * 根据 serviceId 停止对应的服务
 */
async function stopServiceById(serviceId, rustServiceManager, pythonServiceManager) {
    try {
        // 根据 serviceId 判断服务类型
        if (serviceId === 'node-inference') {
            // Rust 推理服务
            if (rustServiceManager) {
                const status = rustServiceManager.getStatus();
                if (status.running) {
                    logger_1.default.info({ serviceId }, 'Stopping Rust inference service before uninstall');
                    await rustServiceManager.stop();
                    logger_1.default.info({ serviceId }, 'Rust inference service stopped');
                }
                else {
                    logger_1.default.debug({ serviceId }, 'Rust inference service is not running, skipping stop');
                }
            }
        }
        else if (serviceId === 'nmt-m2m100') {
            // Python NMT 服务
            if (pythonServiceManager) {
                const statuses = pythonServiceManager.getAllServiceStatuses();
                const nmtStatus = statuses.find(s => s.name === 'nmt');
                if (nmtStatus?.running) {
                    logger_1.default.info({ serviceId }, 'Stopping Python NMT service before uninstall');
                    await pythonServiceManager.stopService('nmt');
                    logger_1.default.info({ serviceId }, 'Python NMT service stopped');
                }
                else {
                    logger_1.default.debug({ serviceId }, 'Python NMT service is not running, skipping stop');
                }
            }
        }
        else if (serviceId === 'piper-tts') {
            // Python TTS 服务
            if (pythonServiceManager) {
                const statuses = pythonServiceManager.getAllServiceStatuses();
                const ttsStatus = statuses.find(s => s.name === 'tts');
                if (ttsStatus?.running) {
                    logger_1.default.info({ serviceId }, 'Stopping Python TTS service before uninstall');
                    await pythonServiceManager.stopService('tts');
                    logger_1.default.info({ serviceId }, 'Python TTS service stopped');
                }
                else {
                    logger_1.default.debug({ serviceId }, 'Python TTS service is not running, skipping stop');
                }
            }
        }
        else if (serviceId === 'your-tts' || serviceId === 'yourtts') {
            // Python YourTTS 服务
            if (pythonServiceManager) {
                const statuses = pythonServiceManager.getAllServiceStatuses();
                const yourttsStatus = statuses.find(s => s.name === 'yourtts');
                if (yourttsStatus?.running) {
                    logger_1.default.info({ serviceId }, 'Stopping Python YourTTS service before uninstall');
                    await pythonServiceManager.stopService('yourtts');
                    logger_1.default.info({ serviceId }, 'Python YourTTS service stopped');
                }
                else {
                    logger_1.default.debug({ serviceId }, 'Python YourTTS service is not running, skipping stop');
                }
            }
        }
        else {
            logger_1.default.warn({ serviceId }, 'Unknown service ID, cannot determine service type to stop');
        }
    }
    catch (error) {
        logger_1.default.error({ error: error.message, serviceId }, 'Failed to stop service before uninstall');
        // 不抛出错误，继续执行卸载流程
    }
}
async function uninstallService(serviceId, version, serviceRegistryManager, rustServiceManager, pythonServiceManager) {
    try {
        if (!serviceRegistryManager) {
            logger_1.default.error({}, 'Service registry manager not initialized');
            throw new Error('服务注册表管理器未初始化');
        }
        logger_1.default.info({ serviceId, version }, 'Starting service uninstall');
        // 首先停止服务
        await stopServiceById(serviceId, rustServiceManager, pythonServiceManager);
        // 获取平台信息
        const platformAdapter = require('../platform-adapter').getPlatformAdapter();
        const platform = platformAdapter.getPlatformId();
        // 如果指定了版本，卸载指定版本；否则卸载所有版本
        if (version) {
            // 获取已安装的服务信息
            const installed = serviceRegistryManager.getInstalled(serviceId, version, platform);
            if (!installed) {
                logger_1.default.warn({ serviceId, version, platform }, 'Service not found in registry');
                return false;
            }
            // 删除服务包文件
            const fs = require('fs').promises;
            try {
                if (await fs.access(installed.install_path).then(() => true).catch(() => false)) {
                    await fs.rm(installed.install_path, { recursive: true, force: true });
                    logger_1.default.info({ serviceId, version, platform, installPath: installed.install_path }, 'Service package files deleted');
                }
                else {
                    logger_1.default.warn({ installPath: installed.install_path }, 'Service package directory does not exist, skipping deletion');
                }
            }
            catch (error) {
                logger_1.default.error({ error: error.message, installPath: installed.install_path }, 'Failed to delete service package files');
                throw new Error(`删除服务文件失败: ${error.message}`);
            }
            // 从注册表中删除
            await serviceRegistryManager.unregisterInstalled(serviceId, version, platform);
            logger_1.default.info({ serviceId, version, platform }, 'Service unregistered from registry');
        }
        else {
            // 卸载所有版本
            const installed = serviceRegistryManager.listInstalled(serviceId);
            for (const service of installed) {
                // 删除服务包文件
                const fs = require('fs').promises;
                try {
                    if (await fs.access(service.install_path).then(() => true).catch(() => false)) {
                        await fs.rm(service.install_path, { recursive: true, force: true });
                        logger_1.default.info({ serviceId: service.service_id, version: service.version, platform: service.platform, installPath: service.install_path }, 'Service package files deleted');
                    }
                    else {
                        logger_1.default.warn({ installPath: service.install_path }, 'Service package directory does not exist, skipping deletion');
                    }
                }
                catch (error) {
                    logger_1.default.error({ error: error.message, installPath: service.install_path }, 'Failed to delete service package files');
                    // 继续删除其他版本，不中断整个卸载流程
                }
                // 从注册表中删除
                await serviceRegistryManager.unregisterInstalled(service.service_id, service.version, service.platform);
            }
            logger_1.default.info({ serviceId, uninstalledCount: installed.length }, 'All service versions uninstalled');
        }
        return true;
    }
    catch (error) {
        logger_1.default.error({ error: error.message, stack: error.stack, serviceId, version }, 'Failed to uninstall service');
        throw error;
    }
}
