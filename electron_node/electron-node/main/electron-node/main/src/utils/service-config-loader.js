"use strict";
/**
 * ServiceConfigLoader - 服务配置加载器
 *
 * 从 service.json 读取服务配置，提供向后兼容性
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
exports.loadServiceConfigFromJson = loadServiceConfigFromJson;
exports.convertToPythonServiceConfig = convertToPythonServiceConfig;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../logger"));
const service_registry_1 = require("../service-registry");
const platform_adapter_1 = require("../platform-adapter");
/**
 * 从 service.json 加载配置（如果服务已安装）
 */
async function loadServiceConfigFromJson(serviceId, servicesDir) {
    try {
        const registryManager = new service_registry_1.ServiceRegistryManager(servicesDir);
        await registryManager.loadRegistry();
        const current = registryManager.getCurrent(serviceId);
        if (!current) {
            return null;
        }
        const serviceJsonPath = current.service_json_path;
        // 读取 service.json
        const content = await fs.readFile(serviceJsonPath, 'utf-8');
        const serviceJson = JSON.parse(content);
        // 获取平台配置
        const platform = (0, platform_adapter_1.getPlatformAdapter)().getPlatformId();
        const platformConfig = serviceJson.platforms[platform];
        if (!platformConfig) {
            logger_1.default.warn({ serviceId, platform }, 'Platform config not found in service.json');
            return null;
        }
        return {
            serviceJson,
            platformConfig,
            installPath: current.install_path,
        };
    }
    catch (error) {
        logger_1.default.debug({ error, serviceId }, 'Failed to load service.json, will use fallback config');
        return null;
    }
}
/**
 * 将 service.json 的配置转换为 PythonServiceConfig 格式
 */
function convertToPythonServiceConfig(serviceId, platformConfig, installPath, projectRoot) {
    const execProgram = path.isAbsolute(platformConfig.exec.program)
        ? platformConfig.exec.program
        : path.join(installPath, platformConfig.exec.program);
    const workingDir = path.isAbsolute(platformConfig.exec.cwd)
        ? platformConfig.exec.cwd
        : path.join(installPath, platformConfig.exec.cwd);
    return {
        name: serviceId,
        port: platformConfig.default_port,
        servicePath: installPath,
        scriptPath: execProgram,
        workingDir,
        exec: {
            program: execProgram,
            args: platformConfig.exec.args.map(arg => {
                // 替换路径变量
                return arg
                    .replace('${cwd}', workingDir)
                    .replace('${install_path}', installPath);
            }),
        },
    };
}
