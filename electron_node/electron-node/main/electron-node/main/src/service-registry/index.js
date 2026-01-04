"use strict";
/**
 * ServiceRegistry - 服务注册表管理
 *
 * 维护 installed.json 和 current.json
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
exports.ServiceRegistryManager = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const logger_1 = __importDefault(require("../logger"));
class ServiceRegistryManager {
    constructor(servicesDir) {
        // 注册表文件直接放在 services 目录下，而不是 services/registry 子目录
        this.registryPath = servicesDir;
        this.installedPath = path.join(servicesDir, 'installed.json');
        this.currentPath = path.join(servicesDir, 'current.json');
        this.registry = {
            installed: {},
            current: {},
        };
    }
    /**
     * 加载注册表
     */
    async loadRegistry() {
        try {
            // 确保目录存在
            await fs.mkdir(this.registryPath, { recursive: true });
            // 加载 installed.json
            try {
                const installedData = await fs.readFile(this.installedPath, 'utf-8');
                this.registry.installed = JSON.parse(installedData);
                // 替换路径占位符 {SERVICES_DIR} 为实际路径
                // 将 Windows 路径中的反斜杠转换为正斜杠以匹配占位符格式
                const servicesDirNormalized = this.registryPath.replace(/\\/g, '/');
                // 降低服务注册表加载日志级别为debug，减少终端输出
                logger_1.default.debug({
                    registryPath: this.registryPath,
                    servicesDirNormalized,
                    hasPlaceholder: installedData.includes('{SERVICES_DIR}'),
                    installedCount: Object.keys(this.registry.installed).length
                }, 'Loading installed.json and replacing path placeholders');
                this.registry.installed = this.replacePathPlaceholders(this.registry.installed, servicesDirNormalized);
                // 验证替换是否成功
                const afterReplace = JSON.stringify(this.registry.installed);
                if (afterReplace.includes('{SERVICES_DIR}')) {
                    logger_1.default.warn({}, 'Path placeholder replacement may have failed');
                }
                else {
                    // 降低服务注册表相关日志级别为debug，减少终端输出
                    logger_1.default.debug({}, 'Path placeholder replacement successful');
                }
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    logger_1.default.error({ error, path: this.installedPath }, 'Failed to load installed.json');
                }
                this.registry.installed = {};
            }
            // 加载 current.json
            try {
                const currentData = await fs.readFile(this.currentPath, 'utf-8');
                this.registry.current = JSON.parse(currentData);
                // 替换路径占位符
                const servicesDirNormalized = this.registryPath.replace(/\\/g, '/');
                this.registry.current = this.replacePathPlaceholders(this.registry.current, servicesDirNormalized);
            }
            catch (error) {
                if (error.code !== 'ENOENT') {
                    logger_1.default.error({ error, path: this.currentPath }, 'Failed to load current.json');
                }
                this.registry.current = {};
            }
            // 降低服务注册表加载日志级别为debug，减少终端输出
            logger_1.default.debug({
                installedCount: Object.keys(this.registry.installed).length,
                currentCount: Object.keys(this.registry.current).length,
            }, 'Service registry loaded');
            return this.registry;
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to load service registry');
            throw error;
        }
    }
    /**
     * 递归替换对象中的路径占位符
     */
    replacePathPlaceholders(obj, servicesDir) {
        if (typeof obj === 'string') {
            return obj.replace(/{SERVICES_DIR}/g, servicesDir);
        }
        else if (Array.isArray(obj)) {
            return obj.map(item => this.replacePathPlaceholders(item, servicesDir));
        }
        else if (obj && typeof obj === 'object') {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.replacePathPlaceholders(value, servicesDir);
            }
            return result;
        }
        return obj;
    }
    /**
     * 保存注册表
     */
    async saveRegistry() {
        try {
            // 确保目录存在
            await fs.mkdir(this.registryPath, { recursive: true });
            // 保存 installed.json
            await fs.writeFile(this.installedPath, JSON.stringify(this.registry.installed, null, 2), 'utf-8');
            // 保存 current.json
            await fs.writeFile(this.currentPath, JSON.stringify(this.registry.current, null, 2), 'utf-8');
            logger_1.default.debug({}, 'Service registry saved');
        }
        catch (error) {
            logger_1.default.error({ error }, 'Failed to save service registry');
            throw error;
        }
    }
    /**
     * 注册已安装的服务版本
     */
    async registerInstalled(serviceId, version, platform, installPath, serviceJsonPath, sizeBytes) {
        if (!this.registry.installed[serviceId]) {
            this.registry.installed[serviceId] = {};
        }
        const key = `${version}::${platform}`;
        this.registry.installed[serviceId][key] = {
            version,
            platform,
            installed_at: new Date().toISOString(),
            service_id: serviceId,
            service_json_path: serviceJsonPath, // 可选：只有通过服务包管理器安装的服务才有
            install_path: installPath,
            size_bytes: sizeBytes, // 从 services_index.json 的 artifact.size_bytes 复制而来
        };
        await this.saveRegistry();
        logger_1.default.info({ serviceId, version, platform, sizeBytes }, 'Registered installed service version');
    }
    /**
     * 取消注册已安装的服务版本
     */
    async unregisterInstalled(serviceId, version, platform) {
        if (!this.registry.installed[serviceId]) {
            return;
        }
        const key = `${version}::${platform}`;
        delete this.registry.installed[serviceId][key];
        // 如果该服务没有其他版本，删除服务条目
        if (Object.keys(this.registry.installed[serviceId]).length === 0) {
            delete this.registry.installed[serviceId];
        }
        await this.saveRegistry();
        logger_1.default.info({ serviceId, version, platform }, 'Unregistered installed service version');
    }
    /**
     * 获取已安装的服务版本
     */
    getInstalled(serviceId, version, platform) {
        if (!this.registry.installed[serviceId]) {
            return null;
        }
        const key = `${version}::${platform}`;
        return this.registry.installed[serviceId][key] || null;
    }
    /**
     * 列出所有已安装的服务版本
     */
    listInstalled(serviceId) {
        const result = [];
        const services = serviceId
            ? { [serviceId]: this.registry.installed[serviceId] || {} }
            : this.registry.installed;
        for (const [sid, versions] of Object.entries(services)) {
            if (!versions)
                continue;
            for (const versionInfo of Object.values(versions)) {
                result.push(versionInfo);
            }
        }
        return result;
    }
    /**
     * 设置当前激活的服务版本
     */
    async setCurrent(serviceId, version, platform, serviceJsonPath, installPath) {
        this.registry.current[serviceId] = {
            service_id: serviceId,
            version,
            platform,
            activated_at: new Date().toISOString(),
            service_json_path: serviceJsonPath,
            install_path: installPath,
        };
        await this.saveRegistry();
        logger_1.default.info({ serviceId, version, platform }, 'Set current service version');
    }
    /**
     * 获取当前激活的服务版本
     */
    getCurrent(serviceId) {
        return this.registry.current[serviceId] || null;
    }
    /**
     * 移除当前激活的服务版本
     */
    async removeCurrent(serviceId) {
        delete this.registry.current[serviceId];
        await this.saveRegistry();
        logger_1.default.info({ serviceId }, 'Removed current service version');
    }
    /**
     * 获取上一个版本（用于回滚）
     */
    getPrevious(serviceId) {
        const current = this.getCurrent(serviceId);
        if (!current) {
            return null;
        }
        const installed = this.listInstalled(serviceId);
        // 找出不是当前版本的已安装版本，选择最新的一个
        const previous = installed
            .filter(v => !(v.version === current.version && v.platform === current.platform))
            .sort((a, b) => {
            // 按安装时间倒序排列
            return new Date(b.installed_at).getTime() - new Date(a.installed_at).getTime();
        })[0];
        return previous || null;
    }
}
exports.ServiceRegistryManager = ServiceRegistryManager;
